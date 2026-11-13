/**
 * Allergens: the nine major US food allergens (FALCPA + FASTER Act sesame).
 *
 * Ingredients carry tags; a recipe contains an allergen when any ingredient
 * in it, or in any sub-recipe at any depth, carries it. Pure functions over
 * plain data so the recipe editor, the matrix page and tests share one rule.
 */

export const ALLERGENS = [
  { id: "milk", label: "Milk", short: "Milk" },
  { id: "eggs", label: "Eggs", short: "Egg" },
  { id: "fish", label: "Fish", short: "Fish" },
  { id: "shellfish", label: "Crustacean shellfish", short: "Shellfish" },
  { id: "tree_nuts", label: "Tree nuts", short: "Tree nut" },
  { id: "peanuts", label: "Peanuts", short: "Peanut" },
  { id: "wheat", label: "Wheat", short: "Wheat" },
  { id: "soy", label: "Soy", short: "Soy" },
  { id: "sesame", label: "Sesame", short: "Sesame" },
] as const;

export type AllergenId = (typeof ALLERGENS)[number]["id"];

const IDS = new Set<string>(ALLERGENS.map((a) => a.id));
export const isAllergen = (s: string): s is AllergenId => IDS.has(s);
export const allergenLabel = (id: string) => ALLERGENS.find((a) => a.id === id)?.label ?? id;

/** Keep only known ids, de-duplicated, in the standard order. */
export function normalizeAllergens(list: readonly string[]): AllergenId[] {
  const set = new Set(list.map((s) => s.trim().toLowerCase()));
  return ALLERGENS.map((a) => a.id).filter((id) => set.has(id));
}

/** Toggle one allergen in a list (returns a new normalized list). */
export function toggleAllergen(list: readonly string[], id: AllergenId, on: boolean): AllergenId[] {
  const rest = normalizeAllergens(list).filter((x) => x !== id);
  return normalizeAllergens(on ? [...rest, id] : rest);
}

export interface AllergenIngredient {
  id: string;
  name: string;
  allergens: readonly string[];
}

export interface AllergenRecipe {
  id: string;
  name: string;
  lines: readonly { ingredientId?: string | null; subRecipeId?: string | null }[];
}

export interface AllergenContext {
  ingredients: ReadonlyMap<string, AllergenIngredient>;
  recipes: ReadonlyMap<string, AllergenRecipe>;
}

export interface RecipeAllergens {
  /** Allergens present, in the standard order. */
  allergens: AllergenId[];
  /** For each allergen, the ingredient names that bring it in (via sub-recipes too). */
  sources: Partial<Record<AllergenId, string[]>>;
}

/** Roll allergens up through sub-recipes. Loops are ignored (each recipe visited once per path). */
export function recipeAllergens(ctx: AllergenContext, recipeId: string, memo: Map<string, RecipeAllergens> = new Map(), stack: string[] = []): RecipeAllergens {
  const cached = memo.get(recipeId);
  if (cached) return cached;
  const recipe = ctx.recipes.get(recipeId);
  const sources = new Map<AllergenId, Set<string>>();
  const add = (a: AllergenId, from: string) => {
    const s = sources.get(a) ?? new Set<string>();
    s.add(from);
    sources.set(a, s);
  };
  if (recipe && !stack.includes(recipeId)) {
    for (const line of recipe.lines) {
      if (line.ingredientId) {
        const ing = ctx.ingredients.get(line.ingredientId);
        if (!ing) continue;
        for (const a of normalizeAllergens(ing.allergens)) add(a, ing.name);
      } else if (line.subRecipeId) {
        const sub = recipeAllergens(ctx, line.subRecipeId, memo, [...stack, recipeId]);
        for (const a of sub.allergens) for (const n of sub.sources[a] ?? []) add(a, n);
      }
    }
  }
  const allergens = ALLERGENS.map((a) => a.id).filter((id) => sources.has(id));
  const result: RecipeAllergens = { allergens, sources: Object.fromEntries(allergens.map((a) => [a, [...sources.get(a)!].sort()])) };
  if (!stack.includes(recipeId)) memo.set(recipeId, result);
  return result;
}

export interface MatrixRow {
  id: string;
  name: string;
  category: string;
  allergens: AllergenId[];
  sources: RecipeAllergens["sources"];
}

/** Menu items × allergens, sorted by category then name. */
export function allergenMatrix(ctx: AllergenContext, items: readonly { id: string; name: string; category: string }[]): MatrixRow[] {
  const memo = new Map<string, RecipeAllergens>();
  return items
    .map((it) => {
      const r = recipeAllergens(ctx, it.id, memo);
      return { id: it.id, name: it.name, category: it.category, allergens: r.allergens, sources: r.sources };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
