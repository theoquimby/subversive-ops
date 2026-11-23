/**
 * Two refinements to how a "usual day" is worked out, and the test that
 * decides whether the forecast uses them:
 *
 *  1. A day with only a stray sale or two (a gift card bought online on a
 *     closed Tuesday) is not an open day. It doesn't belong in the average of
 *     recent Tuesdays, and "forecasting" it means nothing.
 *  2. One freak day (a holiday Monday, a single huge order) shouldn't pull
 *     the usual for the eight weeks after it. Each recent day counts for at
 *     most one-and-a-half times the middle one. See `capHigh` in forecast.ts.
 *
 * Like everything else in the forecast, they're replayed over every past day
 * and only switched on if that lands closer than the method without them.
 *
 * Pure: plain data in, plain data out.
 */

import { addDays, type ISODate } from "./dates";

/** A real open day sells at least this share of the typical day in the eight weeks before it… */
export const STRAY_SHARE = 0.1;
/** …and never less than this many dollars. */
export const STRAY_FLOOR = 25;
const STRAY_WINDOW_DAYS = 56;
/** With fewer earlier days than this to go by, any sale counts. */
const STRAY_MIN_PRIOR = 10;
/** A recent day counts for at most this many times the middle of the recent days. */
export const CAP_HIGH = 1.5;

const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * The days that were really open: sales of at least a tenth of the typical
 * day over the eight weeks before (the middle of the days with any sales).
 */
export function realOpenDays(sales: ReadonlyMap<ISODate, number>): Set<ISODate> {
  const days = [...sales].filter(([, v]) => v > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const out = new Set<ISODate>();
  let start = 0;
  for (let i = 0; i < days.length; i++) {
    const [date, v] = days[i];
    const from = addDays(date, -STRAY_WINDOW_DAYS);
    while (start < i && days[start][0] < from) start++;
    const prior = days.slice(start, i).map(([, x]) => x);
    const least = prior.length >= STRAY_MIN_PRIOR ? Math.max(STRAY_FLOOR, median(prior) * STRAY_SHARE) : 0;
    if (v >= least) out.add(date);
  }
  return out;
}

interface Scored {
  date: ISODate;
  actual: number;
  f1: number | null;
}

export interface MethodSide {
  days: number;
  /** Typical miss with the method as it was, and with the refinements. */
  before: number;
  after: number;
}

export interface MethodCheck {
  /** Every day both methods forecast. */
  all: MethodSide | null;
  /** The last twelve months of those. */
  recent: MethodSide | null;
  /** Days with any sales that are no longer counted as open days. */
  strayDays: number;
  /** Switched on: closer over all the history, and no worse over the last twelve months. */
  use: boolean;
}

/** The refinements earn their place by cutting the miss by this share over all the history… */
export const METHOD_MIN_GAIN = 0.01;
/** …on at least this many days. */
export const METHOD_MIN_DAYS = 200;

function side(pairs: { actual: number; a: number; b: number }[]): MethodSide | null {
  const actual = pairs.reduce((s, p) => s + p.actual, 0);
  if (!pairs.length || actual <= 0) return null;
  return { days: pairs.length, before: pairs.reduce((s, p) => s + Math.abs(p.a - p.actual), 0) / actual, after: pairs.reduce((s, p) => s + Math.abs(p.b - p.actual), 0) / actual };
}

/**
 * Compare the replay as it was (`before`) with the replay using the
 * refinements (`after`), on the days both forecast. Stray-sale days aren't in
 * `after` at all, so they drop out of the comparison, which is the point.
 */
export function checkMethod(before: readonly Scored[], after: readonly Scored[], today: ISODate, strayDays: number): MethodCheck {
  const old = new Map(before.filter((d) => d.f1 != null).map((d) => [d.date, d.f1!]));
  const pairs = after.flatMap((d) => (d.f1 != null && old.has(d.date) ? [{ date: d.date, actual: d.actual, a: old.get(d.date)!, b: d.f1 }] : []));
  const cutoff = addDays(today, -365);
  const all = side(pairs);
  const recent = side(pairs.filter((p) => p.date >= cutoff));
  const use = !!all && all.days >= METHOD_MIN_DAYS && all.after <= all.before * (1 - METHOD_MIN_GAIN) && (!recent || recent.after <= recent.before);
  return { all, recent, strayDays, use };
}

export interface HistoryCheck {
  /** Every day both replays forecast: days with hourly sales, which is all the live forecast ever sees. */
  all: MethodSide | null;
  /** The last twelve months of those. */
  recent: MethodSide | null;
  /** Open days known only from item sales (brought in before hourly sales were kept). */
  itemOnlyDays: number;
  /** Read the full history live: closer over all of it, and no worse over the last twelve months. */
  use: boolean;
}

/**
 * The live forecast reads hourly sales; the full history adds the days known only from item sales. Compare
 * the replay on hourly sales alone (`hourlyOnly`) with the replay on the full history (`full`), on the days
 * both forecast, with the same bar as the refinements above. Item-only days drop out of the comparison
 * (the hourly replay never forecasts them), so it scores only what the switch would change for real days.
 */
export function checkHistory(hourlyOnly: readonly Scored[], full: readonly Scored[], today: ISODate, itemOnlyDays: number): HistoryCheck {
  const c = checkMethod(hourlyOnly, full, today, 0);
  return { all: c.all, recent: c.recent, itemOnlyDays, use: c.use };
}

/** Bumped whenever the refinements change, so what's stored is decided again at once. */
export const METHOD_RULES = 1;

export interface StoredMethod {
  rules: number;
  learnedOn: ISODate;
  /** Leave stray-sale days out and cap freak days. */
  refined: boolean;
  /** Read the full history (item sales before hourly sales were kept), not hourly sales alone. */
  fullHistory: boolean;
}

export const toStoredMethod = (check: MethodCheck, learnedOn: ISODate, history?: HistoryCheck): StoredMethod => ({ rules: METHOD_RULES, learnedOn, refined: check.use, fullHistory: !!history?.use });

export function parseStoredMethod(json: string | null | undefined): StoredMethod | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as StoredMethod;
    return typeof v?.learnedOn === "string" && v.rules === METHOD_RULES ? { rules: METHOD_RULES, learnedOn: v.learnedOn, refined: v.refined === true, fullHistory: v.fullHistory === true } : null;
  } catch {
    return null;
  }
}
