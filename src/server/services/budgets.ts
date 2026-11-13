import "server-only";
import { WeekActuals, WeekTarget, weekStartOf, weekStarts, weekStatus } from "@/domain/budgets";
import { addDays, businessDate, dateRange, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import { paidHours } from "@/domain/labor";
import { Prisma } from "@prisma/client";
import { db, num } from "../db";
import { env } from "../env";
import { buildContext, CostingSnapshot, loadCostingSnapshot, safeCost } from "./costing";
import { dailySalesForecast, dailySalesHistory } from "./forecasting";
import { getLaborRules } from "./labor-rules";
import { businessToday, salesByRecipe } from "./sales";

const tz = () => env.BUSINESS_TIMEZONE;
const dec = (n: number | null, places = 2) => (n == null ? null : new Prisma.Decimal(n.toFixed(places)));

export async function loadTargets(from: ISODate, toExclusive: ISODate): Promise<Map<ISODate, WeekTarget>> {
  const rows = await db.budget.findMany({ where: { weekStart: { gte: parseISODate(from), lt: parseISODate(toExclusive) } } });
  return new Map(
    rows.map((b) => {
      const w = toISODate(b.weekStart);
      return [w, { weekStart: w, sales: num(b.sales), foodCostPct: num(b.foodCostPct), laborPct: num(b.laborPct) }];
    }),
  );
}

export async function saveTarget(weekStart: ISODate, field: "sales" | "foodCostPct" | "laborPct", value: number | null) {
  const w = parseISODate(weekStartOf(weekStart));
  const v = dec(value, field === "sales" ? 2 : 4);
  await db.budget.upsert({ where: { weekStart: w }, create: { weekStart: w, [field]: v }, update: { [field]: v } });
}

export async function saveTargets(rows: WeekTarget[]) {
  await db.$transaction(
    rows.map((t) => {
      const data = { sales: dec(t.sales), foodCostPct: dec(t.foodCostPct, 4), laborPct: dec(t.laborPct, 4) };
      return db.budget.upsert({ where: { weekStart: parseISODate(t.weekStart) }, create: { weekStart: parseISODate(t.weekStart), ...data }, update: data });
    }),
  );
}

// ---- Labor cost -----------------------------------------------------------------

/** Wage rate for a shift/timecard: its own rate, the person's position rate, their base rate, the position default. */
function rateFinder(employees: { id: string; hourlyRate: Prisma.Decimal | null; positions: { positionId: string; rate: Prisma.Decimal | null }[] }[], positions: { id: string; defaultRate: Prisma.Decimal | null }[]) {
  const emp = new Map(employees.map((e) => [e.id, e]));
  const pos = new Map(positions.map((p) => [p.id, num(p.defaultRate)]));
  return (employeeId: string | null, positionId: string | null, own?: Prisma.Decimal | null) => {
    if (own != null) return own.toNumber();
    const e = employeeId ? emp.get(employeeId) : undefined;
    const ep = e?.positions.find((p) => p.positionId === positionId);
    return num(ep?.rate) ?? num(e?.hourlyRate) ?? (positionId ? pos.get(positionId) ?? null : null);
  };
}

export interface LaborTotals {
  hours: number;
  cost: number;
  missingRate: number;
  rows: number;
}

/** Labor hours and cost (with employer burden) per business date, from timecards or scheduled shifts. */
export async function laborByDay(from: ISODate, toExclusive: ISODate, source: "timecards" | "shifts", opts: { publishedOnly?: boolean } = {}): Promise<Map<ISODate, LaborTotals>> {
  const range = { gte: zonedMidnightUTC(from, tz()), lt: zonedMidnightUTC(toExclusive, tz()) };
  const [employees, positions, rules] = await Promise.all([
    db.employee.findMany({ select: { id: true, hourlyRate: true, positions: { select: { positionId: true, rate: true } } } }),
    db.position.findMany({ select: { id: true, defaultRate: true } }),
    getLaborRules(),
  ]);
  const rate = rateFinder(employees, positions);
  const blocks =
    source === "timecards"
      ? (await db.timecard.findMany({ where: { clockIn: range, clockOut: { not: null } } })).map((t) => ({ at: t.clockIn, hours: paidHours({ start: t.clockIn, end: t.clockOut!, breakMinutes: t.breakMinutes }), rate: rate(t.employeeId, t.positionId, t.hourlyRate) }))
      : (await db.shift.findMany({ where: { start: range, ...(opts.publishedOnly ? { published: true } : {}) } })).map((s) => ({ at: s.start, hours: paidHours(s), rate: rate(s.employeeId, s.positionId) }));
  const out = new Map<ISODate, LaborTotals>();
  for (const b of blocks) {
    const d = businessDate(b.at, tz());
    const cur = out.get(d) ?? { hours: 0, cost: 0, missingRate: 0, rows: 0 };
    cur.hours += b.hours;
    cur.rows += 1;
    if (b.rate == null) cur.missingRate += 1;
    else cur.cost += b.hours * b.rate * (1 + rules.employerBurdenPct);
    out.set(d, cur);
  }
  return out;
}

const sumDays = <T,>(m: Map<ISODate, T>, dates: ISODate[], pick: (v: T) => number) => dates.reduce((s, d) => s + (m.has(d) ? pick(m.get(d)!) : 0), 0);

// ---- Theoretical food cost ---------------------------------------------------------

/** Theoretical food cost and menu-price sales of costed items sold in [from, to). */
export async function theoreticalFoodCost(from: ISODate, toExclusive: ISODate, snap?: CostingSnapshot) {
  const s = snap ?? (await loadCostingSnapshot());
  const { byRecipe } = await salesByRecipe(from, toExclusive);
  const ctx = buildContext(s, from);
  let cost = 0;
  let sales = 0;
  for (const [recipeId, series] of byRecipe) {
    const recipe = s.recipes.find((r) => r.id === recipeId);
    const price = num(recipe?.menuPrice);
    const res = safeCost(ctx, recipeId);
    if (!recipe || price == null || "error" in res || !res.lines.some((l) => l.cost != null)) continue;
    const q = [...series.values()].reduce((a, b) => a + b, 0);
    cost += q * res.totalCost;
    sales += q * price;
  }
  return { cost, sales };
}

// ---- The grid ------------------------------------------------------------------------

export interface BudgetRow extends WeekTarget {
  /** past = finished week, current = in progress, future = not started */
  when: "past" | "current" | "future";
  /** Actual sales so far (past/current) */
  sales_actual: number | null;
  /** Forecast for the whole week (current/future) */
  sales_forecast: number | null;
  foodCostPct_actual: number | null;
  laborPct_actual: number | null;
  /** future/current weeks: labor % of forecast from scheduled shifts */
  laborPct_scheduled: number | null;
  status: ReturnType<typeof weekStatus>;
}

export async function budgetGrid(weeksBack = 6, weeksAhead = 8): Promise<{ rows: BudgetRow[]; thisWeek: ISODate }> {
  const today = businessToday();
  const thisWeek = weekStartOf(today);
  const weeks = weekStarts(addDays(thisWeek, -7 * weeksBack), weeksBack + weeksAhead + 1);
  const from = weeks[0];
  const to = addDays(weeks[weeks.length - 1], 7);
  const futureDates = dateRange(thisWeek, to);

  const snap = await loadCostingSnapshot();
  const [targets, history, forecast, worked, scheduled, foodCosts] = await Promise.all([
    loadTargets(from, to),
    dailySalesHistory(from, today),
    dailySalesForecast(futureDates),
    laborByDay(from, today, "timecards"),
    laborByDay(thisWeek, to, "shifts"),
    Promise.all(weeks.filter((w) => w <= today).map(async (w) => [w, await theoreticalFoodCost(w, w === thisWeek ? today : addDays(w, 7), snap)] as const)),
  ]);
  const fc = new Map(forecast.map((f) => [f.date, f.qty]));
  const food = new Map(foodCosts);

  const rows = weeks.map((w): BudgetRow => {
    const days = dateRange(w, addDays(w, 7));
    const when = w === thisWeek ? "current" : w < thisWeek ? "past" : "future";
    const pastDays = days.filter((d) => d < today);
    const t = targets.get(w) ?? { weekStart: w, sales: null, foodCostPct: null, laborPct: null };
    const salesActual = when === "future" ? null : sumDays(history.sales, pastDays, (v) => v);
    const salesForecast = when === "past" ? null : (salesActual ?? 0) + days.filter((d) => d >= today).reduce((s, d) => s + (fc.get(d) ?? 0), 0);
    const laborWorked = sumDays(worked, pastDays, (v) => v.cost);
    const hasTimecards = pastDays.some((d) => worked.has(d));
    const fcst = food.get(w);
    const actuals: WeekActuals = {
      sales: salesActual,
      foodCost: fcst && fcst.sales > 0 ? fcst.cost : null,
      foodSales: fcst && fcst.sales > 0 ? fcst.sales : null,
      laborCost: hasTimecards ? laborWorked : null,
    };
    // Share of the week's expected sales already behind us (for pro-rating the sales target).
    const expected = days.reduce((s, d) => s + (d < today ? history.sales.get(d) ?? 0 : fc.get(d) ?? 0), 0);
    const elapsed = when === "past" ? 1 : when === "future" ? 0 : expected > 0 ? (salesActual ?? 0) / expected : pastDays.length / 7;
    const status = weekStatus(t, actuals, elapsed);
    const schedCost = sumDays(scheduled, days, (v) => v.cost);
    const hasShifts = days.some((d) => scheduled.has(d));
    return {
      ...t,
      when,
      sales_actual: salesActual,
      sales_forecast: salesForecast,
      foodCostPct_actual: status.actualFoodCostPct,
      laborPct_actual: status.actualLaborPct,
      laborPct_scheduled: when !== "past" && hasShifts && salesForecast ? schedCost / salesForecast : null,
      status,
    };
  });
  return { rows, thisWeek };
}
