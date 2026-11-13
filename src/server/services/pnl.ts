import "server-only";
import { addDays, dateRange, ISODate, parseISODate, toISODate, weekday } from "@/domain/dates";
import { addInputs, mondayOf, PnlInput, proratedBudget, summarize } from "@/domain/pnl";
import { blockCost, blockHours, laborByHour, zonedTime } from "@/domain/timecards";
import { db, num } from "../db";
import { env } from "../env";
import { buildContext, loadCostingSnapshot, safeCost } from "./costing";
import { loadTimecards } from "./labor";
import { getLaborRules } from "./labor-rules";
import { businessToday, salesByRecipe } from "./sales";

const dateWhere = (from: ISODate, toExclusive: ISODate) => ({ gte: parseISODate(from), lt: parseISODate(toExclusive) });

/** Net sales and orders per business date: hourly (order totals) where synced, else item-level daily sales. */
async function salesByDay(from: ISODate, toExclusive: ISODate) {
  const [hourly, daily, ignored] = await Promise.all([
    db.hourlySale.groupBy({ by: ["date"], where: { date: dateWhere(from, toExclusive) }, _sum: { netSales: true, orders: true } }),
    db.dailySale.groupBy({ by: ["date", "squareId"], where: { date: dateWhere(from, toExclusive) }, _sum: { netSales: true } }),
    db.squareMapping.findMany({ where: { ignored: true }, select: { squareId: true } }),
  ]);
  const skip = new Set(ignored.map((i) => i.squareId));
  const out = new Map<ISODate, { sales: number; orders: number | null }>();
  for (const d of daily) {
    if (skip.has(d.squareId)) continue;
    const k = toISODate(d.date);
    const cur = out.get(k) ?? { sales: 0, orders: null };
    cur.sales += num(d._sum.netSales) ?? 0;
    out.set(k, cur);
  }
  for (const h of hourly) out.set(toISODate(h.date), { sales: num(h._sum.netSales) ?? 0, orders: h._sum.orders ?? 0 });
  return out;
}

export interface PnlDay extends ReturnType<typeof summarize> {
  date: ISODate;
  future: boolean;
}

export async function pnlReport(from: ISODate, toExclusive: ISODate, now = new Date()) {
  const today = businessToday();
  const [sales, recipeSales, snap, cards, rules, budgets, history] = await Promise.all([
    salesByDay(from, toExclusive),
    salesByRecipe(from, toExclusive),
    loadCostingSnapshot(),
    loadTimecards(from, toExclusive),
    getLaborRules(),
    db.budget.findMany({ where: { weekStart: dateWhere(mondayOf(from), toExclusive) } }),
    salesByDay(addDays(today, -56), today),
  ]);

  // Theoretical COGS: servings sold × today's recipe cost.
  const ctx = buildContext(snap, today);
  const cogsByDay = new Map<ISODate, number>();
  const uncosted = new Set<string>();
  for (const [recipeId, series] of recipeSales.byRecipe) {
    const res = safeCost(ctx, recipeId);
    const name = ctx.recipes.get(recipeId)?.name ?? "Recipe";
    if ("error" in res) {
      uncosted.add(name);
      continue;
    }
    if (res.incomplete) uncosted.add(name);
    for (const [date, q] of series) cogsByDay.set(date, (cogsByDay.get(date) ?? 0) + q * res.totalCost);
  }

  const laborByDay = new Map<ISODate, { cost: number; hours: number }>();
  let missingRates = 0;
  for (const c of cards) {
    const b = { start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate };
    if (c.rate == null) missingRates++;
    const cur = laborByDay.get(c.date) ?? { cost: 0, hours: 0 };
    cur.cost += blockCost(b, rules.employerBurdenPct, now);
    cur.hours += blockHours(b, now);
    laborByDay.set(c.date, cur);
  }

  const days: PnlDay[] = dateRange(from, toExclusive).map((date) => {
    const s = sales.get(date);
    const l = laborByDay.get(date);
    const input: PnlInput = { sales: s?.sales ?? 0, cogs: cogsByDay.get(date) ?? 0, labor: l?.cost ?? 0, laborHours: l?.hours ?? 0, orders: s?.orders ?? null };
    return { date, future: date > today, ...summarize(input) };
  });
  const total = summarize(addInputs(days));

  // Budget: each week's sales target prorated by how much of a typical week the days in range carry.
  const weights = [0, 0, 0, 0, 0, 0, 0];
  for (const [date, s] of history) weights[weekday(date)] += s.sales;
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
    budget,
    burdenPct: rules.employerBurdenPct,
    uncosted: [...uncosted].sort(),
    missingRates,
    openCards: cards.filter((c) => !c.clockOut).length,
    hasHourly: days.some((d) => d.orders != null),
  };
}

/** Sales vs labor cost for each local hour of one business day. */
export async function hourlyDay(date: ISODate, now = new Date()) {
  const [hourly, cards, rules] = await Promise.all([
    db.hourlySale.findMany({ where: { date: parseISODate(date) } }),
    loadTimecards(date, addDays(date, 1)),
    getLaborRules(),
  ]);
  const sales = new Array<number>(24).fill(0);
  const orders = new Array<number>(24).fill(0);
  for (const h of hourly) {
    if (h.hour < 0 || h.hour > 23) continue;
    sales[h.hour] += h.netSales.toNumber();
    orders[h.hour] += h.orders;
  }
  const labor = laborByHour(
    cards.map((c) => ({ start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate })),
    zonedTime(date, 0, env.BUSINESS_TIMEZONE),
    rules.employerBurdenPct,
    now,
  );
  return { date, hasSales: hourly.length > 0, hours: sales.map((s, h) => ({ hour: h, sales: s, orders: orders[h], labor: labor.cost[h], laborHours: labor.hours[h] })) };
}
