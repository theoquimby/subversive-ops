/**
 * Recipe costing and ingredient-usage explosion.
 *
 * Pure functions over plain data so the same logic answers "what does this
 * burger cost today", "what did it cost on March 1st" (pass as-of prices) and
 * "how much bun/beef/aioli does one burger consume" (for ordering).
 */

import { BaseUnit, CustomConversion, toBase, UnitError } from "./units";

export interface CostIngredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  yieldPct: number; // 0–1, usable fraction after trim/cook loss
  conversions: CustomConversion[];
  /** Purchase cost per base unit (before yield), or null if unknown. */
  costPerBase: number | null;
}

export interface CostRecipeLine {
  ingredientId?: string | null;
  subRecipeId?: string | null;
  qty: number;
  unit: string;
}

export interface CostRecipe {
  id: string;
  name: string;
  yieldQty: number;
  yieldUnit: string;
  yieldBase: BaseUnit;
  menuPrice: number | null;
  lines: CostRecipeLine[];
}

export interface CostLineResult {
  label: string;
  kind: "ingredient" | "recipe";
  refId: string;
  qty: number;
  unit: string;
  cost: number | null;
  error?: string;
}

export interface RecipeCostResult {
  recipeId: string;
  /** Cost of one batch / one serving as defined by the recipe yield. */
  totalCost: number;
  /** True when some line had no price or a unit problem — totalCost is then a floor. */
  incomplete: boolean;
  lines: CostLineResult[];
  foodCostPct: number | null;
}

export interface CostingContext {
  ingredients: ReadonlyMap<string, CostIngredient>;
  recipes: ReadonlyMap<string, CostRecipe>;
}

/** Cost per *usable* base unit — what a recipe line actually pays. */
export function usableCostPerBase(ing: CostIngredient): number | null {
  if (ing.costPerBase == null) return null;
  const y = ing.yieldPct > 0 ? ing.yieldPct : 1;
  return ing.costPerBase / y;
}

/** How many base units one batch of a prep recipe yields. */
export function recipeYieldInBase(r: CostRecipe): number {
  return toBase(r.yieldQty, r.yieldUnit, r.yieldBase);
}

export function costRecipe(ctx: CostingContext, recipeId: string): RecipeCostResult {
  const memo = new Map<string, RecipeCostResult>();
  return costRecipeInner(ctx, recipeId, memo, []);
}

function costRecipeInner(
  ctx: CostingContext,
  recipeId: string,
  memo: Map<string, RecipeCostResult>,
  stack: string[],
): RecipeCostResult {
  const cached = memo.get(recipeId);
  if (cached) return cached;
  const recipe = ctx.recipes.get(recipeId);
  if (!recipe) throw new Error(`Recipe ${recipeId} not found`);
  if (stack.includes(recipeId)) {
    throw new Error(`Recipe loop: ${[...stack, recipeId].map((id) => ctx.recipes.get(id)?.name ?? id).join(" → ")}`);
  }

  let total = 0;
  let incomplete = false;
  const lines: CostLineResult[] = [];

  for (const line of recipe.lines) {
    if (line.ingredientId) {
      const ing = ctx.ingredients.get(line.ingredientId);
      if (!ing) {
        incomplete = true;
        lines.push({ label: "Missing ingredient", kind: "ingredient", refId: line.ingredientId, qty: line.qty, unit: line.unit, cost: null, error: "Ingredient not found" });
        continue;
      }
      try {
        const qtyBase = toBase(line.qty, line.unit, ing.baseUnit, ing.conversions);
        const unitCost = usableCostPerBase(ing);
        const cost = unitCost == null ? null : unitCost * qtyBase;
        if (cost == null) incomplete = true;
        else total += cost;
        lines.push({ label: ing.name, kind: "ingredient", refId: ing.id, qty: line.qty, unit: line.unit, cost, error: cost == null ? "No price yet" : undefined });
      } catch (e) {
        incomplete = true;
        lines.push({ label: ing.name, kind: "ingredient", refId: ing.id, qty: line.qty, unit: line.unit, cost: null, error: e instanceof UnitError ? e.message : String(e) });
      }
    } else if (line.subRecipeId) {
      const sub = ctx.recipes.get(line.subRecipeId);
      if (!sub) {
        incomplete = true;
        lines.push({ label: "Missing recipe", kind: "recipe", refId: line.subRecipeId, qty: line.qty, unit: line.unit, cost: null, error: "Recipe not found" });
        continue;
      }
      const subCost = costRecipeInner(ctx, sub.id, memo, [...stack, recipeId]);
      try {
        const perBase = subCost.totalCost / recipeYieldInBase(sub);
        const cost = perBase * toBase(line.qty, line.unit, sub.yieldBase);
        total += cost;
        if (subCost.incomplete) incomplete = true;
        lines.push({ label: sub.name, kind: "recipe", refId: sub.id, qty: line.qty, unit: line.unit, cost, error: subCost.incomplete ? "Sub-recipe has missing prices" : undefined });
      } catch (e) {
        incomplete = true;
        lines.push({ label: sub.name, kind: "recipe", refId: sub.id, qty: line.qty, unit: line.unit, cost: null, error: e instanceof UnitError ? e.message : String(e) });
      }
    }
  }

  const result: RecipeCostResult = {
    recipeId,
    totalCost: total,
    incomplete,
    lines,
    foodCostPct: recipe.menuPrice && recipe.menuPrice > 0 ? total / recipe.menuPrice : null,
  };
  memo.set(recipeId, result);
  return result;
}

/**
 * Raw ingredient purchase quantities (base units, yield loss included)
 * consumed by `servings` of a recipe. Sub-recipes are exploded recursively.
 * Lines that can't be converted are reported in `problems` and skipped.
 */
export function explodeUsage(
  ctx: CostingContext,
  recipeId: string,
  servings = 1,
  out: Map<string, number> = new Map(),
  problems: string[] = [],
  stack: string[] = [],
): { usage: Map<string, number>; problems: string[] } {
  const recipe = ctx.recipes.get(recipeId);
  if (!recipe || stack.includes(recipeId)) return { usage: out, problems };
  for (const line of recipe.lines) {
    if (line.ingredientId) {
      const ing = ctx.ingredients.get(line.ingredientId);
      if (!ing) continue;
      try {
        const used = toBase(line.qty, line.unit, ing.baseUnit, ing.conversions) * servings;
        const purchased = used / (ing.yieldPct > 0 ? ing.yieldPct : 1);
        out.set(ing.id, (out.get(ing.id) ?? 0) + purchased);
      } catch (e) {
        problems.push(`${recipe.name} → ${ing.name}: ${(e as Error).message}`);
      }
    } else if (line.subRecipeId) {
      const sub = ctx.recipes.get(line.subRecipeId);
      if (!sub) continue;
      try {
        const batches = (toBase(line.qty, line.unit, sub.yieldBase) / recipeYieldInBase(sub)) * servings;
        explodeUsage(ctx, sub.id, batches, out, problems, [...stack, recipeId]);
      } catch (e) {
        problems.push(`${recipe.name} → ${sub.name}: ${(e as Error).message}`);
      }
    }
  }
  return { usage: out, problems };
}
