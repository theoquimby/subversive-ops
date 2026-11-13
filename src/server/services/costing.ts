import "server-only";
import { costRecipe, CostingContext, CostIngredient, CostRecipe, explodeUsage, RecipeCostResult } from "@/domain/costing";
import { addDays, ISODate, toISODate } from "@/domain/dates";
import { BaseUnit } from "@/domain/units";
import { db, num } from "../db";

/**
 * Everything needed to cost recipes at any point in time, loaded in a handful
 * of queries. Price history is kept in memory so "cost on date X" for many
 * dates (history charts) is cheap.
 */
export interface CostingSnapshot {
  ingredients: Awaited<ReturnType<typeof loadIngredients>>;
  recipes: Awaited<ReturnType<typeof loadRecipes>>;
  /** productId → price records sorted by date ascending */
  priceHistory: Map<string, { date: ISODate; price: number }[]>;
}

const loadIngredients = () =>
  db.ingredient.findMany({
    where: { active: true },
    include: {
      conversions: true,
      products: { where: { active: true }, select: { id: true, packQtyBase: true, supplierId: true } },
    },
    orderBy: { name: "asc" },
  });

const loadRecipes = () =>
  db.recipe.findMany({
    where: { active: true },
    include: { lines: { orderBy: { sort: "asc" } } },
    orderBy: { name: "asc" },
  });

export async function loadCostingSnapshot(): Promise<CostingSnapshot> {
  const [ingredients, recipes, prices] = await Promise.all([
    loadIngredients(),
    loadRecipes(),
    db.priceRecord.findMany({
      select: { supplierProductId: true, effectiveDate: true, price: true, createdAt: true },
      orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const priceHistory = new Map<string, { date: ISODate; price: number }[]>();
  for (const p of prices) {
    const list = priceHistory.get(p.supplierProductId) ?? [];
    list.push({ date: toISODate(p.effectiveDate), price: p.price.toNumber() });
    priceHistory.set(p.supplierProductId, list);
  }
  return { ingredients, recipes, priceHistory };
}

/** Latest price on or before `asOf` (records are sorted ascending). */
export function priceAsOf(list: { date: ISODate; price: number }[] | undefined, asOf: ISODate): number | null {
  if (!list) return null;
  let found: number | null = null;
  for (const r of list) {
    if (r.date > asOf) break;
    found = r.price;
  }
  return found;
}

/**
 * Cost per base unit for an ingredient on a date. Uses the preferred product
 * if set, otherwise the linked product with the most recent price.
 */
function ingredientCostPerBase(snap: CostingSnapshot, ing: CostingSnapshot["ingredients"][number], asOf: ISODate) {
  const src = ingredientCostSource(snap, ing, asOf);
  return src ? src.price / src.pack : null;
}

/** Which supplier product (and which price on which date) an ingredient's cost comes from. */
export function ingredientCostSource(snap: CostingSnapshot, ing: CostingSnapshot["ingredients"][number], asOf: ISODate): { productId: string; price: number; date: ISODate; pack: number } | null {
  const candidates = ing.products
    .filter((p) => p.packQtyBase && p.packQtyBase.toNumber() > 0)
    .map((p) => {
      const list = snap.priceHistory.get(p.id);
      const price = priceAsOf(list, asOf);
      const lastDate = list?.filter((r) => r.date <= asOf).at(-1)?.date ?? "";
      return { id: p.id, price, lastDate, pack: p.packQtyBase!.toNumber() };
    })
    .filter((c) => c.price != null);
  if (candidates.length === 0) return null;
  const preferred = candidates.find((c) => c.id === ing.preferredProductId);
  const chosen = preferred ?? candidates.sort((a, b) => b.lastDate.localeCompare(a.lastDate))[0];
  return { productId: chosen.id, price: chosen.price!, date: chosen.lastDate, pack: chosen.pack };
}

export function buildContext(snap: CostingSnapshot, asOf: ISODate): CostingContext {
  const ingredients = new Map<string, CostIngredient>();
  for (const ing of snap.ingredients) {
    ingredients.set(ing.id, {
      id: ing.id,
      name: ing.name,
      baseUnit: ing.baseUnit as BaseUnit,
      yieldPct: ing.yieldPct.toNumber(),
      conversions: ing.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })),
      costPerBase: ingredientCostPerBase(snap, ing, asOf),
    });
  }
  const recipes = new Map<string, CostRecipe>();
  for (const r of snap.recipes) {
    recipes.set(r.id, {
      id: r.id,
      name: r.name,
      yieldQty: r.yieldQty.toNumber(),
      yieldUnit: r.yieldUnit,
      yieldBase: r.yieldBase as BaseUnit,
      menuPrice: num(r.menuPrice),
      lines: r.lines.map((l) => ({ ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: l.qty.toNumber(), unit: l.unit })),
    });
  }
  return { ingredients, recipes };
}

export function safeCost(ctx: CostingContext, recipeId: string): RecipeCostResult | { error: string } {
  try {
    return costRecipe(ctx, recipeId);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Weekly cost points for a recipe over the last `weeks` weeks. */
export function costHistory(snap: CostingSnapshot, recipeId: string, today: ISODate, weeks = 26) {
  const points: { date: ISODate; cost: number | null }[] = [];
  for (let i = weeks; i >= 0; i--) {
    const date = addDays(today, -7 * i);
    const res = safeCost(buildContext(snap, date), recipeId);
    // A partial cost (some ingredients not priced yet) would draw a misleading dip, so skip it.
    points.push({ date, cost: "error" in res || res.incomplete ? null : res.totalCost });
  }
  return points;
}

export { explodeUsage };
