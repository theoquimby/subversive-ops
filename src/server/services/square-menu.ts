import "server-only";
import { LinkedPrice, priceDrift, RecipeLite, SquareMenuItem } from "@/domain/squareMenu";
import { rankCandidates } from "@/domain/linking";
import { db, num } from "../db";
import { squareCatalogMeta } from "./sales";
import { readSettingJSON, writeSettingJSON } from "./square";
import { addDays } from "@/domain/dates";
import { businessToday } from "./sales";

/** Suggestions someone said no to: Square id → recipe ids not to suggest again. */
export const REJECTED_KEY = "squareMenu.rejected";
export const loadRejected = async () => (await readSettingJSON<Record<string, string[]>>(REJECTED_KEY)) ?? {};
export async function addRejected(pairs: { squareId: string; recipeId: string }[]) {
  const cur = await loadRejected();
  for (const p of pairs) cur[p.squareId] = [...new Set([...(cur[p.squareId] ?? []), p.recipeId])];
  await writeSettingJSON(REJECTED_KEY, cur);
}

export interface SquareMenuRow extends SquareMenuItem {
  recipeId: string | null;
  recipeName: string | null;
  ignored: boolean;
  /** Bought in, no recipe: cost of one (counts as linked). */
  unitCost: number | null;
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
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true, kind: true, category: true, menuPrice: true, _count: { select: { lines: true } } }, orderBy: { name: "asc" } }),
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
      unitCost: num(m.unitCost),
      archived: x?.archived ?? false,
      deleted: x?.deleted ?? false,
      known: !!x,
    };
  });
  const recipeLite: RecipeLite[] = recipes.map((r) => ({ id: r.id, name: r.name, kind: r.kind as RecipeLite["kind"], menuPrice: num(r.menuPrice) }));
  return { items, recipes: recipeLite, categories: recipes.map((r) => ({ id: r.id, category: r.category })), emptyRecipes: new Set(recipes.filter((r) => r._count.lines === 0).map((r) => r.id)), hasMeta: Object.keys(meta).length > 0 };
}

export async function squareMenuReview() {
  const { items, recipes, emptyRecipes, hasMeta, categories } = await loadSquareMenu();
  const open = items.filter((i) => !i.recipeId && !i.ignored && i.unitCost == null && !i.deleted);
  const rejected = await loadRejected();
  // Rejected pairs are taken out before matching, so the next-best recipe can still be suggested.
  // Same ranking as Link your sales (name, category, price, size), so both pages suggest the same recipe.
  const catOf = new Map(categories.map((r) => [r.id, r.category]));
  const ranked = recipes.map((r) => ({ id: r.id, name: r.name, kind: r.kind, category: catOf.get(r.id) ?? "", menuPrice: r.menuPrice, cost: null, incomplete: false, lines: 1 }));
  const suggestions = open.flatMap((it) => {
    const [best] = rankCandidates({ squareId: it.squareId, name: it.name, baseName: it.baseName, modifier: it.squareType === "MODIFIER", category: it.category, price: it.price }, ranked, { rejected: new Set(rejected[it.squareId] ?? []), limit: 1 });
    return best && best.confidence >= 0.7 ? [{ squareId: it.squareId, recipeId: best.recipeId, recipeName: best.recipeName, confidence: best.confidence }] : [];
  });
  const priceOf = new Map(recipes.map((r) => [r.id, r]));
  const linked: LinkedPrice[] = items
    .filter((i) => i.recipeId && !i.deleted && !i.archived)
    .map((i) => ({ squareId: i.squareId, squareName: i.name, squarePrice: i.price, recipeId: i.recipeId!, recipeName: i.recipeName ?? "", menuPrice: priceOf.get(i.recipeId!)?.menuPrice ?? null }));
  return {
    items,
    recipes,
    open,
    suggestions,
    drift: priceDrift(linked),
    linkedCount: items.filter((i) => i.recipeId).length,
    ignoredCount: items.filter((i) => i.ignored).length,
    needIngredients: new Set(items.filter((i) => i.recipeId && emptyRecipes.has(i.recipeId)).map((i) => i.recipeId)).size,
    hasMeta,
    emptyRecipes,
  };
}

export interface SquareItemRow {
  squareId: string;
  name: string;
  modifier: boolean;
  category: string | null;
  price: number | null;
  known: boolean;
  recipeId: string | null;
  recipeName: string | null;
  ignored: boolean;
  /** Bought in, no recipe: cost of one. */
  unitCost: number | null;
  archived: boolean;
  deleted: boolean;
  sold: number;
  suggestion: { recipeId: string; recipeName: string; confidence: number } | null;
  /** Linked to a recipe that has no ingredient lines yet. */
  recipeEmpty?: boolean;
  /** Linked recipe's menu price, and Square − menu when they differ. */
  menuPrice: number | null;
  drift: { diff: number | null; conflict: boolean } | null;
}

/** Every Square item with its link, suggestion, price gap and 4-week sales, for the Square items table. */
export async function squareItemRows() {
  const [r, volume] = await Promise.all([
    squareMenuReview(),
    db.dailySale.groupBy({ by: ["squareId"], _sum: { qty: true }, where: { date: { gte: new Date(`${addDays(businessToday(), -28)}T00:00:00Z`) } } }),
  ]);
  const sold = new Map(volume.map((v) => [v.squareId, v._sum.qty?.toNumber() ?? 0]));
  const sugg = new Map(r.suggestions.map((s) => [s.squareId, s]));
  const drift = new Map(r.drift.map((d) => [d.squareId, d]));
  const menuPrice = new Map(r.recipes.map((x) => [x.id, x.menuPrice]));
  const rows: SquareItemRow[] = r.items.map((i) => {
    const s = sugg.get(i.squareId);
    const d = drift.get(i.squareId);
    return {
      squareId: i.squareId,
      name: i.name,
      modifier: i.squareType === "MODIFIER",
      category: i.category,
      price: i.price,
      known: i.known,
      recipeId: i.recipeId,
      recipeName: i.recipeName,
      ignored: i.ignored,
      unitCost: i.unitCost,
      archived: i.archived,
      deleted: i.deleted,
      sold: sold.get(i.squareId) ?? 0,
      suggestion: s ? { recipeId: s.recipeId, recipeName: s.recipeName, confidence: s.confidence } : null,
      recipeEmpty: !!i.recipeId && r.emptyRecipes.has(i.recipeId),
      menuPrice: i.recipeId ? menuPrice.get(i.recipeId) ?? null : null,
      drift: d ? { diff: d.diff, conflict: d.conflict } : null,
    };
  });
  return { review: r, rows, recipes: r.recipes.map((x) => ({ id: x.id, name: x.name, kind: x.kind })) };
}
