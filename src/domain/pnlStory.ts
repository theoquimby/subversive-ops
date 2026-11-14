/**
 * The P&L as a story: the sales → costs → profit bridge (with an honest
 * estimate for sales not linked to a recipe), which periods to compare
 * against, a weekly trend, and plain-English notes on what moved. Pure: no
 * I/O and no formatting (the page turns notes into words).
 */

import { addDays, daysBetween, ISODate, parseISODate, toISODate } from "./dates";
import { mondayOf, PeriodKind } from "./pnl";
import { REVENUE_CLASSES, type ClassSplit } from "./revenueClass";

/**
 * Cost share assumed for sales with no recipe behind them (beer, cocktails and
 * anything not linked yet): a typical taproom with a kitchen. The same figure
 * Insights uses (analytics/subops/common.py ASSUMED_COST_SHARE).
 */
export const TYPICAL_COST_SHARE = 0.3;
/** Average days in a month, for spreading monthly fixed costs over a period. */
export const DAYS_PER_MONTH = 365.25 / 12;

/** Store sales that no linked recipe accounts for (order totals minus every class's item sales). */
export function unlinkedSales(split: ClassSplit, totalSales: number): number {
  const linked = REVENUE_CLASSES.reduce((s, c) => s + split[c.value].sales, 0);
  return Math.max(0, totalSales - linked);
}

/** A monthly fixed cost spread over `days` calendar days. */
export const fixedForDays = (monthly: number, days: number) => (monthly > 0 && days > 0 ? (monthly * days) / DAYS_PER_MONTH : 0);

export interface BridgeInput {
  sales: number;
  /** Cost of goods from linked recipes (theoretical). */
  cogs: number;
  labor: number;
  /** Sales with no recipe cost behind them. */
  unlinkedSales: number;
}

export interface Bridge {
  sales: number;
  /** Counted from recipes. */
  cogs: number;
  /** Unlinked sales × TYPICAL_COST_SHARE. */
  cogsEstimate: number;
  labor: number;
  /** Sales − cost of goods (counted + estimate) − labor. */
  profit: number;
  /** profit ÷ sales. */
  margin: number | null;
  /** Fixed costs for the period, when set. */
  fixed: number | null;
  /** profit − fixed, when fixed costs are set. */
  afterFixed: number | null;
  afterFixedMargin: number | null;
  /** Share of sales whose cost comes from a recipe; null with no sales. */
  coverage: number | null;
  /** Part of cost of goods is an estimate. */
  estimated: boolean;
  /** (cogs + estimate) ÷ sales. */
  cogsPct: number | null;
  laborPct: number | null;
  /** (cogs + estimate + labor) ÷ sales. */
  primePct: number | null;
}

export function bridge(i: BridgeInput, fixed: number | null = null): Bridge {
  const unlinked = Math.min(Math.max(0, i.unlinkedSales), Math.max(0, i.sales));
  const cogsEstimate = unlinked * TYPICAL_COST_SHARE;
  const profit = i.sales - i.cogs - cogsEstimate - i.labor;
  const r = (n: number) => (i.sales > 0 ? n / i.sales : null);
  const afterFixed = fixed != null && fixed > 0 ? profit - fixed : null;
  return {
    sales: i.sales,
    cogs: i.cogs,
    cogsEstimate,
    labor: i.labor,
    profit,
    margin: r(profit),
    fixed: fixed != null && fixed > 0 ? fixed : null,
    afterFixed,
    afterFixedMargin: afterFixed == null ? null : r(afterFixed),
    coverage: i.sales > 0 ? 1 - unlinked / i.sales : null,
    estimated: cogsEstimate > 0,
    cogsPct: r(i.cogs + cogsEstimate),
    laborPct: r(i.labor),
    primePct: r(i.cogs + cogsEstimate + i.labor),
  };
}

// ---- What to compare against -------------------------------------------------------

export interface CompareRange {
  from: ISODate;
  toExclusive: ISODate;
  /** "the same days last week", "same week last year"… */
  label: string;
}

/** Same day-of-month `months` away, clamped to that month's length (Mar 31 − 1 month = Feb 28/29). */
export function shiftMonths(date: ISODate, months: number): ISODate {
  const d = parseISODate(date);
  const day = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return toISODate(first);
}

/**
 * The periods worth comparing with the counted days of a P&L period, lined up
 * on the same weekdays (weeks shift by 7, years by 364) or the same dates
 * (months). Today is still in progress, so it gets no comparison.
 */
export function comparisonRanges(kind: PeriodKind, counted: ISODate[]): { prev: CompareRange | null; year: CompareRange | null } {
  if (kind === "today" || counted.length === 0) return { prev: null, year: null };
  const from = counted[0];
  const toExclusive = addDays(counted[counted.length - 1], 1);
  const len = daysBetween(from, toExclusive);
  const shift = (days: number, label: string): CompareRange => ({ from: addDays(from, days), toExclusive: addDays(toExclusive, days), label });
  switch (kind) {
    case "week":
      return { prev: shift(-7, len < 7 ? "the same days last week" : "last week"), year: shift(-364, len < 7 ? "the same days last year" : "the same week last year") };
    case "lastweek":
      return { prev: shift(-7, "the week before"), year: shift(-364, "the same week last year") };
    case "month": {
      const m = (n: number, label: string): CompareRange => {
        const a = shiftMonths(from, n);
        const b = shiftMonths(toExclusive, n);
        return { from: a, toExclusive: b > a ? b : addDays(a, 1), label };
      };
      return { prev: m(-1, "the same dates last month"), year: m(-12, "the same dates last year") };
    }
    case "custom":
      // Under a week: the same weekdays a week earlier (a Saturday against a Saturday).
      if (len < 7) return { prev: shift(-7, len === 1 ? "the same day last week" : "the same days last week"), year: shift(-364, len === 1 ? "the same day last year" : "the same days last year") };
      return { prev: shift(-len, `the ${len} days before`), year: shift(-364, "the same days last year") };
  }
}

// ---- Weekly trend --------------------------------------------------------------------

export interface TrendDay {
  date: ISODate;
  sales: number;
  cogs: number;
  labor: number;
  unlinkedSales: number;
}

export interface TrendWeek {
  /** Monday. */
  weekStart: ISODate;
  /** Days of the week included (fewer than 7 = a week in progress or cut by the range). */
  days: number;
  sales: number;
  cogs: number;
  cogsEstimate: number;
  labor: number;
  profit: number;
}

/** Roll finished days into Monday-start weeks, oldest first. */
export function weeklyTrend(days: TrendDay[]): TrendWeek[] {
  const by = new Map<ISODate, TrendWeek>();
  for (const d of days) {
    const w = mondayOf(d.date);
    const cur = by.get(w) ?? { weekStart: w, days: 0, sales: 0, cogs: 0, cogsEstimate: 0, labor: 0, profit: 0 };
    const b = bridge(d);
    cur.days++;
    cur.sales += b.sales;
    cur.cogs += b.cogs;
    cur.cogsEstimate += b.cogsEstimate;
    cur.labor += b.labor;
    cur.profit += b.profit;
    by.set(w, cur);
  }
  return [...by.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

// ---- What moved ------------------------------------------------------------------------

export interface PeriodFigures {
  sales: number;
  /** Counted cost of goods (linked recipes). */
  cogs: number;
  labor: number;
  laborHours: number;
  unlinkedSales: number;
  /** Food sales and their counted cost. */
  foodSales: number;
  foodCogs: number;
}

export interface StoryDay {
  date: ISODate;
  sales: number;
  cogs: number;
  labor: number;
  unlinkedSales: number;
}

export type StoryNote =
  | { kind: "sales"; tone: "neutral"; sales: number; prev: { change: number; label: string } | null; year: { change: number; label: string } | null }
  | { kind: "labor"; tone: "good" | "warn"; label: string; pct: number; prevPct: number; salesChange: number; laborChange: number; hoursChange: number | null; labor: number }
  | { kind: "food"; tone: "good" | "warn"; label: string; pct: number; prevPct: number }
  | { kind: "bestDay"; tone: "neutral"; date: ISODate; sales: number; share: number }
  | { kind: "lossDays"; tone: "warn"; days: { date: ISODate; sales: number; loss: number; labor: number }[] }
  | { kind: "forecast"; tone: "neutral" | "good"; actual: number; forecast: number; change: number };

const ratio = (a: number, b: number) => (b > 0 ? a / b - 1 : null);

/** Points a ratio must move before it's worth a note. */
export const NOTE_THRESHOLDS = { laborPts: 0.02, foodPts: 0.015, forecast: 0.1, lossMinSales: 1, lossMin: 5 } as const;

/**
 * Plain-English notes on what moved, in reading order: sales, then labor and
 * food cost moves (only past a threshold), the best day, days that lost money
 * once food and labor were paid, and the forecast miss. Every note is derived
 * from the figures given; nothing is guessed.
 */
export function storyNotes(i: {
  cur: PeriodFigures;
  prev: (PeriodFigures & { label: string }) | null;
  year: (PeriodFigures & { label: string }) | null;
  days: StoryDay[];
  forecast: { actual: number; forecast: number } | null;
}): StoryNote[] {
  const out: StoryNote[] = [];
  const { cur, prev, year } = i;
  if (cur.sales <= 0) return out;

  const pc = prev ? ratio(cur.sales, prev.sales) : null;
  const yc = year ? ratio(cur.sales, year.sales) : null;
  out.push({ kind: "sales", tone: "neutral", sales: cur.sales, prev: pc != null ? { change: pc, label: prev!.label } : null, year: yc != null ? { change: yc, label: year!.label } : null });

  if (prev && prev.sales > 0 && prev.labor > 0) {
    const pct = cur.labor / cur.sales;
    const prevPct = prev.labor / prev.sales;
    if (Math.abs(pct - prevPct) >= NOTE_THRESHOLDS.laborPts) {
      out.push({
        kind: "labor",
        tone: pct > prevPct ? "warn" : "good",
        label: prev.label,
        pct,
        prevPct,
        salesChange: cur.sales / prev.sales - 1,
        laborChange: cur.labor / prev.labor - 1,
        hoursChange: prev.laborHours > 0 ? cur.laborHours / prev.laborHours - 1 : null,
        labor: cur.labor,
      });
    }
  }

  if (prev && cur.foodSales > 0 && prev.foodSales > 0 && cur.foodCogs > 0 && prev.foodCogs > 0) {
    const pct = cur.foodCogs / cur.foodSales;
    const prevPct = prev.foodCogs / prev.foodSales;
    if (Math.abs(pct - prevPct) >= NOTE_THRESHOLDS.foodPts) out.push({ kind: "food", tone: pct > prevPct ? "warn" : "good", label: prev.label, pct, prevPct });
  }

  const open = i.days.filter((d) => d.sales >= NOTE_THRESHOLDS.lossMinSales);
  if (open.length >= 3) {
    const best = open.reduce((a, b) => (b.sales > a.sales ? b : a));
    out.push({ kind: "bestDay", tone: "neutral", date: best.date, sales: best.sales, share: best.sales / cur.sales });
  }
  const losses = open
    .map((d) => ({ date: d.date, sales: d.sales, labor: d.labor, loss: -bridge(d).profit }))
    .filter((d) => d.loss >= NOTE_THRESHOLDS.lossMin)
    .sort((a, b) => b.loss - a.loss);
  if (losses.length) out.push({ kind: "lossDays", tone: "warn", days: losses });

  if (i.forecast && i.forecast.forecast > 0) {
    const change = i.forecast.actual / i.forecast.forecast - 1;
    if (Math.abs(change) >= NOTE_THRESHOLDS.forecast) out.push({ kind: "forecast", tone: change > 0 ? "good" : "neutral", actual: i.forecast.actual, forecast: i.forecast.forecast, change });
  }
  return out;
}

/** Change of a ratio in percentage points (0.031 = 3.1 points); null when either side is missing. */
export const pointsChange = (cur: number | null | undefined, prev: number | null | undefined) => (cur == null || prev == null ? null : cur - prev);
