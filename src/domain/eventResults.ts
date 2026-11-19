/**
 * Did it work? For each event that has happened, what the day sold against
 * what an ordinary day of that weekday would have sold at that time of year,
 * and, for a series (every trivia night, every home game), whether the nights
 * together say more than chance would.
 *
 * "Ordinary" is worked out from the venue's own days: the last eight ordinary
 * days of that weekday (no event, no holiday; a freak one capped), scaled by
 * how the other weekdays were doing around the event against how they were
 * doing back then. So a weekly night that has run for months is still compared
 * with the same weekday from before it started, allowing for the season.
 *
 * Daily sales swing a lot on their own, so one good night proves nothing. The
 * same sum is run on every ordinary day of the last two years to see how far
 * off "ordinary" it lands by chance, and a series only gets a verdict when its
 * nights together clear twice that.
 *
 * Pure: plain data in, plain data out.
 */

import { addDays, daysBetween, weekday, type ISODate } from "./dates";
import { eventSeries } from "./events";
import { holidayKind } from "./holidays";

export interface ResultEvent {
  id: string;
  date: ISODate;
  title: string;
  kind: string;
  /** The owner's expected multiplier for the day (1.3 = 30% busier). */
  impact: number;
}

/** Ordinary same-weekday days to compare with, and how far back to look for them. */
const SAMPLES = 8;
export const MIN_SAMPLES = 4;
const MAX_WEEKS_BACK = 78;
/** A freak comparison day counts for at most this many times the middle one. */
const CAP_HIGH = 1.5;
/** Other weekdays within this many days either side of the event set the level "now". */
const NOW_DAYS = 14;
const LEVEL_CLAMP: [number, number] = [0.4, 2.5];
/** Ordinary days over this long show how far a day lands from "ordinary" by chance. */
const NOISE_DAYS = 730;
/** With fewer ordinary days of a weekday than this, all weekdays together set its noise. */
const NOISE_MIN_DAYS = 12;
const LOG_CLIP = 1.2;
/** A series needs this many scored nights before anything is said about it. */
export const RESULT_MIN_NIGHTS = 3;
/** A lift this small isn't worth chasing; "nights needed" is quoted for at least this. */
const SMALLEST_LIFT = Math.log(1.1);
/** Nights needed for a lift to clear chance four times in five (the usual 5% test). */
const POWER_Z = 2.8;
/**
 * How much of the chance in one reading comes from the comparison days and
 * not the night itself: eight days weighted 8 down to 1 carry about 0.157 of
 * a single day's swing. Nights that share comparison days share that error,
 * so it doesn't average away however many nights there are.
 */
const BASIS_VARIANCE = 204 / 1296;
/**
 * A margin on top: the level of the other weekdays is itself a little uncertain, and real sales come in good and
 * bad stretches. In made-up histories where nothing happened, this brings false alarms to about 1 in 20.
 */
const SAFETY = 1.2;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Average sales per weekday (other than `skip`) over the ordinary days in [from, to], leaving out `except`. */
function levels(sales: ReadonlyMap<ISODate, number>, ordinary: ReadonlySet<ISODate>, from: ISODate, to: ISODate, skip: number, except: ReadonlySet<ISODate>): Map<number, number> {
  const by = new Map<number, number[]>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!ordinary.has(d) || except.has(d)) continue;
    const wd = weekday(d);
    if (wd === skip) continue;
    by.set(wd, [...(by.get(wd) ?? []), sales.get(d) ?? 0]);
  }
  return new Map([...by].map(([wd, xs]) => [wd, mean(xs)]));
}

/**
 * What an ordinary day of that weekday would have sold on `date`; null when
 * there aren't enough ordinary days to compare with (the series has run too
 * long, or the other weekdays were hardly open).
 */
export function ordinaryDay(sales: ReadonlyMap<ISODate, number>, ordinary: ReadonlySet<ISODate>, date: ISODate): number | null {
  return ordinaryBasis(sales, ordinary, date)?.value ?? null;
}

/** The same, with the comparison days it rests on and the share of the answer each carries. */
function ordinaryBasis(sales: ReadonlyMap<ISODate, number>, ordinary: ReadonlySet<ISODate>, date: ISODate): { value: number; basis: { date: ISODate; share: number }[] } | null {
  const wd = weekday(date);
  const picked: { date: ISODate; v: number }[] = [];
  for (let k = 1; k <= MAX_WEEKS_BACK && picked.length < SAMPLES; k++) {
    const d = addDays(date, -7 * k);
    if (ordinary.has(d)) picked.push({ date: d, v: sales.get(d) ?? 0 });
  }
  if (picked.length < MIN_SAMPLES) return null;
  const cap = median(picked.map((p) => p.v)) * CAP_HIGH;
  let total = 0;
  let weights = 0;
  picked.forEach((p, i) => {
    const w = SAMPLES - i; // the most recent counts most
    total += Math.min(p.v, cap) * w;
    weights += w;
  });
  const usual = total / weights;

  // How the other weekdays were doing around the event against how they were doing around the comparison days.
  // The days either side of the event are left out: an event can borrow from them.
  const then = levels(sales, ordinary, addDays(picked[picked.length - 1].date, -3), addDays(picked[0].date, 3), wd, new Set());
  const now = levels(sales, ordinary, addDays(date, -NOW_DAYS), addDays(date, NOW_DAYS), wd, new Set([addDays(date, -1), addDays(date, 1)]));
  const shared = [...now.keys()].filter((w) => then.has(w));
  if (shared.length < 2) return null;
  const a = shared.reduce((s, w) => s + now.get(w)!, 0);
  const b = shared.reduce((s, w) => s + then.get(w)!, 0);
  if (a <= 0 || b <= 0) return null;
  return { value: usual * clamp(a / b, ...LEVEL_CLAMP), basis: picked.map((p, i) => ({ date: p.date, share: (SAMPLES - i) / weights })) };
}

export interface EventOutcome {
  id: string;
  date: ISODate;
  series: string;
  actual: number;
  /** An ordinary day of that weekday then; null when it can't be worked out. */
  expected: number | null;
  /** Actual ÷ ordinary − 1; null with nothing to compare against. */
  lift: number | null;
}

export type Verdict = "added" | "cost" | "unclear" | "tooFew" | "noComparison";

export interface SeriesResult {
  series: string;
  kind: string;
  /** Nights with a comparison, and nights without one. */
  nights: number;
  skipped: number;
  first: ISODate;
  last: ISODate;
  /** The nights together: sales against ordinary, with the range chance allows (about 19 times in 20). */
  lift: number | null;
  low: number | null;
  high: number | null;
  /** Sales added per night in dollars (negative when it cost sales). */
  perNight: number | null;
  /** How far one ordinary night lands from ordinary by chance, as a share (0.3 = 30%). */
  noise: number | null;
  /** What the owner expected on average (0.3 = 30% busier); null when left at "no change". */
  hoped: number | null;
  verdict: Verdict;
  /** More nights needed before a lift of this size (or of 10%, if it's smaller) would clear chance. */
  moreNights: number | null;
  /**
   * More nights alone won't settle it: they'd all be compared with the same few ordinary days.
   * Skipping some weeks (or alternating) gives fresh ordinary days to compare with.
   */
  needsBreak: boolean;
  /** The nights either side, against ordinary: borrowed sales show up here. */
  neighbours: { days: number; lift: number } | null;
  /** The multiplier to use for upcoming events of the series: the measured lift, scaled back when it's still unclear. */
  impact: number | null;
}

export interface EventResults {
  outcomes: Map<string, EventOutcome>;
  series: SeriesResult[];
}

export function eventResults(i: { sales: ReadonlyMap<ISODate, number>; openDays: ReadonlySet<ISODate>; events: readonly ResultEvent[]; today: ISODate }): EventResults {
  const eventDays = new Set(i.events.map((e) => e.date));
  // Ordinary days: open, nothing on the calendar, not a holiday.
  const ordinary = new Set([...i.openDays].filter((d) => d < i.today && !eventDays.has(d) && holidayKind(d) == null));

  // How far an ordinary day lands from "ordinary" by chance, per weekday (and its lean, which is taken out).
  const from = addDays(i.today, -NOISE_DAYS);
  const logs = new Map<number, number[]>();
  for (const d of ordinary) {
    if (d < from) continue;
    const e = ordinaryDay(i.sales, ordinary, d);
    const a = i.sales.get(d) ?? 0;
    if (e == null || e <= 0 || a <= 0) continue;
    const wd = weekday(d);
    logs.set(wd, [...(logs.get(wd) ?? []), clamp(Math.log(a / e), -LOG_CLIP, LOG_CLIP)]);
  }
  const all = [...logs.values()].flat();
  const stats = (xs: number[]) => {
    const m = mean(xs);
    return { lean: m, sd: Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)) };
  };
  const pooled = all.length >= NOISE_MIN_DAYS ? stats(all) : null;
  const noise = (wd: number) => {
    const xs = logs.get(wd) ?? [];
    return xs.length >= NOISE_MIN_DAYS ? stats(xs) : pooled;
  };
  /** Log of actual ÷ ordinary for a date, lean taken out; null without a comparison. */
  const score = (date: ISODate, among: ReadonlySet<ISODate> = ordinary) => {
    const n = noise(weekday(date));
    const e = ordinaryBasis(i.sales, among, date);
    const a = i.sales.get(date) ?? 0;
    if (!n || e == null || e.value <= 0 || a <= 0) return null;
    const expected = e.value * Math.exp(n.lean);
    return { log: Math.log(a / expected), expected, sd: n.sd, basis: e.basis };
  };

  const outcomes = new Map<string, EventOutcome>();
  const groups = new Map<string, { kind: string; events: ResultEvent[] }>();
  const past = i.events.filter((e) => e.date < i.today && e.kind !== "CLOSURE");
  const scored = new Map<ISODate, ReturnType<typeof score>>();
  for (const e of past) {
    if (!scored.has(e.date)) scored.set(e.date, i.openDays.has(e.date) ? score(e.date) : null);
    const s = scored.get(e.date)!;
    const series = eventSeries(e.kind, e.title);
    outcomes.set(e.id, { id: e.id, date: e.date, series, actual: i.sales.get(e.date) ?? 0, expected: s?.expected ?? null, lift: s ? Math.exp(s.log) - 1 : null });
    // Holidays have their own place on the scorecard; here it's the things the owner chose to put on.
    if (e.kind === "HOLIDAY") continue;
    if (!groups.has(series)) groups.set(series, { kind: e.kind, events: [] });
    groups.get(series)!.events.push(e);
  }

  const series: SeriesResult[] = [...groups].map(([key, g]) => {
    // One reading per date, however many entries share it.
    const dates = [...new Set(g.events.map((e) => e.date))].sort();
    const got = dates.flatMap((d) => (scored.get(d) ? [{ date: d, ...scored.get(d)! }] : []));
    const hopes = g.events.map((e) => e.impact - 1).filter((x) => Math.abs(x) >= 0.005);
    const base = { series: key, kind: g.kind, nights: got.length, skipped: dates.length - got.length, first: dates[0], last: dates[dates.length - 1], hoped: hopes.length ? mean(hopes) : null };
    if (!got.length) return { ...base, lift: null, low: null, high: null, perNight: null, noise: null, verdict: "noComparison" as const, moreNights: null, needsBreak: false, neighbours: null, impact: null };

    const n = got.length;
    const m = mean(got.map((x) => x.log));
    const sd = Math.sqrt(mean(got.map((x) => x.sd ** 2)));
    // Chance in the average: each night's own swing shrinks with more nights; the swing in the comparison
    // days doesn't, to the extent the nights lean on the same ones.
    const lean = new Map<ISODate, number>();
    for (const x of got) for (const b of x.basis) lean.set(b.date, (lean.get(b.date) ?? 0) + b.share / n);
    const shared = [...lean.values()].reduce((s, x) => s + x * x, 0);
    const day2 = sd ** 2 / (1 + BASIS_VARIANCE);
    const se = SAFETY * Math.sqrt(day2 * (1 / n + shared));
    const z = se > 0 ? m / se : 0;
    const verdict: Verdict = n < RESULT_MIN_NIGHTS ? "tooFew" : z >= 2 ? "added" : z <= -2 ? "cost" : "unclear";
    // Nights needed for a lift this size to clear chance. Something run week after week keeps being compared
    // with the same ordinary days, so more nights only shrink part of the chance; nights with gaps between them
    // bring fresh comparison days as they come.
    const gaps = got.slice(1).map((x, k) => daysBetween(got[k].date, x.date));
    const weekly = n >= 4 && gaps.filter((g) => g === 7).length >= gaps.length * 0.6;
    const target = day2 > 0 ? (Math.max(Math.abs(m), SMALLEST_LIFT) / (POWER_Z * SAFETY)) ** 2 / day2 : 0;
    const needed = weekly ? (target > shared ? Math.ceil(1 / (target - shared)) : null) : target > 0 ? Math.ceil((1 + shared * n) / target) : null;
    const open = verdict === "unclear" || verdict === "tooFew";
    // The nights either side that were ordinary days themselves, compared with days that weren't beside a night
    // of this series (or a weekly night's neighbours would only be compared with each other).
    const besideDates = [...new Set(dates.flatMap((d) => [addDays(d, -1), addDays(d, 1)]))].filter((d) => ordinary.has(d));
    const besideSet = new Set(besideDates);
    const apart = new Set([...ordinary].filter((d) => !besideSet.has(d)));
    const beside = besideDates.flatMap((d) => {
      const s = score(d, apart);
      return s ? [s.log] : [];
    });
    // What to use for the next ones: the measured lift when it's clear, scaled back by how unclear it is otherwise.
    const trust = verdict === "added" || verdict === "cost" ? 1 : verdict === "unclear" ? Math.min(1, Math.abs(z) / 2) : 0;
    return {
      ...base,
      lift: Math.exp(m) - 1,
      low: Math.exp(m - 2 * se) - 1,
      high: Math.exp(m + 2 * se) - 1,
      perNight: mean(got.map((x) => (i.sales.get(x.date) ?? 0) - x.expected)),
      noise: Math.exp(sd) - 1,
      verdict,
      moreNights: open && needed != null ? Math.max(1, needed - n) : null,
      needsBreak: open && weekly && needed == null,
      neighbours: beside.length >= 3 ? { days: beside.length, lift: Math.exp(mean(beside)) - 1 } : null,
      impact: trust > 0 ? Math.round(clamp(Math.exp(m * trust), 0.3, 3) * 100) / 100 : null,
    };
  });

  const rank: Record<Verdict, number> = { added: 0, cost: 1, unclear: 2, tooFew: 3, noComparison: 4 };
  series.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.nights - a.nights || a.series.localeCompare(b.series));
  return { outcomes, series };
}

// ---- In plain words -----------------------------------------------------------------------

const pc = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${pc(x)}`;
const usd = (x: number) => `$${Math.round(Math.abs(x) / 10) * 10 >= 1000 ? (Math.round(Math.abs(x) / 10) * 10).toLocaleString("en-US") : Math.round(Math.abs(x) / 10) * 10}`;
const nightsWord = (n: number) => `${n} night${n === 1 ? "" : "s"}`;

export interface ResultWords {
  label: string;
  tone: "good" | "bad" | "warn" | "neutral";
  /** What happened. */
  line: string;
  /** What would settle it, when it isn't settled; otherwise null. */
  next: string | null;
  /** Extra things worth knowing: what the owner expected, the days either side. */
  notes: string[];
}

/** A series' result as an owner would say it. */
export function describeResult(s: SeriesResult): ResultWords {
  const notes: string[] = [];
  if (s.hoped != null && s.lift != null) notes.push(`You expected ${signed(s.hoped)}.`);
  if (s.neighbours && s.neighbours.days >= 4 && Math.abs(s.neighbours.lift) >= 0.05) {
    notes.push(`The days either side ran about ${pc(s.neighbours.lift)} ${s.neighbours.lift < 0 ? "below" : "above"} ordinary${s.neighbours.lift < 0 && (s.lift ?? 0) > 0 ? ", so some of the gain may be borrowed from them" : ""}.`);
  }
  if (s.skipped > 0 && s.nights > 0) notes.push(`${nightsWord(s.skipped)} couldn't be compared and ${s.skipped === 1 ? "is" : "are"} left out.`);
  const settle = s.needsBreak
    ? "More nights alone won't settle it, because every night is compared with the same few ordinary days. Skip it for two or three weeks, or run it every other week, and the answer comes much sooner."
    : s.moreNights != null
      ? `${s.moreNights > 100 ? "More than 100" : `About ${s.moreNights}`} more ${s.moreNights === 1 ? "night" : "nights"} would ${s.lift != null && Math.abs(Math.log(1 + s.lift)) >= SMALLEST_LIFT ? "settle a change that size" : "show whether there's a change of 10% or more"}.`
      : null;

  if (s.verdict === "noComparison" || s.lift == null || s.low == null || s.high == null || s.perNight == null || s.noise == null) {
    return {
      label: "Nothing to compare",
      tone: "neutral",
      line: "There aren't enough ordinary days of that weekday to set it against.",
      next: s.skipped >= 4 ? "If it runs every week, skip it for two or three weeks and there will be something to measure against." : null,
      notes: [],
    };
  }
  if (s.verdict === "added") {
    return { label: "Added sales", tone: "good", line: `About ${pc(s.lift)} busier than an ordinary day (somewhere between ${pc(s.low)} and ${pc(s.high)}), roughly ${usd(s.perNight)} a night over ${nightsWord(s.nights)}.`, next: null, notes };
  }
  if (s.verdict === "cost") {
    return { label: "Cost sales", tone: "bad", line: `About ${pc(s.lift)} quieter than an ordinary day (somewhere between ${pc(s.high)} and ${pc(s.low)}), roughly ${usd(s.perNight)} a night less over ${nightsWord(s.nights)}.`, next: null, notes };
  }
  const seen = Math.abs(s.lift) < 0.03 ? "no real change" : `${pc(s.lift)} ${s.lift > 0 ? "busier" : "quieter"}`;
  if (s.verdict === "tooFew") {
    return { label: "Too few nights", tone: "neutral", line: `${nightsWord(s.nights)} so far, pointing to ${seen}. One or two nights prove nothing either way: an ordinary night swings by about ${pc(s.noise)} on its own.`, next: settle, notes };
  }
  return { label: "Can't tell yet", tone: "warn", line: `${nightsWord(s.nights)} so far point to ${seen}, but an ordinary night swings by about ${pc(s.noise)} on its own, so that could be chance.`, next: settle, notes };
}
