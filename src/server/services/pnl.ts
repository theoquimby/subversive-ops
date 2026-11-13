import "server-only";
import { CostingContext } from "@/domain/costing";
import { addDays, dateRange, ISODate, parseISODate, toISODate, weekday } from "@/domain/dates";
import { backtest } from "@/domain/forecastAccuracy";
import { addInputs, mondayOf, PnlInput, projectClose, proratedBudget, SoldLine, summarize, theoreticalByDay } from "@/domain/pnl";
import { addSplits, ClassSplit, emptySplit, groupSplit, GroupSplit } from "@/domain/revenueClass";
import { blockCost, blockHours, laborByHour, localMinutes, zonedTime } from "@/domain/timecards";
import { db, num } from "../db";
import { env } from "../env";
import { laborByDay } from "./budgets";
import { buildContext, CostingSnapshot, loadCostingSnapshot, safeCost } from "./costing";
import { dailySalesForecast, dailySalesHistory, hourlySalesForecast } from "./forecasting";
import { classSettings, costTargets, recipeClasses } from "./insights";
import { loadTimecards } from "./labor";
import { getLaborRules } from "./labor-rules";
import { getAdjustments } from "./planning";
import { businessToday, dailyNetSalesExcludingIgnored, lastSquareSync } from "./sales";
import { loadEmployees, loadPositions, rateFor } from "./scheduling";
import { lastCountPeriod, varianceReport } from "./variance";

const tz = () => env.BUSINESS_TIMEZONE;
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

/**
 * Forecast sales per day. Past days use the forecast as it would have been
 * made the evening before (the same backtest as the forecast accuracy panel);
 * today and later use the live forecast with weather.
 */
async function forecastByDay(from: ISODate, toExclusive: ISODate): Promise<Map<ISODate, number>> {
  const today = businessToday();
  const dates = dateRange(from, toExclusive);
  const past = dates.filter((d) => d < today);
  const ahead = dates.filter((d) => d >= today);
  const out = new Map<ISODate, number>();
  if (past.length) {
    const histFrom = addDays(past[0], -120);
    const [history, events, manual] = await Promise.all([
      dailySalesHistory(histFrom, today),
      db.event.findMany({ where: { date: dateWhere(histFrom, today) }, select: { date: true, impact: true, kind: true } }),
      getAdjustments(),
    ]);
    const adjustments = new Map<ISODate, number>();
    const eventDays = new Set<ISODate>();
    for (const e of events) {
      const d = toISODate(e.date);
      const f = e.kind === "CLOSURE" ? 0 : e.impact.toNumber();
      adjustments.set(d, (adjustments.get(d) ?? 1) * f);
      if (e.kind === "CLOSURE" || e.impact.toNumber() !== 1) eventDays.add(d);
    }
    for (const [d, m] of manual) if (d < today) adjustments.set(d, (adjustments.get(d) ?? 1) * m);
    for (const r of backtest({ history: history.sales, openDays: history.openDays, dates: past, adjustments, excludeFromBaseline: eventDays })) out.set(r.date, r.forecast);
  }
  if (ahead.length) {
    try {
      for (const f of await dailySalesForecast(ahead)) out.set(f.date, f.qty);
    } catch (e) {
      console.error("pnl: forecast failed", e);
    }
  }
  return out;
}

export interface PnlDay extends ReturnType<typeof summarize> {
  date: ISODate;
  future: boolean;
  /** Forecast sales for the day (as it stood the evening before, for past days). */
  forecast: number | null;
  /** Scheduled labor cost (shifts, with burden). */
  scheduledLabor: number | null;
  split: GroupSplit;
}

export async function pnlReport(from: ISODate, toExclusive: ISODate, now = new Date()) {
  const today = businessToday();
  const [theo, cards, rules, budgets, history, forecast, scheduled, targets] = await Promise.all([
    theoreticalSplit(from, toExclusive),
    loadTimecards(from, toExclusive),
    getLaborRules(),
    db.budget.findMany({ where: { weekStart: dateWhere(mondayOf(from), toExclusive) } }),
    dailyNetSalesExcludingIgnored(addDays(today, -56), today),
    forecastByDay(from, toExclusive),
    laborByDay(from, toExclusive, "shifts"),
    costTargets(),
  ]);
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

  let splitTotal: ClassSplit = emptySplit();
  const days: PnlDay[] = dateRange(from, toExclusive).map((date) => {
    const s = sales.get(date);
    const l = laborDay.get(date);
    const split = theo.byDay.get(date) ?? emptySplit();
    splitTotal = addSplits(splitTotal, split);
    const g = groupSplit(split, s?.sales ?? 0);
    const input: PnlInput = { sales: s?.sales ?? 0, cogs: g.total.cogs, labor: l?.cost ?? 0, laborHours: l?.hours ?? 0, orders: s?.orders ?? null };
    return { date, future: date > today, forecast: forecast.get(date) ?? null, scheduledLabor: scheduled.get(date)?.cost ?? null, split: g, ...summarize(input) };
  });
  const total = summarize(addInputs(days));
  const split = groupSplit(splitTotal, total.sales);
  // Forecast and schedule comparisons only over finished days (today is still partial).
  const elapsed = days.filter((d) => d.date < today);
  const forecastToDate = elapsed.some((d) => d.forecast != null) ? elapsed.reduce((s, d) => s + (d.forecast ?? 0), 0) : null;
  const scheduledToDate = elapsed.some((d) => d.scheduledLabor != null) ? elapsed.reduce((s, d) => s + (d.scheduledLabor ?? 0), 0) : null;

  // Budget: each week's sales target prorated by how much of a typical week the days in range carry.
  const weights = [0, 0, 0, 0, 0, 0, 0];
  for (const [date, s] of history) weights[weekday(date)] += Math.max(0, s);
  const byWeek = new Map(budgets.map((b) => [toISODate(b.weekStart), b]));
  const weeks = new Map<ISODate, ISODate[]>();
  for (const d of days) weeks.set(mondayOf(d.date), [...(weeks.get(mondayOf(d.date)) ?? []), d.date]);
  let budget: { sales: number | null; foodCostPct: number | null; laborPct: number | null; weeks: number } | null = null;
  if ([...weeks.keys()].every((w) => byWeek.has(w))) {
    const list = [...weeks].map(([w, ds]) => ({ b: byWeek.get(w)!, ds }));
    const allSales = list.every((x) => x.b.sales != null);
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    budget = {
      sales: allSales ? list.reduce((s, x) => s + proratedBudget(num(x.b.sales)!, x.ds, weights.some((w) => w > 0) ? weights : undefined), 0) : null,
      foodCostPct: avg(list.map((x) => num(x.b.foodCostPct))),
      laborPct: avg(list.map((x) => num(x.b.laborPct))),
      weeks: list.length,
    };
  }

  return {
    from,
    toExclusive,
    days,
    total,
    split,
    targets,
    forecastToDate,
    salesToDate: elapsed.reduce((s, d) => s + d.sales, 0),
    laborToDate: elapsed.reduce((s, d) => s + d.labor, 0),
    scheduledToDate,
    budget,
    burdenPct: rules.employerBurdenPct,
    uncosted: theo.uncosted,
    missingRates,
    openCards: cards.filter((c) => !c.clockOut).length,
    hasHourly: days.some((d) => d.orders != null),
  };
}

export type PnlReport = Awaited<ReturnType<typeof pnlReport>>;

/** Scheduled shifts on a business date as cost blocks (rate: person's rate for the position, else the default). */
async function shiftBlocks(date: ISODate) {
  const [shifts, positions] = await Promise.all([
    db.shift.findMany({ where: { start: { gte: zonedTime(date, 0, tz()), lt: zonedTime(addDays(date, 1), 0, tz()) } } }),
    loadPositions(),
  ]);
  if (shifts.length === 0) return { blocks: [], published: 0, total: 0 };
  const employees = new Map((await loadEmployees(positions)).map((e) => [e.id, e]));
  const pos = new Map(positions.map((p) => [p.id, p]));
  return {
    blocks: shifts.map((s) => ({ start: s.start, end: s.end, breakMinutes: s.breakMinutes, rate: rateFor(s.employeeId ? employees.get(s.employeeId) : undefined, s.positionId, pos) })),
    published: shifts.filter((s) => s.published).length,
    total: shifts.length,
  };
}

/** Sales, actual labor and scheduled labor for each local hour of one business day. */
export async function hourlyDay(date: ISODate, now = new Date()) {
  const [hourly, cards, rules, shifts] = await Promise.all([
    db.hourlySale.findMany({ where: { date: parseISODate(date) } }),
    loadTimecards(date, addDays(date, 1)),
    getLaborRules(),
    shiftBlocks(date),
  ]);
  const sales = new Array<number>(24).fill(0);
  const orders = new Array<number>(24).fill(0);
  for (const h of hourly) {
    if (h.hour < 0 || h.hour > 23) continue;
    sales[h.hour] += h.netSales.toNumber();
    orders[h.hour] += h.orders;
  }
  const dayStart = zonedTime(date, 0, tz());
  const labor = laborByHour(
    cards.map((c) => ({ start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate })),
    dayStart,
    rules.employerBurdenPct,
    now,
  );
  // Shifts always have an end, so `now` doesn't matter for them.
  const sched = laborByHour(shifts.blocks, dayStart, rules.employerBurdenPct, now);
  return {
    date,
    hasSales: hourly.length > 0,
    hasSchedule: shifts.total > 0,
    scheduleDraft: shifts.total > 0 && shifts.published === 0,
    hours: sales.map((s, h) => ({ hour: h, sales: s, orders: orders[h], labor: labor.cost[h], laborHours: labor.hours[h], scheduled: sched.cost[h], scheduledHours: sched.hours[h] })),
  };
}

/**
 * Today so far: sales, labor on the clock, and where the day is likely to
 * close (sales so far + the forecast for the hours left).
 */
export async function todaySoFar(now = new Date()) {
  const today = businessToday();
  const ignoredIds = (await db.squareMapping.findMany({ where: { ignored: true }, select: { squareId: true } })).map((m) => m.squareId);
  const [day, ignored, lastSync, forecast] = await Promise.all([
    hourlyDay(today, now),
    db.dailySale.aggregate({ _sum: { netSales: true }, where: { date: parseISODate(today), squareId: { in: ignoredIds } } }),
    lastSquareSync(),
    hourlySalesForecast([today]).then((f) => f[0] ?? null).catch((e) => {
      console.error("today: forecast failed", e);
      return null;
    }),
  ]);
  const mins = localMinutes(now, tz());
  const hour = Math.floor(mins / 60);
  const minute = mins % 60;
  const proj = projectClose(day.hours.map((h) => h.sales), forecast?.hours ?? new Array(24).fill(0), hour, minute);
  const ignoredSales = num(ignored._sum.netSales) ?? 0;
  const soFar = Math.max(0, proj.soFar - ignoredSales);
  const projected = Math.max(soFar, proj.projected - ignoredSales);
  const laborSoFar = day.hours.reduce((s, h) => s + h.labor, 0);
  const laborHours = day.hours.reduce((s, h) => s + h.laborHours, 0);
  // Labor still to come today, from the schedule.
  const schedLeft = day.hours.reduce((s, h) => s + (h.hour > hour ? h.scheduled : h.hour === hour ? h.scheduled * (1 - minute / 60) : 0), 0);
  const projectedLabor = laborSoFar + schedLeft;
  return {
    date: today,
    hasSales: day.hasSales,
    soFar,
    orders: day.hours.reduce((s, h) => s + h.orders, 0),
    laborSoFar,
    laborHours,
    laborPct: soFar > 0 ? laborSoFar / soFar : null,
    forecastDay: forecast ? forecast.qty : null,
    forecastSoFar: forecast ? proj.forecastSoFar : null,
    projected: forecast ? projected : null,
    pace: proj.pace,
    projectedLaborPct: forecast && projected > 0 && day.hasSchedule ? projectedLabor / projected : null,
    hasSchedule: day.hasSchedule,
    lastSync,
  };
}

/**
 * Actual cost of goods from the latest two counts next to theoretical, split
 * food / beverage — the "what really happened" check on the P&L.
 */
export async function actualFromCounts() {
  const period = await lastCountPeriod();
  if (!period) return null;
  try {
    const r = await varianceReport(period.start.id, period.end.id);
    return { from: r.from, to: r.to, days: r.days, food: r.groups.food, beverage: r.groups.beverage, skipped: r.skipped };
  } catch (e) {
    console.error("pnl: variance failed", e);
    return null;
  }
}

