/**
 * The forecast scorecard: every past open day forecast again as it would have
 * been made one, seven and fourteen days ahead (history strictly before the day
 * it was made), beside the plainest alternative there is, "the same day last
 * week". Then scored overall and by weekday, month, weather and event days,
 * so it's plain where the method is weak and whether a new one is better.
 *
 * Weather is not in the replay (the forecast weather for past days was never
 * kept), so grouping by weather shows what the method misses on those days.
 * Pure: plain data in, plain data out.
 */

import { addDays, weekday, type ISODate } from "./dates";
import { forecastSeries, type ForecastOptions } from "./forecast";
import { weatherKind, type WeatherKind } from "./weatherHistory";

export type ScoreModel = "f1" | "f7" | "f14" | "naive";
export const HORIZONS: { model: Exclude<ScoreModel, "naive">; days: number; label: string }[] = [
  { model: "f1", days: 1, label: "The day before" },
  { model: "f7", days: 7, label: "A week ahead" },
  { model: "f14", days: 14, label: "Two weeks ahead" },
];

export interface ScoreDay {
  date: ISODate;
  weekday: number;
  actual: number;
  /** An event, closure or manual change was on the calendar that day. */
  event: boolean;
  weather: WeatherKind | null;
  /** The Ops forecast made the evening before, a week before and two weeks before; null with too little history. */
  f1: number | null;
  f7: number | null;
  f14: number | null;
  /** The same weekday's sales the week before (the latest open one in the four weeks before). */
  naive: number | null;
}

type WeatherIn = { precipMm: number; tempMaxC: number; snowCm?: number | null; precipDayMm?: number | null; code?: number | null };

/** A forecast needs at least this many same-weekday samples behind it to be scored. */
export const MIN_SAMPLES = 3;

export function scoreDays(
  i: {
    history: ReadonlyMap<ISODate, number>;
    openDays: ReadonlySet<ISODate>;
    /** Days left out of every baseline (events and closures), though still scored. */
    eventDays: ReadonlySet<ISODate>;
    /** Multipliers known in advance (events, manual changes), by date. */
    adjustments?: ReadonlyMap<ISODate, number>;
    weather: ReadonlyMap<ISODate, WeatherIn>;
    dates: readonly ISODate[];
  },
  opts: ForecastOptions = {},
): ScoreDay[] {
  const baseDays = i.eventDays.size ? new Set([...i.openDays].filter((d) => !i.eventDays.has(d))) : i.openDays;
  const made = (date: ISODate, ahead: number): number | null => {
    // Made `ahead` days before: history up to and including that evening.
    const [f] = forecastSeries({ history: i.history, openDays: baseDays, asOf: addDays(date, -(ahead - 1)), dates: [date], adjustments: i.adjustments }, opts);
    return f && f.samples >= MIN_SAMPLES ? f.qty : null;
  };
  const out: ScoreDay[] = [];
  for (const date of i.dates) {
    const actual = i.history.get(date) ?? 0;
    if (!i.openDays.has(date) || actual <= 0) continue;
    const f1 = made(date, 1);
    if (f1 == null) continue;
    let naive: number | null = null;
    for (let w = 1; w <= 4 && naive == null; w++) {
      const d = addDays(date, -7 * w);
      if (baseDays.has(d)) naive = i.history.get(d) ?? null;
    }
    const w = i.weather.get(date);
    out.push({ date, weekday: weekday(date), actual, event: i.eventDays.has(date) || (i.adjustments?.get(date) ?? 1) !== 1, weather: w ? weatherKind(w) : null, f1, f7: made(date, 7), f14: made(date, 14), naive });
  }
  return out;
}

export interface Score {
  days: number;
  /** Total miss ÷ total sales: "off by 14% of sales on a typical day". */
  wape: number;
  /** The middle day's miss, as a share of that day's sales. */
  medianApe: number;
  /** Forecast ÷ actual − 1 over the period: above zero = forecasting high. */
  bias: number;
  /** Share of days that landed within 15% of actual. */
  within15: number;
}

export function score(rows: readonly { forecast: number; actual: number }[]): Score | null {
  const ok = rows.filter((r) => r.actual > 0 && Number.isFinite(r.forecast));
  const actual = ok.reduce((s, r) => s + r.actual, 0);
  if (!ok.length || actual <= 0) return null;
  const apes = ok.map((r) => Math.abs(r.forecast - r.actual) / r.actual).sort((a, b) => a - b);
  const mid = Math.floor(apes.length / 2);
  return {
    days: ok.length,
    wape: ok.reduce((s, r) => s + Math.abs(r.forecast - r.actual), 0) / actual,
    medianApe: apes.length % 2 ? apes[mid] : (apes[mid - 1] + apes[mid]) / 2,
    bias: ok.reduce((s, r) => s + r.forecast, 0) / actual - 1,
    within15: apes.filter((a) => a <= 0.15).length / apes.length,
  };
}

const pairs = (days: readonly ScoreDay[], model: ScoreModel) => days.flatMap((d) => (d[model] == null ? [] : [{ forecast: d[model]!, actual: d.actual }]));

export const scoreModel = (days: readonly ScoreDay[], model: ScoreModel): Score | null => score(pairs(days, model));

/** How much of the plain method's miss is gone: 0.4 = 40% closer; below zero = worse than it. */
export function skill(model: Pick<Score, "wape"> | null, naive: Pick<Score, "wape"> | null): number | null {
  return model && naive && naive.wape > 0 ? 1 - model.wape / naive.wape : null;
}

export interface GroupScore {
  key: string;
  score: Score | null;
  /** Actual ÷ forecast − 1: sales ran this much over (or under) what was forecast. */
  lift: number | null;
}

/** Scores per group (weekday, month, weather…), in first-seen order; rows with a null key are left out. */
export function groupScore(days: readonly ScoreDay[], model: ScoreModel, key: (d: ScoreDay) => string | null): GroupScore[] {
  const groups = new Map<string, ScoreDay[]>();
  for (const d of days) {
    const k = key(d);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(d);
  }
  return [...groups].map(([k, list]) => {
    const p = pairs(list, model);
    const f = p.reduce((s, r) => s + r.forecast, 0);
    return { key: k, score: score(p), lift: f > 0 ? p.reduce((s, r) => s + r.actual, 0) / f - 1 : null };
  });
}

export interface ScoreSummary {
  from: ISODate | null;
  to: ISODate | null;
  f1: Score | null;
  f7: Score | null;
  f14: Score | null;
  naive: Score | null;
  /** Ops the day before against "same day last week", on the days both have a number. */
  skill: number | null;
}

export function summarize(days: readonly ScoreDay[]): ScoreSummary {
  const both = days.filter((d) => d.f1 != null && d.naive != null);
  return {
    from: days[0]?.date ?? null,
    to: days[days.length - 1]?.date ?? null,
    f1: scoreModel(days, "f1"),
    f7: scoreModel(days, "f7"),
    f14: scoreModel(days, "f14"),
    naive: scoreModel(days, "naive"),
    skill: skill(scoreModel(both, "f1"), scoreModel(both, "naive")),
  };
}

// ---- Forecasts as they were really made -------------------------------------------

export interface LoggedForecast {
  date: ISODate;
  horizon: number;
  sales: number;
}

/** Scores the forecasts kept each night against what then sold, for one distance ahead. */
export function scoreLogged(logged: readonly LoggedForecast[], actual: ReadonlyMap<ISODate, number>, horizon: number): Score | null {
  return score(logged.filter((l) => l.horizon === horizon && (actual.get(l.date) ?? 0) > 0).map((l) => ({ forecast: l.sales, actual: actual.get(l.date)! })));
}
