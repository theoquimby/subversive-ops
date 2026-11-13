/**
 * How good were our forecasts? Re-runs the forecast for each past day as it
 * would have been made the evening before (history strictly before that day),
 * then compares it with what actually happened.
 */

import { ISODate } from "./dates";
import { forecastSeries, ForecastOptions } from "./forecast";

export interface BacktestRow {
  date: ISODate;
  forecast: number;
  actual: number;
  /** Open that day (had sales) — closed days don't count toward accuracy. */
  open: boolean;
  /** (forecast − actual) ÷ actual; null when closed or nothing sold. */
  error: number | null;
}

export function backtest(
  input: {
    history: ReadonlyMap<ISODate, number>;
    openDays: ReadonlySet<ISODate>;
    dates: ISODate[];
    /** Multipliers known in advance (events, manual), by date. */
    adjustments?: ReadonlyMap<ISODate, number>;
    /** Days left out of every baseline (e.g. past event days), though still scored. */
    excludeFromBaseline?: ReadonlySet<ISODate>;
  },
  opts: ForecastOptions = {},
): BacktestRow[] {
  const ex = input.excludeFromBaseline;
  const baseDays = ex?.size ? new Set([...input.openDays].filter((d) => !ex.has(d))) : input.openDays;
  return input.dates.map((date) => {
    const [f] = forecastSeries({ history: input.history, openDays: baseDays, asOf: date, dates: [date], adjustments: input.adjustments }, opts);
    const actual = input.history.get(date) ?? 0;
    const open = input.openDays.has(date);
    return { date, forecast: f.qty, actual, open, error: open && actual > 0 ? (f.qty - actual) / actual : null };
  });
}

/** Mean absolute percentage error over open days, as a fraction (0.12 = 12%). */
export function mape(rows: Pick<BacktestRow, "error">[]): number | null {
  const errs = rows.map((r) => r.error).filter((e): e is number => e != null);
  return errs.length ? errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length : null;
}

/** Signed total error: positive = we over-forecast overall. */
export function bias(rows: Pick<BacktestRow, "forecast" | "actual" | "open">[]): number | null {
  const open = rows.filter((r) => r.open);
  const actual = open.reduce((s, r) => s + r.actual, 0);
  return actual > 0 ? open.reduce((s, r) => s + r.forecast, 0) / actual - 1 : null;
}
