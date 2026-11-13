import "server-only";
import { addDays, ISODate } from "@/domain/dates";
import { ClassMap, classifyCategory, ClassSettings, DEFAULT_BEV_TARGET, groupOf, normalizeCategory, parseClassSettings, RevenueClass } from "@/domain/revenueClass";
import { db } from "../db";
import { buildContext, CostingSnapshot, loadCostingSnapshot, priceAsOf, safeCost } from "./costing";
import { businessToday } from "./sales";

export const DEFAULT_TARGET_FOOD_COST = 0.3;

export async function targetFoodCost(): Promise<number> {
  const s = await db.setting.findUnique({ where: { key: "costing.targetFoodCostPct" } });
  return s ? Number(s.value) : DEFAULT_TARGET_FOOD_COST;
}

// ---- Revenue classes (food / beer / other beverage / retail) ------------------------

export const CLASS_SETTING = "menu.revenueClasses";

export async function classSettings(): Promise<ClassSettings> {
  const s = await db.setting.findUnique({ where: { key: CLASS_SETTING } });
  return parseClassSettings(s?.value);
}

/** Targets for the P&L split: food from the costing setting, beverage from the class mapping. */
export async function costTargets(): Promise<{ food: number; beverage: number }> {
  const [food, cls] = await Promise.all([targetFoodCost(), classSettings()]);
  return { food, beverage: cls.bevTarget ?? DEFAULT_BEV_TARGET };
}

export async function saveClassSettings(next: { category?: string; cls?: RevenueClass; bevTarget?: number | null }) {
  const cur = await classSettings();
  const map: ClassMap = { ...cur.map };
  if (next.category != null && next.cls) map[normalizeCategory(next.category)] = next.cls;
  const bevTarget = next.bevTarget === undefined ? cur.bevTarget : next.bevTarget;
  const value = JSON.stringify({ map, bevTarget });
  await db.setting.upsert({ where: { key: CLASS_SETTING }, create: { key: CLASS_SETTING, value }, update: { value } });
}

/** recipeId → revenue class, for every active recipe in the snapshot. */
export function recipeClasses(snap: CostingSnapshot, settings: ClassSettings): Map<string, RevenueClass> {
  return new Map(snap.recipes.map((r) => [r.id, classifyCategory(r.category, settings.map)]));
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
  /** Food / beer / other beverage / retail, from the category. */
  cls: RevenueClass;
  incomplete: boolean;
  error?: string;
}

/** Every recipe's cost now vs 30 days ago, and food cost % against target. */
export async function menuCosts(snap?: CostingSnapshot): Promise<{ rows: MenuCostRow[]; today: ISODate }> {
  const s = snap ?? (await loadCostingSnapshot());
  const today = businessToday();
  const [ctxNow, ctxThen, targets, cls] = [buildContext(s, today), buildContext(s, addDays(today, -30)), await costTargets(), await classSettings()];
  const rows = s.recipes.map((r) => {
    const now = safeCost(ctxNow, r.id);
    const then = safeCost(ctxThen, r.id);
    const rc = classifyCategory(r.category, cls.map);
    // Drinks without their own target are held to the beverage target, not the food one.
    const target = r.targetFoodCostPct?.toNumber() ?? (groupOf(rc) === "beverage" ? targets.beverage : targets.food);
    if ("error" in now) {
      return { id: r.id, name: r.name, kind: r.kind, category: r.category, menuPrice: r.menuPrice?.toNumber() ?? null, cost: null, costBefore: null, foodCostPct: null, target, cls: rc, incomplete: true, error: now.error };
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
      cls: rc,
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
