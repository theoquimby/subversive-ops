/**
 * Recipe drafting: propose ingredient lines for a dish Max hasn't costed yet.
 *
 * Three ways in, one output shape (`Draft`) that a person reviews before
 * anything is saved:
 *  - `draftFromSimilar` — no AI. Start from the most similar existing recipe
 *    ("Bacon Burger" ← Classic Burger), swap/add/remove lines for the words
 *    that differ, scale counts ("Wings (10)" ← Wings (6)), and add what the
 *    Square description mentions.
 *  - `parseRecipeText` — no AI. A recipe typed in Notes or a brewing sheet.
 *  - `resolveAiDraft` — turns Claude's structured answer (names as text) into
 *    lines pointing at real ingredients, with units that convert.
 *
 * Lines point at existing ingredients / prep recipes wherever possible; a line
 * that needs something Max doesn't buy yet carries `newName` instead.
 */

import { splitQtyUnit } from "./quickAdd";
import { BaseUnit, canConvert, CustomConversion, normalizeUnit, standardUnit, toBase } from "./units";

// ---- Types ------------------------------------------------------------------------

export type DraftKind = "MENU" | "MODIFIER" | "PREP";

/** Something a line can use: an ingredient ("i:<id>") or a prep recipe ("r:<id>"). */
export interface DraftItem {
  key: string;
  name: string;
  kind: "ingredient" | "recipe";
  category: string;
  baseUnit: BaseUnit;
  conversions: CustomConversion[];
  /** Units offered for this item, first = default. */
  units: string[];
  /** Cost per usable base unit (ingredients) or per yield base unit (prep recipes); null = no price yet. */
  costPerBase: number | null;
}

/** An existing recipe, used as an example to draft from. */
export interface ExampleRecipe {
  id: string;
  name: string;
  kind: DraftKind;
  category: string;
  menuPrice: number | null;
  yieldQty: number;
  yieldUnit: string;
  lines: { itemKey: string; qty: number; unit: string }[];
}

/** What we're drafting for: a Square item, an empty recipe, or a typed name. */
export interface DraftTarget {
  name: string;
  kind: DraftKind;
  category?: string | null;
  description?: string | null;
  /** Modifier list names / options from Square, for context. */
  modifiers?: string[];
  price?: number | null;
  /** Don't use this recipe as an example (it's the one being drafted). */
  excludeRecipeId?: string | null;
}

export interface DraftLine {
  /** Existing ingredient / prep recipe, or null when it needs a new ingredient. */
  itemKey: string | null;
  /** Name for a new ingredient (only when itemKey is null). */
  newName?: string | null;
  newBaseUnit?: BaseUnit | null;
  qty: number;
  unit: string;
  /** Why this line is here / what to check, in plain English. */
  note?: string | null;
}

export type DraftMethod = "similar" | "keywords" | "ai" | "photo" | "text";

export interface Draft {
  name: string;
  kind: DraftKind;
  category: string;
  menuPrice: number | null;
  yieldQty: number;
  yieldUnit: string;
  lines: DraftLine[];
  /** Existing recipes this was drafted from, most similar first. */
  basis: string[];
  method: DraftMethod;
  notes: string | null;
  /** Things the reviewer should know ("Nothing similar yet…"). */
  warnings: string[];
}

// ---- Words ------------------------------------------------------------------------

const STOP = new Set(["the", "and", "with", "w", "a", "an", "of", "on", "in", "or", "for", "to", "our", "your", "made", "fresh", "served", "topped", "choice", "side"]);
/** Dish words: help find similar recipes but never mean an ingredient on their own. */
const GENERIC = new Set(["burger", "sandwich", "salad", "wrap", "plate", "platter", "bowl", "basket", "order", "kid", "kids", "lil", "little", "small", "medium", "large", "regular", "half", "full", "single", "double", "triple", "pint", "pour", "growler", "crowler", "glass", "can", "bottle", "draft", "draught", "combo", "special", "classic", "new", "add", "extra", "sub", "substitute", "no", "style", "item", "addon", "on", "modifier", "dish", "sauce", "slider"]);
const PACK = /^(\d+([.,/]\d+)?(x\d+)?(ct|pk|oz|lb|lbs|in|mic|ply|gal|g|kg|ml|l|ft|yd|cs)?|ct|pk|cs|ea|ply|mic|lbs?|gal|oz|in|ft|yd|iw)$/;
const NON_FOOD = /clean|suppl|test/i;

/** Lowercase word stems: "Tomatoes, diced" → ["tomato", "diced"]. Numbers and pack sizes dropped. */
export function words(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/#\d+/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w) && !PACK.test(w))
    .map(stem);
}

const SYNONYM: Record<string, string> = { bbq: "barbecue", bleu: "blue", parm: "parmesan", mozz: "mozzarella", shroom: "mushroom", shrooms: "mushroom", chix: "chicken", jalapeno: "jalapeno", ff: "fries", wing: "wing", tender: "tender", patty: "patty", patties: "patty" };

function stem(raw: string): string {
  const w = SYNONYM[raw] ?? raw;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

const idfOf = (docs: string[][]) => {
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length + 1;
  return (w: string) => Math.log(1 + n / (1 + (df.get(w) ?? 0)));
};

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ---- Matching a phrase to an ingredient ---------------------------------------------

export interface ItemIndex {
  items: DraftItem[];
  byKey: Map<string, DraftItem>;
  tokens: Map<string, string[]>;
  idf: (w: string) => number;
  /** How many example recipes use each item. */
  usage: Map<string, number>;
}

export function indexItems(items: DraftItem[], examples: ExampleRecipe[] = []): ItemIndex {
  const tokens = new Map(items.map((i) => [i.key, words(i.name)]));
  const usage = new Map<string, number>();
  for (const r of examples) for (const k of new Set(r.lines.map((l) => l.itemKey))) usage.set(k, (usage.get(k) ?? 0) + 1);
  return { items, byKey: new Map(items.map((i) => [i.key, i])), tokens, idf: idfOf([...tokens.values()]), usage };
}

const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

/**
 * The ingredient or prep recipe a phrase most likely means, with a 0–1
 * confidence. "ground beef" → Ground beef (Kilcoyne); "2-row malt" → null.
 */
export function matchItem(phrase: string, ix: ItemIndex, minConfidence = 0.55): { item: DraftItem; confidence: number } | null {
  const q = [...new Set(words(phrase))];
  if (!q.length) return null;
  const exact = phrase.trim().toLowerCase();
  let best: { item: DraftItem; confidence: number; score: number } | null = null;
  for (const item of ix.items) {
    if (NON_FOOD.test(item.category)) continue;
    if (item.name.toLowerCase() === exact) return { item, confidence: 1 };
    const t = ix.tokens.get(item.key)!;
    const common = q.filter((w) => t.some((x) => sameWord(w, x)));
    if (!common.length) continue;
    const wq = sum(q.map(ix.idf));
    const wc = sum(common.map(ix.idf));
    const wt = sum(t.map(ix.idf));
    const coverage = wc / wq;
    const dice = (2 * wc) / (wq + wt);
    const confidence = Math.min(0.99, 0.6 * coverage + 0.4 * dice + (q.join(" ") === t.join(" ") ? 0.2 : 0));
    const score = confidence + Math.log1p(ix.usage.get(item.key) ?? 0) * 0.03 + (item.kind === "recipe" ? 0.01 : 0);
    if (!best || score > best.score) best = { item, confidence, score };
  }
  return best && best.confidence >= minConfidence ? { item: best.item, confidence: round(best.confidence) } : null;
}

// ---- Units --------------------------------------------------------------------------

const FRIENDLY: Record<BaseUnit, string> = { g: "oz", ml: "fl oz", each: "each" };

/** The default unit for an item: a custom unit for "each" items (slice, bun), else oz / fl oz / each. */
export function defaultUnit(item: Pick<DraftItem, "baseUnit" | "units" | "conversions">): string {
  if (item.baseUnit === "each") return item.conversions[0]?.unit ?? "each";
  return item.units.includes(FRIENDLY[item.baseUnit]) ? FRIENDLY[item.baseUnit] : item.units[0] ?? FRIENDLY[item.baseUnit];
}

/**
 * Keep the unit when it converts for this item; otherwise fall back to the
 * item's default and say so. Spelling follows the item's own unit list.
 */
export function chooseUnit(item: Pick<DraftItem, "baseUnit" | "units" | "conversions">, unit?: string | null): { unit: string; changed: boolean } {
  if (unit) {
    const u = normalizeUnit(unit);
    const alias: Record<string, string> = { ounce: "oz", ounces: "oz", pound: "lb", pounds: "lb", lbs: "lb", "fl. oz": "fl oz", floz: "fl oz", tablespoon: "tbsp", teaspoon: "tsp", cups: "cup", ea: "each", pc: "each", pcs: "each", piece: "each", pieces: "each", grams: "g", gram: "g", liter: "l", litre: "l", gallon: "gal", gallons: "gal", quart: "qt", quarts: "qt", barrel: "bbl", barrels: "bbl", hectoliter: "hl" };
    const cand = [u, alias[u], u.endsWith("s") ? u.slice(0, -1) : null].filter((x): x is string => !!x);
    for (const c of cand) {
      const own = item.units.find((x) => normalizeUnit(x) === c) ?? item.conversions.find((x) => normalizeUnit(x.unit) === c)?.unit;
      if (own) return { unit: own, changed: false };
      if (canConvert(c, item.baseUnit, item.conversions)) return { unit: c, changed: false };
    }
  }
  return { unit: defaultUnit(item), changed: !!unit };
}

/** Cost of one line, or null (no price / unit doesn't convert / new ingredient). */
export function lineCost(line: DraftLine, ix: Pick<ItemIndex, "byKey">): number | null {
  const item = line.itemKey ? ix.byKey.get(line.itemKey) : null;
  if (!item || item.costPerBase == null || !(line.qty > 0)) return null;
  try {
    return toBase(line.qty, line.unit, item.baseUnit, item.conversions) * item.costPerBase;
  } catch {
    return null;
  }
}

/** Estimated plate (or batch) cost, and food cost % against the price. */
export function draftCost(draft: Pick<Draft, "lines" | "menuPrice" | "kind">, ix: Pick<ItemIndex, "byKey">) {
  const costs = draft.lines.map((l) => lineCost(l, ix));
  const total = round(sum(costs.map((c) => c ?? 0)), 4);
  const missing = costs.filter((c) => c == null).length;
  return { total, missing, lines: costs, foodCostPct: draft.kind !== "PREP" && draft.menuPrice && draft.menuPrice > 0 && total > 0 ? total / draft.menuPrice : null };
}

// ---- Similar recipes --------------------------------------------------------------

const normCat = (c?: string | null) => (c ?? "").trim().toLowerCase().replace(/s$/, "");

export interface Neighbour { recipe: ExampleRecipe; score: number }

/** Existing recipes most like the target (name words, dish type, category, price). */
export function similarRecipes(target: DraftTarget, examples: ExampleRecipe[], k = 3): Neighbour[] {
  const drink = isDrink(target.name, target.category);
  const pool = examples.filter((r) => r.id !== target.excludeRecipeId && r.lines.length > 0 && (target.kind === "PREP" ? r.kind === "PREP" : r.kind !== "PREP") && (target.kind === "PREP" || isDrink(r.name, r.category) === drink));
  const tw = words(target.name);
  if (!tw.length) return [];
  const idf = idfOf(pool.map((r) => words(r.name)));
  const head = tw[tw.length - 1];
  const out: Neighbour[] = [];
  for (const r of pool) {
    const rw = words(r.name);
    if (!rw.length) continue;
    const common = [...new Set(tw)].filter((w) => rw.some((x) => sameWord(w, x)));
    const wt = sum([...new Set(tw)].map(idf));
    const wr = sum([...new Set(rw)].map(idf));
    let score = (2 * sum(common.map(idf))) / (wt + wr);
    if (!common.length && normCat(target.category) !== normCat(r.category)) continue;
    if (rw.some((x) => sameWord(x, head))) score += 0.15;
    if (target.category && normCat(target.category) === normCat(r.category)) score += 0.1;
    if (target.price && r.menuPrice) score += 0.08 * Math.max(0, 1 - Math.abs(Math.log(target.price / r.menuPrice)));
    out.push({ recipe: r, score: round(score, 3) });
  }
  return out.sort((a, b) => b.score - a.score || a.recipe.lines.length - b.recipe.lines.length).slice(0, k);
}

/** Median quantity an item is used in, in its most common unit (from existing recipes). */
export function typicalUse(itemKey: string, examples: ExampleRecipe[], kind?: DraftKind): { qty: number; unit: string } | null {
  const uses = examples.filter((r) => !kind || (kind === "PREP") === (r.kind === "PREP")).flatMap((r) => r.lines.filter((l) => l.itemKey === itemKey));
  if (!uses.length) return null;
  const byUnit = new Map<string, number[]>();
  for (const u of uses) byUnit.set(u.unit, [...(byUnit.get(u.unit) ?? []), u.qty]);
  const [unit, qs] = [...byUnit].sort((a, b) => b[1].length - a[1].length)[0];
  const s = [...qs].sort((a, b) => a - b);
  return { qty: s[Math.floor((s.length - 1) / 2)], unit };
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12, dozen: 12 };

/** "Wings (10)", "10 pc wings", "Half dozen wings" → 10 / 10 / 6. */
export function countIn(name: string): number | null {
  const s = name.toLowerCase().replace(/#\d+/g, "");
  if (/half[\s-]dozen/.test(s)) return 6;
  const m = s.match(/\((\d{1,3})\)|\b(\d{1,3})\s*(?:pc|pcs|piece|pieces|ct|count|wings?|tenders?|sliders?)\b/);
  if (m) return Number(m[1] ?? m[2]);
  for (const [w, n] of Object.entries(WORD_NUM)) if (new RegExp(`\\b${w}\\b`).test(s)) return n;
  return null;
}

const MULTIPLIER: Record<string, number> = { double: 2, triple: 3 };
/** The main protein of a dish (the patty, the chicken), not bacon on top. */
const isProtein = (it: DraftItem) => /\b(beef|patty|patties|chicken|pork|impossible|beyond|tofu|tempeh|seitan|salmon|fish|shrimp|steak|brisket|turkey|veggie burger)\b/i.test(it.name);

const DRINK_WORDS = /\b(beer|ipa|neipa|dipa|lager|pils|pilsner|stout|porter|sour|gose|saison|ale|kolsch|hefe|hefeweizen|wit|bock|cider|seltzer|mead|wine|cocktail|spritz|mule|margarita|soda|lemonade|tea|coffee|growler|crowler|pint|half pour|taster|flight|draft|draught|on tap|can|bottle)\b/i;
/** A drink rather than a plate: drafted only from other drinks. */
export function isDrink(name: string, category?: string | null): boolean {
  return DRINK_WORDS.test(name) || /beer|drink|bev|cocktail|wine|cider|bar|tap/i.test(category ?? "");
}

/** Pour size in fl oz from the name: "(Pint)" 16, "Half pour" 8, "Crowler" 32, "Growler" 64, "12 oz" 12. */
export function pourSize(name: string): number | null {
  const s = name.toLowerCase();
  const oz = s.match(/(\d{1,2}(?:\.\d)?)\s*(?:fl\.?\s*)?oz\b/);
  if (oz) return Number(oz[1]);
  if (/\bcrowler\b/.test(s)) return 32;
  if (/\bhalf[- ]growler\b/.test(s)) return 32;
  if (/\bgrowler\b/.test(s)) return 64;
  if (/\bhalf[- ]?(pour|pint)\b|\btaster\b/.test(s)) return 8;
  if (/\bpint\b/.test(s)) return 16;
  return null;
}

/** The protein most used in a category's recipes ("Burgers" → ground beef). */
function commonProtein(examples: ExampleRecipe[], ix: ItemIndex, category: string, except: string): DraftItem | null {
  const n = new Map<string, number>();
  for (const r of examples) {
    if (normCat(r.category) !== normCat(category)) continue;
    for (const l of r.lines) {
      const it = ix.byKey.get(l.itemKey);
      if (it && it.key !== except && isProtein(it)) n.set(it.key, (n.get(it.key) ?? 0) + 1);
    }
  }
  const top = [...n].sort((a, b) => b[1] - a[1])[0];
  return top ? ix.byKey.get(top[0]) ?? null : null;
}

/** Split a description into ingredient-ish phrases. */
export function descriptionPhrases(text: string): string[] {
  return text
    .replace(/\([^)]*\)/g, " ")
    .split(/[,;.\n•|]|\band\b|\bwith\b|\bon an?\b|\bon\b|\bw\/|\btopped\b|\bserved\b|\+/i)
    .map((p) => p.replace(/^\s*(a|an|the|some|our|house[- ]made|homemade|fresh|choice of)\s+/i, "").trim())
    .filter((p) => p.length > 1 && p.length < 60);
}

/** Words in `a` not in `b`, grouped into runs: "bacon blue cheese burger" − "classic burger" → ["bacon blue cheese"]. */
function extraPhrases(aName: string, b: string[]): string[] {
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const w of words(aName)) {
    if (b.some((x) => sameWord(w, x)) || GENERIC.has(w)) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(w);
  }
  if (cur.length) runs.push(cur);
  return runs.map((r) => r.join(" "));
}

/** Items for a phrase: the whole phrase if it matches well, else word by word. */
function itemsForPhrase(phrase: string, ix: ItemIndex): DraftItem[] {
  const whole = matchItem(phrase, ix, 0.7);
  if (whole) return [whole.item];
  const ws = phrase.split(" ");
  if (ws.length === 1) return [];
  return ws.map((w) => matchItem(w, ix, 0.6)?.item).filter((x): x is DraftItem => !!x);
}

const dimensionOfLine = (l: DraftLine, ix: ItemIndex): BaseUnit | null => (l.itemKey ? ix.byKey.get(l.itemKey)?.baseUnit ?? null : null);

function portionFor(item: DraftItem, examples: ExampleRecipe[], kind: DraftKind): { qty: number; unit: string; typical: boolean } {
  const t = typicalUse(item.key, examples, kind) ?? typicalUse(item.key, examples);
  if (t) return { ...t, typical: true };
  const unit = defaultUnit(item);
  return { qty: 1, unit, typical: false };
}

/**
 * Draft without AI: copy the most similar recipe and adjust it for the words
 * that differ, the count in the name, "double", and the description.
 */
export function draftFromSimilar(target: DraftTarget, examples: ExampleRecipe[], ix: ItemIndex): Draft {
  const pool = examples.filter((r) => r.id !== target.excludeRecipeId);
  // "Side of X" copies only other sides; "Beef or Chicken" drafts the first choice.
  const isSide = /^\s*side of\b/i;
  const near = similarRecipes({ ...target, name: target.name.replace(/\s+or\s+.*$/i, "") }, pool, 12).filter((n) => (isSide.test(target.name) ? isSide.test(n.recipe.name) : !isSide.test(n.recipe.name) || normCat(n.recipe.category) === normCat(target.category))).slice(0, 3);
  const best = near[0] && near[0].score >= 0.3 ? near[0].recipe : null;
  const warnings: string[] = [];
  let lines: DraftLine[] = [];
  const kind = target.kind;
  const modifier = kind === "MODIFIER" || /^\s*(add|extra|sub)\b/i.test(target.name);

  const addItem = (item: DraftItem, why: string) => {
    if (lines.some((l) => l.itemKey === item.key)) return;
    const p = portionFor(item, pool, kind);
    lines.push({ itemKey: item.key, qty: p.qty, unit: p.unit, note: p.typical ? `${why} — your usual portion` : `${why} — portion is a guess, check it` });
  };

  if (/^\s*no\b/i.test(target.name)) {
    warnings.push("Takes something off the plate, so it usually costs nothing extra.");
  } else if (best && !modifier) {
    lines = best.lines.map((l) => ({ itemKey: l.itemKey, qty: l.qty, unit: l.unit, note: null }));
    const bw = words(best.name);
    const tw = words(target.name);
    // Lines for words the example has and the target doesn't ("Mushroom & Swiss" → mushroom lines).
    const missing = bw.filter((w) => !tw.some((x) => sameWord(w, x)) && !GENERIC.has(w));
    const removed: DraftLine[] = [];
    if (missing.length) {
      lines = lines.filter((l) => {
        const t = ix.tokens.get(l.itemKey ?? "") ?? [];
        const hit = missing.some((w) => t.some((x) => sameWord(w, x)));
        if (hit) removed.push(l);
        return !hit;
      });
    }
    const nameOf = (k: string | null) => (k ? ix.byKey.get(k)?.name ?? "the original" : "the original");
    const has = (k: string) => lines.some((l) => l.itemKey === k);
    // Words the target has.
    for (const phrase of extraPhrases(target.name, bw)) {
      const pw = phrase.split(" ");
      // "Vegan" + Garlic Aioli → Vegan Garlic Aioli: a variant of a line already there.
      const vi = lines.findIndex((l) => {
        const lt = ix.tokens.get(l.itemKey ?? "") ?? [];
        const v = lt.length ? matchItem(`${phrase} ${nameOf(l.itemKey)}`, ix, 0.8) : null;
        if (!v || v.item.key === l.itemKey || has(v.item.key)) return false;
        const vt = ix.tokens.get(v.item.key)!;
        return pw.every((w) => vt.some((x) => sameWord(w, x))) && lt.every((w) => vt.includes(w));
      });
      if (vi >= 0) {
        const old = lines[vi];
        const v = matchItem(`${phrase} ${nameOf(old.itemKey)}`, ix, 0.8)!.item;
        lines[vi] = { itemKey: v.key, qty: old.qty, unit: chooseUnit(v, old.unit).unit, note: `for "${phrase}", in place of ${nameOf(old.itemKey)}` };
        continue;
      }
      for (const item of itemsForPhrase(phrase, ix)) {
        if (has(item.key)) continue;
        // Swap for a removed line of the same kind ("Swiss" for the removed cheddar)…
        let swapIdx = removed.findIndex((r) => dimensionOfLine(r, ix) === item.baseUnit && (!isProtein(item) || isProtein(ix.byKey.get(r.itemKey!)!)));
        let from: DraftLine | null = swapIdx >= 0 ? removed.splice(swapIdx, 1)[0] : null;
        // …or, for a protein, the example's protein ("Impossible" burger from the beef one).
        if (!from && isProtein(item)) {
          swapIdx = lines.findIndex((l) => l.itemKey && isProtein(ix.byKey.get(l.itemKey)!) && dimensionOfLine(l, ix) === item.baseUnit);
          if (swapIdx >= 0) from = lines.splice(swapIdx, 1)[0];
        }
        if (from) {
          const u = chooseUnit(item, from.unit);
          lines.push({ itemKey: item.key, qty: u.changed ? portionFor(item, pool, kind).qty : from.qty, unit: u.unit, note: `for "${phrase}", in place of ${nameOf(from.itemKey)}` });
        } else addItem(item, `for "${phrase}"`);
      }
    }
    // Removed lines nothing replaced: "Vegan Garlic Aioli" − vegan → Garlic Aioli; a lost protein → the usual one for the category.
    for (const r of removed) {
      const rt = ix.tokens.get(r.itemKey ?? "") ?? [];
      const left = rt.filter((w) => !missing.some((m) => sameWord(m, w)));
      const plain = left.length ? matchItem(left.join(" "), ix, 0.75) : null;
      if (plain && plain.item.key !== r.itemKey && !has(plain.item.key)) {
        lines.push({ itemKey: plain.item.key, qty: r.qty, unit: chooseUnit(plain.item, r.unit).unit, note: `in place of ${nameOf(r.itemKey)}` });
        continue;
      }
      const old = r.itemKey ? ix.byKey.get(r.itemKey) : null;
      if (old && isProtein(old) && !lines.some((l) => l.itemKey && isProtein(ix.byKey.get(l.itemKey)!))) {
        const usual = commonProtein(pool, ix, best.category, old.key);
        if (usual) lines.unshift({ itemKey: usual.key, qty: r.qty, unit: chooseUnit(usual, r.unit).unit, note: `in place of ${old.name} — the usual for ${best.category}` });
      }
    }
    // Counts: Wings (10) from Wings (6).
    const n = countIn(target.name);
    const m = countIn(best.name);
    if (n && m && n !== m) {
      lines = lines.map((l) => (l.qty === m ? { ...l, qty: n, note: `scaled from ${m} to ${n}` } : l));
    }
    // Double / triple the main protein.
    const mult = tw.map((w) => MULTIPLIER[w]).find(Boolean);
    if (mult && !bw.some((w) => MULTIPLIER[w])) {
      const i = lines.findIndex((l) => l.itemKey && isProtein(ix.byKey.get(l.itemKey)!));
      if (i >= 0) lines[i] = { ...lines[i], qty: round(lines[i].qty * mult, 4), note: `×${mult} for "${tw.find((w) => MULTIPLIER[w])}"` };
    }
  } else {
    // No close recipe (or an add-on): one line per ingredient named.
    for (const phrase of extraPhrases(target.name.replace(/^\s*(add|extra|sub|substitute)\s+/i, "").replace(/\s+or\s+.*$/i, ""), [])) {
      for (const item of itemsForPhrase(phrase, ix)) addItem(item, `for "${phrase}"`);
    }
    if (modifier && lines.length > 1) lines = lines.slice(0, 1);
  }

  // Drinks: pour the beer named, at the pour size.
  if (kind !== "PREP" && isDrink(target.name, target.category)) {
    const size = pourSize(target.name);
    if (size) {
      const liquid = lines.find((l) => l.itemKey && ix.byKey.get(l.itemKey)!.baseUnit === "ml");
      if (liquid) Object.assign(liquid, { qty: size, unit: "fl oz", note: `${size} fl oz pour` });
    }
    if (!lines.length) warnings.push("Looks like a drink. Kegged beer is costed on Menu costs → Draft beer; for a house beer, read its brew sheet here and use it as a prep recipe.");
  }

  // Description: add what it mentions; a mentioned bun/cheese replaces the example's unmentioned one.
  if (target.description) {
    const mentioned = descriptionPhrases(target.description)
      .map((p) => ({ p, m: matchItem(p, ix, 0.65) }))
      .filter((x): x is { p: string; m: { item: DraftItem; confidence: number } } => !!x.m);
    const mentionedKeys = new Set(mentioned.map((x) => x.m.item.key));
    for (const { p, m } of mentioned) {
      if (lines.some((l) => l.itemKey === m.item.key)) continue;
      const mt = ix.tokens.get(m.item.key) ?? [];
      const swapIdx = lines.findIndex((l) => {
        if (!l.itemKey || mentionedKeys.has(l.itemKey)) return false;
        const other = ix.byKey.get(l.itemKey)!;
        return other.baseUnit === m.item.baseUnit && (ix.tokens.get(l.itemKey) ?? []).some((w) => mt.includes(w));
      });
      if (swapIdx >= 0) {
        const old = lines[swapIdx];
        const u = chooseUnit(m.item, old.unit);
        lines[swapIdx] = { itemKey: m.item.key, qty: old.qty, unit: u.unit, note: `description says "${p}"` };
      } else addItem(m.item, `description says "${p}"`);
    }
  }

  // Every unit must convert for its item.
  lines = lines.map((l) => {
    const item = l.itemKey ? ix.byKey.get(l.itemKey) : null;
    if (!item) return l;
    const u = chooseUnit(item, l.unit);
    return u.changed ? { ...l, unit: u.unit, note: `${l.note ? `${l.note}; ` : ""}check the amount (was ${l.qty} ${l.unit})` } : l;
  });

  if (!lines.length && !warnings.length) warnings.push(near.length ? `Nothing close enough to copy (nearest: ${near.map((n) => n.recipe.name).join(", ")}). Add lines below, paste the recipe, or snap a photo.` : "Nothing similar yet. Add lines below, paste the recipe, or snap a photo.");
  const prep = best && kind === "PREP" ? best : null;
  return {
    name: target.name.replace(/\s*#\d+\s*$/, "").trim(),
    kind,
    category: target.category?.trim() || best?.category || (kind === "PREP" ? "Prep" : kind === "MODIFIER" ? "Add-ons" : "Food"),
    menuPrice: kind === "PREP" ? null : target.price ?? null,
    yieldQty: prep?.yieldQty ?? 1,
    yieldUnit: prep?.yieldUnit ?? "each",
    lines,
    basis: best && !modifier ? near.filter((n) => n.score >= 0.3).map((n) => n.recipe.name) : [],
    method: best && !modifier ? "similar" : "keywords",
    notes: null,
    warnings,
  };
}

// ---- Pasted text and brewing sheets ------------------------------------------------

const METHOD_HEADING = /^(method|directions|instructions|procedure|steps|prep|preparation|notes?|plating|to serve)\s*:?\s*$/i;
const ING_HEADING = /^(ingredients?|grain bill|grains?|malts?|fermentables?|hops?|hop schedule|yeast|adjuncts?|water( additions)?|salts?|other|spices?|sauce|dressing|garnish|for the .*)\s*:?\s*$/i;
const YIELD_LINE = /^(yield|yields|makes|batch(?: size)?|batch volume|volume|serves|servings|portions?)\b\s*[:=-]?\s*(.+)$/i;
const BREW_STAT = /^(og|fg|sg|abv|ibu|srm|ebc|plato|mash|sparge|boil|ferment(ation)?|pitch|whirlpool time|efficiency|target|brew ?date|brewer|style|ph|temp)\b/i;
const BREW_WORDS = /\b(malt|2-row|two-row|pilsner malt|crystal|caramel|munich|vienna|hops?|yeast|wort|mash|sparge|boil|ibu|og|fg|abv|bbl|hl|dry hop|whirlpool|lager|ale|ipa|stout|porter|saison|kolsch|us-05|wlp|wyeast)\b/i;

const NUMBER_WORDS: Record<string, string> = { a: "1", an: "1", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", half: "0.5" };

/** Tidy one ingredient line: "50# 2-Row (78%) @ mash" → { text: "50 lb 2-Row", note: "78% · mash" }. */
export function cleanIngredientLine(raw: string): { text: string; note: string | null } {
  const notes: string[] = [];
  let s = raw.trim().replace(/^[-•*·]\s*|^\d+[.)]\s+(?=\S)/, "");
  s = s.replace(/\(([^)]*)\)/g, (_, inner: string) => { notes.push(inner.trim()); return " "; });
  s = s.replace(/\s+[@–—-]\s*(\d+\s*min.*|flame ?out.*|whirlpool.*|dry ?hop.*|mash.*|boil.*|knock ?out.*|fwh.*|day \d+.*)$/i, (m) => { notes.push(m.replace(/^\s*[@–—-]\s*/, "").trim()); return ""; });
  s = s.replace(/\s+@\s*(.+)$/i, (_, t: string) => { notes.push(t.trim()); return ""; });
  s = s.replace(/,\s*(chopped|diced|minced|sliced|shredded|grated|crushed|melted|softened|to taste|divided|optional|finely.*|roughly.*|thinly.*)$/i, (_, t: string) => { notes.push(t); return ""; });
  s = s.replace(/(\d)\s*#/g, "$1 lb ");
  s = s.replace(/\b(packs?|pkgs?|packets?|sachets?|vials?|pouch(?:es)?|cans?|bricks?)\b/gi, "each");
  s = s.replace(/^(a|an|one|two|three|four|five|six|half)\s+/i, (m) => `${NUMBER_WORDS[m.trim().toLowerCase()] ?? m} `);
  return { text: s.replace(/\s+/g, " ").trim(), note: notes.filter(Boolean).join(" · ") || null };
}

/** "7 bbl", "2 qt", "24", "4 servings" → qty + unit. */
export function parseYield(text: string): { qty: number; unit: string; servings: boolean } | null {
  const t = text.trim().toLowerCase().replace(/[()]/g, " ");
  const m = t.match(/(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*([a-z][a-z .]*)?/);
  if (!m) return null;
  const { qty } = splitQtyUnit(m[1]);
  const q = qty ?? Number(m[1]);
  if (!(q > 0)) return null;
  const unitWord = (m[2] ?? "").trim().split(/\s+/).slice(0, 2).join(" ");
  const servings = !unitWord || /^(serving|portion|people|person|plate|each|piece|pc|sandwich|burger|order)/.test(unitWord);
  const candidates = [unitWord, unitWord.split(" ")[0], unitWord.replace(/s$/, ""), unitWord.split(" ")[0].replace(/s$/, ""), ({ barrel: "bbl", barrels: "bbl", gallons: "gal", gallon: "gal", quarts: "qt", quart: "qt", liters: "l", litres: "l", liter: "l", hectoliter: "hl", hectoliters: "hl", pounds: "lb", pound: "lb", lbs: "lb", cups: "cup" } as Record<string, string>)[unitWord.split(" ")[0]]];
  const unit = candidates.find((c) => c && standardUnit(c));
  return { qty: q, unit: unit ?? "each", servings: !unit && servings };
}

export function looksLikeBrewSheet(text: string): boolean {
  const hits = text.match(new RegExp(BREW_WORDS.source, "gi")) ?? [];
  return new Set(hits.map((h) => h.toLowerCase())).size >= 3;
}

/**
 * Parse a typed recipe (from Notes, an email, a brewing sheet) into a draft.
 * First line is the name unless it reads like an ingredient. Lines after
 * "Method"/"Directions" go to notes. "Serves 4" divides a menu recipe per
 * serving; "Yield: 2 qt" / "Batch size: 7 bbl" make it a prep recipe.
 */
export function parseRecipeText(text: string, ix: ItemIndex, opts: { name?: string; kind?: DraftKind } = {}): Draft {
  const rawLines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const brew = looksLikeBrewSheet(text);
  const knownUnits = ix.items.flatMap((i) => i.units);
  let name = opts.name ?? "";
  let yieldInfo: ReturnType<typeof parseYield> = null;
  const notes: string[] = [];
  const lines: DraftLine[] = [];
  const unmatched: string[] = [];
  let inMethod = false;
  let first = true;
  let section = "";

  for (const raw of rawLines) {
    if (!raw) continue;
    const y = raw.match(YIELD_LINE);
    if (y) {
      yieldInfo = parseYield(y[2]) ?? yieldInfo;
      first = false;
      continue;
    }
    if (METHOD_HEADING.test(raw)) { inMethod = true; first = false; continue; }
    if (ING_HEADING.test(raw)) { inMethod = false; first = false; section = raw.toLowerCase(); continue; }
    if (inMethod) { notes.push(raw); continue; }
    if (BREW_STAT.test(raw) && /[:=\d]/.test(raw) && !/\b(malt|hops?)\b/i.test(raw)) { notes.push(raw); first = false; continue; }
    const { text: cleaned, note } = cleanIngredientLine(raw);
    const split = splitQtyUnit(cleaned, knownUnits);
    if (first && !opts.name && split.qty == null) {
      name = raw.replace(/[:#*]+$/g, "").replace(/^#+\s*/, "").trim();
      first = false;
      continue;
    }
    first = false;
    if (!split.name) continue;
    if (split.qty == null && /^(step|\d+\.)\s/i.test(raw)) { notes.push(raw); continue; }
    // A sentence, not an ingredient ("Mix everything and chill overnight.")
    if (split.qty == null && split.name.split(" ").length > 6) { notes.push(raw); continue; }
    const hit = matchItem(split.name, ix, brew ? 0.7 : 0.6);
    const unitWord = split.unit;
    if (hit) {
      const u = chooseUnit(hit.item, unitWord);
      lines.push({ itemKey: hit.item.key, qty: split.qty ?? 1, unit: u.unit, note: [note, u.changed ? `check the amount (written as ${split.qty ?? 1} ${unitWord})` : null, hit.confidence < 0.8 ? `read "${split.name}"` : null].filter(Boolean).join(" · ") || null });
    } else {
      const base = (unitWord && standardUnit(unitWord)?.base) || "each";
      // Under a "Hops" / "Yeast" heading, say so in the new ingredient's name ("Saaz hops").
      const kindWord = brew && /^hop/.test(section) ? "hops" : brew && /^yeast/.test(section) ? "yeast" : null;
      const named = kindWord && !new RegExp(kindWord.slice(0, 3), "i").test(split.name) ? `${split.name} ${kindWord}` : split.name;
      const newName = named.replace(/^\w/, (c) => c.toUpperCase());
      unmatched.push(newName);
      lines.push({ itemKey: null, newName, newBaseUnit: base, qty: split.qty ?? 1, unit: unitWord && standardUnit(unitWord) ? unitWord : "each", note });
    }
  }

  const kind: DraftKind = opts.kind ?? (brew || (yieldInfo && !yieldInfo.servings) ? "PREP" : "MENU");
  let yieldQty = 1;
  let yieldUnit = "each";
  if (yieldInfo && kind === "PREP") { yieldQty = yieldInfo.qty; yieldUnit = yieldInfo.unit; }
  if (yieldInfo && kind !== "PREP" && yieldInfo.servings && yieldInfo.qty > 1) {
    for (const l of lines) l.qty = round(l.qty / yieldInfo.qty, 4);
    notes.unshift(`Written for ${yieldInfo.qty} servings; amounts divided to one serving.`);
  }
  const warnings: string[] = [];
  if (kind === "PREP" && !yieldInfo) warnings.push(brew ? "Add the batch size (e.g. 7 bbl) so cost per pint works out." : "Add the batch yield (e.g. 2 qt) so the cost per use works out.");
  if (unmatched.length) warnings.push(`${unmatched.length} line${unmatched.length === 1 ? " needs a new ingredient" : "s need new ingredients"} (no price yet): ${unmatched.slice(0, 4).join(", ")}${unmatched.length > 4 ? "…" : ""}.`);
  return {
    name: name || (brew ? "New beer" : "New recipe"),
    kind,
    category: brew ? "Beer" : kind === "PREP" ? "Prep" : "Food",
    menuPrice: null,
    yieldQty,
    yieldUnit,
    lines,
    basis: [],
    method: "text",
    notes: notes.join("\n") || null,
    warnings,
  };
}

// ---- Claude's answer → lines ---------------------------------------------------------

/** The shape Claude fills in (see services/recipe-drafts.ts for the schema). */
export interface AiDraft {
  name: string;
  kind: DraftKind;
  category: string;
  yieldQty: number;
  yieldUnit: string;
  lines: { item: string; isNew: boolean; qty: number; unit: string; note: string }[];
  notes: string;
}

/** Map Claude's names onto real items; unknown names become new-ingredient lines. */
export function resolveAiDraft(ai: AiDraft, ix: ItemIndex, method: DraftMethod, base?: Partial<Draft>): Draft {
  const exact = new Map(ix.items.map((i) => [i.name.trim().toLowerCase(), i]));
  const lines: DraftLine[] = [];
  for (const l of ai.lines) {
    if (!l.item?.trim() || !(l.qty > 0)) continue;
    const item = exact.get(l.item.trim().toLowerCase()) ?? (!l.isNew ? matchItem(l.item, ix, 0.75)?.item : null) ?? null;
    if (item) {
      if (lines.some((x) => x.itemKey === item.key)) continue;
      const u = chooseUnit(item, l.unit);
      lines.push({ itemKey: item.key, qty: round(l.qty, 4), unit: u.unit, note: [l.note || null, u.changed ? `check the amount (Claude said ${l.qty} ${l.unit})` : null].filter(Boolean).join(" · ") || null });
    } else {
      const base = standardUnit(l.unit)?.base ?? "each";
      lines.push({ itemKey: null, newName: l.item.trim(), newBaseUnit: base, qty: round(l.qty, 4), unit: standardUnit(l.unit) ? normalizeUnit(l.unit) : "each", note: l.note || null });
    }
  }
  const kind: DraftKind = base?.kind ?? (["MENU", "MODIFIER", "PREP"].includes(ai.kind) ? ai.kind : "MENU");
  const yu = kind === "PREP" && standardUnit(ai.yieldUnit) ? normalizeUnit(ai.yieldUnit) : "each";
  const newCount = lines.filter((l) => !l.itemKey).length;
  return {
    name: base?.name ?? (ai.name.trim() || "New recipe"),
    kind,
    category: base?.category ?? (ai.category.trim() || (kind === "PREP" ? "Prep" : "Food")),
    menuPrice: kind === "PREP" ? null : base?.menuPrice ?? null,
    yieldQty: kind === "PREP" && ai.yieldQty > 0 ? ai.yieldQty : 1,
    yieldUnit: yu,
    lines,
    basis: base?.basis ?? [],
    method,
    notes: ai.notes?.trim() || null,
    warnings: [...(base?.warnings ?? []), ...(newCount ? [`${newCount} line${newCount === 1 ? " needs a new ingredient" : "s need new ingredients"} (no price yet).`] : [])],
  };
}

/** Category for a new ingredient made from a draft line. */
export function newIngredientCategory(name: string, draft: Pick<Draft, "category">): string {
  if (/beer|brew/i.test(draft.category) || BREW_WORDS.test(name)) return "Brewing";
  return "Other";
}
