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

/**
 * The stretch of days a source has really finished reporting. Google fills a
 * day in piece by piece (Maps views can be there a day before Search views),
 * so a day only counts once every part has a number, and the newest `margin`
 * of those days are held back as possibly still short.
 */
export function settledSpan(parts: readonly ReadonlyMap<ISODate, number>[], margin = 0): { from?: ISODate; through?: ISODate } {
  if (!parts.length) return {};
  const complete = [...parts[0].keys()].filter((d) => parts.every((p) => (p.get(d) ?? 0) > 0)).sort();
  if (!complete.length) return {};
  return { from: complete[0], through: addDays(complete[complete.length - 1], -margin) };
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

/** How late a series runs: today minus its newest real day, between 1 and 7. */
const delayOf = (last: ISODate | null, today: ISODate) => (last ? Math.min(7, Math.max(1, daysBetween(last, today))) : 1);

/**
 * The replay itself. Each day is forecast from the days before it: the slope
 * so far, around the level the reading is usually at. Returns what was found
 * and the fit as it stands at the end, for the live forecast.
 */
function replay(xAhead: (d: ISODate) => number | null, xSame: (d: ISODate) => number | null, days: readonly SignalDay[]) {
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
    const xs = xSame(d.date);
    if (xs != null && !d.event) same.add(xs, y);
    const xa = xAhead(d.date);
    if (xa == null) continue;
    if (ahead.n >= SIGNAL_WARMUP) {
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
    sameDay: same.n >= SIGNAL_MIN_DAYS && same.r != null ? { days: same.n, r: same.r } : null,
    ahead: ahead.n >= SIGNAL_MIN_DAYS && ahead.r != null ? { days: ahead.n, r: ahead.r, per20: ahead.slope * 0.2 } : null,
    scored,
    missWithout,
    missWith,
    verdict,
    slope: ahead.slope,
    meanX: ahead.meanX,
  };
}

/**
 * Test one series against the days. `today` sets how late its numbers run
 * (today minus its newest day, at least 1): a forecast can only use what had
 * arrived by then.
 */
export function testSignal(series: SignalSeries, days: readonly SignalDay[], today: ISODate): SignalResult {
  const { first, last, at } = reader(series.values, series.from, series.through);
  const delay = delayOf(last, today);
  const { slope: _slope, meanX: _meanX, ...found } = replay((d) => aheadLevel(at, d, delay), (d) => sameDayLevel(at, d), days);
  void _slope;
  void _meanX;
  return { key: series.key, label: series.label, source: series.source, from: first, to: last, delay, ...found };
}

// ---- One combined reading -----------------------------------------------------------------

/** The numbers that help largely rise and fall together, so they go in as one reading: the average of their levels. */
const average = (xs: (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x != null);
  return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : null;
};

export interface CombinedFit {
  result: SignalResult;
  /** The fit as it stands today, for the live forecast: sales move `slope` for each 1.0 the reading sits above `meanX`. */
  slope: number;
  meanX: number;
}

/**
 * Test the combined reading. `extraDelay` replays a forecast made further ahead:
 * 6 for "a week ahead" (pass the week-ahead forecasts as `days`), when the newest
 * numbers are that much older than the day being forecast.
 */
export function testCombined(members: readonly SignalSeries[], days: readonly SignalDay[], today: ISODate, extraDelay = 0): CombinedFit | null {
  const rs = members.filter((m) => m.values.size > 0).map((m) => {
    const r = reader(m.values, m.from, m.through);
    return { ...r, delay: delayOf(r.last, today) };
  });
  if (!rs.length) return null;
  const { slope, meanX, ...found } = replay(
    (d) => average(rs.map((r) => aheadLevel(r.at, d, r.delay + extraDelay))),
    (d) => average(rs.map((r) => sameDayLevel(r.at, d))),
    days,
  );
  const firsts = rs.map((r) => r.first).filter((x): x is ISODate => x != null).sort();
  const lasts = rs.map((r) => r.last).filter((x): x is ISODate => x != null).sort();
  return {
    result: { key: extraDelay ? "combined.week" : "combined", label: "Online interest", source: "Combined", from: firsts[0] ?? null, to: lasts[lasts.length - 1] ?? null, delay: Math.max(...rs.map((r) => r.delay)) + extraDelay, ...found },
    slope,
    meanX,
  };
}

/** Where the combined reading stands right now: the last week on file against the four before, averaged over the members. */
export function combinedLevelNow(members: readonly SignalSeries[], today: ISODate): number | null {
  return average(
    members.filter((m) => m.values.size > 0).map((m) => {
      const r = reader(m.values, m.from, m.through);
      return aheadLevel(r.at, today, delayOf(r.last, today));
    }),
  );
}

/**
 * Bumped whenever the way the reading is worked out changes. A stored reading from older rules is ignored
 * (and learned again on the next visit), so a fix reaches the live forecast the same day.
 * 2: only days Google has finished filling in are counted. 3: the newest Search day is held back too.
 */
export const SIGNAL_RULES = 3;

/** What's kept between nightly runs for the live forecast. */
export interface StoredSignal {
  rules: number;
  learnedOn: ISODate;
  /** The labels of the numbers that make up the reading. */
  members: string[];
  /** Where the reading stands: 0.1 = the last week on file ran 10% above the four before. Null when it can't be worked out. */
  level: number | null;
  /** For the next few days, and for the rest of the coming week; each only counts when its replay beat the forecast without it. */
  near: { slope: number; meanX: number; used: boolean };
  week: { slope: number; meanX: number; used: boolean };
}

/** Days ahead covered by the near fit (today and the next two days); the week fit covers the rest, up to nine days out. */
export const SIGNAL_NEAR_DAYS = 2;
export const SIGNAL_WEEK_DAYS = 9;

export function toStoredSignal(i: { learnedOn: ISODate; members: readonly string[]; level: number | null; near: CombinedFit | null; week: CombinedFit | null }): StoredSignal {
  const part = (f: CombinedFit | null) => ({ slope: Math.round((f?.slope ?? 0) * 10000) / 10000, meanX: Math.round((f?.meanX ?? 0) * 10000) / 10000, used: f?.result.verdict === "helps" });
  return { rules: SIGNAL_RULES, learnedOn: i.learnedOn, members: [...i.members], level: i.level == null ? null : Math.round(i.level * 10000) / 10000, near: part(i.near), week: part(i.week) };
}

export function parseStoredSignal(json: string | null | undefined): StoredSignal | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as StoredSignal;
    const part = (p: unknown) => {
      const x = (p ?? {}) as { slope?: unknown; meanX?: unknown; used?: unknown };
      return typeof x.slope === "number" && Number.isFinite(x.slope) && typeof x.meanX === "number" && Number.isFinite(x.meanX) ? { slope: x.slope, meanX: x.meanX, used: x.used === true } : { slope: 0, meanX: 0, used: false };
    };
    if (typeof v?.learnedOn !== "string" || v.rules !== SIGNAL_RULES) return null;
    return { rules: SIGNAL_RULES, learnedOn: v.learnedOn, members: Array.isArray(v.members) ? v.members.filter((m) => typeof m === "string") : [], level: typeof v.level === "number" && Number.isFinite(v.level) ? v.level : null, near: part(v.near), week: part(v.week) };
  } catch {
    return null;
  }
}

/**
 * The multiplier for a day `daysAhead` days out (0 = today): how far the reading
 * sits from its usual level, times what that has meant for sales, never more
 * than a fifth either way. 1 when nothing is switched on or the day is too far out.
 */
export function onlineFactor(stored: StoredSignal | null, daysAhead: number): number {
  if (!stored || stored.level == null || daysAhead < 0 || daysAhead > SIGNAL_WEEK_DAYS) return 1;
  const fit = daysAhead <= SIGNAL_NEAR_DAYS ? stored.near : stored.week;
  if (!fit.used) return 1;
  return Math.round((1 + clamp(fit.slope * (stored.level - fit.meanX), [-SIGNAL_MAX_MOVE, SIGNAL_MAX_MOVE])) * 1000) / 1000;
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
