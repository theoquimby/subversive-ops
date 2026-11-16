/**
 * Linking brewing recipe lines to ingredients. Recipes imported from Brew
 * Manager have line names ("Pils, Hudson Valley Malt (NYS)") but no ingredient,
 * so they count toward no stock, ordering or cost. This works out which
 * ingredient each line is, by a name made from the line. Pure; the service
 * (services/brewIngredientLink.ts) reads and writes the database.
 *
 * Naming scheme, one per ingredient:
 *
 *   <Variety> <malt | hops | yeast> (NYS) · <Supplier>
 *
 * - The kind word is added for grain, hop and yeast lines, unless the variety
 *   already says it ("Chit Malt", "Flaked oats", "Hop extract", "House yeast").
 * - "(NYS)" (New York grown) stays in the name, as a New York farm brewery
 *   counts it; "(NON_NYS)" reads "(not NYS)"; no origin, nothing.
 * - The supplier comes after "·", spelled out from Brew Manager's short names
 *   (NYHG → NY Hop Guild, HVM → Hudson Valley Malt, MoreBeerPro → MoreBeer).
 *   Several (a yeast co-pitch) are joined with "+". A lab in brackets that the
 *   supplier already names goes ("Helio Gazer (Omega), Omega Yeast" → "Helio
 *   Gazer yeast · Omega Yeast"); with no supplier given, it becomes the supplier.
 * - Other lines (adjuncts, water salts, spices) are their name as written,
 *   cleaned, with " · <Supplier>" only when the part after the last comma is a
 *   known supplier. Spices Brew Manager kept with the hops are not called hops.
 *
 * Examples: "Pils malt (NYS) · Hudson Valley Malt", "Munich malt (NYS) ·
 * Subversive", "Cascade hops (NYS) · NY Hop Guild", "Tettnang hops",
 * "Philly Sour yeast · MoreBeer", "Pickling spice".
 *
 * The key is the name in lower case without punctuation, so the same malt from
 * the same maltster in many recipes is one ingredient, while "Cascade (NYS)"
 * and "Cascade", or the same variety from two suppliers, stay apart.
 */

import { foldName } from "./brewImport";
import { type BrewLineKind } from "./brewMath";
import { baseUnitForBrewUnit, brewToBase, categoryForKind } from "./brewRecipes";
import type { BaseUnit, CustomConversion } from "./units";

export interface LinkLine {
  kind: BrewLineKind | string;
  name: string;
  unit: string;
}

export interface IngredientIdentity {
  key: string;
  name: string;
  category: "Malt" | "Hops" | "Yeast" | "Brewing";
  baseUnit: BaseUnit;
  /** The supplier this is bought from, by name (a known brewery supplier, or as written); null for none or Subversive's own malt */
  supplierHint: string | null;
}

/** Brewery suppliers Brew Manager names by short names. */
const KNOWN: { name: string; test: RegExp }[] = [
  { name: "Hudson Valley Malt", test: /hudson\s*valley|\bhvm\b/i },
  { name: "NY Hop Guild", test: /\bnyhg\b|hop\s*guild/i },
  { name: "Yakima Quality Hops", test: /yakima/i },
  { name: "Omega Yeast", test: /\bomega\b/i },
  { name: "MoreBeer", test: /more\s*beer|lallemand/i },
];
/** Subversive malts its own grain: no outside supplier. */
const OWN = /\bsubversive\b/i;

/** The brewery supplier a name or short name means ("NYHG" → "NY Hop Guild"), or null. "NYS" is an origin, not Hudson Valley Malt. */
export function knownBrewSupplier(text: string): string | null {
  return KNOWN.find((k) => k.test.test(text ?? ""))?.name ?? null;
}

const ORIGIN = /\(\s*(non[\s_-]*nys|nys)\s*\)/gi;
const GRAINISH = /malt|flake|\boats?\b|\bhulls?\b|\brice\b|\bcorn\b|maize|sugar|syrup|honey|dextrose|lactose|candi|torrif|\braw\b|grits|extract|\bdme\b|\blme\b/i;
const NOT_HOP =
  /\b(?:pickling|spices?|peels?|zest|coriander|salt|sugar|honey|fruit|pur[eé]e|tea|coffee|cacao|cocoa|vanilla|cinnamon|ginger|limes?|lemons?|oranges?|grapefruits?|peppers?|peppercorns?|chil[ei]s?|juice|lactose|nibs|cloves?|nutmeg|anise|lavender|hibiscus|chamomile|mint|basil|juniper|spruce|sage|thyme|rosemary|cucumbers?|\w*berr(?:y|ies)|cherr(?:y|ies)|peach(?:es)?|mangos?|mangoes|pineapples?|passion\s*fruit|guava|apricots?|plums?|maple|molasses|cardamom)\b/i;

const squash = (s: string) => s.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
const tidy = (s: string) => squash(s).replace(/^[\s,+\-–]+|[\s,+\-–]+$/g, "").trim();
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const MAX_NAME = 120;

/** Supplier text → its parts, short names spelled out: "Omega Yeast + MoreBeerPro" → ["Omega Yeast", "MoreBeer"]. */
function supplierParts(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s*(?:\+|\/|&)\s*/)) {
    const p = tidy(raw);
    if (!p) continue;
    const name = knownBrewSupplier(p) ?? p;
    if (!out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

const hintOf = (part: string | undefined): string | null => (!part || OWN.test(part) ? null : part);

/** The ingredient a recipe line is: its name, key, category, base unit and supplier. Null when the line has no name. */
export function brewIngredientIdentity(line: LinkLine): IngredientIdentity | null {
  let s = squash(line.name ?? "");
  if (!s) return null;

  // Where it was grown, from anywhere in the name.
  let origin: "NYS" | "not NYS" | null = null;
  s = s.replace(ORIGIN, (_m, o: string) => {
    origin = /non/i.test(o) || origin === "not NYS" ? "not NYS" : "NYS";
    return " ";
  });
  s = squash(s);

  // Variety and supplier: Brew Manager writes "<variety>, <supplier>".
  const kind = String(line.kind);
  const named = kind === "grain" || kind === "hop" || kind === "yeast";
  let base = s;
  let sup = "";
  const comma = s.lastIndexOf(",");
  if (comma > 0) {
    const after = tidy(s.slice(comma + 1));
    if (after && (named || knownBrewSupplier(after) || OWN.test(after))) {
      base = tidy(s.slice(0, comma));
      sup = after;
    }
  }
  let parts = sup ? supplierParts(sup) : [];

  // A lab in brackets: dropped when the supplier names it, the supplier when none is given.
  base = base.replace(/\(([^)]*)\)/g, (m, inner: string) => {
    const k = knownBrewSupplier(inner);
    if (!k) return m;
    if (!parts.length) {
      parts = [k];
      return " ";
    }
    return parts.includes(k) ? " " : m;
  });
  if (kind === "yeast") base = base.replace(/\bco-?\s?pitch(?:ed)?\b/gi, " ");
  base = capFirst(tidy(base));
  if (!base) return null;

  const effective: BrewLineKind = kind === "hop" && NOT_HOP.test(base) ? "other" : ((["grain", "hop", "yeast", "adjunct", "water", "other"].includes(kind) ? kind : "other") as BrewLineKind);
  const word =
    effective === "grain" ? (GRAINISH.test(base) ? "" : "malt") : effective === "hop" ? (/\bhops?\b/i.test(base) ? "" : "hops") : effective === "yeast" ? (/yeast/i.test(base) ? "" : "yeast") : "";

  const name = [base, word, origin ? `(${origin})` : ""].filter(Boolean).join(" ") + (parts.length ? ` · ${parts.join(" + ")}` : "");
  const short = name.length > MAX_NAME ? name.slice(0, MAX_NAME).trim() : name;
  const supplierHint = parts.length ? hintOf(parts[0]) : OWN.test(base) ? null : knownBrewSupplier(base);
  return { key: ingredientKey(short), name: short, category: categoryForKind(effective), baseUnit: baseUnitForBrewUnit(line.unit), supplierHint };
}

/** Lower case, no accents or punctuation: names that differ only in those are the same ingredient. */
export const ingredientKey = (name: string) => foldName(name);

/** The product code for an ingredient made from recipe lines, at its supplier: "BM-CASCADE-HOPS-NYS-NY-HOP-GUILD". */
export const productSkuFor = (key: string) => `BM-${key.trim().replace(/\s+/g, "-").toUpperCase()}`.slice(0, 100);

/** How a brewery supplier sells it, until a price sheet says otherwise: by the pound, the gallon or the package. */
export function purchaseUnitFor(base: BaseUnit): { unit: "lb" | "gal" | "pkg"; packQtyBase: number } {
  return base === "g" ? { unit: "lb", packQtyBase: 453.592 } : base === "ml" ? { unit: "gal", packQtyBase: 3785.41 } : { unit: "pkg", packQtyBase: 1 };
}

/** The line's unit works for this ingredient (a standard conversion, or one the ingredient has). */
export function fitsUnit(unit: string, base: BaseUnit, conversions: readonly CustomConversion[]): boolean {
  try {
    return Number.isFinite(brewToBase(1, unit, base, conversions));
  } catch {
    return false;
  }
}

const MEASURED: Record<BaseUnit, { is: string; say: string }> = {
  g: { is: "weighed", say: "weighs" },
  ml: { is: "measured by volume", say: "holds" },
  each: { is: "counted", say: "is in packages" },
};

export function unitMismatchWhy(unit: string, ingredient: string, base: BaseUnit): string {
  const m = MEASURED[base];
  return base === "each"
    ? `It's in ${unit}, but ${ingredient} is counted. Say how many 1 ${unit} is on the ingredient, then match it on the recipe.`
    : `It's in ${unit}, but ${ingredient} is ${m.is}. Say what 1 ${unit} ${m.say} on the ingredient, then match it on the recipe.`;
}

// ---- Planning ---------------------------------------------------------------------------

export interface PlanLine {
  id: string;
  /** The recipe's name, for saying which line was left */
  recipe: string;
  kind: string;
  name: string;
  unit: string;
}

export interface PlanIngredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  conversions: CustomConversion[];
}

export interface LinkPlan {
  /** New ingredients, in the order first met */
  creates: IngredientIdentity[];
  /** Each line to link: to an existing ingredient, or (ingredientId null) to the new one with this key */
  links: { lineId: string; key: string; ingredientId: string | null }[];
  /** Existing ingredients linked to */
  reused: string[];
  left: { lineId: string; recipe: string; line: string; why: string }[];
  /** Each key's identity (for the supplier) */
  identities: Map<string, IngredientIdentity>;
}

/**
 * Which ingredient each unlinked line goes to. An ingredient already named so
 * (any case or punctuation, any department) is used, else one with the line's
 * own name; otherwise a new one, measured the way most of its lines are. A line
 * whose unit doesn't fit its ingredient (cups of a weighed spice) is left, with why.
 */
export function planBrewIngredientLinks(lines: readonly PlanLine[], ingredients: readonly PlanIngredient[]): LinkPlan {
  const byKey = new Map<string, PlanIngredient>();
  for (const i of ingredients) {
    const k = ingredientKey(i.name);
    if (k && !byKey.has(k)) byKey.set(k, i);
  }
  const exact = new Map(ingredients.map((i) => [i.name.trim().toLowerCase(), i]));

  const groups = new Map<string, { identity: IngredientIdentity; lines: PlanLine[] }>();
  const plan: LinkPlan = { creates: [], links: [], reused: [], left: [], identities: new Map() };
  for (const l of lines) {
    const identity = brewIngredientIdentity(l);
    if (!identity || !identity.key) {
      plan.left.push({ lineId: l.id, recipe: l.recipe, line: l.name, why: "It has no name to match." });
      continue;
    }
    const g = groups.get(identity.key);
    if (g) g.lines.push(l);
    else groups.set(identity.key, { identity, lines: [l] });
  }

  const target = new Map<string, { ingredientId: string | null; name: string; baseUnit: BaseUnit; conversions: readonly CustomConversion[] }>();
  for (const [key, g] of groups) {
    plan.identities.set(key, g.identity);
    const found = exact.get(g.identity.name.toLowerCase()) ?? byKey.get(key) ?? g.lines.map((l) => byKey.get(ingredientKey(l.name))).find(Boolean);
    if (found) {
      target.set(key, { ingredientId: found.id, name: found.name, baseUnit: found.baseUnit, conversions: found.conversions });
      continue;
    }
    // Most lines decide how it's measured; a tie goes to the first line.
    const votes = new Map<BaseUnit, number>();
    for (const l of g.lines) votes.set(baseUnitForBrewUnit(l.unit), (votes.get(baseUnitForBrewUnit(l.unit)) ?? 0) + 1);
    let baseUnit = g.identity.baseUnit;
    for (const [b, n] of votes) if (n > (votes.get(baseUnit) ?? 0)) baseUnit = b;
    target.set(key, { ingredientId: null, name: g.identity.name, baseUnit, conversions: [] });
  }

  const created = new Set<string>();
  const reused = new Set<string>();
  for (const l of lines) {
    const identity = brewIngredientIdentity(l);
    const t = identity?.key ? target.get(identity.key) : undefined;
    if (!identity || !t) continue;
    if (!fitsUnit(l.unit, t.baseUnit, t.conversions)) {
      plan.left.push({ lineId: l.id, recipe: l.recipe, line: l.name, why: unitMismatchWhy(l.unit, t.name, t.baseUnit) });
      continue;
    }
    plan.links.push({ lineId: l.id, key: identity.key, ingredientId: t.ingredientId });
    if (t.ingredientId) reused.add(t.ingredientId);
    else if (!created.has(identity.key)) {
      created.add(identity.key);
      plan.creates.push({ ...groups.get(identity.key)!.identity, baseUnit: t.baseUnit });
    }
  }
  plan.reused = [...reused];
  // Left lines in recipe order, like the lines.
  const order = new Map(lines.map((l, i) => [l.id, i]));
  plan.left.sort((a, b) => (order.get(a.lineId) ?? 0) - (order.get(b.lineId) ?? 0));
  return plan;
}

// ---- What happened ------------------------------------------------------------------------

export interface LinkSummary {
  ingredientsCreated: number;
  ingredientsReused: number;
  linesLinked: number;
  linesLeft: { recipe: string; line: string; why: string }[];
  /** Products set up at a brewery supplier, so ordering knows who to order from */
  productsCreated: number;
}

export const EMPTY_LINK_SUMMARY: LinkSummary = { ingredientsCreated: 0, ingredientsReused: 0, linesLinked: 0, linesLeft: [], productsCreated: 0 };

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "Linked 118 recipe lines to 47 ingredients (40 new); 3 left: Pickling spice in Gose, …" */
export function linkSummaryText(s: LinkSummary): string {
  const ings = s.ingredientsCreated + s.ingredientsReused;
  const left = s.linesLeft.length;
  if (!s.linesLinked && !left) return "Every recipe line is already linked to an ingredient.";
  const head = s.linesLinked ? `Linked ${n(s.linesLinked, "recipe line")} to ${n(ings, "ingredient")}${s.ingredientsCreated ? ` (${s.ingredientsCreated} new)` : ""}` : "No lines linked";
  if (!left) return `${head}.`;
  const shown = s.linesLeft.slice(0, 3).map((l) => `${l.line} in ${l.recipe}`);
  return `${head}; ${left} left: ${shown.join(", ")}${left > 3 ? `, and ${left - 3} more` : ""}.`;
}
