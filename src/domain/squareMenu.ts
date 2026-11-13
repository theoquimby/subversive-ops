import { fuzzyScore } from "./search";

/**
 * Turning the Square menu into recipes: suggest which recipe each Square item
 * is, plan new recipes for items that have none, and spot price drift between
 * Square and the recipe's menu price.
 */

export type SquareObjectType = "ITEM_VARIATION" | "MODIFIER";
export type RecipeKindLite = "MENU" | "MODIFIER" | "PREP";

export interface SquareMenuItem {
  squareId: string;
  squareType: SquareObjectType;
  /** Name as shown in lists, e.g. "Smash Burger · Double" or "Bacon (Add-ons)". */
  name: string;
  /** Name to match and to name a new recipe after, e.g. "Smash Burger · Double" or "Bacon". */
  baseName: string;
  price: number | null;
  category: string | null;
}

export interface RecipeLite {
  id: string;
  name: string;
  kind: RecipeKindLite;
  menuPrice: number | null;
}

const STOP = new Set(["the", "and", "with", "w", "regular", "reg", "a", "of"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

/** How sure we are that two menu names are the same dish, 0–1. */
export function matchConfidence(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const na = ta.join(" ");
  const nb = tb.join(" ");
  if (na === nb) return 1;
  const setA = new Set(ta);
  const setB = new Set(tb);
  const common = [...setA].filter((t) => setB.has(t)).length;
  const dice = (2 * common) / (setA.size + setB.size);
  const [q, t] = na.length <= nb.length ? [na, nb] : [nb, na];
  const s = fuzzyScore(q, t);
  const self = fuzzyScore(t, t) ?? 1;
  const fuzzy = s == null || self <= 0 ? 0 : Math.max(0, s / self);
  return Math.min(0.99, Math.max(dice, fuzzy));
}

export interface Suggestion {
  squareId: string;
  recipeId: string;
  recipeName: string;
  confidence: number;
}

const kindFor = (t: SquareObjectType): RecipeKindLite => (t === "MODIFIER" ? "MODIFIER" : "MENU");

/**
 * Best recipe for each item at or above `threshold`. Items only match
 * recipes of the matching kind (menu items ↔ menu recipes, modifiers ↔
 * add-ons), and a near-tie between two recipes is left for a person to pick.
 */
export function suggestMatches(items: SquareMenuItem[], recipes: RecipeLite[], threshold = 0.7): Suggestion[] {
  const out: Suggestion[] = [];
  for (const it of items) {
    const kind = kindFor(it.squareType);
    const scored = recipes
      .filter((r) => r.kind === kind)
      .map((r) => ({ r, c: Math.max(matchConfidence(it.baseName, r.name), matchConfidence(it.name, r.name)) }))
      .sort((x, y) => y.c - x.c);
    const [best, second] = scored;
    if (!best || best.c < threshold) continue;
    if (second && best.c < 1 && best.c - second.c < 0.05) continue;
    out.push({ squareId: it.squareId, recipeId: best.r.id, recipeName: best.r.name, confidence: Math.round(best.c * 100) / 100 });
  }
  return out;
}

// ---- New recipes from Square ----------------------------------------------------

export interface RecipeDraft {
  name: string;
  kind: "MENU" | "MODIFIER";
  category: string;
  menuPrice: number | null;
  squareIds: string[];
}

export interface RecipePlan {
  create: RecipeDraft[];
  /** Items whose name already belongs to a recipe of the same kind: link instead of creating. */
  link: { recipeId: string; squareIds: string[] }[];
}

/**
 * Plan recipes for the chosen Square items. Names stay unique: an existing
 * recipe of the same kind is linked rather than duplicated; a clash with a
 * different kind gets a suffix.
 */
export function planRecipesFromSquare(items: SquareMenuItem[], existing: { id: string; name: string; kind: RecipeKindLite }[]): RecipePlan {
  const byName = new Map(existing.map((r) => [r.name.trim().toLowerCase(), r]));
  const drafts = new Map<string, RecipeDraft>();
  const links = new Map<string, string[]>();
  for (const it of items) {
    const kind = kindFor(it.squareType) as "MENU" | "MODIFIER";
    let name = it.baseName.trim() || it.name.trim();
    const clash = byName.get(name.toLowerCase());
    if (clash && clash.kind === kind) {
      links.set(clash.id, [...(links.get(clash.id) ?? []), it.squareId]);
      continue;
    }
    if (clash) name = `${name} (${kind === "MODIFIER" ? "add-on" : "Square"})`;
    const key = name.toLowerCase();
    const prev = drafts.get(key);
    if (prev && prev.kind === kind) {
      prev.squareIds.push(it.squareId);
      if (prev.menuPrice == null) prev.menuPrice = it.price;
      continue;
    }
    if (byName.has(key)) continue; // suffixed name also taken; leave for a person
    drafts.set(key, { name, kind, category: it.category?.trim() || (kind === "MODIFIER" ? "Add-ons" : "Food"), menuPrice: it.price, squareIds: [it.squareId] });
  }
  return { create: [...drafts.values()], link: [...links].map(([recipeId, squareIds]) => ({ recipeId, squareIds })) };
}

// ---- Price drift ---------------------------------------------------------------

export interface LinkedPrice {
  squareId: string;
  squareName: string;
  squarePrice: number | null;
  recipeId: string;
  recipeName: string;
  menuPrice: number | null;
}

export interface PriceDrift extends LinkedPrice {
  squarePrice: number;
  diff: number | null;
  /** The recipe is linked to several Square items with different prices — pick by hand. */
  conflict: boolean;
}

/** Linked items whose Square price differs from the recipe's menu price, biggest gap first. */
export function priceDrift(rows: LinkedPrice[]): PriceDrift[] {
  const pricesByRecipe = new Map<string, Set<number>>();
  for (const r of rows) {
    if (r.squarePrice == null) continue;
    const set = pricesByRecipe.get(r.recipeId) ?? new Set<number>();
    set.add(Math.round(r.squarePrice * 100));
    pricesByRecipe.set(r.recipeId, set);
  }
  const out: PriceDrift[] = [];
  for (const r of rows) {
    if (r.squarePrice == null) continue;
    const same = r.menuPrice != null && Math.round(r.menuPrice * 100) === Math.round(r.squarePrice * 100);
    if (same) continue;
    out.push({ ...r, squarePrice: r.squarePrice, diff: r.menuPrice == null ? null : r.squarePrice - r.menuPrice, conflict: (pricesByRecipe.get(r.recipeId)?.size ?? 0) > 1 });
  }
  return out.sort((a, b) => Math.abs(b.diff ?? Infinity) - Math.abs(a.diff ?? Infinity) || a.squareName.localeCompare(b.squareName));
}
