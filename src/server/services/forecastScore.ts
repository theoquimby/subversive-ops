import "server-only";
import { addDays, dateRange, daysBetween, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { groupScore, score, scoreDays, scoreLogged, summarize, type GroupScore, type Score, type ScoreDay, type ScoreSummary } from "@/domain/forecastScore";
import { learnWeatherEffects, toStored, type WeatherEffects } from "@/domain/weatherEffect";
import { ARCHIVE_LAG_DAYS, backfillSpans, NOAA_DAILY_TYPES, NOAA_STATION, parseNceiDaily } from "@/domain/weatherHistory";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { dailySalesForecast, eventsBetween, pastEventDays, saveWeatherRows, storedWeatherEffects, WEATHER_EFFECTS_KEY, weatherMap } from "./forecasting";
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
  /** Days from the first sale to five days ago (what NOAA's record can give). */
  wanted: number;
  /** Of those, days loaded from NOAA's record. */
  onFile: number;
  /** The station the record comes from. */
  station: string;
}

const NOAA_KEY = "weather.noaa";
interface NoaaState {
  station: string;
  from: ISODate;
  through: ISODate;
}

/** The stretch of days already loaded from NOAA's record for the current station, if any. */
async function noaaState(): Promise<NoaaState | null> {
  const s = await db.setting.findUnique({ where: { key: NOAA_KEY } });
  if (!s) return null;
  try {
    const v = JSON.parse(s.value) as NoaaState;
    return v.station === NOAA_STATION.id && typeof v.from === "string" && typeof v.through === "string" && v.from <= v.through ? v : null;
  } catch {
    return null;
  }
}

const loadedDays = (st: NoaaState | null) => new Set(st ? dateRange(st.from, addDays(st.through, 1)) : []);

export async function weatherCoverage(): Promise<WeatherCoverage> {
  const today = businessToday();
  const [first, st] = await Promise.all([firstSaleDate(), noaaState()]);
  if (!first) return { firstSale: null, wanted: 0, onFile: 0, station: NOAA_STATION.name };
  const last = addDays(today, -ARCHIVE_LAG_DAYS);
  const have = loadedDays(st);
  const wantedDays = last >= first ? dateRange(first, addDays(last, 1)) : [];
  return { firstSale: first, wanted: wantedDays.length, onFile: wantedDays.filter((d) => have.has(d)).length, station: NOAA_STATION.name };
}

/**
 * Fill in what the weather actually was on every day back to the first sale,
 * from NOAA's daily summaries (US government data, free for any use, no key).
 * Asks only for what isn't loaded yet, a year at a time, so it's quick to run
 * nightly once caught up. Never throws.
 */
export async function backfillWeather(maxSpans = 10): Promise<{ days: number; spans: number } | { error: string }> {
  try {
    const today = businessToday();
    const first = await firstSaleDate();
    if (!first) return { days: 0, spans: 0 };
    let st = await noaaState();
    const spans = backfillSpans({ firstSale: first, today, have: loadedDays(st), maxSpans });
    let days = 0;
    for (const s of spans) {
      const url = `https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=${NOAA_STATION.id}&startDate=${s.from}&endDate=${s.to}&dataTypes=${NOAA_DAILY_TYPES}&units=metric&format=json`;
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`NOAA's weather record returned ${res.status}`);
      const rows = parseNceiDaily(await res.json());
      await saveWeatherRows(rows, today);
      days += rows.length;
      // Remember how far the record reaches. A span with nothing in it yet (the latest few days) is asked for again tomorrow.
      const lastDay = rows.reduce<ISODate | null>((m, r) => (m == null || r.date > m ? r.date : m), null);
      if (lastDay) {
        st = { station: NOAA_STATION.id, from: st && st.from < s.from ? st.from : s.from, through: st && st.through > lastDay ? st.through : lastDay };
        const value = JSON.stringify(st);
        await db.setting.upsert({ where: { key: NOAA_KEY }, create: { key: NOAA_KEY, value }, update: { value } });
      }
    }
    return { days, spans: spans.length };
  } catch (e) {
    const err = e as Error;
    return { error: err.name === "TimeoutError" ? "NOAA's weather record timed out" : err.message || "NOAA's weather record couldn't be reached" };
  }
}

// ---- Forecasts kept as they were made -------------------------------------------------

/** v2: weather by kind (rain, heavy rain, snow, heat, cold) in place of one rain factor. */
export const FORECAST_MODEL = "v2";
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
  /** What each kind of weather does to sales, learned day by day from the replay, and which kinds are switched on. */
  weatherEffects: WeatherEffects;
  /** Every scored day, the day-before forecast without weather against the same forecast with the switched-on kinds. */
  withWeather: { without: Score | null; with: Score | null };
  /** Forecasts as they were really made each night (with weather in them), once there are some to score. */
  logged: { since: ISODate | null; dayBefore: Score | null; weekAhead: Score | null };
}

export async function forecastScorecard(): Promise<Scorecard> {
  const today = businessToday();
  const first = await firstSaleDate();
  const coverage = await weatherCoverage();
  const none = summarize([]);
  if (!first) return { today, firstSale: null, days: [], openDays: 0, dailyOnly: 0, all: none, recent: none, byWeekday: [], byMonth: [], byWeather: [], byEvent: [], weather: coverage, weatherEffects: learnWeatherEffects([]).effects, withWeather: { without: null, with: null }, logged: { since: null, dayBefore: null, weekAhead: null } };

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
  const learned = learnWeatherEffects(days);
  const scoredDays = days.filter((d) => d.f1 != null);
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
    weatherEffects: learned.effects,
    withWeather: {
      without: score(scoredDays.map((d) => ({ forecast: d.f1!, actual: d.actual }))),
      with: score(scoredDays.map((d) => ({ forecast: learned.withWeather.get(d.date) ?? d.f1!, actual: d.actual }))),
    },
    logged: { since, dayBefore: scoreLogged(log, history.sales, 1), weekAhead: scoreLogged(log, history.sales, 7) },
  };
}

// ---- Weather effects for the live forecast ------------------------------------------------

/** Keep the learned factors where the live forecast reads them. */
export async function saveWeatherEffects(effects: WeatherEffects, today: ISODate) {
  const value = JSON.stringify(toStored(effects, today));
  await db.setting.upsert({ where: { key: WEATHER_EFFECTS_KEY }, create: { key: WEATHER_EFFECTS_KEY, value }, update: { value } });
}

/** Replay every past day, learn what each kind of weather does, and keep it for the live forecast. Runs nightly. */
export async function learnWeatherEffectsNow(): Promise<WeatherEffects> {
  const s = await forecastScorecard();
  await saveWeatherEffects(s.weatherEffects, s.today);
  return s.weatherEffects;
}

/** Learn today if the nightly run hasn't (first run, or a missed night). Cheap when it's up to date. Never throws. */
export async function ensureWeatherEffects(): Promise<void> {
  try {
    const stored = await storedWeatherEffects();
    if (stored?.learnedOn === businessToday()) return;
    await learnWeatherEffectsNow();
  } catch (e) {
    console.error("weather effects failed", e);
  }
}
