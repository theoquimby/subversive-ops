import "server-only";
import { explodeUsage } from "@/domain/costing";
import { ISODate, toISODate } from "@/domain/dates";
import { computeVariance, VarianceSummary } from "@/domain/variance";
import { db, num } from "../db";
import { buildContext, loadCostingSnapshot } from "./costing";
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

export interface VarianceReport extends VarianceSummary {
  from: ISODate;
  to: ISODate;
  foodSales: number;
  days: number;
}

/**
 * Usage between two counts. Counts are assumed to happen before service, so
 * sales on the start date count toward the period and sales on the end date don't.
 */
export async function varianceReport(startCountId: string, endCountId: string): Promise<VarianceReport> {
  const [start, end] = await Promise.all([
    db.stockCount.findUniqueOrThrow({ where: { id: startCountId } }),
    db.stockCount.findUniqueOrThrow({ where: { id: endCountId } }),
  ]);
  const [a, b] = start.takenAt <= end.takenAt ? [start, end] : [end, start];
  const from = toISODate(a.takenAt);
  const to = toISODate(b.takenAt);

  const [snap, lines, received, waste, sales, saleRows, mappings] = await Promise.all([
    loadCostingSnapshot(),
    db.stockCountLine.findMany({ where: { count: { completed: true, takenAt: { lte: b.takenAt } } }, include: { count: { select: { takenAt: true } } }, orderBy: { count: { takenAt: "asc" } } }),
    db.purchaseOrderLine.findMany({
      where: { order: { status: "RECEIVED", receivedAt: { gt: a.takenAt, lte: b.takenAt } } },
      include: { product: { select: { ingredientId: true, packQtyBase: true } } },
    }),
    db.wasteLog.findMany({ where: { loggedAt: { gt: a.takenAt, lte: b.takenAt } } }),
    salesByRecipe(from, to),
    db.dailySale.findMany({ where: { date: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) } }, select: { squareId: true, netSales: true } }),
    db.squareMapping.findMany({ where: { recipeId: { not: null } }, select: { squareId: true } }),
  ]);

  const ctx = buildContext(snap, to);

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

  const theoretical = new Map<string, number>();
  for (const [recipeId, series] of sales.byRecipe) {
    const servings = [...series.values()].reduce((s, q) => s + q, 0);
    if (servings) explodeUsage(ctx, recipeId, servings, theoretical);
  }

  const mapped = new Set(mappings.map((m) => m.squareId));
  const foodSales = saleRows.filter((r) => mapped.has(r.squareId)).reduce((s, r) => s + r.netSales.toNumber(), 0);

  const summary = computeVariance(
    snap.ingredients
      .filter((i) => opening.has(i.id) || closing.has(i.id) || theoretical.has(i.id))
      .map((i) => ({
        ingredientId: i.id,
        name: i.name,
        category: i.category,
        opening: opening.get(i.id) ?? null,
        closing: closing.get(i.id) ?? null,
        received: receivedBy.get(i.id) ?? 0,
        theoretical: theoretical.get(i.id) ?? 0,
        waste: wasteBy.get(i.id) ?? 0,
        unitCost: ctx.ingredients.get(i.id)?.costPerBase ?? null,
      })),
  );
  return { ...summary, from, to, foodSales, days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) };
}

/** Waste logging leaderboard — keeps logging a habit (who's logging, not who's wasting). */
export async function wasteLeaderboard(since: Date) {
  const rows = await db.wasteLog.groupBy({ by: ["loggedBy"], where: { loggedAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { loggedBy: "desc" } } });
  return rows.filter((r) => r.loggedBy).map((r) => ({ name: r.loggedBy!, logs: r._count._all }));
}
