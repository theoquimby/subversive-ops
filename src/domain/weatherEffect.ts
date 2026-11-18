/**
 * What each kind of weather does to sales here, learned from the scorecard's
 * replay: on rain days, snow days and so on, how far did sales run from a
 * forecast that knew nothing about the weather, compared with fair days?
 *
 * Two safeguards keep it honest:
 *  - a kind with few days is pulled toward "no effect" (a handful of snow days
 *    shouldn't swing a forecast by a quarter);
 *  - every day is replayed using only the days before it, and a kind is only
 *    switched on where that replay landed closer than the forecast without it.
 *
 * Pure: plain data in, plain data out.
 */

import type { ISODate } from "./dates";
import type { WeatherKind } from "./weatherHistory";

export const EFFECT_KINDS: Exclude<WeatherKind, "fair">[] = ["rain", "heavyRain", "snow", "hot", "cold"];

/** Days of "no effect" mixed into every kind: 15 days of evidence move it halfway. */
export const EFFECT_PRIOR_DAYS = 15;
/** A kind needs this many days behind it before it changes a forecast at all… */
export const EFFECT_MIN_DAYS = 10;
/** …and this many fair days to compare against. */
export const EFFECT_MIN_FAIR = 30;
/** No single kind of weather may move a day by more than this either way. */
export const EFFECT_CLAMP: [number, number] = [0.5, 1.25];
/** A kind is switched on once its replay has this many days and beats the plain forecast by this share. */
export const EFFECT_MIN_SCORED = 20;
export const EFFECT_MIN_GAIN = 0.01;
/** Smaller than this isn't worth applying. */
const EFFECT_MIN_SIZE = 0.02;
/** Rain amounts in the forecast reach about three days; past that it's a chance of rain, so the effect is scaled back. */
export const EFFECT_FAR_DAYS = 4;
export const EFFECT_FAR_TRUST = 0.6;

export interface EffectDay {
  date: ISODate;
  actual: number;
  /** The forecast made the evening before, with no weather in it. */
  f1: number | null;
  weather: WeatherKind | null;
  /** Event days are forecast with weather, but nothing is learned from them. */
  event?: boolean;
}

interface Tally {
  actual: number;
  forecast: number;
  days: number;
}
const tally = (): Tally => ({ actual: 0, forecast: 0, days: 0 });

/**
 * The multiplier for one kind of weather: how sales ran against the forecast on
 * those days, relative to fair days, pulled toward 1 by `EFFECT_PRIOR_DAYS` and clamped.
 */
export function effectFactor(kind: Tally, fair: Tally): number {
  if (kind.days < EFFECT_MIN_DAYS || fair.days < EFFECT_MIN_FAIR || kind.forecast <= 0 || fair.forecast <= 0 || fair.actual <= 0) return 1;
  const raw = kind.actual / kind.forecast / (fair.actual / fair.forecast);
  const shrunk = 1 + (raw - 1) * (kind.days / (kind.days + EFFECT_PRIOR_DAYS));
  return Math.min(EFFECT_CLAMP[1], Math.max(EFFECT_CLAMP[0], shrunk));
}

export interface KindEffect {
  kind: Exclude<WeatherKind, "fair">;
  /** Days of this weather it has learned from. */
  days: number;
  /** The multiplier as it stands today (1 = no effect). */
  factor: number;
  /** Days replayed with a factor in play, and the typical miss on them without and with it. */
  scored: number;
  missWithout: number | null;
  missWith: number | null;
  /** Switched on: the replay with it beat the replay without it. */
  used: boolean;
}

export interface WeatherEffects {
  kinds: KindEffect[];
  fairDays: number;
  /** Over every replayed day of a switched-on kind. */
  scored: number;
  missWithout: number | null;
  missWith: number | null;
  /** The last day it learned from. */
  through: ISODate | null;
}

export interface EffectReplay {
  effects: WeatherEffects;
  /** The day-before forecast with weather, per date, as it would have been made then (only where a factor applied). */
  withWeather: Map<ISODate, number>;
}

/**
 * Walk through the days in order. Each day is forecast with the factor learned
 * from the days before it, then added to what's known. Returns today's factors,
 * how each kind's replay scored, and which kinds earned their place.
 */
export function learnWeatherEffects(days: readonly EffectDay[]): EffectReplay {
  const sorted = [...days].filter((d) => d.f1 != null && d.f1 > 0 && d.actual > 0 && d.weather != null).sort((a, b) => a.date.localeCompare(b.date));
  const fair = tally();
  const seen = new Map<string, Tally>(EFFECT_KINDS.map((k) => [k, tally()]));
  const replay = new Map<string, { actual: number; without: number; with: number; days: number }>(EFFECT_KINDS.map((k) => [k, { actual: 0, without: 0, with: 0, days: 0 }]));
  const withWeather = new Map<ISODate, number>();

  for (const d of sorted) {
    const f1 = d.f1!;
    const t = d.weather === "fair" ? fair : seen.get(d.weather!)!;
    if (d.weather !== "fair") {
      const factor = effectFactor(t, fair);
      if (factor !== 1) {
        const r = replay.get(d.weather!)!;
        r.days++;
        r.actual += d.actual;
        r.without += Math.abs(f1 - d.actual);
        r.with += Math.abs(f1 * factor - d.actual);
        withWeather.set(d.date, f1 * factor);
      }
    }
    if (d.event) continue;
    t.days++;
    t.actual += d.actual;
    t.forecast += f1;
  }

  const kinds: KindEffect[] = EFFECT_KINDS.map((kind) => {
    const r = replay.get(kind)!;
    const factor = effectFactor(seen.get(kind)!, fair);
    const missWithout = r.actual > 0 ? r.without / r.actual : null;
    const missWith = r.actual > 0 ? r.with / r.actual : null;
    const used = r.days >= EFFECT_MIN_SCORED && missWith != null && missWithout != null && missWith <= missWithout * (1 - EFFECT_MIN_GAIN) && Math.abs(factor - 1) >= EFFECT_MIN_SIZE;
    return { kind, days: seen.get(kind)!.days, factor, scored: r.days, missWithout, missWith, used };
  });

  const on = kinds.filter((k) => k.used).map((k) => replay.get(k.kind)!);
  const actual = on.reduce((s, r) => s + r.actual, 0);
  // Only the switched-on kinds change a forecast, so only their days count as "with weather".
  const usedKinds = new Set(kinds.filter((k) => k.used).map((k) => k.kind as string));
  for (const d of sorted) if (!usedKinds.has(d.weather!)) withWeather.delete(d.date);

  return {
    effects: {
      kinds,
      fairDays: fair.days,
      scored: on.reduce((s, r) => s + r.days, 0),
      missWithout: actual > 0 ? on.reduce((s, r) => s + r.without, 0) / actual : null,
      missWith: actual > 0 ? on.reduce((s, r) => s + r.with, 0) / actual : null,
      through: sorted.length ? sorted[sorted.length - 1].date : null,
    },
    withWeather,
  };
}

/** What's kept between nightly runs: just the factors in use. */
export interface StoredEffects {
  learnedOn: ISODate;
  kinds: { kind: string; factor: number; days: number; used: boolean }[];
}

export const toStored = (e: WeatherEffects, learnedOn: ISODate): StoredEffects => ({ learnedOn, kinds: e.kinds.map((k) => ({ kind: k.kind, factor: Math.round(k.factor * 1000) / 1000, days: k.days, used: k.used })) });

/** Reads the stored factors back, ignoring anything malformed. */
export function parseStored(json: string | null | undefined): StoredEffects | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as StoredEffects;
    if (typeof v?.learnedOn !== "string" || !Array.isArray(v.kinds)) return null;
    const kinds = v.kinds.filter((k) => k && typeof k.kind === "string" && Number.isFinite(k.factor) && k.factor > 0 && Number.isFinite(k.days));
    return { learnedOn: v.learnedOn, kinds: kinds.map((k) => ({ kind: k.kind, factor: k.factor, days: k.days, used: k.used === true })) };
  } catch {
    return null;
  }
}

/**
 * The multiplier for a day forecast `daysAhead` days out (0 = today) with this
 * kind of weather expected. Kinds that haven't earned their place give 1; four
 * or more days out the effect is scaled back, because by then the forecast is a
 * chance of rain, not an amount.
 */
export function weatherFactor(stored: StoredEffects | null, kind: WeatherKind | null, daysAhead: number): { factor: number; days: number } {
  const k = kind && kind !== "fair" ? stored?.kinds.find((x) => x.kind === kind && x.used) : undefined;
  if (!k) return { factor: 1, days: 0 };
  const trust = daysAhead >= EFFECT_FAR_DAYS ? EFFECT_FAR_TRUST : 1;
  return { factor: Math.round((1 + (k.factor - 1) * trust) * 1000) / 1000, days: k.days };
}
