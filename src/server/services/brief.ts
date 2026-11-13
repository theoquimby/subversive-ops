import "server-only";
import { busiestDays, weekStartOf } from "@/domain/budgets";
import { addDays, businessDate, dateRange, daysBetween, ISODate, parseISODate, weekday } from "@/domain/dates";
import { INVOICE_ISSUE_STATUSES } from "@/domain/alerts";
import { decisions, weekRecap, worstRag } from "@/domain/weekRecap";
import { db } from "../db";
import { env } from "../env";
import { laborByDay, loadTargets } from "./budgets";
import { loadCostingSnapshot } from "./costing";
import { dailySalesForecast } from "./forecasting";
import { costTargets, menuCosts, recentPriceMoves } from "./insights";
import { periodKpis } from "./kpis";
import { buildOrderPlan } from "./planning";
import { ReviewAlert, reviewAlerts, unrepliedNegative } from "./reviews";
import { businessToday } from "./sales";
import { getAutoDraft } from "./scheduling";
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
  /** The existing draft was saved by the auto-draft job. */
  autoDrafted: boolean;
  needsCount: number;
  /** Items that run out before this delivery arrives. */
  runsOut: string[];
}

async function orderDrafts(today: ISODate, weekEnd: ISODate): Promise<OrderDraft[]> {
  const suppliers = await db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const open = await db.purchaseOrder.findMany({ where: { status: "DRAFT", deliveryDate: { gte: parseISODate(today) } }, select: { id: true, supplierId: true, notes: true } });
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
        autoDrafted: Boolean(open.find((o) => o.supplierId === s.id)?.notes?.startsWith("Auto-drafted")),
        needsCount: plan.lines.filter((l) => l.status === "needs-count").length,
        runsOut: plan.lines.filter((l) => l.status === "runs-out").map((l) => l.ingredientName),
      });
    } catch (e) {
      console.error("brief: order plan failed", s.name, e);
    }
  }
  return out.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || b.total - a.total);
}

/** Square items that sold in [from, to) but aren't linked to a recipe (and aren't ignored), best sellers first. */
async function unmappedSelling(from: ISODate, toExclusive: ISODate) {
  const unmapped = await db.squareMapping.findMany({ where: { recipeId: null, ignored: false }, select: { squareId: true, squareName: true } });
  if (unmapped.length === 0) return { count: 0, sales: 0, top: [] as { name: string; sales: number; qty: number }[] };
  const sold = await db.dailySale.groupBy({
    by: ["squareId"],
    where: { squareId: { in: unmapped.map((m) => m.squareId) }, date: { gte: parseISODate(from), lt: parseISODate(toExclusive) } },
    _sum: { netSales: true, qty: true },
  });
  const names = new Map(unmapped.map((m) => [m.squareId, m.squareName]));
  const rows = sold
    .map((r) => ({ name: names.get(r.squareId) ?? "Item", sales: r._sum.netSales?.toNumber() ?? 0, qty: r._sum.qty?.toNumber() ?? 0 }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.sales - a.sales);
  return { count: rows.length, sales: rows.reduce((s, r) => s + r.sales, 0), top: rows.slice(0, 5) };
}

/**
 * The last finished week against its budget. On Sunday (when the brief goes out) that's
 * the current week with today still running (left out, sales pro-rated); otherwise the
 * Monday–Sunday before this one.
 */
async function lastWeekRecap(today: ISODate, snap: Awaited<ReturnType<typeof loadCostingSnapshot>>) {
  const from = weekday(today) === 0 ? weekStartOf(today) : addDays(weekStartOf(today), -7);
  const week = addDays(from, 7);
  const [k, budgets, targets] = await Promise.all([periodKpis(from, week, { snap }), loadTargets(from, week), costTargets()]);
  const budget = budgets.get(from) ?? null;
  const elapsed = k.counted.length / 7;
  const rows = weekRecap({ sales: k.total.sales, foodPct: k.foodPct, beveragePct: k.beveragePct, laborPct: k.laborPct, primePct: k.primePct, budget, targets, elapsed });
  return { from, to: addDays(week, -1), days: k.counted.length, todayExcluded: k.todayExcluded, hasBudget: budget != null, rows, overall: worstRag(rows) };
}

export async function weeklyBrief() {
  const today = businessToday();
  const week = briefWeek(today);
  const weekEnd = addDays(week, 7);
  const dates = dateRange(week, weekEnd);
  const snap = await loadCostingSnapshot();

  const [forecast, targets, orders, shifts, scheduled, moves, costs, counts, timeOff, swaps, reviews, alerts, lastWaste, lastWeek, badReviews, invoiceIssues, unmapped, autoDraft] = await Promise.all([
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
    reviewAlerts().catch((e): ReviewAlert[] => {
      console.error("brief: review alerts failed", e);
      return [];
    }),
    db.wasteLog.findFirst({ orderBy: { loggedAt: "desc" }, select: { loggedAt: true } }),
    lastWeekRecap(today, snap).catch((e) => {
      console.error("brief: last week recap failed", e);
      return null;
    }),
    db.review.count({ where: { replied: false, rating: { lte: 2 }, postedAt: { gte: parseISODate(addDays(today, -60)) } } }),
    db.invoice.count({ where: { status: { in: [...INVOICE_ISSUE_STATUSES] } } }),
    unmappedSelling(addDays(today, -7), addDays(today, 1)),
    getAutoDraft(),
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
  const lastWasteDate = lastWaste ? businessDate(lastWaste.loggedAt, env.BUSINESS_TIMEZONE) : null;
  const daysSinceWaste = lastWasteDate ? daysBetween(lastWasteDate, today) : null;

  const decide = decisions({
    timeOff,
    swaps,
    badReviews,
    autoOrders: orders.filter((o) => o.existingDraftId && o.autoDrafted).length,
    draftShifts: schedule.drafts,
    scheduleAutoDrafted: autoDraft,
    invoiceIssues,
  });

  return {
    today,
    week,
    weekEnd,
    lastWeek,
    decisions: decide,
    unmapped,
    forecast: { days: forecast.map((d) => ({ date: d.date, qty: d.qty, events: d.drivers.events.map((e) => e.title), closed: d.drivers.eventFactor === 0 })), total, busiest, events },
    budget: target,
    orders,
    schedule,
    increases,
    overTarget,
    gap,
    counts: { last: lastCount, daysSince: daysSinceCount, overdue: daysSinceCount == null || daysSinceCount > 7 },
    requests: { timeOff, swaps },
    reviews: { unreplied: reviews, alerts },
    waste: { last: lastWasteDate, daysSince: daysSinceWaste, quiet: daysSinceWaste == null || daysSinceWaste > 7 },
  };
}

export type WeeklyBrief = Awaited<ReturnType<typeof weeklyBrief>>;
