/**
 * Weather on file for every day there are sales: reading the weather service's
 * answer, working out which days still need fetching, and naming a day by the
 * weather a guest would have felt. Pure: no network, no database.
 */

import { addDays, type ISODate } from "./dates";

export interface WeatherRow {
  date: ISODate;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
  code: number;
  apparentMaxC: number | null;
  snowCm: number | null;
  windMaxKph: number | null;
  /** Rain and melted snow from 11am to 9pm local time; null when the hourly figures are missing. */
  precipDayMm: number | null;
}

/** The hours that count as "during the day" for rain: 11am up to (not including) 9pm. */
export const DAY_WINDOW: readonly [number, number] = [11, 21];

/** The daily and hourly fields asked of the weather service (forecast and archive take the same names). */
export const WEATHER_DAILY = "temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,snowfall_sum,wind_speed_10m_max,weather_code";
export const WEATHER_HOURLY = "precipitation";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Rows from an Open-Meteo answer (forecast or archive). Days with no temperature yet are skipped. */
export function parseOpenMeteo(body: unknown): WeatherRow[] {
  const j = (body ?? {}) as { daily?: Record<string, unknown>; hourly?: Record<string, unknown> };
  const d = j.daily ?? {};
  const times = arr(d.time);
  if (!times.length) return [];

  // Rain in the day window, summed per date from the hourly figures.
  const dayRain = new Map<string, number>();
  const hTime = arr(j.hourly?.time);
  const hRain = arr(j.hourly?.precipitation);
  for (let i = 0; i < hTime.length; i++) {
    const t = hTime[i];
    const mm = num(hRain[i]);
    if (typeof t !== "string" || mm == null) continue;
    const hour = Number(t.slice(11, 13));
    if (hour < DAY_WINDOW[0] || hour >= DAY_WINDOW[1]) continue;
    const date = t.slice(0, 10);
    dayRain.set(date, (dayRain.get(date) ?? 0) + mm);
  }

  const out: WeatherRow[] = [];
  times.forEach((t, i) => {
    const max = num(arr(d.temperature_2m_max)[i]);
    const min = num(arr(d.temperature_2m_min)[i]);
    if (typeof t !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t) || max == null || min == null) return;
    const rain = dayRain.get(t);
    out.push({
      date: t,
      tempMaxC: max,
      tempMinC: min,
      precipMm: num(arr(d.precipitation_sum)[i]) ?? 0,
      code: num(arr(d.weather_code)[i]) ?? 0,
      apparentMaxC: num(arr(d.apparent_temperature_max)[i]),
      snowCm: num(arr(d.snowfall_sum)[i]),
      windMaxKph: num(arr(d.wind_speed_10m_max)[i]),
      precipDayMm: rain == null ? null : round1(rain),
    });
  });
  return out;
}

/** The archive runs about five days behind; the nightly forecast call covers the days since. */
export const ARCHIVE_LAG_DAYS = 5;
const SPAN_DAYS = 365;

/**
 * Date spans to ask the weather archive for: from the first day with sales to
 * five days ago, skipping the stretches already on file with detail, in
 * year-sized pieces, oldest first.
 */
export function backfillSpans(i: { firstSale: ISODate | null; today: ISODate; have: ReadonlySet<ISODate>; maxSpans?: number }): { from: ISODate; to: ISODate }[] {
  if (!i.firstSale) return [];
  const last = addDays(i.today, -ARCHIVE_LAG_DAYS);
  const spans: { from: ISODate; to: ISODate }[] = [];
  let d = i.firstSale;
  while (d <= last && spans.length < (i.maxSpans ?? 8)) {
    if (i.have.has(d)) {
      d = addDays(d, 1);
      continue;
    }
    // A span starts at a missing day and runs up to a year; it ends early at the last missing day in reach.
    const cap = addDays(d, SPAN_DAYS) < last ? addDays(d, SPAN_DAYS) : last;
    let end = cap;
    while (end > d && i.have.has(end)) end = addDays(end, -1);
    spans.push({ from: d, to: end });
    d = addDays(end, 1);
  }
  return spans;
}

// ---- What kind of day it was -----------------------------------------------------

export type WeatherKind = "snow" | "heavyRain" | "rain" | "hot" | "cold" | "fair";
export const WEATHER_KINDS: WeatherKind[] = ["fair", "rain", "heavyRain", "snow", "hot", "cold"];
export const WEATHER_KIND_LABEL: Record<WeatherKind, string> = { fair: "Fair", rain: "Rain", heavyRain: "Heavy rain", snow: "Snow", hot: "Hot", cold: "Freezing" };
export const WEATHER_KIND_HINT: Record<WeatherKind, string> = {
  fair: "Dry or a light shower, 33–85°F",
  rain: "0.2–0.6 in of rain, 11am–9pm",
  heavyRain: "Over 0.6 in of rain, 11am–9pm",
  snow: "An inch of snow or more",
  hot: "86°F or hotter",
  cold: "High of 32°F or below",
};

export const RAIN_MM = 5;
export const HEAVY_RAIN_MM = 15;
export const SNOW_CM = 2.5;
export const HOT_C = 30;
export const COLD_C = 0;

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

/** One word for the day's weather, the worst thing first: snow, then rain, then heat or cold. */
export function weatherKind(w: { precipMm: number; tempMaxC: number; snowCm?: number | null; precipDayMm?: number | null; code?: number | null }): WeatherKind {
  if (w.snowCm != null ? w.snowCm >= SNOW_CM : SNOW_CODES.has(w.code ?? -1) && w.precipMm >= 2) return "snow";
  const wet = w.precipDayMm ?? w.precipMm;
  if (wet >= HEAVY_RAIN_MM) return "heavyRain";
  if (wet >= RAIN_MM) return "rain";
  if (w.tempMaxC >= HOT_C) return "hot";
  if (w.tempMaxC <= COLD_C) return "cold";
  return "fair";
}
