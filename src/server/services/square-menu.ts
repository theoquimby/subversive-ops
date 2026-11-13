import "server-only";
import { LinkedPrice, priceDrift, RecipeLite, SquareMenuItem, suggestMatches } from "@/domain/squareMenu";
import { db, num } from "../db";
import { squareCatalogMeta } from "./sales";

export interface SquareMenuRow extends SquareMenuItem {
  recipeId: string | null;
  recipeName: string | null;
  ignored: boolean;
  archived: boolean;
  deleted: boolean;
  /** Catalog metadata (price, category) has been synced for this item. */
  known: boolean;
}

/** Square items joined with their catalog metadata and linked recipe. */
export async function loadSquareMenu() {
  const [mappings, meta, recipes] = await Promise.all([
    db.squareMapping.findMany({ include: { recipe: { select: { name: true } } }, orderBy: { squareName: "asc" } }),
    squareCatalogMeta(),
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true, kind: true, menuPrice: true, _count: { select: { lines: true } } }, orderBy: { name: "asc" } }),
  ]);
  const items: SquareMenuRow[] = mappings.map((m) => {
    const x = meta[m.squareId];
    return {
      squareId: m.squareId,
      squareType: m.squareType === "MODIFIER" ? "MODIFIER" : "ITEM_VARIATION",
      name: m.squareName,
      baseName: x?.baseName ?? m.squareName,
      price: x?.price ?? null,
      category: x?.category ?? null,
      recipeId: m.recipeId,
      recipeName: m.recipe?.name ?? null,
      ignored: m.ignored,
      archived: x?.archived ?? false,
      deleted: x?.deleted ?? false,
      known: !!x,
    };
  });
  const recipeLite: RecipeLite[] = recipes.map((r) => ({ id: r.id, name: r.name, kind: r.kind as RecipeLite["kind"], menuPrice: num(r.menuPrice) }));
  return { items, recipes: recipeLite, emptyRecipes: new Set(recipes.filter((r) => r._count.lines === 0).map((r) => r.id)), hasMeta: Object.keys(meta).length > 0 };
}

export async function squareMenuReview() {
  const { items, recipes, emptyRecipes, hasMeta } = await loadSquareMenu();
  const open = items.filter((i) => !i.recipeId && !i.ignored && !i.deleted);
  const suggestions = suggestMatches(open, recipes);
  const priceOf = new Map(recipes.map((r) => [r.id, r]));
  const linked: LinkedPrice[] = items
    .filter((i) => i.recipeId && !i.deleted && !i.archived)
    .map((i) => ({ squareId: i.squareId, squareName: i.name, squarePrice: i.price, recipeId: i.recipeId!, recipeName: i.recipeName ?? "", menuPrice: priceOf.get(i.recipeId!)?.menuPrice ?? null }));
  return {
    items,
    open,
    suggestions,
    drift: priceDrift(linked),
    linkedCount: items.filter((i) => i.recipeId).length,
    ignoredCount: items.filter((i) => i.ignored).length,
    needIngredients: new Set(items.filter((i) => i.recipeId && emptyRecipes.has(i.recipeId)).map((i) => i.recipeId)).size,
    hasMeta,
  };
}
