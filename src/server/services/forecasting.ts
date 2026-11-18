import "server-only";
import { addDays, dateRange, daysBetween, ISODate, parseISODate, toISODate, weekday } from "@/domain/dates";
import { DayForecast, defaultHourlyShape, forecastSeries, hasYearOfHistory, hourlyShares, seasonalIndex, WeatherObs, YEAR_LAG } from "@/domain/forecast";
import { backtest, bias, mape } from "@/domain/forecastAccuracy";
import { parseStored, weatherFactor as learnedWeatherFactor, type StoredEffects } from "@/domain/weatherEffect";
import { parseNwsGrid, weatherKind, type WeatherKind, type WeatherRow } from "@/domain/weatherHistory";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "../db";
import { env } from "../env";
import { getOpeningHours } from "./labor-rules";
import { getAdjustments, setAdjustment } from "./planning";
import { businessToday } from "./sales";
import { settingValue } from "./setting-read";

/** Enough for "same week last year" plus the four weeks before it. */
const SEASONAL_HISTORY_DAYS = YEAR_LAG + 63;

// ---- Weather (US National Weather Service: public domain, no key) -----------------

export async function location() {
  const s = await db.setting.findUnique({ where: { key: "location" } });
  return s ? (JSON.parse(s.value) as { lat: number; lon: number; label: string }) : { lat: 42.2173, lon: -73.8646, label: "Catskill, NY" };
}

const WEATHER_STATUS = "weather.status";

export interface WeatherStatus {
  lastAttempt: string | null; // ISO instant
  lastOk: string | null;
  error: string | null;
}

export async function weatherStatus(): Promise<WeatherStatus> {
  const s = await db.setting.findUnique({ where: { key: WEATHER_STATUS } });
  return s ? (JSON.parse(s.value) as WeatherStatus) : { lastAttempt: null, lastOk: null, error: null };
}

async function saveWeatherStatus(st: WeatherStatus) {
  const value = JSON.stringify(st);
  await db.setting.upsert({ where: { key: WEATHER_STATUS }, create: { key: WEATHER_STATUS, value }, update: { value } });
}

/** The Weather Service asks every caller to say who it is. */
export const NWS_HEADERS = { "User-Agent": "ops-weather/1.0 (taproom sales forecast)", Accept: "application/geo+json" } as const;
const NWS_GRID_KEY = "weather.nwsGrid";

/** The Weather Service's forecast grid for a spot, looked up once per location and remembered. */
async function nwsGridUrl(lat: number, lon: number): Promise<string> {
  const saved = await db.setting.findUnique({ where: { key: NWS_GRID_KEY } });
  if (saved) {
    try {
      const g = JSON.parse(saved.value) as { lat: number; lon: number; url: string };
      if (g.lat === lat && g.lon === lon && typeof g.url === "string" && g.url.startsWith("https://api.weather.gov/")) return g.url;
    } catch {
      // fall through and look it up again
    }
  }
  const res = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: NWS_HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) throw new Error("The Weather Service has no forecast for that spot. It covers the United States only.");
  if (!res.ok) throw new Error(`The Weather Service returned ${res.status}`);
  const url = ((await res.json()) as { properties?: { forecastGridData?: unknown } }).properties?.forecastGridData;
  if (typeof url !== "string" || !url.startsWith("https://api.weather.gov/")) throw new Error("The Weather Service sent no forecast address");
  const value = JSON.stringify({ lat, lon, url });
  await db.setting.upsert({ where: { key: NWS_GRID_KEY }, create: { key: NWS_GRID_KEY, value }, update: { value } });
  return url;
}

/**
 * Pull the Weather Service's forecast for the next week (api.weather.gov, US
 * government data, free for any use). Self-throttles: at most every 6 hours
 * after a success, every 30 minutes after a failure. Never throws — a network
 * failure is recorded and returned as `{ error }`. What actually happened on
 * past days comes from NOAA's daily record (see backfillWeather).
 */
export async function refreshWeather(force = false): Promise<{ skipped: true } | { days: number } | { error: string }> {
  const status = await weatherStatus();
  const sinceAttempt = status.lastAttempt ? Date.now() - new Date(status.lastAttempt).getTime() : Infinity;
  const sinceOk = status.lastOk ? Date.now() - new Date(status.lastOk).getTime() : Infinity;
  if (!force && (sinceOk < 6 * 3600_000 || (status.error && sinceAttempt < 30 * 60_000))) return { skipped: true };
  const attempt = new Date().toISOString();
  try {
    const { lat, lon } = await location();
    const res = await fetch(await nwsGridUrl(lat, lon), { headers: NWS_HEADERS, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`The Weather Service returned ${res.status}`);
    const { rows, partial } = parseNwsGrid(await res.json(), env.BUSINESS_TIMEZONE);
    if (!rows.length) throw new Error("The Weather Service sent no forecast");
    await saveWeatherRows(rows, businessToday(), new Set(partial));
    // Forecast days further out than the Weather Service goes are stale: drop them.
    await db.weatherDay.deleteMany({ where: { forecast: true, date: { gt: parseISODate(rows[rows.length - 1].date) } } });
    await saveWeatherStatus({ lastAttempt: attempt, lastOk: attempt, error: null });
    return { days: rows.length };
  } catch (e) {
    const err = e as Error;
    const message = err.name === "TimeoutError" ? "The Weather Service timed out" : err.message || "The Weather Service couldn't be reached";
    await saveWeatherStatus({ ...status, lastAttempt: attempt, error: message }).catch(() => {});
    return { error: message };
  }
}

/**
 * Write weather rows over whatever is on file for those days. Days from
 * `today` on are marked as forecast; earlier ones as what happened. For
 * `partial` days (today, fetched after some of it has gone) rain and snow
 * never go down: the hours already past aren't in the new figures.
 */
export async function saveWeatherRows(rows: readonly WeatherRow[], today: ISODate, partial: ReadonlySet<ISODate> = new Set()): Promise<void> {
  const dec = (n: number | null) => (n == null ? null : new Prisma.Decimal(n));
  // Dates go as text and are cast in SQL, so the database's time zone can't move them a day.
  const partialDays = [...partial];
  for (let i = 0; i < rows.length; i += 200) {
    const values = rows.slice(i, i + 200).map(
      (r) =>
        Prisma.sql`(${r.date}::date, ${dec(r.tempMaxC)}::numeric, ${dec(r.tempMinC)}::numeric, ${dec(r.precipMm)}::numeric, ${Math.round(r.code)}::int, ${r.date >= today}::boolean, ${dec(r.apparentMaxC)}::numeric, ${dec(r.snowCm)}::numeric, ${dec(r.windMaxKph)}::numeric, ${dec(r.precipDayMm)}::numeric)`,
    );
    await db.$executeRaw`
      INSERT INTO "WeatherDay" AS w ("date", "tempMaxC", "tempMinC", "precipMm", "code", "forecast", "fetchedAt", "apparentMaxC", "snowCm", "windMaxKph", "precipDayMm")
      SELECT v.d, v.tmax, v.tmin, v.precip, v.code, v.fc, now(), v.feels, v.snow, v.wind, v.dayrain
      FROM (VALUES ${Prisma.join(values)}) AS v(d, tmax, tmin, precip, code, fc, feels, snow, wind, dayrain)
      ON CONFLICT ("date") DO UPDATE SET
        "tempMaxC" = EXCLUDED."tempMaxC", "tempMinC" = EXCLUDED."tempMinC", "forecast" = EXCLUDED."forecast", "fetchedAt" = EXCLUDED."fetchedAt",
        "apparentMaxC" = COALESCE(EXCLUDED."apparentMaxC", w."apparentMaxC"),
        "windMaxKph" = COALESCE(EXCLUDED."windMaxKph", w."windMaxKph"),
        "precipMm" = CASE WHEN EXCLUDED."date" = ANY(${partialDays}::date[]) THEN GREATEST(w."precipMm", EXCLUDED."precipMm") ELSE EXCLUDED."precipMm" END,
        "code" = CASE WHEN EXCLUDED."date" = ANY(${partialDays}::date[]) AND w."precipMm" > EXCLUDED."precipMm" THEN w."code" ELSE EXCLUDED."code" END,
        "snowCm" = CASE WHEN EXCLUDED."date" = ANY(${partialDays}::date[]) THEN GREATEST(w."snowCm", EXCLUDED."snowCm") ELSE EXCLUDED."snowCm" END,
        "precipDayMm" = CASE WHEN EXCLUDED."date" = ANY(${partialDays}::date[]) THEN GREATEST(w."precipDayMm", EXCLUDED."precipDayMm") ELSE EXCLUDED."precipDayMm" END`;
  }
}

/** Read once per render per range (forecasts for several date sets share it). */
export const weatherMap = cache(async (from: ISODate, to: ISODate) => {
  const rows = await db.weatherDay.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(to) } } });
  return new Map(rows.map((w) => [toISODate(w.date), { date: toISODate(w.date), precipMm: w.precipMm.toNumber(), tempMaxC: w.tempMaxC.toNumber(), tempMinC: w.tempMinC.toNumber(), code: w.code, snowCm: w.snowCm?.toNumber() ?? null, precipDayMm: w.precipDayMm?.toNumber() ?? null }]));
});

export const WEATHER_EFFECTS_KEY = "forecast.weatherEffects";

/**
 * What each kind of weather does to sales here, as last learned from the
 * scorecard's replay (see `learnWeatherEffectsNow`). Null until it has run.
 */
export const storedWeatherEffects = cache(async (): Promise<StoredEffects | null> => parseStored(await settingValue(WEATHER_EFFECTS_KEY)));

/** WMO weather code → short label + emoji-free icon key. */
export function weatherLabel(code: number): { label: string; icon: "sun" | "cloud" | "rain" | "snow" | "storm" | "fog" } {
  if (code === 0 || code === 1) return { label: "Clear", icon: "sun" };
  if (code === 2 || code === 3) return { label: "Cloudy", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "fog" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "snow" };
  if (code === 85 || code === 86) return { label: "Snow showers", icon: "snow" };
  if (code >= 95) return { label: "Storms", icon: "storm" };
  return { label: "Rain", icon: "rain" };
}

// ---- History -------------------------------------------------------------------

/**
 * Store-level daily sales and open days (hourly table if synced, else item sales).
 * Read once per render per range: a page asks for the same history from several forecasts.
 * Callers must not mutate the result.
 */
export const dailySalesHistory = cache(async (from: ISODate, to: ISODate) => {
  const where = { date: { gte: parseISODate(from), lt: parseISODate(to) } };
  const hourly = await db.hourlySale.groupBy({ by: ["date"], _sum: { netSales: true }, where });
  // Item sales only stand in before the hourly sync has run (rare), so don't aggregate them otherwise.
  const src = hourly.length > 0 ? hourly : await db.dailySale.groupBy({ by: ["date"], _sum: { netSales: true }, where });
  const sales = new Map<ISODate, number>(src.map((r) => [toISODate(r.date), r._sum.netSales?.toNumber() ?? 0]));
  const openDays = new Set([...sales].filter(([, v]) => v > 0).map(([d]) => d));
  return { sales, openDays };
});

/** Events in [from, to), read once per render per range. */
export const eventsBetween = cache((from: ISODate, to: ISODate) =>
  db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(to) } }, select: { date: true, impact: true, kind: true } }),
);

/** Past event dates (other than plain holidays-with-no-effect) are left out of baselines. */
export async function pastEventDays(from: ISODate, to: ISODate) {
  const rows = await eventsBetween(from, to);
  return new Set(rows.filter((e) => e.kind === "CLOSURE" || e.impact.toNumber() !== 1).map((e) => toISODate(e.date)));
}

/** History for baselines: sales, open days, and open days minus event days (once per render per range). */
const baselineHistory = cache(async (from: ISODate, to: ISODate) => {
  const [h, events] = await Promise.all([dailySalesHistory(from, to), pastEventDays(from, to)]);
  const cleanOpenDays = new Set([...h.openDays].filter((d) => !events.has(d)));
  return { ...h, cleanOpenDays, eventDays: events };
});

// ---- Adjustments: manual × events × weather --------------------------------------

export interface DayDrivers {
  date: ISODate;
  manual: number;
  reason: string | null;
  events: { id: string; title: string; kind: string; impact: number; startTime: string | null }[];
  eventFactor: number;
  weather: (WeatherObs & { tempMinC: number; code: number }) | null;
  weatherFactor: number;
  /** The kind of day the weather makes it (null with no weather on file). */
  weatherKind: WeatherKind | null;
  /** Past days of that weather the factor was learned from; 0 when no factor applies. */
  weatherDays: number;
  total: number;
}

/** Comma-joined dates, so per-render caches can key on a list of dates. */
const datesKey = (dates: ISODate[]) => dates.join(",");
const keyDates = (key: string): ISODate[] => (key ? key.split(",") : []);

/** Manual × event × weather multipliers per date. Worked out once per render per date list; don't mutate the result. */
export const demandDrivers = (dates: ISODate[]): Promise<Map<ISODate, DayDrivers>> => demandDriversFor(datesKey(dates));

const demandDriversFor = cache(async (key: string): Promise<Map<ISODate, DayDrivers>> => {
  const dates = keyDates(key);
  if (dates.length === 0) return new Map();
  const today = businessToday();

  const to = addDays(dates[dates.length - 1], 1);
  const [manual, reasons, events, weather, effects] = await Promise.all([
    getAdjustments(),
    getReasons(),
    db.event.findMany({ where: { date: { gte: parseISODate(dates[0]), lt: parseISODate(to) } }, orderBy: { startTime: "asc" } }),
    weatherMap(dates[0], to),
    storedWeatherEffects(),
  ]);
  const out = new Map<ISODate, DayDrivers>();
  for (const date of dates) {
    const ev = events.filter((e) => toISODate(e.date) === date).map((e) => ({ id: e.id, title: e.title, kind: e.kind, impact: e.impact.toNumber(), startTime: e.startTime }));
    const closed = ev.some((e) => e.kind === "CLOSURE");
    const eventFactor = closed ? 0 : ev.reduce((p, e) => p * e.impact, 1);
    const w = weather.get(date) ?? null;
    const kind = w ? weatherKind(w) : null;
    // Only days still to come: past days are never re-forecast with hindsight weather.
    const learned = date >= today ? learnedWeatherFactor(effects, kind, daysBetween(today, date)) : { factor: 1, days: 0 };
    const weatherFactor = learned.factor;
    const m = manual.get(date) ?? 1;
    out.set(date, { date, manual: m, reason: reasons[date] ?? null, events: ev, eventFactor, weather: w, weatherFactor, weatherKind: kind, weatherDays: learned.days, total: m * eventFactor * weatherFactor });
  }
  return out;
});

// ---- Manual override reasons ------------------------------------------------------

const REASONS_KEY = "forecast.reasons";

export async function getReasons(): Promise<Record<ISODate, string>> {
  const s = await settingValue(REASONS_KEY);
  return s ? (JSON.parse(s) as Record<ISODate, string>) : {};
}

/** Manual multiplier for a day plus a note on why (stored alongside `forecast.adjustments`). */
export async function setManualAdjustment(date: ISODate, multiplier: number | null, reason: string | null) {
  await setAdjustment(date, multiplier);
  const reasons = await getReasons();
  const keep = multiplier != null && multiplier !== 1 && reason?.trim();
  if (keep) reasons[date] = reason!.trim().slice(0, 200);
  else delete reasons[date];
  // Drop notes for days long past so the setting doesn't grow forever.
  const cutoff = addDays(businessToday(), -400);
  for (const d of Object.keys(reasons)) if (d < cutoff) delete reasons[d];
  const value = JSON.stringify(reasons);
  await db.setting.upsert({ where: { key: REASONS_KEY }, create: { key: REASONS_KEY, value }, update: { value } });
}

// ---- Forecasts -------------------------------------------------------------------

export interface DailySalesForecast extends DayForecast {
  drivers: DayDrivers;
  /** Forecast orders (checks / covers proxy) for the day; null before hourly sales are synced. */
  orders: number | null;
}

/** Store-level orders per day from the hourly table (Square order count). Once per render per range. */
export const dailyOrdersHistory = cache(async (from: ISODate, to: ISODate) => {
  const rows = await db.hourlySale.groupBy({ by: ["date"], _sum: { orders: true }, where: { date: { gte: parseISODate(from), lt: parseISODate(to) } } });
  return new Map<ISODate, number>(rows.map((r) => [toISODate(r.date), r._sum.orders ?? 0]));
});

/** Daily sales (and orders) forecast. Worked out once per render per date list; don't mutate the result. */
export const dailySalesForecast = (dates: ISODate[]): Promise<DailySalesForecast[]> => dailySalesForecastFor(datesKey(dates));

const dailySalesForecastFor = cache(async (key: string): Promise<DailySalesForecast[]> => {
  const dates = keyDates(key);
  const today = businessToday();
  const from = addDays(today, -SEASONAL_HISTORY_DAYS);
  const [history, drivers, orders] = await Promise.all([baselineHistory(from, today), demandDrivers(dates), dailyOrdersHistory(from, today)]);
  const adjustments = new Map([...drivers].map(([d, x]) => [d, x.total]));
  // Orders follow the same model, on days that had both sales and orders recorded.
  const orderDays = new Set([...history.cleanOpenDays].filter((d) => (orders.get(d) ?? 0) > 0));
  const orderF = orderDays.size ? new Map(forecastSeries({ history: orders, openDays: orderDays, asOf: today, dates, adjustments }).map((f) => [f.date, f])) : null;
  return forecastSeries({ history: history.sales, openDays: history.cleanOpenDays, asOf: today, dates, adjustments }).map((f) => {
    const o = orderF?.get(f.date);
    return { ...f, drivers: drivers.get(f.date)!, orders: o && o.samples > 0 ? o.qty : null };
  });
});

/**
 * Store-level year-over-year seasonal factor per date (1 until a year of sales
 * history exists). Item forecasts only look back ten weeks, so they borrow this.
 */
export async function seasonalFactors(dates: ISODate[]): Promise<{ factors: Map<ISODate, number>; active: boolean }> {
  const today = businessToday();
  const history = await baselineHistory(addDays(today, -SEASONAL_HISTORY_DAYS), today);
  const active = hasYearOfHistory(history.sales, history.cleanOpenDays, today);
  return { factors: new Map(dates.map((d) => [d, active ? seasonalIndex(history.sales, history.cleanOpenDays, today, d) : 1])), active };
}

/** The last eight weeks of hourly sales and orders (for each weekday's hourly shape), once per render. */
const recentHourly = cache(async (today: ISODate) => {
  const rows = await db.hourlySale.findMany({ where: { date: { gte: parseISODate(addDays(today, -56)), lt: parseISODate(today) } }, select: { date: true, hour: true, netSales: true, orders: true } });
  return {
    plain: rows.map((r) => ({ date: toISODate(r.date), hour: r.hour, netSales: r.netSales.toNumber() })),
    plainOrders: rows.map((r) => ({ date: toISODate(r.date), hour: r.hour, netSales: r.orders })),
  };
});

/** Forecast sales and orders for each hour of each date (local hours 0–23). */
export async function hourlySalesForecast(dates: ISODate[]) {
  const today = businessToday();
  const [daily, rows, opening] = await Promise.all([
    dailySalesForecast(dates),
    recentHourly(today),
    getOpeningHours(dates[0] ?? today),
  ]);
  const { plain, plainOrders } = rows;
  const shapeCache = new Map<number, { shares: number[]; orderShares: number[]; learned: boolean }>();
  return daily.map((d) => {
    const wd = weekday(d.date);
    if (!shapeCache.has(wd)) {
      const learned = hourlyShares(plain, wd, today);
      const hours = opening[wd];
      const ok = learned.some((x) => x > 0);
      const shares = ok ? learned : hours ? defaultHourlyShape(hours[0], hours[1]) : learned;
      const lo = hourlyShares(plainOrders, wd, today);
      shapeCache.set(wd, { shares, orderShares: lo.some((x) => x > 0) ? lo : shares, learned: ok });
    }
    const { shares, orderShares, learned } = shapeCache.get(wd)!;
    return { ...d, hours: shares.map((s) => s * d.qty), orderHours: d.orders == null ? null : orderShares.map((s) => s * d.orders!), shapeLearned: learned };
  });
}

// ---- Accuracy --------------------------------------------------------------------

/**
 * The last `days` days, each forecast as it would have been made the day
 * before (same model, history strictly before that day, events and manual
 * adjustments known in advance; weather left out because past forecasts
 * weren't stored).
 */
export async function forecastAccuracy(days = 28) {
  const today = businessToday();
  const from = addDays(today, -days);
  const [history, events, manual] = await Promise.all([
    baselineHistory(addDays(from, -SEASONAL_HISTORY_DAYS), today),
    db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(today) } } }),
    getAdjustments(),
  ]);
  const adjustments = new Map<ISODate, number>();
  for (const date of dateRange(from, today)) {
    const ev = events.filter((e) => toISODate(e.date) === date);
    const f = ev.some((e) => e.kind === "CLOSURE") ? 0 : ev.reduce((p, e) => p * e.impact.toNumber(), 1);
    adjustments.set(date, f * (manual.get(date) ?? 1));
  }
  const rows = backtest({ history: history.sales, openDays: history.openDays, dates: dateRange(from, today), adjustments, excludeFromBaseline: history.eventDays });
  return { rows, mape: mape(rows), bias: bias(rows) };
}
