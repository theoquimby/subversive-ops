/**
 * Waste of prepped and plated items: "2 qt aioli" or "3 burgers, dropped"
 * becomes ingredient waste, so the margin gap and on-hand estimates count it
 * like any other waste. Pure: works on the costing context.
 */

import { CostingContext, CostRecipe, explodeUsage, recipeYieldInBase } from "./costing";
import { STANDARD_UNITS_BY_BASE, toBase, UnitError } from "./units";

/** Units someone can log a recipe in: its yield unit first, then the standard units for its base. */
export function recipeWasteUnits(r: Pick<CostRecipe, "yieldUnit" | "yieldBase"> & { kind?: string }): string[] {
  if (r.kind && r.kind !== "PREP") return ["each"];
  const std = STANDARD_UNITS_BY_BASE[r.yieldBase];
  return [...new Set([r.yieldUnit, ...std])];
}

/**
 * How many batches of `recipe` the quantity represents. Menu items and add-ons
 * are counted in servings ("each" = one serving, whatever the recipe yield).
 */
export function batchesFor(recipe: CostRecipe & { kind?: string }, qty: number, unit: string): number {
  if (!(qty > 0)) throw new UnitError("Enter how much.");
  if (recipe.kind && recipe.kind !== "PREP") return qty;
  const yieldBase = recipeYieldInBase(recipe);
  if (!(yieldBase > 0)) throw new UnitError(`${recipe.name} has no batch size set.`);
  return toBase(qty, unit, recipe.yieldBase) / yieldBase;
}

export interface WasteExplosion {
  /** Ingredient id → purchased base units wasted (yield loss included, as in usage). */
  usage: Map<string, number>;
  problems: string[];
  batches: number;
}

/** Ingredient quantities thrown away when `qty unit` of a recipe is wasted. */
export function explodeWaste(ctx: CostingContext, recipeId: string, qty: number, unit: string, kind?: string): WasteExplosion {
  const recipe = ctx.recipes.get(recipeId);
  if (!recipe) throw new UnitError("That item isn't available any more.");
  const batches = batchesFor({ ...recipe, kind }, qty, unit);
  const { usage, problems } = explodeUsage(ctx, recipeId, batches);
  for (const [id, q] of usage) if (!(q > 0)) usage.delete(id);
  return { usage, problems, batches };
}

/** Cost of wasted ingredient quantities at purchase cost (null if nothing is priced). */
export function wasteCost(ctx: CostingContext, usage: ReadonlyMap<string, number>): number | null {
  let total = 0;
  let any = false;
  for (const [id, q] of usage) {
    const c = ctx.ingredients.get(id)?.costPerBase;
    if (c == null) continue;
    total += c * q;
    any = true;
  }
  return any ? total : null;
}
