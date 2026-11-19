/**
 * What each holiday and school break does to sales here, learned the same way
 * as the weather: on those days, how far did sales run from the forecast,
 * compared with ordinary days? Each day is replayed from the days before it,
 * and a holiday is only switched on where that replay landed closer.
 *
 * Holidays come once a year, so the rules differ from the weather's: two past
 * occurrences are enough to start, and to make up for so few days a holiday
 * has to cut the miss by 5%, not 1%, and move the day by at least a tenth, to
 * earn its place.
 *
 * Days the owner planned for (an event, a manual change) are left alone
 * entirely: their own number wins, and nothing is learned from them.
 *
 * Also here: holidays the business has been closed on every year, which no
 * replay can score (a closed day has no sales to compare).
 *
 * Pure: plain data in, plain data out.
 */

import { addDays, type ISODate } from "./dates";
import { HOLIDAY_KINDS, holidayKind, SINGLE_DAY_HOLIDAYS, type HolidayKind } from "./holidays";

/** Days of "no effect" mixed into every holiday: two occurrences move it halfway. */
export const HOLIDAY_PRIOR_DAYS = 2;
export const HOLIDAY_MIN_DAYS = 2;
export const HOLIDAY_MIN_ORDINARY = 30;
/** A holiday Monday can be several times a usual Monday; a quiet Christmas Eve a fraction of a usual day. */
export const HOLIDAY_CLAMP: [number, number] = [0.3, 3];
export const HOLIDAY_MIN_SCORED = 3;
export const HOLIDAY_MIN_GAIN = 0.05;
/** With two dozen holidays tested on a handful of days each, a small effect can pass by luck: only a tenth or more counts. */
export const HOLIDAY_MIN_SIZE = 0.1;

export interface HolidayDay {
  date: ISODate;
  actual: number;
  /** The forecast made the evening before, with no holiday in it. */
  forecast: number | null;
  /** The owner had their own plan for the day (an event or a manual change). */
  event?: boolean;
}

interface Tally {
  actual: number;
  forecast: number;
  days: number;
}
const tally = (): Tally => ({ actual: 0, forecast: 0, days: 0 });

/** The multiplier for one holiday: how sales ran against the forecast on it, relative to ordinary days, pulled toward 1 and clamped. */
export function holidayFactor(kind: Tally, ordinary: Tally): number {
  if (kind.days < HOLIDAY_MIN_DAYS || ordinary.days < HOLIDAY_MIN_ORDINARY || kind.forecast <= 0 || ordinary.forecast <= 0 || ordinary.actual <= 0) return 1;
  const raw = kind.actual / kind.forecast / (ordinary.actual / ordinary.forecast);
  const shrunk = 1 + (raw - 1) * (kind.days / (kind.days + HOLIDAY_PRIOR_DAYS));
  return Math.min(HOLIDAY_CLAMP[1], Math.max(HOLIDAY_CLAMP[0], shrunk));
}

export interface HolidayEffect {
  kind: HolidayKind;
  /** Past days of this holiday it has learned from. */
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

export interface HolidayEffects {
  /** Every holiday seen at least once, in calendar order. */
  kinds: HolidayEffect[];
  ordinaryDays: number;
  /** Over every replayed day of a switched-on holiday. */
  scored: number;
  missWithout: number | null;
  missWith: number | null;
}

export function learnHolidayEffects(days: readonly HolidayDay[]): { effects: HolidayEffects; withHolidays: Map<ISODate, number> } {
  const sorted = [...days].filter((d) => d.forecast != null && d.forecast > 0 && d.actual > 0 && !d.event).sort((a, b) => a.date.localeCompare(b.date));
  const ordinary = tally();
  const seen = new Map<HolidayKind, Tally>();
  const replay = new Map<HolidayKind, { actual: number; without: number; with: number; days: number }>();
  const forecasts: { date: ISODate; kind: HolidayKind; forecast: number }[] = [];

  for (const d of sorted) {
    const f = d.forecast!;
    const kind = holidayKind(d.date);
    if (!kind) {
      ordinary.days++;
      ordinary.actual += d.actual;
      ordinary.forecast += f;
      continue;
    }
    if (!seen.has(kind)) {
      seen.set(kind, tally());
      replay.set(kind, { actual: 0, without: 0, with: 0, days: 0 });
    }
    const t = seen.get(kind)!;
    const factor = holidayFactor(t, ordinary);
    if (factor !== 1) {
      const r = replay.get(kind)!;
      r.days++;
      r.actual += d.actual;
      r.without += Math.abs(f - d.actual);
      r.with += Math.abs(f * factor - d.actual);
      forecasts.push({ date: d.date, kind, forecast: f * factor });
    }
    t.days++;
    t.actual += d.actual;
    t.forecast += f;
  }

  const kinds: HolidayEffect[] = HOLIDAY_KINDS.filter((k) => seen.has(k)).map((kind) => {
    const r = replay.get(kind)!;
    const factor = holidayFactor(seen.get(kind)!, ordinary);
    const missWithout = r.actual > 0 ? r.without / r.actual : null;
    const missWith = r.actual > 0 ? r.with / r.actual : null;
    const used = r.days >= HOLIDAY_MIN_SCORED && missWith != null && missWithout != null && missWith <= missWithout * (1 - HOLIDAY_MIN_GAIN) && Math.abs(factor - 1) >= HOLIDAY_MIN_SIZE;
    return { kind, days: seen.get(kind)!.days, factor, scored: r.days, missWithout, missWith, used };
  });

  const usedKinds = new Set(kinds.filter((k) => k.used).map((k) => k.kind));
  const on = [...usedKinds].map((k) => replay.get(k)!);
  const actual = on.reduce((s, r) => s + r.actual, 0);
  return {
    effects: {
      kinds,
      ordinaryDays: ordinary.days,
      scored: on.reduce((s, r) => s + r.days, 0),
      missWithout: actual > 0 ? on.reduce((s, r) => s + r.without, 0) / actual : null,
      missWith: actual > 0 ? on.reduce((s, r) => s + r.with, 0) / actual : null,
    },
    // Only the switched-on holidays change a forecast.
    withHolidays: new Map(forecasts.filter((x) => usedKinds.has(x.kind)).map((x) => [x.date, x.forecast])),
  };
}

/** Occurrences needed, all of them closed, before a holiday is read as "closed every year". */
export const CLOSED_MIN_YEARS = 3;

/**
 * Single-day holidays the business was closed on at each of its last three
 * occurrences. An occurrence only counts when that weekday would normally have
 * been open: open on at least two of the same weekday in the two weeks before
 * and the two weeks after. So a Christmas Eve that fell on a Tuesday, at a
 * place that doesn't open Tuesdays, says nothing, and neither does a holiday
 * inside a long shutdown.
 */
export function usuallyClosed(i: { openDays: ReadonlySet<ISODate>; from: ISODate; today: ISODate }): HolidayKind[] {
  const history = new Map<HolidayKind, boolean[]>();
  for (let d = i.from; d < i.today; d = addDays(d, 1)) {
    const kind = holidayKind(d);
    if (!kind || !SINGLE_DAY_HOLIDAYS.has(kind)) continue;
    const sameWeekdayOpen = [-14, -7, 7, 14].filter((k) => i.openDays.has(addDays(d, k))).length;
    if (sameWeekdayOpen < 2) continue;
    if (!history.has(kind)) history.set(kind, []);
    history.get(kind)!.push(i.openDays.has(d));
  }
  return HOLIDAY_KINDS.filter((k) => {
    const h = history.get(k);
    return !!h && h.length >= CLOSED_MIN_YEARS && h.slice(-CLOSED_MIN_YEARS).every((open) => !open);
  });
}

/** Bumped whenever the way holidays are worked out changes, so what's stored is learned again at once. */
export const HOLIDAY_RULES = 2;

/** What's kept between nightly runs for the live forecast. */
export interface StoredHolidays {
  rules: number;
  learnedOn: ISODate;
  kinds: { kind: string; factor: number; days: number; used: boolean }[];
  closed: string[];
}

export const toStoredHolidays = (e: HolidayEffects, closed: readonly HolidayKind[], learnedOn: ISODate): StoredHolidays => ({
  rules: HOLIDAY_RULES,
  learnedOn,
  kinds: e.kinds.map((k) => ({ kind: k.kind, factor: Math.round(k.factor * 1000) / 1000, days: k.days, used: k.used })),
  closed: [...closed],
});

export function parseStoredHolidays(json: string | null | undefined): StoredHolidays | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as StoredHolidays;
    if (typeof v?.learnedOn !== "string" || v.rules !== HOLIDAY_RULES || !Array.isArray(v.kinds)) return null;
    const kinds = v.kinds.filter((k) => k && typeof k.kind === "string" && Number.isFinite(k.factor) && k.factor > 0 && Number.isFinite(k.days));
    return { rules: HOLIDAY_RULES, learnedOn: v.learnedOn, kinds: kinds.map((k) => ({ kind: k.kind, factor: k.factor, days: k.days, used: k.used === true })), closed: Array.isArray(v.closed) ? v.closed.filter((c) => typeof c === "string") : [] };
  } catch {
    return null;
  }
}

export interface HolidayPlan {
  kind: HolidayKind;
  /** What the forecast is multiplied by: 0 when closed every year, 1 when the holiday isn't switched on. */
  factor: number;
  /** Past days the factor was learned from. */
  days: number;
  closed: boolean;
  used: boolean;
}

/** What the forecast does for a date that falls on a holiday; null on an ordinary day. */
export function holidayPlan(stored: StoredHolidays | null, date: ISODate): HolidayPlan | null {
  const kind = holidayKind(date);
  if (!kind) return null;
  if (stored?.closed.includes(kind)) return { kind, factor: 0, days: 0, closed: true, used: true };
  const k = stored?.kinds.find((x) => x.kind === kind);
  return k?.used ? { kind, factor: k.factor, days: k.days, closed: false, used: true } : { kind, factor: 1, days: k?.days ?? 0, closed: false, used: false };
}

export interface UpcomingHoliday extends HolidayPlan {
  from: ISODate;
  to: ISODate;
}

/** The holidays in the next `days` days, a stretch of the same one as a single entry. */
export function upcomingHolidays(stored: StoredHolidays | null, today: ISODate, days = 28): UpcomingHoliday[] {
  const out: UpcomingHoliday[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const p = holidayPlan(stored, d);
    if (!p) continue;
    const last = out[out.length - 1];
    if (last && last.kind === p.kind && addDays(last.to, 1) === d) last.to = d;
    else out.push({ ...p, from: d, to: d });
  }
  return out;
}
