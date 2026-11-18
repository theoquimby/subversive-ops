/**
 * Weather on file for every day there are sales: reading the Weather Service's
 * forecast and NOAA's record of what happened, working out which days still
 * need fetching, and naming a day by the weather a guest would have felt.
 * Both sources are US government data, free for any use. Pure: no network, no database.
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
  /** Rain and melted snow from 11am to 9pm local time; null when there are no hourly figures (past days). */
  precipDayMm: number | null;
}

/** The hours that count as "during the day" for rain: 11am up to (not including) 9pm. */
export const DAY_WINDOW: readonly [number, number] = [11, 21];

export const RAIN_MM = 5;
export const HEAVY_RAIN_MM = 15;
export const SNOW_CM = 2.5;
export const HOT_C = 30;
export const COLD_C = 0;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- The forecast: US National Weather Service grid data (public domain) ---------------

const HOUR = 3_600_000;

/** A local date and hour for an instant, in the business's time zone. */
function localClock(timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const cache = new Map<number, { date: ISODate; hour: number }>();
  return (ms: number) => {
    let c = cache.get(ms);
    if (!c) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      c = { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
      cache.set(ms, c);
    }
    return c;
  };
}

/** "2026-11-18T12:00:00+00:00/PT6H" → where it starts and how many hours it runs. */
export function parseValidTime(v: unknown): { start: number; hours: number } | null {
  if (typeof v !== "string") return null;
  const [iso, dur] = v.split("/");
  const start = Date.parse(iso);
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur ?? "");
  if (!Number.isFinite(start) || !m) return null;
  const hours = Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + (m[3] ? 1 : 0);
  return hours > 0 ? { start, hours } : null;
}

type Span = { start: number; hours: number; value: number };

function series(props: Record<string, unknown>, name: string): Span[] {
  const s = props[name] as { values?: unknown } | undefined;
  return arr(s?.values).flatMap((x) => {
    const o = (x ?? {}) as { validTime?: unknown; value?: unknown };
    const t = parseValidTime(o.validTime);
    const value = num(o.value);
    return t && value != null ? [{ ...t, value }] : [];
  });
}

/** When there's no rain amount that far out, a 60% chance or more during the day counts as a rainy day. */
export const LIKELY_RAIN_PCT = 60;

interface GridDay {
  max?: number;
  min?: number;
  rain: number;
  rainDay: number;
  rainHours: number;
  rainDayHours: number;
  snow: number;
  snowHours: number;
  wind?: number;
  feels?: number;
  sky: number[];
  pop: number;
}

/**
 * Daily rows from the Weather Service's grid forecast (api.weather.gov
 * /gridpoints/…): highs and lows as it gives them, rain and snow shared out by
 * the hour from its six-hour totals, wind, and the feels-like high.
 *
 * Rain amounts only run about three days out; beyond that a day counts as
 * rainy when the chance of rain between 11am and 9pm reaches 60%.
 *
 * `partial` lists days whose rain total is missing hours already gone (today,
 * later in the day): the caller keeps the larger of that and what's on file.
 */
export function parseNwsGrid(body: unknown, timeZone: string): { rows: WeatherRow[]; partial: ISODate[] } {
  const props = ((body ?? {}) as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== "object") return { rows: [], partial: [] };
  const at = localClock(timeZone);
  const inWindow = (hour: number) => hour >= DAY_WINDOW[0] && hour < DAY_WINDOW[1];
  const windowHours = DAY_WINDOW[1] - DAY_WINDOW[0];

  const days = new Map<ISODate, GridDay>();
  const day = (d: ISODate) => {
    if (!days.has(d)) days.set(d, { rain: 0, rainDay: 0, rainHours: 0, rainDayHours: 0, snow: 0, snowHours: 0, sky: [], pop: 0 });
    return days.get(d)!;
  };
  const eachHour = (list: Span[], f: (d: GridDay, hour: number, s: Span) => void) => {
    for (const s of list) {
      for (let h = 0; h < s.hours; h++) {
        const c = at(s.start + h * HOUR);
        f(day(c.date), c.hour, s);
      }
    }
  };

  // The high belongs to the day it starts in; the overnight low to the morning it ends in.
  for (const s of series(props, "maxTemperature")) day(at(s.start).date).max = s.value;
  for (const s of series(props, "minTemperature")) {
    const d = day(at(s.start + (s.hours - 1) * HOUR).date);
    d.min = d.min == null ? s.value : Math.min(d.min, s.value);
  }
  eachHour(series(props, "quantitativePrecipitation"), (d, hour, s) => {
    d.rain += s.value / s.hours;
    d.rainHours++;
    if (inWindow(hour)) {
      d.rainDay += s.value / s.hours;
      d.rainDayHours++;
    }
  });
  eachHour(series(props, "snowfallAmount"), (d, _h, s) => {
    d.snow += s.value / s.hours;
    d.snowHours++;
  });
  eachHour(series(props, "windSpeed"), (d, _h, s) => {
    d.wind = Math.max(d.wind ?? 0, s.value);
  });
  eachHour(series(props, "apparentTemperature"), (d, hour, s) => {
    if (inWindow(hour)) d.feels = d.feels == null ? s.value : Math.max(d.feels, s.value);
  });
  eachHour(series(props, "skyCover"), (d, hour, s) => {
    if (inWindow(hour)) d.sky.push(s.value);
  });
  eachHour(series(props, "probabilityOfPrecipitation"), (d, hour, s) => {
    if (inWindow(hour)) d.pop = Math.max(d.pop, s.value);
  });

  const rows: WeatherRow[] = [];
  const partial: ISODate[] = [];
  const sorted = [...days].sort((a, b) => a[0].localeCompare(b[0]));
  // The first day with a high and a low is today (or tomorrow, once today's high has passed).
  const first = sorted.find(([, d]) => d.max != null && d.min != null)?.[0];
  for (const [date, d] of sorted) {
    if (d.max == null || d.min == null) continue;
    const fullWindow = d.rainDayHours >= windowHours;
    // Hours of the day window with no amount: gone already (the first day) or beyond where amounts reach.
    const gone = !fullWindow && date === first;
    if (gone) partial.push(date);
    const proxy = !fullWindow && !gone && d.pop >= LIKELY_RAIN_PCT ? RAIN_MM + 1 : 0;
    const precipDayMm = Math.max(d.rainDay, proxy);
    const precipMm = Math.max(d.rain, proxy);
    const snowCm = d.snowHours > 0 ? d.snow / 10 : null;
    const snowy = snowCm != null ? snowCm >= 1 : proxy > 0 && d.max <= 1;
    const sky = d.sky.length ? d.sky.reduce((a, b) => a + b, 0) / d.sky.length : 0;
    rows.push({
      date,
      tempMaxC: round1(d.max),
      tempMinC: round1(Math.min(d.min, d.max)),
      precipMm: round1(precipMm),
      code: snowy ? 73 : precipDayMm >= RAIN_MM ? 63 : precipMm >= 1 ? 61 : sky >= 70 ? 3 : sky >= 35 ? 2 : 1,
      apparentMaxC: d.feels == null ? null : round1(d.feels),
      snowCm: snowCm == null ? null : round1(snowCm),
      windMaxKph: d.wind == null ? null : round1(d.wind),
      precipDayMm: round1(precipDayMm),
    });
  }
  return { rows, partial };
}

// ---- What happened: NOAA daily summaries (public domain) --------------------------------

/**
 * The station past weather is read from: NOAA's first-order station at Albany
 * International Airport, about 35 miles north of Catskill. Airport stations
 * report midnight to midnight with rain, snow and wind every day; the closer
 * volunteer stations read at 7am, which puts rain on the wrong day.
 */
export const NOAA_STATION = { id: "USW00014735", name: "Albany International Airport" } as const;
export const NOAA_DAILY_TYPES = "TMAX,TMIN,PRCP,SNOW,AWND,WSF2";

/** Rows from NOAA's daily summaries (metric units: °C, mm, m/s). Days with no high or low are skipped. */
export function parseNceiDaily(body: unknown): WeatherRow[] {
  const f = (v: unknown): number | null => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };
  return arr(body).flatMap((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const date = typeof r.DATE === "string" ? r.DATE.slice(0, 10) : "";
    const max = f(r.TMAX);
    const min = f(r.TMIN);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || max == null || min == null) return [];
    const precipMm = f(r.PRCP) ?? 0;
    const snowMm = f(r.SNOW);
    // No snow figure on a mild day means none fell; on a cold one it's unknown.
    const snowCm = snowMm != null ? snowMm / 10 : max > 4 ? 0 : null;
    const wind = f(r.WSF2) ?? f(r.AWND);
    const row: WeatherRow = {
      date,
      tempMaxC: max,
      tempMinC: min,
      precipMm,
      code: (snowCm ?? 0) >= 1 ? 73 : precipMm >= RAIN_MM ? 63 : precipMm >= 1 ? 61 : 1,
      apparentMaxC: null,
      snowCm: snowCm == null ? null : round1(snowCm),
      windMaxKph: wind == null ? null : round1(wind * 3.6),
      precipDayMm: null,
    };
    return [row];
  });
}

/** NOAA's daily summaries run about five days behind; the forecast on file stands in until they arrive. */
export const ARCHIVE_LAG_DAYS = 5;
const SPAN_DAYS = 365;

/**
 * Date spans to ask NOAA for: from the first day with sales to five days ago,
 * skipping the stretches already loaded, in year-sized pieces, oldest first.
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
  rain: "0.2–0.6 in of rain",
  heavyRain: "Over 0.6 in of rain",
  snow: "An inch of snow or more",
  hot: "86°F or hotter",
  cold: "High of 32°F or below",
};

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

/**
 * One word for the day's weather, the worst thing first: snow, then rain, then
 * heat or cold. Rain goes by the 11am–9pm amount when it's known (forecasts);
 * past days only have the whole day's total.
 */
export function weatherKind(w: { precipMm: number; tempMaxC: number; snowCm?: number | null; precipDayMm?: number | null; code?: number | null }): WeatherKind {
  if (w.snowCm != null ? w.snowCm >= SNOW_CM : SNOW_CODES.has(w.code ?? -1) && w.precipMm >= 2) return "snow";
  const wet = w.precipDayMm ?? w.precipMm;
  if (wet >= HEAVY_RAIN_MM) return "heavyRain";
  if (wet >= RAIN_MM) return "rain";
  if (w.tempMaxC >= HOT_C) return "hot";
  if (w.tempMaxC <= COLD_C) return "cold";
  return "fair";
}
