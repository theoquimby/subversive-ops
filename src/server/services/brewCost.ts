import "server-only";
import { usableCostPerBase } from "@/domain/costing";
import { costBrewRecipe, liveRecipeForBeer, pourCostFromBrew, scaleBrewCost, type CostLine, type PricedIngredient } from "@/domain/brewRecipes";
import { db } from "../db";
import { buildContext, loadCostingSnapshot } from "./costing";
import { businessToday } from "./sales";

/**
 * Brewing recipe costs from today's ingredient prices: the same prices (and the
 * same "which supplier product" rule) as the menu costs, never a second store.
 */

/** Every active ingredient with what one base unit costs today (null: no price yet). */
export async function pricedIngredients(): Promise<Map<string, PricedIngredient>> {
  const snap = await loadCostingSnapshot();
  const ctx = buildContext(snap, businessToday());
  const out = new Map<string, PricedIngredient>();
  for (const c of ctx.ingredients.values()) {
    out.set(c.id, { id: c.id, name: c.name, baseUnit: c.baseUnit, costPerBase: usableCostPerBase(c), conversions: c.conversions });
  }
  return out;
}

export const costLine = (l: { name: string; ingredientId: string | null; qty: { toNumber(): number } | number; unit: string }): CostLine => ({
  name: l.name,
  ingredientId: l.ingredientId,
  qty: typeof l.qty === "number" ? l.qty : l.qty.toNumber(),
  unit: l.unit,
});

/**
 * What a brew of `bbl` barrels of this recipe costs in ingredients today.
 * `total` is a floor when `unpricedLines` > 0 (those lines have no price yet).
 * Null when the recipe doesn't exist.
 */
export async function brewCostFor(recipeId: string, bbl: number): Promise<{ total: number; unpricedLines: number } | null> {
  const recipe = await db.brewRecipe.findUnique({ where: { id: recipeId }, include: { lines: { orderBy: { sort: "asc" } } } });
  if (!recipe) return null;
  const priced = await pricedIngredients();
  const batchBbl = recipe.batchBbl.toNumber();
  const c = costBrewRecipe(recipe.lines.map(costLine), priced, batchBbl);
  return scaleBrewCost({ total: c.total, unpricedLines: c.unpricedLines }, batchBbl, bbl);
}

/**
 * Keg pour costs per beer from its live brewing recipe, for beers whose live
 * recipe has every line priced. `pourYield` is the keg yield after foam and
 * line loss; `halfKegOz` what a 1/2 bbl holds.
 */
export async function brewPourCosts(pourYield: number, halfKegOz: number): Promise<Map<string, { perPint: number; perHalf: number; recipe: string }>> {
  const out = new Map<string, { perPint: number; perHalf: number; recipe: string }>();
  const recipes = await db.brewRecipe.findMany({
    where: { status: "live", beerId: { not: null } },
    select: { id: true, name: true, beerId: true, status: true, updatedAt: true, batchBbl: true, lines: { orderBy: { sort: "asc" }, select: { name: true, ingredientId: true, qty: true, unit: true } } },
  });
  if (!recipes.length) return out;
  const priced = await pricedIngredients();
  for (const beerId of new Set(recipes.map((r) => r.beerId!))) {
    const r = liveRecipeForBeer(recipes, beerId);
    if (!r) continue;
    const bbl = r.batchBbl.toNumber();
    const c = costBrewRecipe(r.lines.map(costLine), priced, bbl);
    const pc = pourCostFromBrew({ total: c.total, unpricedLines: c.unpricedLines, batchBbl: bbl }, pourYield, halfKegOz);
    if (pc) out.set(beerId, { ...pc, recipe: `brewing recipe ${r.name}` });
  }
  return out;
}
