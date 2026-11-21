/**
 * Linking sales without anyone pressing a button, but only where it can't go
 * wrong. Two kinds of link qualify:
 *
 * - **Sure matches**: the same test as the Sure matches button (a near-certain
 *   name and a cost that looks right for the price).
 * - **Siblings**: another flavour or option of an item already linked
 *   ("Wings (6) · Cajun" when "Wings (6) · Buffalo" is), at a similar price and
 *   never a different size ("Festbier · Half Pour" isn't "Festbier · Full Pour").
 *
 * Never touched: anything someone has linked, unlinked, skipped or decided
 * before (a person's call always wins), beer pours (they're costed from the
 * keg), and cans, merch and fees (they get a cost each, not a recipe).
 */

import { sizeConflict, type ItemKind } from "./linking";
import { splitItemName } from "./kegPours";

export interface AutoCandidate {
  squareId: string;
  name: string;
  modifier: boolean;
  kind: ItemKind;
  price: number | null;
  sales30: number;
  /** The best suggestion and whether it passes the Sure matches test. */
  best: { recipeId: string; recipeName: string; confidence: number; safe: boolean } | null;
  /** Someone has changed this item's link before, or skipped it: leave it alone. */
  touched: boolean;
}

export interface LinkedSibling {
  name: string;
  modifier: boolean;
  price: number | null;
  recipeId: string;
  recipeName: string;
}

export interface AutoLink {
  squareId: string;
  name: string;
  recipeId: string;
  recipeName: string;
  why: "sure" | "sibling";
  /** For a sibling: the linked item it follows. */
  like?: string;
  sales30: number;
}

/** A sure match must be at least this sure to be linked unseen (the button's "high" starts at 0.85). */
export const AUTO_MIN_CONFIDENCE = 0.9;
/** A sibling's price may differ by this much (extra sauce, a pricier flavour) and still be the same dish. */
const SIBLING_PRICE_GAP = 0.15;

const RECIPE_KINDS = new Set<ItemKind>(["food", "drink"]);
const key = (s: string) => s.trim().toLowerCase();

function samePrice(a: number | null, b: number | null): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return a === b || a == null || b == null;
  return Math.abs(a - b) / Math.max(a, b) <= SIBLING_PRICE_GAP;
}

export function autoLinkPlan(candidates: readonly AutoCandidate[], linked: readonly LinkedSibling[]): AutoLink[] {
  // Linked items by their base name ("Wings (6)"), per kind (item or add-on).
  const byBase = new Map<string, LinkedSibling[]>();
  for (const l of linked) {
    const { base, variation } = splitItemName(l.name);
    if (!variation) continue;
    const k = `${l.modifier ? "m" : "i"}:${key(base)}`;
    byBase.set(k, [...(byBase.get(k) ?? []), l]);
  }
  const out: AutoLink[] = [];
  for (const c of candidates) {
    if (c.touched || !RECIPE_KINDS.has(c.kind)) continue;
    const { base, variation } = splitItemName(c.name);
    // Siblings first: an item already linked by a person is the strongest evidence there is.
    const sibs = variation ? (byBase.get(`${c.modifier ? "m" : "i"}:${key(base)}`) ?? []) : [];
    const fits = sibs.filter((s) => {
      const sv = splitItemName(s.name).variation ?? "";
      return !sizeConflict(variation ?? "", sv) && samePrice(c.price, s.price);
    });
    const recipes = new Set(fits.map((s) => s.recipeId));
    if (fits.length && recipes.size === 1) {
      out.push({ squareId: c.squareId, name: c.name, recipeId: fits[0].recipeId, recipeName: fits[0].recipeName, why: "sibling", like: fits[0].name, sales30: c.sales30 });
      continue;
    }
    if (c.best && c.best.safe && c.best.confidence >= AUTO_MIN_CONFIDENCE) {
      out.push({ squareId: c.squareId, name: c.name, recipeId: c.best.recipeId, recipeName: c.best.recipeName, why: "sure", sales30: c.sales30 });
    }
  }
  return out;
}
