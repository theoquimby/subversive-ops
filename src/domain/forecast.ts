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
