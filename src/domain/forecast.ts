/**
 * Demand forecast per menu item, per day.
 *
 * Deliberately simple and explainable (v1):
 *   baseline(day) = recency-weighted average of the same weekday over the last
 *                   N weeks, skipping days the business was closed
 *   trend         = last 4 weeks vs the 4 before, dampened and clamped
 *   forecast      = baseline × trend × manual adjustment for that date
 *
 * Manual adjustments cover what history can't see (a festival, a private
 * buyout, a closure). The interface is stable, so a smarter model (weather,
 * events, ML) can replace `forecastSeries` later without touching callers.
 */

import { addDays, dateRange, ISODate, weekday } from "./dates";

export interface ForecastOptions {
  weeksBack?: number; // same-weekday samples to use (default 8)
  trendDampening?: number; // 0 = ignore trend, 1 = full (default 0.5)
  trendClamp?: [number, number]; // default [0.8, 1.25]
}

export interface ForecastInput {
  /** Sales history for one item: date → qty sold. Missing dates = 0 sold. */
  history: ReadonlyMap<ISODate, number>;
  /** Dates the business was open (had any sales). Closed days are ignored. */
  openDays: ReadonlySet<ISODate>;
  /** The date forecasting runs from (exclusive upper bound of history). */
  asOf: ISODate;
  dates: ISODate[];
  /** Multipliers by date, e.g. { "2026-12-31": 1.4 }; missing = 1. */
  adjustments?: ReadonlyMap<ISODate, number>;
}

export interface DayForecast {
  date: ISODate;
  qty: number;
  baseline: number;
  trend: number;
  adjustment: number;
  samples: number;
}

export function computeTrend(
  history: ReadonlyMap<ISODate, number>,
  openDays: ReadonlySet<ISODate>,
  asOf: ISODate,
  opts: ForecastOptions = {},
): number {
  const damp = opts.trendDampening ?? 0.5;
  const [lo, hi] = opts.trendClamp ?? [0.8, 1.25];
  const sum = (from: ISODate, to: ISODate) => {
    let total = 0;
    let open = 0;
    for (const d of dateRange(from, to)) {
      if (!openDays.has(d)) continue;
      open++;
      total += history.get(d) ?? 0;
    }
    return { total, open };
  };
  const recent = sum(addDays(asOf, -28), asOf);
  const prior = sum(addDays(asOf, -56), addDays(asOf, -28));
  if (recent.open < 7 || prior.open < 7 || prior.total === 0) return 1;
  const ratio = recent.total / recent.open / (prior.total / prior.open);
  const damped = 1 + (ratio - 1) * damp;
  return Math.min(hi, Math.max(lo, damped));
}

export function forecastSeries(input: ForecastInput, opts: ForecastOptions = {}): DayForecast[] {
  const weeksBack = opts.weeksBack ?? 8;
  const trend = computeTrend(input.history, input.openDays, input.asOf, opts);

  return input.dates.map((date) => {
    const wd = weekday(date);
    // Walk back week by week from the most recent same weekday before asOf.
    let cursor = addDays(input.asOf, -1);
    while (weekday(cursor) !== wd) cursor = addDays(cursor, -1);

    let weighted = 0;
    let weights = 0;
    let samples = 0;
    for (let i = 0; i < weeksBack; i++) {
      const d = addDays(cursor, -7 * i);
      if (!input.openDays.has(d)) continue;
      const w = weeksBack - i; // most recent week weighs most
      weighted += (input.history.get(d) ?? 0) * w;
      weights += w;
      samples++;
    }
    const baseline = weights > 0 ? weighted / weights : 0;
    const adjustment = input.adjustments?.get(date) ?? 1;
    return { date, qty: baseline * trend * adjustment, baseline, trend, adjustment, samples };
  });
}

// ---- Hourly shape ------------------------------------------------------------

/**
 * Share of a day's sales falling in each hour (sums to 1), learned from the
 * same weekday over recent weeks. Days with no sales are ignored.
 */
export function hourlyShares(rows: { date: ISODate; hour: number; netSales: number }[], targetWeekday: number, asOf: ISODate, weeksBack = 8): number[] {
  const shares = new Array(24).fill(0);
  const byDate = new Map<ISODate, number[]>();
  for (const r of rows) {
    if (r.date >= asOf || r.date < addDays(asOf, -7 * weeksBack) || weekday(r.date) !== targetWeekday) continue;
    const arr = byDate.get(r.date) ?? new Array(24).fill(0);
    arr[r.hour] += r.netSales;
    byDate.set(r.date, arr);
  }
  let days = 0;
  for (const arr of byDate.values()) {
    const total = arr.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    days++;
    arr.forEach((v, h) => (shares[h] += v / total));
  }
  return days ? shares.map((s) => s / days) : shares;
}

// ---- Weather -----------------------------------------------------------------

export interface WeatherObs {
  date: ISODate;
  precipMm: number;
  tempMaxC: number;
}

export const isWet = (w: WeatherObs) => w.precipMm >= 5;

/**
 * How much rain moves sales here: ratio of (actual ÷ same-weekday baseline) on
 * wet days vs dry days. Needs a few wet days of history; otherwise a mild default.
 */
export function learnRainFactor(
  dailySales: ReadonlyMap<ISODate, number>,
  weather: ReadonlyMap<ISODate, WeatherObs>,
  openDays: ReadonlySet<ISODate>,
): { factor: number; wetSamples: number } {
  const ratios = { wet: [] as number[], dry: [] as number[] };
  for (const d of openDays) {
    const w = weather.get(d);
    const actual = dailySales.get(d);
    if (!w || actual == null) continue;
    const [base] = forecastSeries({ history: dailySales, openDays, asOf: d, dates: [d] }, { trendDampening: 0 });
    if (!base || base.baseline <= 0 || base.samples < 3) continue;
    (isWet(w) ? ratios.wet : ratios.dry).push(actual / base.baseline);
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  if (ratios.wet.length < 3 || ratios.dry.length < 5) return { factor: 0.93, wetSamples: ratios.wet.length };
  return { factor: Math.min(1.1, Math.max(0.7, mean(ratios.wet) / mean(ratios.dry))), wetSamples: ratios.wet.length };
}
