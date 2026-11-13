import "server-only";
import { addDays, ISODate } from "@/domain/dates";
import { db } from "../db";
import { buildContext, CostingSnapshot, loadCostingSnapshot, priceAsOf, safeCost } from "./costing";
import { businessToday } from "./sales";

export const DEFAULT_TARGET_FOOD_COST = 0.3;

export async function targetFoodCost(): Promise<number> {
  const s = await db.setting.findUnique({ where: { key: "costing.targetFoodCostPct" } });
  return s ? Number(s.value) : DEFAULT_TARGET_FOOD_COST;
}

export interface MenuCostRow {
  id: string;
  name: string;
  kind: string;
  category: string;
  menuPrice: number | null;
  cost: number | null;
  costBefore: number | null; // 30 days ago
  foodCostPct: number | null;
  target: number;
  incomplete: boolean;
  error?: string;
}

/** Every recipe's cost now vs 30 days ago, and food cost % against target. */
export async function menuCosts(snap?: CostingSnapshot): Promise<{ rows: MenuCostRow[]; today: ISODate }> {
  const s = snap ?? (await loadCostingSnapshot());
  const today = businessToday();
  const [ctxNow, ctxThen, globalTarget] = [buildContext(s, today), buildContext(s, addDays(today, -30)), await targetFoodCost()];
  const rows = s.recipes.map((r) => {
    const now = safeCost(ctxNow, r.id);
    const then = safeCost(ctxThen, r.id);
    const target = r.targetFoodCostPct?.toNumber() ?? globalTarget;
    if ("error" in now) {
      return { id: r.id, name: r.name, kind: r.kind, category: r.category, menuPrice: r.menuPrice?.toNumber() ?? null, cost: null, costBefore: null, foodCostPct: null, target, incomplete: true, error: now.error };
    }
    const anyPrice = now.lines.some((l) => l.cost != null);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      category: r.category,
      menuPrice: r.menuPrice?.toNumber() ?? null,
      cost: anyPrice ? now.totalCost : null,
      costBefore: "error" in then || then.lines.every((l) => l.cost == null) ? null : then.totalCost,
      foodCostPct: anyPrice ? now.foodCostPct : null,
      target,
      incomplete: now.incomplete,
    };
  });
  return { rows, today };
}

export interface PriceMove {
  productId: string;
  description: string;
  supplier: string;
  ingredient: string | null;
  oldPrice: number;
  newPrice: number;
  changePct: number;
  date: ISODate;
}

/** Price changes that took effect in the last `days` days, biggest first. */
export async function recentPriceMoves(days = 30, snap?: CostingSnapshot): Promise<PriceMove[]> {
  const s = snap ?? (await loadCostingSnapshot());
  const today = businessToday();
  const since = addDays(today, -days);
  const products = await db.supplierProduct.findMany({
    where: { active: true },
    select: { id: true, description: true, supplier: { select: { name: true } }, ingredient: { select: { name: true } } },
  });
  const moves: PriceMove[] = [];
  for (const p of products) {
    const hist = s.priceHistory.get(p.id);
    if (!hist || hist.length < 2) continue;
    const before = priceAsOf(hist, addDays(since, -1));
    const now = priceAsOf(hist, today);
    if (before == null || now == null || Math.abs(now - before) < 0.005) continue;
    const lastChange = [...hist].reverse().find((h) => h.date <= today)!;
    moves.push({
      productId: p.id,
      description: p.description,
      supplier: p.supplier.name,
      ingredient: p.ingredient?.name ?? null,
      oldPrice: before,
      newPrice: now,
      changePct: (now - before) / before,
      date: lastChange.date,
    });
  }
  return moves.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}
