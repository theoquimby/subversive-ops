import "server-only";
import { addDays, ISODate, parseISODate, toISODate, weekday } from "@/domain/dates";
import { DayForecast, forecastSeries, hourlyShares, isWet, learnRainFactor, WeatherObs } from "@/domain/forecast";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { getAdjustments } from "./planning";
import { businessToday } from "./sales";

const HISTORY_DAYS = 120;

// ---- Weather (Open-Meteo: free, no key) -----------------------------------------

export async function location() {
  const s = await db.setting.findUnique({ where: { key: "location" } });
  return s ? (JSON.parse(s.value) as { lat: number; lon: number; label: string }) : { lat: 42.2173, lon: -73.8646, label: "Catskill, NY" };
}

export async function refreshWeather(force = false) {
  const latest = await db.weatherDay.findFirst({ orderBy: { fetchedAt: "desc" } });
  if (!force && latest && Date.now() - latest.fetchedAt.getTime() < 6 * 3600_000) return { skipped: true };
  const { lat, lon } = await location();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=${encodeURIComponent(env.BUSINESS_TIMEZONE)}&forecast_days=16&past_days=92`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const j = (await res.json()) as { daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; weather_code: number[] } };
  const today = businessToday();
  const d = j.daily;
  await db.$transaction(
    d.time.map((date, i) =>
      db.weatherDay.upsert({
        where: { date: parseISODate(date) },
        create: { date: parseISODate(date), tempMaxC: new Prisma.Decimal(d.temperature_2m_max[i] ?? 0), tempMinC: new Prisma.Decimal(d.temperature_2m_min[i] ?? 0), precipMm: new Prisma.Decimal(d.precipitation_sum[i] ?? 0), code: d.weather_code[i] ?? 0, forecast: date >= today },
        update: { tempMaxC: new Prisma.Decimal(d.temperature_2m_max[i] ?? 0), tempMinC: new Prisma.Decimal(d.temperature_2m_min[i] ?? 0), precipMm: new Prisma.Decimal(d.precipitation_sum[i] ?? 0), code: d.weather_code[i] ?? 0, forecast: date >= today, fetchedAt: new Date() },
      }),
    ),
  );
  return { days: d.time.length };
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

// ---- Adjustments: manual × events × weather --------------------------------------

export interface DayDrivers {
  date: ISODate;
  manual: number;
  events: { id: string; title: string; kind: string; impact: number; startTime: string | null }[];
  eventFactor: number;
  weather: (WeatherObs & { tempMinC: number; code: number }) | null;
  weatherFactor: number;
  total: number;
}

export async function demandDrivers(dates: ISODate[]): Promise<Map<ISODate, DayDrivers>> {
  if (dates.length === 0) return new Map();
  const today = businessToday();

  const to = addDays(dates[dates.length - 1], 1);
  const [manual, events, weather, history] = await Promise.all([
    getAdjustments(),
    db.event.findMany({ where: { date: { gte: parseISODate(dates[0]), lt: parseISODate(to) } }, orderBy: { startTime: "asc" } }),
    weatherMap(addDays(today, -HISTORY_DAYS), to),
    dailySalesHistory(addDays(today, -HISTORY_DAYS), today),
  ]);
  const rain = learnRainFactor(history.sales, weather, history.openDays);
  const out = new Map<ISODate, DayDrivers>();
  for (const date of dates) {
    const ev = events.filter((e) => toISODate(e.date) === date).map((e) => ({ id: e.id, title: e.title, kind: e.kind, impact: e.impact.toNumber(), startTime: e.startTime }));
    const closed = ev.some((e) => e.kind === "CLOSURE");
    const eventFactor = closed ? 0 : ev.reduce((p, e) => p * e.impact, 1);
    const w = weather.get(date) ?? null;
    const weatherFactor = w && date >= today && isWet(w) ? rain.factor : 1;
    const m = manual.get(date) ?? 1;
    out.set(date, { date, manual: m, events: ev, eventFactor, weather: w, weatherFactor, total: m * eventFactor * weatherFactor });
  }
  return out;
}

// ---- Forecasts -------------------------------------------------------------------

export interface DailySalesForecast extends DayForecast {
  drivers: DayDrivers;
}

export async function dailySalesForecast(dates: ISODate[]): Promise<DailySalesForecast[]> {
  const today = businessToday();
  const [history, drivers] = await Promise.all([dailySalesHistory(addDays(today, -HISTORY_DAYS), today), demandDrivers(dates)]);
  const adjustments = new Map([...drivers].map(([d, x]) => [d, x.total]));
  return forecastSeries({ history: history.sales, openDays: history.openDays, asOf: today, dates, adjustments }).map((f) => ({ ...f, drivers: drivers.get(f.date)! }));
}

/** Forecast sales for each hour of each date (local hours 0–23). */
export async function hourlySalesForecast(dates: ISODate[]) {
  const today = businessToday();
  const [daily, rows] = await Promise.all([
    dailySalesForecast(dates),
    db.hourlySale.findMany({ where: { date: { gte: parseISODate(addDays(today, -56)), lt: parseISODate(today) } } }),
  ]);
  const plain = rows.map((r) => ({ date: toISODate(r.date), hour: r.hour, netSales: r.netSales.toNumber() }));
  const shapeCache = new Map<number, number[]>();
  return daily.map((d) => {
    const wd = weekday(d.date);
    if (!shapeCache.has(wd)) shapeCache.set(wd, hourlyShares(plain, wd, today));
    const shares = shapeCache.get(wd)!;
    return { ...d, hours: shares.map((s) => s * d.qty) };
  });
}
