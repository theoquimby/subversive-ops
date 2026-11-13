import "server-only";
import { allergenMatrix, recipeAllergens, type AllergenContext } from "@/domain/allergens";
import { db } from "../db";

/** Ingredients with their tags and active recipes with their lines — enough to roll allergens up. */
export async function loadAllergenContext(): Promise<AllergenContext> {
  const [ingredients, recipes] = await Promise.all([
    db.ingredient.findMany({ select: { id: true, name: true, allergens: true } }),
    db.recipe.findMany({ where: { active: true }, select: { id: true, name: true, lines: { select: { ingredientId: true, subRecipeId: true } } } }),
  ]);
  return { ingredients: new Map(ingredients.map((i) => [i.id, i])), recipes: new Map(recipes.map((r) => [r.id, r])) };
}

export async function allergensForRecipe(recipeId: string) {
  return recipeAllergens(await loadAllergenContext(), recipeId);
}

/** Every active menu item (and add-on) × allergen. */
export async function menuAllergens() {
  const [ctx, items, taggedCount, ingredientCount] = await Promise.all([
    loadAllergenContext(),
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true, category: true, kind: true } }),
    db.ingredient.count({ where: { active: true, NOT: { allergens: { isEmpty: true } } } }),
    db.ingredient.count({ where: { active: true } }),
  ]);
  const kind = new Map(items.map((i) => [i.id, i.kind]));
  const rows = allergenMatrix(ctx, items).map((r) => ({ ...r, kind: kind.get(r.id)! }));
  return { rows, taggedCount, ingredientCount };
}
