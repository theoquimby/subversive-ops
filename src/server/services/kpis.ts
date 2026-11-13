import "server-only";
import { CostingContext } from "@/domain/costing";
import { dateRange, ISODate, parseISODate, toISODate } from "@/domain/dates";
import { emptySplit, groupSplit, GroupSplit } from "@/domain/revenueClass";
import { KpiDay, PeriodTotals, rollupKpis, SoldLine, summarize, theoreticalByDay } from "@/domain/pnl";
import { blockCost, blockHours } from "@/domain/timecards";
import { db } from "../db";
import { buildContext, CostingSnapshot, loadCostingSnapshot, safeCost } from "./costing";
import { classSettings, recipeClasses } from "./insights";
import { loadTimecards } from "./labor";
import { getLaborRules } from "./labor-rules";
import { businessToday, dailyNetSalesExcludingIgnored } from "./sales";

/**
 * Period KPIs — the one place net sales, food/beverage cost %, labor % and
 * prime cost are computed. P&L, Budgets and the Overview all read these, so
 * the same week shows the same numbers everywhere.
 *
 * - Net sales: Square order totals (item totals where the hourly sync hasn't
 *   run), minus items marked "Ignore".
 * - Theoretical cost: items sold × each recipe's cost as of the sale date,
 *   split food / beverage (food cost % is of food sales, beverage of beverage).
 * - Labor: timecards × rate × (1 + employer burden); open cards count up to now.
 * - Today is in progress: it counts only with `includeToday`.
 */

const dateWhere = (from: ISODate, toExclusive: ISODate) => ({ gte: parseISODate(from), lt: parseISODate(toExclusive) });

/**
 * Item-level sales for [from, to): servings and net sales per recipe per day
 * (for food/beverage splits and theoretical cost), plus each day's non-ignored
 * item total (used when a day has no order-level hourly rows).
 */
async function itemSales(from: ISODate, toExclusive: ISODate) {
  const [rows, mappings] = await Promise.all([
    db.dailySale.findMany({ where: { date: dateWhere(from, toExclusive) }, select: { date: true, squareId: true, qty: true, netSales: true } }),
    db.squareMapping.findMany({ select: { squareId: true, recipeId: true, ignored: true } }),
  ]);
  const map = new Map(mappings.map((m) => [m.squareId, m]));
  const sold: SoldLine[] = [];
  const itemTotal = new Map<ISODate, number>();
  for (const r of rows) {
    const m = map.get(r.squareId);
    if (m?.ignored) continue;
    const date = toISODate(r.date);
    itemTotal.set(date, (itemTotal.get(date) ?? 0) + r.netSales.toNumber());
    if (m?.recipeId) sold.push({ date, recipeId: m.recipeId, qty: r.qty.toNumber(), sales: r.netSales.toNumber() });
  }
  return { sold, itemTotal };
}

/**
 * Net sales (ignored Square items left out) and orders per business date:
 * order totals where the hourly sync has run, else the sum of item sales.
 */
async function salesByDay(from: ISODate, toExclusive: ISODate, itemTotal: Map<ISODate, number>) {
  const [orders, net] = await Promise.all([
    db.hourlySale.groupBy({ by: ["date"], where: { date: dateWhere(from, toExclusive) }, _sum: { orders: true } }),
    dailyNetSalesExcludingIgnored(from, toExclusive),
  ]);
  const out = new Map<ISODate, { sales: number; orders: number | null }>();
  for (const [date, sales] of itemTotal) out.set(date, { sales, orders: null });
  const ordersBy = new Map(orders.map((o) => [toISODate(o.date), o._sum.orders ?? 0]));
  for (const [date, sales] of net) out.set(date, { sales: Math.max(0, sales), orders: ordersBy.get(date) ?? 0 });
  return out;
}

/**
 * Recipe cost as of a date, so past days are costed at the prices that
 * applied then rather than today's. One context per day, cached.
 */
export function asOfCoster(snap: CostingSnapshot) {
  const ctxs = new Map<ISODate, CostingContext>();
  const memo = new Map<string, { cost: number; incomplete: boolean } | null>();
  return (recipeId: string, date: ISODate) => {
    const key = `${date}|${recipeId}`;
    if (memo.has(key)) return memo.get(key)!;
    let ctx = ctxs.get(date);
    if (!ctx) ctxs.set(date, (ctx = buildContext(snap, date)));
    const res = safeCost(ctx, recipeId);
    const out = "error" in res ? null : { cost: res.totalCost, incomplete: res.incomplete };
    memo.set(key, out);
    return out;
  };
}

/** Theoretical cost of goods per day and revenue class, at as-of-date recipe costs. */
export async function theoreticalSplit(from: ISODate, toExclusive: ISODate, snap?: CostingSnapshot) {
  const [s, settings, items] = await Promise.all([snap ?? loadCostingSnapshot(), classSettings(), itemSales(from, toExclusive)]);
  const classes = recipeClasses(s, settings);
  const names = new Map(s.recipes.map((r) => [r.id, r.name]));
  const { byDay, uncosted } = theoreticalByDay(items.sold, asOfCoster(s), (id) => classes.get(id) ?? "food");
  return { byDay, uncosted: [...uncosted].map((id) => names.get(id) ?? "Recipe").sort(), itemTotal: items.itemTotal };
}

export interface KpiDayDetail extends KpiDay {
  /** Food / beverage / total lines for the day, against its own net sales. */
  group: GroupSplit;
  summary: ReturnType<typeof summarize>;
  state: "done" | "today" | "future";
}

/** Raw per-day KPI inputs for [from, toExclusive). */
export async function dailyKpis(from: ISODate, toExclusive: ISODate, opts: { now?: Date; snap?: CostingSnapshot } = {}) {
  const now = opts.now ?? new Date();
  const today = businessToday();
  const [theo, cards, rules] = await Promise.all([theoreticalSplit(from, toExclusive, opts.snap), loadTimecards(from, toExclusive), getLaborRules()]);
  const sales = await salesByDay(from, toExclusive, theo.itemTotal);
  const laborDay = new Map<ISODate, { cost: number; hours: number }>();
  let missingRates = 0;
  for (const c of cards) {
    const b = { start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate };
    if (c.rate == null) missingRates++;
    const cur = laborDay.get(c.date) ?? { cost: 0, hours: 0 };
    cur.cost += blockCost(b, rules.employerBurdenPct, now);
    cur.hours += blockHours(b, now);
    laborDay.set(c.date, cur);
  }
  const days: KpiDayDetail[] = dateRange(from, toExclusive).map((date) => {
    const s = sales.get(date);
    const l = laborDay.get(date);
    const split = theo.byDay.get(date) ?? emptySplit();
    const group = groupSplit(split, s?.sales ?? 0);
    const input = { sales: s?.sales ?? 0, cogs: group.total.cogs, labor: l?.cost ?? 0, laborHours: l?.hours ?? 0, orders: s?.orders ?? null };
    return { date, ...input, split, salesSynced: !!s, group, summary: summarize(input), state: date < today ? "done" : date === today ? "today" : "future" };
  });
  return {
    today,
    days,
    uncosted: theo.uncosted,
    missingRates,
    openCards: cards.filter((c) => !c.clockOut).length,
    burdenPct: rules.employerBurdenPct,
  };
}

export type DailyKpis = Awaited<ReturnType<typeof dailyKpis>>;

export interface PeriodKpis extends PeriodTotals {
  from: ISODate;
  toExclusive: ISODate;
  includeToday: boolean;
  /** Today falls in the range but isn't counted (still in progress). */
  todayExcluded: boolean;
  /** Today is in range and Square sales for it haven't arrived yet. */
  todaySalesPending: boolean;
  days: KpiDayDetail[];
  uncosted: string[];
  missingRates: number;
  openCards: number;
  burdenPct: number;
}

/** Totals for a slice of already-loaded days (e.g. one week out of a longer load). */
export function periodFrom(d: DailyKpis, from: ISODate, toExclusive: ISODate, includeToday: boolean): PeriodKpis {
  const days = d.days.filter((x) => x.date >= from && x.date < toExclusive);
  const todayDay = days.find((x) => x.date === d.today);
  return {
    ...rollupKpis(days, d.today, includeToday),
    from,
    toExclusive,
    includeToday,
    todayExcluded: !!todayDay && !includeToday,
    todaySalesPending: !!todayDay && !todayDay.salesSynced,
    days,
    uncosted: d.uncosted,
    missingRates: d.missingRates,
    openCards: d.openCards,
    burdenPct: d.burdenPct,
  };
}

/**
 * KPIs for business dates [from, toExclusive). Today is left out unless
 * `includeToday` (pass true only when the person picked "Today").
 */
export async function periodKpis(from: ISODate, toExclusive: ISODate, opts: { includeToday?: boolean; now?: Date; snap?: CostingSnapshot } = {}): Promise<PeriodKpis> {
  return periodFrom(await dailyKpis(from, toExclusive, opts), from, toExclusive, opts.includeToday ?? false);
}
