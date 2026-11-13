import "server-only";
import { explodeUsage } from "@/domain/costing";
import { addDays, dateRange, ISODate, nextWeekdayOnOrAfter, parseISODate, toISODate } from "@/domain/dates";
import { DayForecast, forecastSeries } from "@/domain/forecast";
import { estimateOnHand, OrderSuggestion, suggestLine } from "@/domain/ordering";
import { db, num } from "../db";
import { buildContext, loadCostingSnapshot, priceAsOf } from "./costing";
import { businessToday, salesByRecipe } from "./sales";

const HISTORY_DAYS = 70;

// ---- Forecast adjustments (events, closures) ---------------------------------

const ADJ_KEY = "forecast.adjustments";

export async function getAdjustments(): Promise<Map<ISODate, number>> {
  const s = await db.setting.findUnique({ where: { key: ADJ_KEY } });
  return new Map(Object.entries(s ? (JSON.parse(s.value) as Record<string, number>) : {}));
}

export async function setAdjustment(date: ISODate, multiplier: number | null) {
  const adj = await getAdjustments();
  if (multiplier == null || multiplier === 1) adj.delete(date);
  else adj.set(date, multiplier);
  const value = JSON.stringify(Object.fromEntries(adj));
  await db.setting.upsert({ where: { key: ADJ_KEY }, create: { key: ADJ_KEY, value }, update: { value } });
}

// ---- Forecast ---------------------------------------------------------------

export interface ItemForecast {
  recipeId: string;
  name: string;
  days: DayForecast[];
  total: number;
}

export async function forecastItems(dates: ISODate[]) {
  const today = businessToday();
  const [{ byRecipe, openDays }, adjustments, recipes] = await Promise.all([
    salesByRecipe(addDays(today, -HISTORY_DAYS), today),
    getAdjustments(),
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true } }),
  ]);
  const items: ItemForecast[] = recipes
    .map((r) => {
      const days = forecastSeries({ history: byRecipe.get(r.id) ?? new Map(), openDays, asOf: today, dates, adjustments });
      return { recipeId: r.id, name: r.name, days, total: days.reduce((s, d) => s + d.qty, 0) };
    })
    .filter((i) => i.total > 0)
    .sort((a, b) => b.total - a.total);
  return { items, adjustments, hasHistory: openDays.size > 0, historyDays: openDays.size };
}

// ---- Order plan ---------------------------------------------------------------

export interface OrderPlan {
  supplier: { id: string; name: string; email: string | null; minOrder: number | null };
  today: ISODate;
  deliveryDate: ISODate;
  coverUntil: ISODate; // exclusive
  lines: OrderSuggestion[];
  total: number;
  problems: string[];
  onHandNotes: Map<string, string>;
}

/** Delivery date and cover window for a supplier, from its delivery days and lead time. */
export function deliveryWindow(s: { deliveryDays: number[]; leadTimeDays: number }, today: ISODate) {
  const earliest = addDays(today, Math.max(0, s.leadTimeDays));
  const deliveryDate = nextWeekdayOnOrAfter(earliest, s.deliveryDays) ?? earliest;
  const coverUntil = nextWeekdayOnOrAfter(addDays(deliveryDate, 1), s.deliveryDays) ?? addDays(deliveryDate, 7);
  return { deliveryDate, coverUntil };
}

export async function buildOrderPlan(supplierId: string, override?: { deliveryDate?: ISODate; coverUntil?: ISODate }): Promise<OrderPlan> {
  const today = businessToday();
  const supplier = await db.supplier.findUniqueOrThrow({
    where: { id: supplierId },
    include: { products: { where: { active: true, ingredientId: { not: null } }, include: { ingredient: true } } },
  });
  const win = deliveryWindow(supplier, today);
  const deliveryDate = override?.deliveryDate ?? win.deliveryDate;
  const coverUntil = override?.coverUntil ?? win.coverUntil;

  // Only one product per ingredient is ordered from a supplier: the preferred one, else the first.
  const byIngredient = new Map<string, (typeof supplier.products)[number]>();
  for (const p of supplier.products) {
    const ing = p.ingredient!;
    const cur = byIngredient.get(ing.id);
    if (!cur || ing.preferredProductId === p.id) byIngredient.set(ing.id, p);
  }
  const ingredientIds = [...byIngredient.keys()];

  const snap = await loadCostingSnapshot();
  const ctx = buildContext(snap, today);
  const problems: string[] = [];

  // Usage per serving of every recipe, exploded to raw ingredients.
  const perServing = new Map<string, Map<string, number>>();
  for (const r of ctx.recipes.values()) {
    const { usage, problems: p } = explodeUsage(ctx, r.id, 1);
    perServing.set(r.id, usage);
    problems.push(...p);
  }

  // Earliest count among these ingredients bounds how much actual history we need.
  const lastCounts = await latestCounts(ingredientIds);
  const earliestCount = [...lastCounts.values()].map((c) => c.date).sort()[0] ?? today;

  const forecastDates = dateRange(today, coverUntil);
  const [{ items }, { byRecipe }] = await Promise.all([forecastItems(forecastDates), salesByRecipe(earliestCount, today)]);

  const usageBetween = (ingredientId: string, from: ISODate, to: ISODate) => {
    let total = 0;
    for (const it of items) {
      const per = perServing.get(it.recipeId)?.get(ingredientId);
      if (!per) continue;
      for (const d of it.days) if (d.date >= from && d.date < to) total += d.qty * per;
    }
    return total;
  };
  const actualUsageSince = (ingredientId: string, from: ISODate) => {
    let total = 0;
    for (const [recipeId, series] of byRecipe) {
      const per = perServing.get(recipeId)?.get(ingredientId);
      if (!per) continue;
      for (const [date, qty] of series) if (date >= from && date < today) total += qty * per;
    }
    return total;
  };

  const [received, waste, incoming] = await Promise.all([
    receivedSince(ingredientIds, lastCounts),
    wasteSince(ingredientIds, lastCounts),
    incomingBy(ingredientIds, deliveryDate),
  ]);

  const onHandNotes = new Map<string, string>();
  const lines: OrderSuggestion[] = [];
  for (const [ingredientId, product] of byIngredient) {
    const ing = product.ingredient!;
    const count = lastCounts.get(ingredientId);
    const onHand = estimateOnHand({
      lastCountQty: count?.qty ?? null,
      receivedSinceCount: received.get(ingredientId) ?? 0,
      usageSinceCount: count ? actualUsageSince(ingredientId, count.date) : 0,
      wasteSinceCount: waste.get(ingredientId) ?? 0,
    });
    onHandNotes.set(ingredientId, count ? `counted ${count.date}` : "not counted yet");
    lines.push(
      suggestLine(
        {
          supplierProductId: product.id,
          ingredientId,
          ingredientName: ing.name,
          description: product.description,
          purchaseUnit: product.purchaseUnit,
          packQtyBase: num(product.packQtyBase),
          unitPrice: priceAsOf(snap.priceHistory.get(product.id), today),
          safetyPct: ing.safetyPct.toNumber(),
        },
        {
          onHandNow: onHand.qty,
          onHandKnown: count != null,
          usageUntilDelivery: usageBetween(ingredientId, today, deliveryDate),
          usageDuringCover: usageBetween(ingredientId, deliveryDate, coverUntil),
          incomingBeforeDelivery: incoming.get(ingredientId) ?? 0,
        },
      ),
    );
  }
  lines.sort((a, b) => (b.suggestedUnits > 0 ? 1 : 0) - (a.suggestedUnits > 0 ? 1 : 0) || a.ingredientName.localeCompare(b.ingredientName));

  return {
    supplier: { id: supplier.id, name: supplier.name, email: supplier.email, minOrder: num(supplier.minOrder) },
    today,
    deliveryDate,
    coverUntil,
    lines,
    total: lines.reduce((s, l) => s + (l.lineCost ?? 0), 0),
    problems: [...new Set(problems)],
    onHandNotes,
  };
}

async function latestCounts(ingredientIds: string[]) {
  const lines = await db.stockCountLine.findMany({
    where: { ingredientId: { in: ingredientIds }, count: { completed: true } },
    include: { count: { select: { takenAt: true } } },
    orderBy: { count: { takenAt: "desc" } },
  });
  const out = new Map<string, { qty: number; date: ISODate; at: Date }>();
  for (const l of lines) {
    if (out.has(l.ingredientId)) continue;
    out.set(l.ingredientId, { qty: l.qtyBase.toNumber(), date: toISODate(l.count.takenAt), at: l.count.takenAt });
  }
  return out;
}

async function receivedSince(ingredientIds: string[], counts: Map<string, { at: Date }>) {
  const rows = await db.purchaseOrderLine.findMany({
    where: { order: { status: "RECEIVED" }, product: { ingredientId: { in: ingredientIds } } },
    include: { order: { select: { receivedAt: true } }, product: { select: { ingredientId: true, packQtyBase: true } } },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = r.product.ingredientId!;
    const since = counts.get(id)?.at;
    if (!since || !r.order.receivedAt || r.order.receivedAt <= since) continue;
    out.set(id, (out.get(id) ?? 0) + (num(r.receivedQty) ?? r.qty.toNumber()) * (num(r.product.packQtyBase) ?? 0));
  }
  return out;
}

async function wasteSince(ingredientIds: string[], counts: Map<string, { at: Date }>) {
  const rows = await db.wasteLog.findMany({ where: { ingredientId: { in: ingredientIds } } });
  const out = new Map<string, number>();
  for (const r of rows) {
    const since = counts.get(r.ingredientId)?.at;
    if (!since || r.loggedAt <= since) continue;
    out.set(r.ingredientId, (out.get(r.ingredientId) ?? 0) + r.qtyBase.toNumber());
  }
  return out;
}

async function incomingBy(ingredientIds: string[], deliveryDate: ISODate) {
  const rows = await db.purchaseOrderLine.findMany({
    where: { order: { status: "SENT", deliveryDate: { lte: parseISODate(deliveryDate) } }, product: { ingredientId: { in: ingredientIds } } },
    include: { product: { select: { ingredientId: true, packQtyBase: true } } },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = r.product.ingredientId!;
    out.set(id, (out.get(id) ?? 0) + r.qty.toNumber() * (num(r.product.packQtyBase) ?? 0));
  }
  return out;
}
