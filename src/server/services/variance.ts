import "server-only";
import { explodeUsage } from "@/domain/costing";
import { ISODate, toISODate } from "@/domain/dates";
import { groupOf, RevenueGroup, classifyCategory } from "@/domain/revenueClass";
import type { BaseUnit } from "@/domain/units";
import { computeVariance, Consumer, dominantClass, explainVariance, VarianceExplanation, VarianceInput, VarianceRow, VarianceSummary } from "@/domain/variance";
import { db, num } from "../db";
import { buildContext, loadCostingSnapshot } from "./costing";
import { classSettings, recipeClasses } from "./insights";
import { salesByRecipe } from "./sales";

/** Completed counts, newest first — each one is a possible period boundary. */
export async function countPoints() {
  const counts = await db.stockCount.findMany({
    where: { completed: true },
    orderBy: { takenAt: "desc" },
    take: 60,
    select: { id: true, takenAt: true, area: true, _count: { select: { lines: true } } },
  });
  return counts.map((c) => ({ id: c.id, at: c.takenAt, date: toISODate(c.takenAt), area: c.area ?? "All", lines: c._count.lines }));
}

export interface VarianceGroupTotals {
  /** Net sales of linked items in this group. */
  sales: number;
  theoreticalCost: number;
  actualCost: number;
  wasteCost: number;
  unexplainedCost: number;
  /** cost ÷ sales; null with no sales. */
  theoreticalPct: number | null;
  actualPct: number | null;
}

export type VarianceLine = VarianceRow & VarianceInput & {
  group: RevenueGroup;
  baseUnit: BaseUnit;
  consumers: Consumer[];
  explanation: VarianceExplanation | null;
};

export interface VarianceReport extends Omit<VarianceSummary, "rows"> {
  rows: VarianceLine[];
  from: ISODate;
  to: ISODate;
  /** Net sales of every item linked to a recipe (food and drink). */
  foodSales: number;
  days: number;
  groups: { food: VarianceGroupTotals; beverage: VarianceGroupTotals };
}

/**
 * Usage between two counts. Counts are assumed to happen before service, so
 * sales on the start date count toward the period and sales on the end date don't.
 * Every ingredient is put in the food or beverage group by which sales used
 * most of it (a keg goes with beer, ground beef with food).
 */
export async function varianceReport(startCountId: string, endCountId: string): Promise<VarianceReport> {
  const [start, end] = await Promise.all([
    db.stockCount.findUniqueOrThrow({ where: { id: startCountId } }),
    db.stockCount.findUniqueOrThrow({ where: { id: endCountId } }),
  ]);
  const [a, b] = start.takenAt <= end.takenAt ? [start, end] : [end, start];
  const from = toISODate(a.takenAt);
  const to = toISODate(b.takenAt);

  const [snap, lines, received, waste, sales, saleRows, mappings, settings] = await Promise.all([
    loadCostingSnapshot(),
    db.stockCountLine.findMany({ where: { count: { completed: true, takenAt: { lte: b.takenAt } } }, include: { count: { select: { takenAt: true } } }, orderBy: { count: { takenAt: "asc" } } }),
    db.purchaseOrderLine.findMany({
      where: { order: { status: "RECEIVED", receivedAt: { gt: a.takenAt, lte: b.takenAt } } },
      include: { product: { select: { ingredientId: true, packQtyBase: true } } },
    }),
    db.wasteLog.findMany({ where: { loggedAt: { gt: a.takenAt, lte: b.takenAt } } }),
    salesByRecipe(from, to),
    db.dailySale.findMany({ where: { date: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) } }, select: { squareId: true, netSales: true } }),
    db.squareMapping.findMany({ where: { recipeId: { not: null }, ignored: false }, select: { squareId: true, recipeId: true } }),
    classSettings(),
  ]);

  const ctx = buildContext(snap, to);
  const classOf = recipeClasses(snap, settings);

  // Opening = last count at/before the start; closing = last count inside (start, end].
  const opening = new Map<string, number>();
  const closing = new Map<string, number>();
  for (const l of lines) {
    if (l.count.takenAt <= a.takenAt) opening.set(l.ingredientId, l.qtyBase.toNumber());
    else closing.set(l.ingredientId, l.qtyBase.toNumber());
  }
  const sumBy = <T,>(rows: T[], id: (r: T) => string | null | undefined, qty: (r: T) => number) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = id(r);
      if (k) m.set(k, (m.get(k) ?? 0) + qty(r));
    }
    return m;
  };
  const receivedBy = sumBy(received, (r) => r.product.ingredientId, (r) => (num(r.receivedQty) ?? r.qty.toNumber()) * (num(r.product.packQtyBase) ?? 0));
  const wasteBy = sumBy(waste, (r) => r.ingredientId, (r) => r.qtyBase.toNumber());

  // Theoretical usage, which items drove it, and which revenue class used each ingredient.
  const theoretical = new Map<string, number>();
  const consumers = new Map<string, Consumer[]>();
  const usageByGroup = new Map<string, Map<RevenueGroup, number>>();
  for (const [recipeId, series] of sales.byRecipe) {
    const servings = [...series.values()].reduce((s, q) => s + q, 0);
    if (!servings) continue;
    const { usage } = explodeUsage(ctx, recipeId, 1);
    const group = groupOf(classOf.get(recipeId) ?? "food");
    const name = ctx.recipes.get(recipeId)?.name ?? "Item";
    for (const [ingId, perServing] of usage) {
      theoretical.set(ingId, (theoretical.get(ingId) ?? 0) + perServing * servings);
      consumers.set(ingId, [...(consumers.get(ingId) ?? []), { recipeId, name, perServing, sold: servings }]);
      const g = usageByGroup.get(ingId) ?? new Map<RevenueGroup, number>();
      g.set(group, (g.get(group) ?? 0) + perServing * servings);
      usageByGroup.set(ingId, g);
    }
  }

  const recipeFor = new Map(mappings.map((m) => [m.squareId, m.recipeId!]));
  const salesByGroup = { food: 0, beverage: 0, other: 0 } as Record<RevenueGroup, number>;
  for (const r of saleRows) {
    const recipeId = recipeFor.get(r.squareId);
    if (!recipeId) continue;
    salesByGroup[groupOf(classOf.get(recipeId) ?? "food")] += r.netSales.toNumber();
  }

  const summary = computeVariance(
    snap.ingredients
      .filter((i) => opening.has(i.id) || closing.has(i.id) || theoretical.has(i.id))
      .map((i) => {
        const fallback = groupOf(classifyCategory(i.category, settings.map));
        const group = dominantClass(usageByGroup.get(i.id) ?? new Map<RevenueGroup, number>(), fallback);
        return {
          ingredientId: i.id,
          name: i.name,
          category: i.category,
          opening: opening.get(i.id) ?? null,
          closing: closing.get(i.id) ?? null,
          received: receivedBy.get(i.id) ?? 0,
          theoretical: theoretical.get(i.id) ?? 0,
          waste: wasteBy.get(i.id) ?? 0,
          unitCost: ctx.ingredients.get(i.id)?.costPerBase ?? null,
          group: group === "other" ? ("food" as const) : group,
          baseUnit: i.baseUnit as BaseUnit,
          consumers: consumers.get(i.id) ?? [],
        };
      }),
  );
  const rows: VarianceLine[] = summary.rows.map((r) => ({ ...r, explanation: explainVariance(r, r.consumers) }));

  const totals = (group: "food" | "beverage"): VarianceGroupTotals => {
    const s = computeVariance(rows.filter((r) => r.group === group));
    const sales = salesByGroup[group];
    return {
      sales,
      theoreticalCost: s.theoreticalCost,
      actualCost: s.actualCost,
      wasteCost: s.wasteCost,
      unexplainedCost: s.unexplainedCost,
      theoreticalPct: sales > 0 ? s.theoreticalCost / sales : null,
      actualPct: sales > 0 ? s.actualCost / sales : null,
    };
  };

  return {
    ...summary,
    rows,
    from,
    to,
    foodSales: salesByGroup.food + salesByGroup.beverage + salesByGroup.other,
    days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000),
    groups: { food: totals("food"), beverage: totals("beverage") },
  };
}

/** The latest two counts on different days, or null if there aren't two yet. */
export async function lastCountPeriod() {
  const points = await countPoints();
  const end = points[0];
  const start = end && points.find((p) => p.at < end.at && p.date !== end.date);
  return end && start ? { start, end } : null;
}

/** Waste logging leaderboard — keeps logging a habit (who's logging, not who's wasting). */
export async function wasteLeaderboard(since: Date) {
  // A prep or menu item exploded into several ingredient rows counts as one log.
  const rows = await db.wasteLog.findMany({ where: { loggedAt: { gte: since }, loggedBy: { not: null } }, select: { id: true, loggedBy: true, batchId: true } });
  const by = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = by.get(r.loggedBy!) ?? new Set<string>();
    s.add(r.batchId ?? r.id);
    by.set(r.loggedBy!, s);
  }
  return [...by].map(([name, s]) => ({ name, logs: s.size })).sort((a, b) => b.logs - a.logs || a.name.localeCompare(b.name));
}
