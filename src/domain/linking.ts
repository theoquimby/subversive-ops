/**
 * Linking Square sales to what they cost: suggest a recipe for each unlinked
 * Square item, say what a link would do before it's saved ("plate cost $3.10
 * → 31% food cost"), flag links that look wrong, sort out the things that
 * aren't recipes at all (draft beer pours, cans, merch, gift cards) and
 * measure how much of the last 30 days' sales is linked. Pure.
 */

import { classifyCategory, type ClassMap, type RevenueClass } from "./revenueClass";
import { matchConfidence } from "./squareMenu";
import { nameScore } from "./salesNameMatch";
import { beerKey, matchSquareItem, pourOz, splitItemName, type BeerMatcher } from "./kegPours";

// ---- Shapes ---------------------------------------------------------------------------

export interface LinkItem {
  squareId: string;
  /** As listed, e.g. "Wings (6) · Buffalo". */
  name: string;
  /** Item name without the modifier list, e.g. "Bacon" for "Bacon (Add-ons)". */
  baseName: string;
  modifier: boolean;
  category: string | null;
  /** Square price (null: varies or unknown). */
  price: number | null;
}

export interface LinkRecipe {
  id: string;
  name: string;
  kind: "MENU" | "MODIFIER" | "PREP";
  category: string;
  menuPrice: number | null;
  /** Cost of one serving today (null: can't be costed). */
  cost: number | null;
  /** Some ingredient has no price, so `cost` is a floor. */
  incomplete: boolean;
  /** Ingredient lines (0: an empty recipe that costs nothing yet). */
  lines: number;
}

/** How a Square item counts. */
export interface LinkState {
  recipeId: string | null;
  ignored: boolean;
  /** Bought in, no recipe: what one costs us. */
  unitCost: number | null;
  costClass: RevenueClass | null;
}

export const UNLINKED: LinkState = { recipeId: null, ignored: false, unitCost: null, costClass: null };

/** Linked = it has a cost behind it (a recipe or a bought-in cost) or is left out of sales on purpose. */
export const isSettled = (s: LinkState) => !!s.recipeId || s.ignored || s.unitCost != null;

// ---- Sizes ("Wings (6)" is not "Wings (10)") -------------------------------------------

const SIZE_WORDS: Record<string, string> = { half: "half", small: "small", short: "small", kid: "small", kids: "small", full: "full", large: "large", double: "double", single: "single", triple: "triple" };

/** Numbers and size words in a name: "Wings (10)" → {10}, "Festbier · Half Pour (9 oz)" → {half, 9}. */
export function sizeMarks(name: string): Set<string> {
  const out = new Set<string>();
  const n = String(name ?? "").toLowerCase();
  for (const m of n.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  for (const w of n.split(/[^a-z]+/)) if (SIZE_WORDS[w]) out.add(SIZE_WORDS[w]);
  return out;
}

/** The two names say different sizes ("Wings (6)" vs "Wings (10)", "Half Pour" vs "Full Pour"). Silent when either says none. */
export function sizeConflict(a: string, b: string): boolean {
  const A = sizeMarks(a);
  const B = sizeMarks(b);
  if (!A.size || !B.size) return false;
  const nums = (s: Set<string>) => [...s].filter((x) => /\d/.test(x));
  const words = (s: Set<string>) => [...s].filter((x) => !/\d/.test(x));
  const na = nums(A), nb = nums(B), wa = words(A), wb = words(B);
  if (na.length && nb.length && !na.some((x) => nb.includes(x))) return true;
  if (wa.length && wb.length && !wa.some((x) => wb.includes(x))) return true;
  return false;
}

// ---- Suggestions ------------------------------------------------------------------------

export interface Candidate {
  recipeId: string;
  recipeName: string;
  /** 0–1. */
  confidence: number;
  /** Plain-English reasons, strongest first ("Same name", "Same price"). */
  reasons: string[];
}

export type Band = "high" | "medium" | "low";
export const bandOf = (c: number): Band => (c >= 0.85 ? "high" : c >= 0.6 ? "medium" : "low");

const normCat = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/**
 * Score every menu recipe and add-on for one Square item, best first. Name
 * similarity does most of the work; a matching category or price nudges it up,
 * a different kind of thing (beer vs food), a far-off price or a different
 * size pulls it down. Prep recipes are never sold, so they're left out.
 */
export function rankCandidates(item: LinkItem, recipes: readonly LinkRecipe[], opts: { rejected?: ReadonlySet<string>; classMap?: ClassMap; limit?: number } = {}): Candidate[] {
  const itemClass = item.category ? classifyCategory(item.category, opts.classMap) : null;
  const out: Candidate[] = [];
  const dot = (s: string) => { const i = s.indexOf(" · "); return i < 0 ? null : { base: s.slice(0, i), variation: s.slice(i + 3) }; };
  const itemDot = dot(item.name);
  for (const r of recipes) {
    if (r.kind === "PREP" || opts.rejected?.has(r.id)) continue;
    // "Saison · Full Pour" is never "IPA · Full Pour", nor "IPA · Half Pour": with a variation on
    // both sides, the item part must agree and the sizes mustn't clash.
    const rDot = dot(r.name);
    if (itemDot && rDot && (beerKey(itemDot.base) !== beerKey(rDot.base) || sizeConflict(itemDot.variation, rDot.variation))) continue;
    const name = Math.max(matchConfidence(item.baseName, r.name), matchConfidence(item.name, r.name), nameScore(item.name, r.name), nameScore(item.baseName, r.name));
    if (name < 0.35) continue;
    const reasons: string[] = [];
    let c = name;
    if (name >= 0.999) reasons.push("Same name");
    else if (name >= 0.75) reasons.push("Very similar name");
    else reasons.push("Similar name");
    if (item.category && normCat(item.category) === normCat(r.category)) {
      c += 0.04;
      reasons.push("Same category");
    } else if (itemClass && classifyCategory(r.category, opts.classMap) !== itemClass) {
      c -= 0.15;
      reasons.push(`Square calls it ${itemClass === "otherBev" ? "a drink" : itemClass === "food" ? "food" : itemClass}`);
    }
    if (item.price != null && item.price > 0 && r.menuPrice != null && r.menuPrice > 0) {
      const ratio = Math.min(item.price, r.menuPrice) / Math.max(item.price, r.menuPrice);
      if (ratio >= 0.99) {
        c += 0.06;
        reasons.push("Same price");
      } else if (ratio >= 0.85) {
        c += 0.02;
        reasons.push("Similar price");
      } else if (ratio < 0.6) {
        c -= 0.12;
        reasons.push("Price is quite different");
      }
    }
    const wantKind = item.modifier ? "MODIFIER" : "MENU";
    if (r.kind !== wantKind) c -= 0.06;
    if (sizeConflict(item.name, r.name)) {
      c -= 0.3;
      reasons.push("Different size");
    }
    const conf = Math.round(Math.max(0, Math.min(name >= 0.999 && c >= 1 ? 1 : 0.99, c)) * 100) / 100;
    if (conf < 0.3) continue;
    out.push({ recipeId: r.id, recipeName: r.name, confidence: conf, reasons });
  }
  out.sort((a, b) => b.confidence - a.confidence || a.recipeName.localeCompare(b.recipeName));
  // Two near-equal answers: neither is "sure", so it waits for a person.
  if (out.length > 1 && out[0].confidence - out[1].confidence < 0.04 && bandOf(out[0].confidence) === "high") {
    out[0] = { ...out[0], confidence: 0.84, reasons: [...out[0].reasons, `Close call with ${out[1].recipeName}`] };
  }
  return out.slice(0, opts.limit ?? 5);
}

// ---- What kind of thing is it? ----------------------------------------------------------

export type ItemKind = "beer" | "packaged" | "notSales" | "retail" | "drink" | "food";

const NOT_SALES = /\b(gift ?cards?|e-?gift|service (fee|charge)|gratuity|tips?|donations?|deposits?|custom amount|open (item|food|bar)|corkage|reservation fee|ticket fee)\b/i;
const RETAIL = /\b(t-?shirts?|tees?|hoodies?|sweatshirts?|hats?|beanies?|caps?|stickers?|koozies?|totes?|merch(andise)?|apparel|socks|pint glass(es)?|glassware|mugs?|growler bottle|bottle opener|poster|candles?)\b/i;
const PACKAGED = /\b(\d+\s*-?\s*pack|cans?|bottles?|crowlers?|bombers?|cases?|sixer)\b/i;
const DRINK = /\b(cocktails?|margaritas?|manhattans?|old fashioned|mules?|martinis?|negronis?|spritz|g&t|gin and tonic|whiskey|whisky|bourbon|vodka|tequila|rum|wine|chardonnay|cabernet|pinot|riesling|ros[eé]|prosecco|soda|coke|coca cola|sprite|lemonade|iced tea|coffee|espresso|latte|kombucha|juice|seltzer|cider|mocktails?|shots?)\b/i;
const POUR = /\b(pour|pint|oz|ounce|taster|sample|flight|glass|half|full|mug|stein|pitcher)\b/i;
/** Food words: "Giant Pretzel · The Full Hookup - Full Pour" is a pretzel deal, not a beer. */
const FOOD = /\b(pretzels?|burgers?|sandwich(es)?|wings?|fries|salads?|plates?|platters?|nachos|tacos?|brats?|bratwurst|schnitzel|combo|deal|special|hookup|bundle)\b/i;

/**
 * A first guess at what a Square item is, so the assistant can offer the right
 * way to cost it: beer pours go to draft beer, cans and merch get a cost each,
 * gift cards and fees leave sales, everything else wants a recipe.
 */
export function classifyItem(item: LinkItem, beers: readonly BeerMatcher[] = [], classMap?: ClassMap): { kind: ItemKind; beerId: string | null; beerName: string | null } {
  const n = item.name;
  if (NOT_SALES.test(n) || NOT_SALES.test(item.category ?? "")) return { kind: "notSales", beerId: null, beerName: null };
  const cls = item.category ? classifyCategory(item.category, classMap) : null;
  if (RETAIL.test(n) || cls === "retail") return { kind: "retail", beerId: null, beerName: null };
  const { base, variation } = splitItemName(n);
  // A Square item linked to a beer is that beer; the rest match by name.
  const beerId = matchSquareItem(item.squareId, n, [...beers]);
  if (PACKAGED.test(n)) return { kind: "packaged", beerId, beerName: beerId ? beers.find((b) => b.id === beerId)!.name : null };
  if (!item.modifier && (beerId || (variation && POUR.test(variation) && (cls === "beer" || /\bpour\b/i.test(variation))) || /\bflight\b/i.test(n))) {
    // Cocktails with a "glass" variation aren't beer.
    if (!beerId && DRINK.test(base)) return { kind: "drink", beerId: null, beerName: null };
    if (!beerId && FOOD.test(base + " " + (variation ?? ""))) return { kind: "food", beerId: null, beerName: null };
    return { kind: "beer", beerId, beerName: beerId ? beers.find((b) => b.id === beerId)!.name : base.replace(/\*+$/, "").trim() };
  }
  if (DRINK.test(n) || cls === "otherBev") return { kind: "drink", beerId: null, beerName: null };
  return { kind: "food", beerId: null, beerName: null };
}

/** A starting point for "what does one cost you?" (shown as a hint, never saved on its own). */
export function suggestUnitCost(kind: ItemKind, price: number | null): number | null {
  if (price == null || price <= 0) return null;
  const share = kind === "retail" ? 0.5 : kind === "packaged" ? 0.35 : 0.3;
  return Math.round(price * share * 100) / 100;
}

/** Revenue class a bought-in item most likely belongs to. */
export function defaultCostClass(kind: ItemKind, item: LinkItem, classMap?: ClassMap): RevenueClass {
  if (kind === "retail") return "retail";
  if (kind === "beer") return "beer";
  if (kind === "packaged") {
    const c = item.category ? classifyCategory(item.category, classMap) : null;
    return c && c !== "food" ? c : PACKAGED.test(item.name) && /\b(cider|seltzer|soda|wine)\b/i.test(item.name) ? "otherBev" : "beer";
  }
  if (kind === "drink") return "otherBev";
  return item.category ? classifyCategory(item.category, classMap) : "food";
}

// ---- Draft beer pours, grouped by beer ----------------------------------------------------

export interface PourItem {
  squareId: string;
  name: string;
  /** "Full Pour", "Half Pour (9 oz)". */
  label: string;
  oz: number;
  price: number | null;
  sales30: number;
}

export interface BeerGroup {
  key: string;
  /** The beer's name in the app, or the Square name when no beer matches. */
  beer: string;
  beerId: string | null;
  pours: PourItem[];
  sales30: number;
}

/** Unlinked draft beer pours grouped by beer, biggest sales first. Pours of 0 oz (cans) are left out. */
export function beerGroups(items: readonly (LinkItem & { sales30: number })[], beers: readonly BeerMatcher[], overrides?: Record<string, number>): BeerGroup[] {
  const by = new Map<string, BeerGroup>();
  for (const it of items) {
    const c = classifyItem(it, beers);
    if (c.kind !== "beer") continue;
    const { base, variation } = splitItemName(it.name);
    // A flight mixes beers; it gets a cost each instead.
    if (/\bflights?\b/i.test(base)) continue;
    const oz = pourOz(variation ?? (/\bflight\b/i.test(it.name) ? "flight" : null), { overrides });
    if (oz <= 0) continue;
    const name = c.beerName ?? base;
    const key = c.beerId ?? beerKey(name);
    const g = by.get(key) ?? { key, beer: name, beerId: c.beerId, pours: [], sales30: 0 };
    g.pours.push({ squareId: it.squareId, name: it.name, label: (variation ?? "Pour").trim(), oz, price: it.price, sales30: it.sales30 });
    g.sales30 += it.sales30;
    by.set(key, g);
  }
  for (const g of by.values()) g.pours.sort((a, b) => b.oz - a.oz || b.sales30 - a.sales30);
  return [...by.values()].sort((a, b) => b.sales30 - a.sales30);
}

// ---- Effect of a link, and links that look wrong ----------------------------------------

export type FlagCode = "noLines" | "missingPrices" | "noSquarePrice" | "low" | "high" | "size" | "kind";

export interface Flag {
  code: FlagCode;
  text: string;
  /** bad: probably wrong; warn: worth a look. */
  tone: "bad" | "warn";
}

export interface Effect {
  /** Cost of one sale (null: unknown). */
  cost: number | null;
  /** cost ÷ Square price. */
  pct: number | null;
  flags: Flag[];
}

export const LOW_PCT = 0.05;
export const HIGH_PCT = 0.8;

const pctText = (p: number) => `${Math.round(p * 100)}%`;

/** What linking `item` to `recipe` means for its cost, and anything that looks off. */
export function linkEffect(item: LinkItem, recipe: Pick<LinkRecipe, "name" | "kind" | "cost" | "incomplete" | "lines">): Effect {
  const flags: Flag[] = [];
  const price = item.price != null && item.price > 0 ? item.price : null;
  if (recipe.lines === 0) flags.push({ code: "noLines", text: `${recipe.name} has no ingredients yet, so it costs $0 until you add them.`, tone: "warn" });
  else if (recipe.incomplete) flags.push({ code: "missingPrices", text: "Some ingredients have no price yet, so the cost is a floor.", tone: "warn" });
  if (!price) flags.push({ code: "noSquarePrice", text: "Square has no fixed price for this item, so its cost % can't be checked.", tone: "warn" });
  const cost = recipe.lines === 0 ? 0 : recipe.cost;
  const pct = price && cost != null ? cost / price : null;
  if (pct != null && recipe.lines > 0) {
    if (pct < LOW_PCT) flags.push({ code: "low", text: `Only ${pctText(pct)} of the price. The recipe may be missing ingredients, or it's the wrong one.`, tone: "bad" });
    else if (pct > HIGH_PCT) flags.push({ code: "high", text: `${pctText(pct)} of the price. Check the portion and units, or it's the wrong recipe.`, tone: "bad" });
  }
  if (sizeConflict(item.name, recipe.name)) flags.push({ code: "size", text: `Sizes don't match: “${item.name}” vs “${recipe.name}”.`, tone: "bad" });
  if (recipe.kind === "PREP") flags.push({ code: "kind", text: "That's a prep recipe; sold items link to a menu recipe or add-on.", tone: "bad" });
  else if (item.modifier && recipe.kind === "MENU") flags.push({ code: "kind", text: "An add-on in Square linked to a whole menu item. Fine for sides; check the portion.", tone: "warn" });
  return { cost, pct, flags };
}

/** Bought-in cost: the same checks on a typed cost each. */
export function unitCostEffect(item: LinkItem, unitCost: number): Effect {
  const price = item.price != null && item.price > 0 ? item.price : null;
  const pct = price ? unitCost / price : null;
  const flags: Flag[] = [];
  if (!price) flags.push({ code: "noSquarePrice", text: "Square has no fixed price for this item, so its cost % can't be checked.", tone: "warn" });
  if (pct != null && unitCost > 0 && pct < LOW_PCT) flags.push({ code: "low", text: `Only ${pctText(pct)} of the price. Is that the cost of one?`, tone: "bad" });
  if (pct != null && pct > HIGH_PCT) flags.push({ code: "high", text: `${pctText(pct)} of the price. Is that the cost of one, not a case?`, tone: "bad" });
  return { cost: unitCost, pct, flags };
}

/** Links worth a second look are the ones with a "bad" flag. */
export const suspicious = (e: Effect) => e.flags.some((f) => f.tone === "bad");

/** A high-confidence suggestion that's safe to accept in bulk: sure of the name and nothing looks off. */
export const safeToBulk = (c: Candidate, e: Effect) => bandOf(c.confidence) === "high" && !e.flags.some((f) => f.tone === "bad" || f.code === "noLines");

// ---- Coverage -------------------------------------------------------------------------------

export const COVERAGE_TARGET = 0.9;

export interface Coverage {
  /** Sales with a cost behind them (recipe or bought-in cost). */
  linked: number;
  /** All item sales that count (left-out items excluded). */
  total: number;
  share: number | null;
  target: number;
  /** More dollars to link to reach the target (0 once there). Skipped specials count towards it. */
  toTarget: number;
  unlinkedItems: number;
  /** Sales of items skipped for now (specials nobody wants to cost yet): estimated at a typical cost. */
  skipped: number;
}

/** How much of the period's item sales has a cost behind it. Items left out of sales don't count either way. */
export function coverage(rows: readonly { state: LinkState; sales: number; skipped?: boolean }[], target = COVERAGE_TARGET): Coverage {
  let linked = 0, total = 0, unlinkedItems = 0, skipped = 0;
  for (const r of rows) {
    if (r.state.ignored) continue;
    const s = Math.max(0, r.sales);
    total += s;
    if (r.state.recipeId || r.state.unitCost != null) linked += s;
    else if (r.skipped) skipped += s;
    else if (s > 0) unlinkedItems++;
  }
  const share = total > 0 ? linked / total : null;
  return { linked, total, share, target, toTarget: share == null ? 0 : Math.max(0, target * total - linked - skipped), unlinkedItems, skipped };
}

/** How well a Square item's name agrees with a recipe's (0 to 1), the same reading suggestions use. */
export const linkNameMatch = (item: Pick<LinkItem, "name" | "baseName">, recipeName: string) =>
  Math.max(matchConfidence(item.baseName, recipeName), matchConfidence(item.name, recipeName), nameScore(item.name, recipeName), nameScore(item.baseName, recipeName));

// ---- Words for the history ------------------------------------------------------------------

export function describeState(s: LinkState, recipeName?: string | null): string {
  if (s.ignored) return "Left out of sales";
  if (s.recipeId) return recipeName ?? "a recipe";
  if (s.unitCost != null) return `Bought in at $${s.unitCost.toFixed(2)} each`;
  return "Not linked";
}

export const sameState = (a: LinkState, b: LinkState) =>
  (a.recipeId ?? null) === (b.recipeId ?? null) && !!a.ignored === !!b.ignored && (a.unitCost == null ? null : Math.round(a.unitCost * 100)) === (b.unitCost == null ? null : Math.round(b.unitCost * 100)) && (a.costClass ?? null) === (b.costClass ?? null);

// ---- Inside recipes -------------------------------------------------------------------------

const HOUSE_MADE = /\b(house|homemade|sauce|aioli|mayo|dressing|vinaigrette|pickled?|pickles|brine|rub|marinade|marinated|dough|batter|stock|broth|gravy|jam|compote|syrup|slaw|coleslaw|salsa|pesto|chutney|relish|confit|braised|smoked|roasted|candied|whipped|prepped|cooked|pulled|croutons?|crumbs?|frizzled|caramelized|seasoning|spice mix|blend|beer cheese|queso)\b/i;

/** Sauces you buy, not make. A brand in brackets ("Sweet chili sauce (Mae Ploy)") also means bought. */
const BOUGHT = /\b(worcestershire|soy|fish sauce|oyster sauce|hoisin|sriracha|tabasco|frank'?s|ketchup|hot sauce|pickle juice|ken'?s|heinz|hellmann'?s|kewpie)\b|\(/i;

/** The name sounds like something made in the kitchen ("House Pickles", "Garlic Aioli", "Pulled Pork"). */
export const looksHouseMade = (name: string) => HOUSE_MADE.test(String(name ?? "")) && !BOUGHT.test(String(name ?? ""));

/** A prep recipe that is probably the same thing as this ingredient ("Garlic Aioli" ingredient ↔ "Garlic Aioli" prep). */
export function prepTwin(ingredientName: string, preps: readonly { id: string; name: string }[]): { id: string; name: string } | null {
  let best: { id: string; name: string; c: number } | null = null;
  for (const p of preps) {
    const c = Math.max(matchConfidence(ingredientName, p.name), nameScore(ingredientName, p.name));
    if (c >= 0.8 && (!best || c > best.c)) best = { ...p, c };
  }
  return best ? { id: best.id, name: best.name } : null;
}
