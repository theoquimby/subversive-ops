/**
 * Do the online numbers say anything about sales? For each one (direction
 * requests on Google, search clicks, website visitors…) two questions:
 *
 *  1. On the day: when it runs above its usual level for that weekday, do
 *     sales run above the forecast too? That shows it's a real sign of demand.
 *  2. Ahead of time: using only what was on file when the forecast was made
 *     (these numbers arrive a day or more late), would it have made the
 *     forecast closer? Each day is replayed from the days before it, the same
 *     test the weather had to pass.
 *
 * Only the second can improve a forecast. Pure: plain data in, plain data out.
 */

import { addDays, daysBetween, type ISODate } from "./dates";

export interface SignalSeries {
  key: string;
  label: string;
  /** Where it comes from, in the app's words ("Google listing"). */
  source: string;
  values: ReadonlyMap<ISODate, number>;
  /**
   * The stretch the source really covers, when the caller knows it: a day inside it with no value counts as zero,
   * and anything after `through` hasn't arrived yet (Google files empty rows for recent days and fills them in later).
   */
  from?: ISODate;
  through?: ISODate;
}

export interface SignalDay {
  date: ISODate;
  actual: number;
  /** The forecast made the evening before (with weather, where that's switched on). */
  forecast: number | null;
  event?: boolean;
}

/** Days of history before the replay starts adjusting a forecast. */
export const SIGNAL_WARMUP = 60;
/** Replayed days needed before a verdict means anything. */
export const SIGNAL_MIN_SCORED = 45;
/** Same-day link: days needed to report it at all. */
export const SIGNAL_MIN_DAYS = 30;
/** A signal earns its place by cutting the miss by at least this share. */
export const SIGNAL_MIN_GAIN = 0.01;
/** The most a signal may move one day's forecast, either way. */
export const SIGNAL_MAX_MOVE = 0.2;
/** Days of "no link" mixed into the slope, so a short history can't swing a forecast. */
const SLOPE_PRIOR_DAYS = 30;
/** A day far from its norm counts as this much at most (one viral post shouldn't decide it). */
const CLAMP: [number, number] = [-0.75, 1.5];
const clamp = (x: number, [lo, hi]: [number, number] = CLAMP) => Math.min(hi, Math.max(lo, x));

/** The stretch a series covers (the caller's, or its own first and last day), and a reader that treats a gap inside it as zero. */
function reader(values: ReadonlyMap<ISODate, number>, from?: ISODate, through?: ISODate) {
  let first: ISODate | null = from ?? null;
  let last: ISODate | null = through ?? null;
  if (from == null || through == null) {
    for (const d of values.keys()) {
      if (from == null && (first == null || d < first)) first = d;
      if (through == null && (last == null || d > last)) last = d;
    }
  }
  const at = (d: ISODate): number | null => (first == null || last == null || d < first || d > last ? null : (values.get(d) ?? 0));
  return { first, last, at };
}

/** Mean over [from, to] inclusive; null unless every day is inside the series. */
function mean(at: (d: ISODate) => number | null, from: ISODate, to: ISODate): number | null {
  let total = 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = at(d);
    if (v == null) return null;
    total += v;
    n++;
  }
  return n ? total / n : null;
}

/**
 * How far the last week on file runs from the four weeks before it, for a
 * forecast of `date` when the newest number on file is `delay` days older than
 * `date`. Whole weeks on both sides, so the weekday pattern cancels.
 */
export function aheadLevel(at: (d: ISODate) => number | null, date: ISODate, delay: number): number | null {
  const end = addDays(date, -delay);
  const week = mean(at, addDays(end, -6), end);
  const norm = mean(at, addDays(end, -34), addDays(end, -7));
  return week == null || norm == null || norm <= 0 ? null : clamp(week / norm - 1);
}

/** How far the day itself runs from the same weekday over the four weeks before (needs three of them). */
export function sameDayLevel(at: (d: ISODate) => number | null, date: ISODate): number | null {
  const v = at(date);
  if (v == null) return null;
  const prior = [7, 14, 21, 28].map((k) => at(addDays(date, -k))).filter((x): x is number => x != null);
  const norm = prior.length >= 3 ? prior.reduce((s, x) => s + x, 0) / prior.length : 0;
  return norm > 0 ? clamp(v / norm - 1) : null;
}

class Fit {
  n = 0;
  private sx = 0;
  private sy = 0;
  private sxy = 0;
  private sxx = 0;
  private syy = 0;
  add(x: number, y: number) {
    this.n++;
    this.sx += x;
    this.sy += y;
    this.sxy += x * y;
    this.sxx += x * x;
    this.syy += y * y;
  }
  private get cov() {
    return this.sxy - (this.sx * this.sy) / this.n;
  }
  private get vx() {
    return this.sxx - (this.sx * this.sx) / this.n;
  }
  private get vy() {
    return this.syy - (this.sy * this.sy) / this.n;
  }
  /** Pearson correlation, −1 to 1; null when either side never moves. */
  get r(): number | null {
    return this.n >= 3 && this.vx > 1e-9 && this.vy > 1e-9 ? this.cov / Math.sqrt(this.vx * this.vy) : null;
  }
  /** How much y moves per unit of x, pulled toward zero when days are few. */
  get slope(): number {
    return this.n >= 3 && this.vx > 1e-9 ? (this.cov / this.vx) * (this.n / (this.n + SLOPE_PRIOR_DAYS)) : 0;
  }
  get meanX() {
    return this.n ? this.sx / this.n : 0;
  }
}

export type SignalVerdict = "helps" | "noHelp" | "thin";

export interface SignalResult {
  key: string;
  label: string;
  source: string;
  /** First and last day on file, and how many days late the numbers arrive. */
  from: ISODate | null;
  to: ISODate | null;
  delay: number;
  /** On the day: days compared and how closely it moves with sales (−1 to 1). */
  sameDay: { days: number; r: number } | null;
  /** Ahead of time: days compared, the link, and how far sales land over the forecast when it runs 20% above normal. */
  ahead: { days: number; r: number; per20: number } | null;
  /** The replay: days forecast with it, and the typical miss without and with. */
  scored: number;
  missWithout: number | null;
  missWith: number | null;
  verdict: SignalVerdict;
}

/**
 * Test one series against the days. `today` sets how late its numbers run
 * (today minus its newest day, at least 1): a forecast can only use what had
 * arrived by then.
 */
export function testSignal(series: SignalSeries, days: readonly SignalDay[], today: ISODate): SignalResult {
  const { first, last, at } = reader(series.values, series.from, series.through);
  const delay = last ? Math.min(7, Math.max(1, daysBetween(last, today))) : 1;
  const sorted = [...days].filter((d) => d.forecast != null && d.forecast > 0 && d.actual > 0).sort((a, b) => a.date.localeCompare(b.date));

  const same = new Fit();
  const ahead = new Fit();
  let scored = 0;
  let actual = 0;
  let without = 0;
  let withIt = 0;
  for (const d of sorted) {
    const f = d.forecast!;
    const y = clamp(d.actual / f - 1);
    const xs = sameDayLevel(at, d.date);
    if (xs != null && !d.event) same.add(xs, y);
    const xa = aheadLevel(at, d.date, delay);
    if (xa == null) continue;
    if (ahead.n >= SIGNAL_WARMUP) {
      // Forecast this day from the days before it: the slope so far, around the level it's usually at.
      const move = clamp(ahead.slope * (xa - ahead.meanX), [-SIGNAL_MAX_MOVE, SIGNAL_MAX_MOVE]);
      scored++;
      actual += d.actual;
      without += Math.abs(f - d.actual);
      withIt += Math.abs(f * (1 + move) - d.actual);
    }
    if (!d.event) ahead.add(xa, y);
  }

  const missWithout = actual > 0 ? without / actual : null;
  const missWith = actual > 0 ? withIt / actual : null;
  const verdict: SignalVerdict = scored < SIGNAL_MIN_SCORED || missWith == null || missWithout == null ? "thin" : missWith <= missWithout * (1 - SIGNAL_MIN_GAIN) ? "helps" : "noHelp";
  return {
    key: series.key,
    label: series.label,
    source: series.source,
    from: first,
    to: last,
    delay,
    sameDay: same.n >= SIGNAL_MIN_DAYS && same.r != null ? { days: same.n, r: same.r } : null,
    ahead: ahead.n >= SIGNAL_MIN_DAYS && ahead.r != null ? { days: ahead.n, r: ahead.r, per20: ahead.slope * 0.2 } : null,
    scored,
    missWithout,
    missWith,
    verdict,
  };
}

/** Every series tested, the ones that help first (biggest gain first), then by how closely they move with sales. */
export function testSignals(series: readonly SignalSeries[], days: readonly SignalDay[], today: ISODate): SignalResult[] {
  const gain = (r: SignalResult) => (r.verdict === "helps" && r.missWith != null && r.missWithout ? 1 - r.missWith / r.missWithout : -1);
  return series
    .filter((s) => s.values.size > 0 && (s.from == null || s.through == null || s.from <= s.through))
    .map((s) => testSignal(s, days, today))
    .sort((a, b) => gain(b) - gain(a) || Math.abs(b.sameDay?.r ?? 0) - Math.abs(a.sameDay?.r ?? 0));
}

/** A correlation in everyday words. */
export function linkWord(r: number | null | undefined): string {
  if (r == null) return "Too few days";
  const a = Math.abs(r);
  const size = a < 0.1 ? "No link" : a < 0.25 ? "Weak" : a < 0.45 ? "Some" : "Strong";
  return a < 0.1 ? size : `${size}${r < 0 ? ", opposite" : ""}`;
}
