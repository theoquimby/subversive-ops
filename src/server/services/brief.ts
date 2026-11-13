import "server-only";
import { busiestDays, weekStartOf } from "@/domain/budgets";
import { addDays, businessDate, dateRange, daysBetween, ISODate, parseISODate, weekday } from "@/domain/dates";
import { db } from "../db";
import { env } from "../env";
import { laborByDay, loadTargets } from "./budgets";
import { loadCostingSnapshot } from "./costing";
import { dailySalesForecast } from "./forecasting";
import { menuCosts, recentPriceMoves } from "./insights";
import { buildOrderPlan } from "./planning";
import { unrepliedNegative } from "./reviews";
import { businessToday } from "./sales";
import { countPoints, varianceReport } from "./variance";

/** The week the brief is about: this week on a Monday, otherwise next week. */
export function briefWeek(today: ISODate): ISODate {
  return weekday(today) === 1 ? today : addDays(weekStartOf(today), 7);
}

export interface OrderDraft {
  supplierId: string;
  supplier: string;
  deliveryDate: ISODate;
  coverUntil: ISODate;
  items: number;
  total: number;
  minOrder: number | null;
  lines: { supplierProductId: string; suggestedQty: number; qty: number; unitPrice: number | null }[];
  existingDraftId: string | null;
  needsCount: number;
}

async function orderDrafts(today: ISODate, weekEnd: ISODate): Promise<OrderDraft[]> {
  const suppliers = await db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const open = await db.purchaseOrder.findMany({ where: { status: "DRAFT", deliveryDate: { gte: parseISODate(today) } }, select: { id: true, supplierId: true } });
  const out: OrderDraft[] = [];
  for (const s of suppliers) {
    try {
      const plan = await buildOrderPlan(s.id);
      if (plan.deliveryDate >= weekEnd) continue;
      const ordering = plan.lines.filter((l) => l.suggestedUnits > 0);
      out.push({
        supplierId: s.id,
        supplier: s.name,
        deliveryDate: plan.deliveryDate,
        coverUntil: plan.coverUntil,
        items: ordering.length,
        total: plan.total,
        minOrder: plan.supplier.minOrder,
        lines: ordering.map((l) => ({ supplierProductId: l.supplierProductId, suggestedQty: l.suggestedUnits, qty: l.suggestedUnits, unitPrice: l.unitPrice })),
        existingDraftId: open.find((o) => o.supplierId === s.id)?.id ?? null,
        needsCount: plan.lines.filter((l) => l.status === "needs-count").length,
      });
    } catch (e) {
      console.error("brief: order plan failed", s.name, e);
    }
  }
  return out.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || b.total - a.total);
}

export async function weeklyBrief() {
  const today = businessToday();
  const week = briefWeek(today);
  const weekEnd = addDays(week, 7);
  const dates = dateRange(week, weekEnd);
  const snap = await loadCostingSnapshot();

  const [forecast, targets, orders, shifts, scheduled, moves, costs, counts, timeOff, swaps, reviews] = await Promise.all([
    dailySalesForecast(dates),
    loadTargets(week, weekEnd),
    orderDrafts(today, weekEnd),
    db.shift.findMany({ where: { start: { gte: parseISODate(addDays(week, -1)), lt: parseISODate(addDays(weekEnd, 1)) } }, select: { start: true, published: true, employeeId: true } }),
    laborByDay(week, weekEnd, "shifts"),
    recentPriceMoves(7, snap),
    menuCosts(snap),
    countPoints(),
    db.timeOffRequest.count({ where: { status: "PENDING", endDate: { gte: parseISODate(today) } } }),
    db.shiftSwap.count({ where: { status: "PENDING", shift: { start: { gte: new Date() } } } }),
    unrepliedNegative(),
  ]);

  // Forecast
  const total = forecast.reduce((s, d) => s + d.qty, 0);
  const busiest = busiestDays(forecast, 2);
  const target = targets.get(week) ?? null;
  const events = forecast.flatMap((d) => d.drivers.events.map((e) => ({ date: d.date, title: e.title })));

  // Schedule: shifts starting in the business week (the query has a day of margin each side).
  const weekShifts = shifts.filter((s) => {
    const d = businessDate(s.start, env.BUSINESS_TIMEZONE);
    return d >= week && d < weekEnd;
  });
  const labor = [...scheduled.values()].reduce((a, v) => ({ hours: a.hours + v.hours, cost: a.cost + v.cost, missing: a.missing + v.missingRate }), { hours: 0, cost: 0, missing: 0 });
  const schedule = {
    published: weekShifts.filter((s) => s.published).length,
    drafts: weekShifts.filter((s) => !s.published).length,
    open: weekShifts.filter((s) => !s.employeeId).length,
    hours: labor.hours,
    cost: labor.cost,
    missingRates: labor.missing,
    laborPct: total > 0 && labor.cost > 0 ? labor.cost / total : null,
  };

  // Costs
  const sold = costs.rows.filter((r) => r.kind !== "PREP");
  const overTarget = sold.filter((r) => r.foodCostPct != null && r.foodCostPct > r.target).sort((a, b) => b.foodCostPct! - b.target - (a.foodCostPct! - a.target));
  const increases = moves.filter((m) => m.changePct > 0);

  // Margin gap from the latest two counts
  let gap: { from: ISODate; to: ISODate; unexplainedCost: number; foodSales: number; top: { name: string; cost: number }[] } | null = null;
  if (counts.length >= 2) {
    try {
      const v = await varianceReport(counts[1].id, counts[0].id);
      gap = {
        from: v.from,
        to: v.to,
        unexplainedCost: v.unexplainedCost,
        foodSales: v.foodSales,
        top: v.rows.filter((r) => (r.unexplainedCost ?? 0) > 0).slice(0, 3).map((r) => ({ name: r.name, cost: r.unexplainedCost! })),
      };
    } catch (e) {
      console.error("brief: variance failed", e);
    }
  }
  const lastCount = counts[0]?.date ?? null;
  const daysSinceCount = lastCount ? daysBetween(lastCount, today) : null;

  return {
    today,
    week,
    weekEnd,
    forecast: { days: forecast.map((d) => ({ date: d.date, qty: d.qty, events: d.drivers.events.map((e) => e.title), closed: d.drivers.eventFactor === 0 })), total, busiest, events },
    budget: target,
    orders,
    schedule,
    increases,
    overTarget,
    gap,
    counts: { last: lastCount, daysSince: daysSinceCount, overdue: daysSinceCount == null || daysSinceCount > 7 },
    requests: { timeOff, swaps },
    reviews: { unreplied: reviews },
  };
}

export type WeeklyBrief = Awaited<ReturnType<typeof weeklyBrief>>;
