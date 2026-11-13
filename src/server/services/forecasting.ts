import "server-only";
import { addDays, dateRange, ISODate, parseISODate, toISODate, weekday } from "@/domain/dates";
import { DayForecast, defaultHourlyShape, forecastSeries, hourlyShares, isWet, learnRainFactor, WeatherObs } from "@/domain/forecast";
import { backtest, bias, mape } from "@/domain/forecastAccuracy";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { getOpeningHours } from "./labor-rules";
import { getAdjustments, setAdjustment } from "./planning";
import { businessToday } from "./sales";

const HISTORY_DAYS = 120;

// ---- Weather (Open-Meteo: free, no key) -----------------------------------------

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

/**
 * Pull 92 days of observed weather and a 16-day forecast. Self-throttles: at
 * most every 6 hours after a success, every 30 minutes after a failure. Never
 * throws — a network failure is recorded and returned as `{ error }`.
 */
export async function refreshWeather(force = false): Promise<{ skipped: true } | { days: number } | { error: string }> {
  const status = await weatherStatus();
  const sinceAttempt = status.lastAttempt ? Date.now() - new Date(status.lastAttempt).getTime() : Infinity;
  const sinceOk = status.lastOk ? Date.now() - new Date(status.lastOk).getTime() : Infinity;
  if (!force && (sinceOk < 6 * 3600_000 || (status.error && sinceAttempt < 30 * 60_000))) return { skipped: true };
  const attempt = new Date().toISOString();
  try {
    const { lat, lon } = await location();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=${encodeURIComponent(env.BUSINESS_TIMEZONE)}&forecast_days=16&past_days=92`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
    const j = (await res.json()) as { daily: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_sum: (number | null)[]; weather_code: (number | null)[] } };
    const today = businessToday();
    const d = j.daily;
    await db.$transaction(
      d.time.map((date, i) => {
        const data = { tempMaxC: new Prisma.Decimal(d.temperature_2m_max[i] ?? 0), tempMinC: new Prisma.Decimal(d.temperature_2m_min[i] ?? 0), precipMm: new Prisma.Decimal(d.precipitation_sum[i] ?? 0), code: d.weather_code[i] ?? 0, forecast: date >= today, fetchedAt: new Date() };
        return db.weatherDay.upsert({ where: { date: parseISODate(date) }, create: { date: parseISODate(date), ...data }, update: data });
      }),
    );
    await saveWeatherStatus({ lastAttempt: attempt, lastOk: attempt, error: null });
    return { days: d.time.length };
  } catch (e) {
    const err = e as Error;
    const message = err.name === "TimeoutError" ? "Weather service timed out" : err.message || "Weather service unreachable";
    await saveWeatherStatus({ ...status, lastAttempt: attempt, error: message }).catch(() => {});
    return { error: message };
  }
}

export async function weatherMap(from: ISODate, to: ISODate) {
  const rows = await db.weatherDay.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(to) } } });
  return new Map(rows.map((w) => [toISODate(w.date), { date: toISODate(w.date), precipMm: w.precipMm.toNumber(), tempMaxC: w.tempMaxC.toNumber(), tempMinC: w.tempMinC.toNumber(), code: w.code }]));
}

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

/** Store-level daily sales and open days (hourly table if synced, else item sales). */
export async function dailySalesHistory(from: ISODate, to: ISODate) {
  const [hourly, items] = await Promise.all([
    db.hourlySale.groupBy({ by: ["date"], _sum: { netSales: true }, where: { date: { gte: parseISODate(from), lt: parseISODate(to) } } }),
    db.dailySale.groupBy({ by: ["date"], _sum: { netSales: true }, where: { date: { gte: parseISODate(from), lt: parseISODate(to) } } }),
  ]);
  const src = hourly.length > 0 ? hourly : items;
  const sales = new Map<ISODate, number>(src.map((r) => [toISODate(r.date), r._sum.netSales?.toNumber() ?? 0]));
  const openDays = new Set([...sales].filter(([, v]) => v > 0).map(([d]) => d));
  return { sales, openDays };
}

/** Past event dates (other than plain holidays-with-no-effect) are left out of baselines. */
async function pastEventDays(from: ISODate, to: ISODate) {
  const rows = await db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(to) } }, select: { date: true, impact: true, kind: true } });
  return new Set(rows.filter((e) => e.kind === "CLOSURE" || e.impact.toNumber() !== 1).map((e) => toISODate(e.date)));
}

/** History for baselines: sales, open days, and open days minus event days. */
async function baselineHistory(from: ISODate, to: ISODate) {
  const [h, events] = await Promise.all([dailySalesHistory(from, to), pastEventDays(from, to)]);
  const cleanOpenDays = new Set([...h.openDays].filter((d) => !events.has(d)));
  return { ...h, cleanOpenDays, eventDays: events };
}

// ---- Adjustments: manual × events × weather --------------------------------------

export interface DayDrivers {
  date: ISODate;
  manual: number;
  reason: string | null;
  events: { id: string; title: string; kind: string; impact: number; startTime: string | null }[];
  eventFactor: number;
  weather: (WeatherObs & { tempMinC: number; code: number }) | null;
  weatherFactor: number;
  rain: { factor: number; wetSamples: number };
  total: number;
}

export async function demandDrivers(dates: ISODate[]): Promise<Map<ISODate, DayDrivers>> {
  if (dates.length === 0) return new Map();
  const today = businessToday();

  const to = addDays(dates[dates.length - 1], 1);
  const [manual, reasons, events, weather, history] = await Promise.all([
    getAdjustments(),
    getReasons(),
    db.event.findMany({ where: { date: { gte: parseISODate(dates[0]), lt: parseISODate(to) } }, orderBy: { startTime: "asc" } }),
    weatherMap(addDays(today, -HISTORY_DAYS), to),
    baselineHistory(addDays(today, -HISTORY_DAYS), today),
  ]);
  const rain = learnRainFactor(history.sales, weather, history.cleanOpenDays);
  const out = new Map<ISODate, DayDrivers>();
  for (const date of dates) {
    const ev = events.filter((e) => toISODate(e.date) === date).map((e) => ({ id: e.id, title: e.title, kind: e.kind, impact: e.impact.toNumber(), startTime: e.startTime }));
    const closed = ev.some((e) => e.kind === "CLOSURE");
    const eventFactor = closed ? 0 : ev.reduce((p, e) => p * e.impact, 1);
    const w = weather.get(date) ?? null;
    const weatherFactor = w && date >= today && isWet(w) ? rain.factor : 1;
    const m = manual.get(date) ?? 1;
    out.set(date, { date, manual: m, reason: reasons[date] ?? null, events: ev, eventFactor, weather: w, weatherFactor, rain, total: m * eventFactor * weatherFactor });
  }
  return out;
}

// ---- Manual override reasons ------------------------------------------------------

const REASONS_KEY = "forecast.reasons";

export async function getReasons(): Promise<Record<ISODate, string>> {
  const s = await db.setting.findUnique({ where: { key: REASONS_KEY } });
  return s ? (JSON.parse(s.value) as Record<ISODate, string>) : {};
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
}

export async function dailySalesForecast(dates: ISODate[]): Promise<DailySalesForecast[]> {
  const today = businessToday();
  const [history, drivers] = await Promise.all([baselineHistory(addDays(today, -HISTORY_DAYS), today), demandDrivers(dates)]);
  const adjustments = new Map([...drivers].map(([d, x]) => [d, x.total]));
  return forecastSeries({ history: history.sales, openDays: history.cleanOpenDays, asOf: today, dates, adjustments }).map((f) => ({ ...f, drivers: drivers.get(f.date)! }));
}

/** Forecast sales for each hour of each date (local hours 0–23). */
export async function hourlySalesForecast(dates: ISODate[]) {
  const today = businessToday();
  const [daily, rows, opening] = await Promise.all([
    dailySalesForecast(dates),
    db.hourlySale.findMany({ where: { date: { gte: parseISODate(addDays(today, -56)), lt: parseISODate(today) } } }),
    getOpeningHours(),
  ]);
  const plain = rows.map((r) => ({ date: toISODate(r.date), hour: r.hour, netSales: r.netSales.toNumber() }));
  const shapeCache = new Map<number, { shares: number[]; learned: boolean }>();
  return daily.map((d) => {
    const wd = weekday(d.date);
    if (!shapeCache.has(wd)) {
      const learned = hourlyShares(plain, wd, today);
      const hours = opening[wd];
      const ok = learned.some((x) => x > 0);
      shapeCache.set(wd, { shares: ok ? learned : hours ? defaultHourlyShape(hours[0], hours[1]) : learned, learned: ok });
    }
    const { shares, learned } = shapeCache.get(wd)!;
    return { ...d, hours: shares.map((s) => s * d.qty), shapeLearned: learned };
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
    baselineHistory(addDays(from, -HISTORY_DAYS), today),
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
