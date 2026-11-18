import "server-only";
import { addDays, dateRange, daysBetween, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { groupScore, scoreDays, scoreLogged, summarize, type GroupScore, type Score, type ScoreDay, type ScoreSummary } from "@/domain/forecastScore";
import { ARCHIVE_LAG_DAYS, backfillSpans, parseOpenMeteo, WEATHER_DAILY, WEATHER_HOURLY } from "@/domain/weatherHistory";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { dailySalesForecast, eventsBetween, location, pastEventDays, saveWeatherRows, weatherMap } from "./forecasting";
import { getAdjustments } from "./planning";
import { businessToday } from "./sales";

/** The first day with any sales on file (hourly or item sales); null before Square has synced. */
export async function firstSaleDate(): Promise<ISODate | null> {
  const [h, d] = await Promise.all([db.hourlySale.aggregate({ _min: { date: true } }), db.dailySale.aggregate({ _min: { date: true } })]);
  const dates = [h._min.date, d._min.date].filter((x): x is Date => !!x).map(toISODate).sort();
  return dates[0] ?? null;
}

// ---- Weather history ---------------------------------------------------------------

export interface WeatherCoverage {
  firstSale: ISODate | null;
  /** Days from the first sale to five days ago (what the archive can give). */
  wanted: number;
  /** Of those, days on file with full detail. */
  onFile: number;
  /** The earliest day of weather on file at all. */
  from: ISODate | null;
}

async function detailedDays(first: ISODate, today: ISODate): Promise<Set<ISODate>> {
  const rows = await db.weatherDay.findMany({
    where: { date: { gte: parseISODate(first), lt: parseISODate(today) }, forecast: false, OR: [{ precipDayMm: { not: null } }, { snowCm: { not: null } }] },
    select: { date: true },
  });
  return new Set(rows.map((r) => toISODate(r.date)));
}

export async function weatherCoverage(): Promise<WeatherCoverage> {
  const today = businessToday();
  const [first, earliest] = await Promise.all([firstSaleDate(), db.weatherDay.aggregate({ _min: { date: true } })]);
  const from = earliest._min.date ? toISODate(earliest._min.date) : null;
  if (!first) return { firstSale: null, wanted: 0, onFile: 0, from };
  const last = addDays(today, -ARCHIVE_LAG_DAYS);
  const have = await detailedDays(first, today);
  const wantedDays = last >= first ? dateRange(first, addDays(last, 1)) : [];
  return { firstSale: first, wanted: wantedDays.length, onFile: wantedDays.filter((d) => have.has(d)).length, from };
}

/**
 * Fill in the weather for every day back to the first sale, from the free
 * archive (Open-Meteo, no key). Asks only for what's missing, a year at a
 * time, so it's quick to run nightly once caught up. Never throws.
 */
export async function backfillWeather(maxSpans = 4): Promise<{ days: number; spans: number } | { error: string }> {
  try {
    const today = businessToday();
    const first = await firstSaleDate();
    if (!first) return { days: 0, spans: 0 };
    const spans = backfillSpans({ firstSale: first, today, have: await detailedDays(first, today), maxSpans });
    const { lat, lon } = await location();
    let days = 0;
    for (const s of spans) {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${s.from}&end_date=${s.to}&daily=${WEATHER_DAILY}&hourly=${WEATHER_HOURLY}&timezone=${encodeURIComponent(env.BUSINESS_TIMEZONE)}`;
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`The weather archive returned ${res.status}`);
      const rows = parseOpenMeteo(await res.json());
      await saveWeatherRows(rows, today);
      days += rows.length;
    }
    return { days, spans: spans.length };
  } catch (e) {
    const err = e as Error;
    return { error: err.name === "TimeoutError" ? "The weather archive timed out" : err.message || "The weather archive couldn't be reached" };
  }
}

// ---- Forecasts kept as they were made -------------------------------------------------

export const FORECAST_MODEL = "v1";
const LOG_DAYS_AHEAD = 14;

/** Keep tonight's forecast for today and the next two weeks, so it can be scored against what then sells. */
export async function logForecasts(): Promise<number> {
  const today = businessToday();
  const dates = dateRange(today, addDays(today, LOG_DAYS_AHEAD + 1));
  const f = await dailySalesForecast(dates);
  const rows = f
    .filter((x) => x.samples > 0)
    .map((x) => ({
      madeOn: parseISODate(today),
      date: parseISODate(x.date),
      horizon: daysBetween(today, x.date),
      sales: new Prisma.Decimal(x.qty.toFixed(2)),
      baseline: new Prisma.Decimal(x.baseline.toFixed(2)),
      weatherFactor: new Prisma.Decimal(x.drivers.weatherFactor.toFixed(3)),
      eventFactor: new Prisma.Decimal(Math.min(999, x.drivers.eventFactor).toFixed(3)),
      manual: new Prisma.Decimal(Math.min(999, x.drivers.manual).toFixed(3)),
      model: FORECAST_MODEL,
    }));
  await db.$transaction([db.forecastLog.deleteMany({ where: { madeOn: parseISODate(today), model: FORECAST_MODEL } }), db.forecastLog.createMany({ data: rows })]);
  return rows.length;
}

// ---- The scorecard ------------------------------------------------------------------

/**
 * Every day's sales back to the first one: the hourly table where it has the
 * day, item sales where it doesn't (older history brought in before hourly
 * sales were kept). `dailyOnly` counts the days that came from item sales.
 */
async function fullSalesHistory(first: ISODate, today: ISODate) {
  const where = { date: { gte: parseISODate(first), lt: parseISODate(today) } };
  const [hourly, daily] = await Promise.all([
    db.hourlySale.groupBy({ by: ["date"], _sum: { netSales: true }, where }),
    db.dailySale.groupBy({ by: ["date"], _sum: { netSales: true }, where }),
  ]);
  const sales = new Map<ISODate, number>(daily.map((r) => [toISODate(r.date), r._sum.netSales?.toNumber() ?? 0]));
  const fromHourly = new Set<ISODate>();
  for (const r of hourly) {
    const d = toISODate(r.date);
    sales.set(d, r._sum.netSales?.toNumber() ?? 0);
    fromHourly.add(d);
  }
  const openDays = new Set([...sales].filter(([, v]) => v > 0).map(([d]) => d));
  return { sales, openDays, dailyOnly: [...openDays].filter((d) => !fromHourly.has(d)).length };
}

export interface Scorecard {
  today: ISODate;
  firstSale: ISODate | null;
  days: ScoreDay[];
  /** Open days on file, and how many of them only have item sales (no hourly sales). */
  openDays: number;
  dailyOnly: number;
  all: ScoreSummary;
  /** The last 90 days on their own: how it's doing lately. */
  recent: ScoreSummary;
  byWeekday: GroupScore[];
  byMonth: GroupScore[];
  byWeather: GroupScore[];
  byEvent: GroupScore[];
  weather: WeatherCoverage;
  /** Forecasts as they were really made each night (with weather in them), once there are some to score. */
  logged: { since: ISODate | null; dayBefore: Score | null; weekAhead: Score | null };
}

export async function forecastScorecard(): Promise<Scorecard> {
  const today = businessToday();
  const first = await firstSaleDate();
  const coverage = await weatherCoverage();
  const none = summarize([]);
  if (!first) return { today, firstSale: null, days: [], openDays: 0, dailyOnly: 0, all: none, recent: none, byWeekday: [], byMonth: [], byWeather: [], byEvent: [], weather: coverage, logged: { since: null, dayBefore: null, weekAhead: null } };

  const [history, eventDays, events, manual, weather, logged] = await Promise.all([
    fullSalesHistory(first, today),
    pastEventDays(first, today),
    eventsBetween(first, today),
    getAdjustments(),
    weatherMap(first, today),
    db.forecastLog.findMany({ where: { model: FORECAST_MODEL, date: { lt: parseISODate(today) }, horizon: { in: [1, 7] } }, select: { date: true, horizon: true, sales: true, madeOn: true } }),
  ]);

  // What was known in advance: events on the calendar and manual changes (as forecastAccuracy does).
  const adjustments = new Map<ISODate, number>();
  const byDate = new Map<ISODate, { kind: string; impact: number }[]>();
  for (const e of events) {
    const d = toISODate(e.date);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push({ kind: e.kind, impact: e.impact.toNumber() });
  }
  for (const [d, list] of byDate) adjustments.set(d, list.some((e) => e.kind === "CLOSURE") ? 0 : list.reduce((p, e) => p * e.impact, 1));
  for (const [d, m] of manual) if (d >= first && d < today) adjustments.set(d, (adjustments.get(d) ?? 1) * m);

  const days = scoreDays({ history: history.sales, openDays: history.openDays, eventDays, adjustments, weather, dates: dateRange(first, today) });
  const cutoff = addDays(today, -90);
  const since = logged.length ? toISODate(logged.reduce((a, b) => (a.madeOn < b.madeOn ? a : b)).madeOn) : null;
  const log = logged.map((l) => ({ date: toISODate(l.date), horizon: l.horizon, sales: l.sales.toNumber() }));

  return {
    today,
    firstSale: first,
    days,
    openDays: history.openDays.size,
    dailyOnly: history.dailyOnly,
    all: summarize(days),
    recent: summarize(days.filter((d) => d.date >= cutoff)),
    byWeekday: groupScore(days, "f1", (d) => String(d.weekday)).sort((a, b) => ((Number(a.key) + 6) % 7) - ((Number(b.key) + 6) % 7)),
    byMonth: groupScore(days, "f1", (d) => d.date.slice(5, 7)).sort((a, b) => a.key.localeCompare(b.key)),
    byWeather: groupScore(days, "f1", (d) => d.weather),
    byEvent: groupScore(days, "f1", (d) => (d.event ? "event" : "normal")),
    weather: coverage,
    logged: { since, dayBefore: scoreLogged(log, history.sales, 1), weekAhead: scoreLogged(log, history.sales, 7) },
  };
}
