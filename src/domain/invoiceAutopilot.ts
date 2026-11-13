/**
 * Invoice & receipt autopilot: the pure decisions between "paper in hand" and
 * "prices in costing". Store-receipt clean-up, math checks on what was read,
 * linking lines to products (or proposing new ones), which prices to record on
 * approval, and what a delivery's received quantities should be. No DB, no I/O.
 */

import { matchScore, normalize } from "./dataTable";
import { DESCRIPTION_THRESHOLD, descriptionSimilarity, matchProduct, type CatalogProduct } from "./invoiceMatch";
import { inferPackQty, normalizePurchaseUnit } from "./priceSheet";
import type { BaseUnit } from "./units";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- Line kinds -----------------------------------------------------------------------

/** Only "item" lines are products: they're matched, linked and priced. The rest just add up. */
export const LINE_KINDS = ["item", "fee", "deposit", "tax", "credit"] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const isLineKind = (k: unknown): k is LineKind => typeof k === "string" && (LINE_KINDS as readonly string[]).includes(k);
export const LINE_KIND_LABEL: Record<LineKind, string> = { item: "Item", fee: "Fee", deposit: "Deposit", tax: "Tax", credit: "Credit" };

// ---- Stores and receipts ------------------------------------------------------------------

/** Stores Subversive buys from on grocery runs, by how their name shows up on a receipt. */
const STORES: { name: string; re: RegExp }[] = [
  { name: "Price Chopper", re: /price\s*chopper|market\s*32/i },
  { name: "Restaurant Depot", re: /restaurant\s*depot|\bjetro\b/i },
  { name: "Hannaford", re: /hannaford/i },
  { name: "Costco", re: /costco/i },
  { name: "Sam's Club", re: /sam'?s\s*club/i },
  { name: "BJ's", re: /\bbj'?s\b/i },
  { name: "ShopRite", re: /shop\s*-?rite/i },
  { name: "Walmart", re: /wal\s*-?\s*mart/i },
  { name: "Aldi", re: /\baldi\b/i },
  { name: "Tops", re: /\btops\s+(friendly|markets?)\b/i },
  { name: "Stewart's", re: /stewart'?s(\s*shops?)?\b/i },
  { name: "Target", re: /\btarget\b/i },
  { name: "Whole Foods", re: /whole\s*foods/i },
  { name: "Trader Joe's", re: /trader\s*joe/i },
  { name: "Home Depot", re: /home\s*depot/i },
  { name: "Lowe's", re: /\blowe'?s\b/i },
  { name: "Staples", re: /\bstaples\b/i },
];

/** The tidy store name for something printed on a receipt ("PRICE CHOPPER #172" → "Price Chopper"), or null. */
export function knownStore(printed: string | null | undefined): string | null {
  if (!printed) return null;
  return STORES.find((s) => s.re.test(printed))?.name ?? null;
}

/** A store receipt rather than a supplier invoice: the reader said so, or the seller is a known store. */
export function looksLikeReceipt(args: { documentType?: string | null; supplierName?: string | null }): boolean {
  return args.documentType === "receipt" || knownStore(args.supplierName) != null;
}

/** Grocery-receipt shorthand → words. Only unambiguous ones; unknown tokens are kept as printed. */
export const RECEIPT_ABBREVIATIONS: Record<string, string> = {
  org: "organic", orgnc: "organic", chkn: "chicken", chk: "chicken", ckn: "chicken", bnls: "boneless", bnlss: "boneless", sknls: "skinless",
  brst: "breast", thgh: "thigh", thghs: "thighs", wng: "wing", wngs: "wings", grnd: "ground", grd: "ground", bf: "beef", trky: "turkey", tky: "turkey",
  sausg: "sausage", saus: "sausage", bcn: "bacon", stk: "steak", tom: "tomato", toms: "tomatoes", tmto: "tomato", pot: "potato", pots: "potatoes",
  potat: "potato", onn: "onion", onns: "onions", oni: "onion", yel: "yellow", ylw: "yellow", wht: "white", grn: "green", lett: "lettuce",
  rom: "romaine", romn: "romaine", mush: "mushroom", mushrm: "mushroom", mshrm: "mushroom", mshrms: "mushrooms", crmni: "cremini", crem: "cremini", bnna: "banana", bnns: "bananas", ban: "banana",
  lmn: "lemon", lmns: "lemons", avo: "avocado", avoc: "avocado", cuc: "cucumber", cuke: "cucumber", ppr: "pepper", pepr: "pepper", jal: "jalapeno",
  jalap: "jalapeno", cil: "cilantro", cilan: "cilantro", prsly: "parsley", grlc: "garlic", grlic: "garlic", scal: "scallion", scln: "scallions",
  celry: "celery", carr: "carrot", crrt: "carrot", crrts: "carrots", brocc: "broccoli", spnch: "spinach", strwb: "strawberries", strw: "strawberry",
  blub: "blueberries", blubry: "blueberries", rasp: "raspberries", appl: "apple", appls: "apples",
  mlk: "milk", whl: "whole", hvy: "heavy", crm: "cream", whpg: "whipping", bttr: "butter", btr: "butter", unsltd: "unsalted", sltd: "salted",
  chs: "cheese", chz: "cheese", mozz: "mozzarella", moz: "mozzarella", ched: "cheddar", chdr: "cheddar", parm: "parmesan", yog: "yogurt", ygrt: "yogurt",
  lg: "large", lrg: "large", xlg: "extra large", jmb: "jumbo", sm: "small", med: "medium", dz: "dozen", doz: "dozen",
  brd: "bread", bns: "buns", hmbgr: "hamburger", hmbrgr: "hamburger", hotdg: "hot dog", tort: "tortillas", trtla: "tortilla", trtlas: "tortillas",
  flr: "flour", sug: "sugar", sgr: "sugar", gran: "granulated", brn: "brown", pwdr: "powder", pwd: "powder", slt: "salt", vin: "vinegar", vngr: "vinegar",
  evoo: "extra virgin olive oil", veg: "vegetable", cnla: "canola", frz: "frozen", frzn: "frozen", frsh: "fresh", slcd: "sliced", sl: "sliced",
  shrd: "shredded", shred: "shredded", dcd: "diced", chpd: "chopped", btl: "bottle", btls: "bottles", pkg: "package", bg: "bag",
  choc: "chocolate", van: "vanilla", sda: "soda", wtr: "water", sprklg: "sparkling", spklg: "sparkling", jce: "juice", lmnd: "lemonade",
  napk: "napkins", twl: "towel", twls: "towels", dish: "dish", soap: "soap", dtrgnt: "detergent", alum: "aluminum", foil: "foil",
  ks: "Kirkland Signature", gv: "Great Value",
};

const UNIT_WORDS = new Set(["lb", "lbs", "oz", "fl", "gal", "qt", "pt", "ct", "ea", "kg", "g", "l", "ml", "pk", "#"]);

const titleWord = (w: string) => (w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));

/**
 * Tidy a store-receipt line: "ORG BNNS 2.31LB" → "Organic Bananas 2.31 lb".
 * Leading long item codes are split off as the SKU; trailing tax flags (a lone
 * "F", "T", "N", "TF"…) are dropped.
 */
export function expandReceiptText(raw: string): { sku: string | null; text: string } {
  let s = raw.replace(/\s+/g, " ").trim();
  let sku: string | null = null;
  const code = s.match(/^(\d{5,14})\s+(.*)$/);
  if (code) {
    sku = code[1];
    s = code[2];
  }
  s = s.replace(/\s+(?:[A-Z]{1,2})$/, (m) => (/^\s+(F|T|N|TF|FT|B|X|S|E)$/.test(m) ? "" : m));
  const words = s.split(" ").map((w) => {
    const glued = w.match(/^(\d+(?:\.\d+)?)([a-z#]+)$/i);
    if (glued && UNIT_WORDS.has(glued[2].toLowerCase())) return `${glued[1]} ${glued[2].toLowerCase()}`;
    const bare = w.toLowerCase().replace(/[^a-z0-9#/.&'-]/g, "");
    const exp = RECEIPT_ABBREVIATIONS[bare.replace(/[.']/g, "")];
    if (exp) return exp.split(" ").map((x) => (/^[A-Z]/.test(x) ? x : titleWord(x))).join(" ");
    if (UNIT_WORDS.has(bare)) return bare;
    if (/\d/.test(w)) return w;
    return titleWord(w.toLowerCase());
  });
  return { sku, text: words.join(" ").replace(/\s+/g, " ").trim() };
}

// ---- Pack sizes -------------------------------------------------------------------------

const PACK_RE = /(?:^|[\s,(])((?:\d+(?:\.\d+)?\s*[/xX]\s*)?\d+(?:\.\d+)?\s*-?\s*(?:fl\s*oz|lbs?|oz|gal|qt|pt|ct|ea|kg|g|l|ml|#|dz|doz))\b\.?/i;

/** Pack size printed inside a description ("Chicken breast 4/10 LB" → "4/10 LB"), or null. */
export function packFromDescription(desc: string): string | null {
  const m = desc.match(PACK_RE);
  return m ? m[1].replace(/\s+/g, " ").trim().toUpperCase() : null;
}

/** The ingredient base unit a pack's unit implies: LB/OZ → g, GAL/L → ml, CT/EA → each. */
export function baseUnitForPack(packText: string | null | undefined, purchaseUnit?: string | null): BaseUnit | null {
  const t = `${packText ?? ""} ${purchaseUnit ?? ""}`.toLowerCase();
  const unit = (re: string) => new RegExp(`(?<![a-z])(?:${re})(?![a-z])`).test(t);
  if (unit("fl\\s*oz|gal|qt|pt|ml|l|lit|liters?|litres?")) return "ml";
  if (unit("lbs?|oz|kg|g|gram|grams") || t.includes("#")) return "g";
  if (unit("ct|ea|each|dz|doz|dozen|piece|count")) return "each";
  return null;
}

/** A readable product/ingredient name from an invoice description: abbreviations expanded, pack size dropped. */
export function cleanItemName(desc: string): string {
  const pack = packFromDescription(desc);
  const without = pack ? desc.replace(new RegExp(pack.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/\s+/g, "\\s*"), "i"), " ") : desc;
  const { text } = expandReceiptText(without.replace(/[,;]+/g, " "));
  return text.replace(/\s+/g, " ").trim().slice(0, 80) || desc.trim().slice(0, 80);
}

/** A stable item code for products bought without one (store receipts): "Organic Bananas" → "ORGANIC-BANANAS". */
export function codeFromDescription(desc: string): string {
  return normalize(cleanItemName(desc)).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ITEM";
}

// ---- Math check ---------------------------------------------------------------------------

export interface MathLine {
  description: string;
  qty: number;
  unitPrice: number;
  /** Extended price as printed, when it was read. */
  lineTotal?: number | null;
  kind?: LineKind;
}

export interface MathIssue {
  kind: "line" | "subtotal" | "total";
  lineIndex?: number;
  /** Printed minus computed. */
  diff: number;
  message: string;
}

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const qtyText = (n: number) => String(Number(n.toFixed(3)));

/**
 * Do the numbers read off the paper add up? Each line's qty × unit price vs its
 * printed extension, the item lines vs the printed subtotal, and everything
 * (plus tax, when it isn't already a line) vs the total.
 */
export function checkInvoiceMath(args: { lines: MathLine[]; subtotal?: number | null; tax?: number | null; total?: number | null }): { linesTotal: number; expectedTotal: number; issues: MathIssue[] } {
  const issues: MathIssue[] = [];
  args.lines.forEach((l, i) => {
    if (l.lineTotal == null) return;
    const computed = round2(l.qty * l.unitPrice);
    const diff = round2(l.lineTotal - computed);
    if (Math.abs(diff) > Math.max(0.02, Math.abs(l.lineTotal) * 0.005)) {
      issues.push({ kind: "line", lineIndex: i, diff, message: `${l.description || `Line ${i + 1}`}: ${qtyText(l.qty)} × ${money(l.unitPrice)} = ${money(computed)}, but ${money(l.lineTotal)} is printed.` });
    }
  });
  const amount = (l: MathLine) => (l.lineTotal != null ? l.lineTotal : l.qty * l.unitPrice);
  const nonTax = round2(args.lines.filter((l) => l.kind !== "tax").reduce((s, l) => s + amount(l), 0));
  const taxLines = round2(args.lines.filter((l) => l.kind === "tax").reduce((s, l) => s + amount(l), 0));
  const linesTotal = round2(nonTax + taxLines);
  if (args.subtotal != null) {
    const diff = round2(args.subtotal - nonTax);
    // Some subtotals are before fees and deposits: accept a match on items alone too.
    const itemsOnly = round2(args.lines.filter((l) => !l.kind || l.kind === "item").reduce((s, l) => s + amount(l), 0));
    if (Math.abs(diff) > 0.05 && Math.abs(args.subtotal - itemsOnly) > 0.05) {
      issues.push({ kind: "subtotal", diff, message: `The lines add up to ${money(nonTax)}, but the subtotal says ${money(args.subtotal)} (${money(Math.abs(diff))} ${diff > 0 ? "missing" : "extra"}).` });
    }
  }
  const tax = taxLines === 0 && args.tax ? args.tax : 0;
  const expectedTotal = round2(linesTotal + tax);
  if (args.total != null) {
    const diff = round2(args.total - expectedTotal);
    if (Math.abs(diff) > 0.05) {
      issues.push({ kind: "total", diff, message: `Lines${tax ? " plus tax" : ""} come to ${money(expectedTotal)}, but the total is ${money(args.total)} (${money(Math.abs(diff))} ${diff > 0 ? "missing — a line may not have been read" : "over"}).` });
    }
  }
  return { linesTotal, expectedTotal, issues };
}

/** Lines where the invoice itself prints fewer shipped than ordered. */
export function printedShorts<T extends { qty: number; orderedQty?: number | null }>(lines: T[]): { line: T; short: number }[] {
  return lines.filter((l) => l.orderedQty != null && l.orderedQty - l.qty > 1e-9).map((line) => ({ line, short: round2(line.orderedQty! - line.qty) }));
}

// ---- Linking lines to products --------------------------------------------------------------

export interface IngredientRef {
  id: string;
  name: string;
  baseUnit: BaseUnit;
}

/** 0..1: how well an ingredient name fits an invoice description (every word of the name should appear). */
export function ingredientFit(name: string, description: string): number {
  const text = normalize(description);
  let s = descriptionSimilarity(name, text);
  if (matchScore(name, text) != null) s = Math.max(s, 0.85);
  return s;
}

/** Best ingredient for a line, preferring the most specific name ("Olive oil" over "Oil"). */
export function suggestIngredient(description: string, ingredients: IngredientRef[]): { ingredient: IngredientRef; score: number } | null {
  const expanded = `${description} ${cleanItemName(description)}`;
  let best: { ingredient: IngredientRef; score: number } | null = null;
  for (const ing of ingredients) {
    const score = ingredientFit(ing.name, expanded);
    if (score < DESCRIPTION_THRESHOLD) continue;
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && ing.name.length > best.ingredient.name.length)) best = { ingredient: ing, score };
  }
  return best;
}

export interface LinkableLine {
  sku?: string | null;
  description: string;
  kind?: string | null;
  packText?: string | null;
  supplierProductId?: string | null;
}

export interface NewProductPlan {
  sku: string;
  description: string;
  packText: string | null;
  purchaseUnit: string;
  /** An ingredient you already have that this looks like. */
  ingredient: { id: string; name: string; score: number } | null;
  /** What to create when there's no good match. */
  newIngredient: { name: string; baseUnit: BaseUnit };
  /** Base units per purchase unit, when the pack size says (for the suggested or new ingredient). */
  packQtyBase: number | null;
}

export type LinkSuggestion =
  | { kind: "linked"; productId: string; by: "sku" | "description" | "manual" }
  | { kind: "product"; productId: string; score: number }
  | { kind: "create"; plan: NewProductPlan }
  | { kind: "skip" };

/** Below the auto-link bar but worth one tap. */
export const SUGGEST_THRESHOLD = 0.4;
/** How much of an existing product's name must show up in the line to suggest it. */
export const REVERSE_THRESHOLD = 0.85;

/**
 * What to do with one invoice line: it's already linked (by hand, item code or
 * description), it probably is an existing product (one tap to confirm), or it's
 * new — then propose the product and the ingredient it feeds.
 */
export function suggestLink(line: LinkableLine, catalog: Pick<CatalogProduct, "id" | "sku" | "description">[], ingredients: IngredientRef[], opts: { receipt?: boolean; usedSkus?: Set<string> } = {}): LinkSuggestion {
  if (line.kind && line.kind !== "item") return { kind: "skip" };
  const full = catalog.map((c) => ({ ...c, currentPrice: null }));
  const m = matchProduct(line, full);
  if (m) return { kind: "linked", productId: m.id, by: m.by ?? "description" };
  const expanded = cleanItemName(line.description);
  let best: { id: string; s: number } | null = null;
  for (const p of catalog) {
    // Most of the line should be in the product's name, and nearly all of the product's name in the line:
    // "Chkn thighs boneless" is not "chkn brst bnls", even though three words agree.
    const forward = Math.max(descriptionSimilarity(line.description, p.description), descriptionSimilarity(expanded, p.description));
    const reverse = Math.max(descriptionSimilarity(p.description, line.description), descriptionSimilarity(p.description, expanded));
    if (forward < SUGGEST_THRESHOLD || reverse < REVERSE_THRESHOLD) continue;
    const s = (forward + reverse) / 2;
    if (!best || s > best.s) best = { id: p.id, s };
  }
  if (best) return { kind: "product", productId: best.id, score: round2(best.s) };

  const printedPack = line.packText?.trim() || packFromDescription(line.description);
  const purchaseUnit = opts.receipt ? (/\d\s*lbs?\b/i.test(line.description) && !printedPack?.includes("/") ? "lb" : "each") : "case";
  // A weighed receipt item ("Bananas 2.31 lb") is priced per lb: the weight isn't a pack size.
  const packText = purchaseUnit === "lb" && !line.packText ? null : printedPack;
  const ing = suggestIngredient(line.description, ingredients);
  const baseUnit = ing?.ingredient.baseUnit ?? baseUnitForPack(packText, purchaseUnit) ?? (opts.receipt ? "each" : "g");
  let sku = (line.sku ?? "").trim() || codeFromDescription(line.description);
  if (opts.usedSkus) {
    let n = 2;
    const base = sku;
    while (opts.usedSkus.has(sku.toLowerCase())) sku = `${base}-${n++}`;
    opts.usedSkus.add(sku.toLowerCase());
  }
  const packQtyBase = purchaseUnit === "lb" && baseUnit === "g" ? 453.5924 : inferPackQty(packText, baseUnit);
  return {
    kind: "create",
    plan: {
      sku: sku.slice(0, 60),
      description: (opts.receipt ? expanded : line.description.trim()).slice(0, 200),
      packText: packText ?? null,
      purchaseUnit: normalizePurchaseUnit(purchaseUnit),
      ingredient: ing ? { id: ing.ingredient.id, name: ing.ingredient.name, score: round2(ing.score) } : null,
      newIngredient: { name: expanded.replace(/\s+\d.*$/, "").trim() || expanded, baseUnit },
      packQtyBase: packQtyBase == null ? null : Number(packQtyBase.toFixed(4)),
    },
  };
}

// ---- Prices on approval -------------------------------------------------------------------

export interface PricedLine {
  supplierProductId: string | null;
  unitPrice: number;
  qty: number;
  kind?: string | null;
}

/**
 * The price records an approved invoice should add: for each linked item, the
 * last billed price on the invoice, where it differs from the price on record
 * as of the invoice date (or there is none). Credits, returns, fees and $0
 * lines never set a price.
 */
export function planPriceRecords(lines: PricedLine[], currentPrice: (productId: string) => number | null): { supplierProductId: string; from: number | null; to: number }[] {
  const last = new Map<string, number>();
  for (const l of lines) {
    if (!l.supplierProductId || (l.kind && l.kind !== "item") || !(l.unitPrice > 0) || !(l.qty > 0)) continue;
    last.set(l.supplierProductId, l.unitPrice);
  }
  const out: { supplierProductId: string; from: number | null; to: number }[] = [];
  for (const [id, to] of last) {
    const from = currentPrice(id);
    if (from == null || Math.abs(from - to) >= 0.005) out.push({ supplierProductId: id, from, to: round2(to) });
  }
  return out;
}

/** Record prices when an invoice is approved? On by default; never for an approval that's been reopened since. */
export function shouldRecordPricesOnApprove(setting: string | null | undefined): boolean {
  return setting !== "false";
}

// ---- Received quantities from the invoice ----------------------------------------------------

export interface OrderLineQty {
  id: string;
  supplierProductId: string;
  qty: number;
  receivedQty: number | null;
}

/**
 * Check in a sent order from its invoice: the shipped quantity of each product
 * is spread over that product's order lines (in order, the last one taking any
 * extra). Products on the order but not on the invoice are left alone and listed;
 * billed products that weren't ordered are listed to be added as received.
 */
export function receiveFromInvoice(orderLines: OrderLineQty[], invoiceLines: { supplierProductId: string | null; qty: number; kind?: string | null }[]): {
  updates: { orderLineId: string; receivedQty: number }[];
  shorts: { supplierProductId: string; ordered: number; shipped: number }[];
  overs: { supplierProductId: string; ordered: number; shipped: number }[];
  notOnInvoice: string[];
  /** Billed products that weren't on the order at all (received as extras). */
  notOnOrder: { supplierProductId: string; shipped: number }[];
} {
  const shipped = new Map<string, number>();
  for (const l of invoiceLines) {
    if (!l.supplierProductId || (l.kind && l.kind !== "item")) continue;
    shipped.set(l.supplierProductId, (shipped.get(l.supplierProductId) ?? 0) + l.qty);
  }
  const byProduct = new Map<string, OrderLineQty[]>();
  for (const l of orderLines) byProduct.set(l.supplierProductId, [...(byProduct.get(l.supplierProductId) ?? []), l]);
  const updates: { orderLineId: string; receivedQty: number }[] = [];
  const shorts: { supplierProductId: string; ordered: number; shipped: number }[] = [];
  const overs: { supplierProductId: string; ordered: number; shipped: number }[] = [];
  const notOnInvoice: string[] = [];
  for (const [pid, lines] of byProduct) {
    const ordered = round2(lines.reduce((s, l) => s + l.qty, 0));
    const got = shipped.get(pid);
    if (got == null) {
      notOnInvoice.push(...lines.map((l) => l.id));
      continue;
    }
    let left = Math.max(0, got);
    lines.forEach((l, i) => {
      const q = i === lines.length - 1 ? left : Math.min(left, l.qty);
      left = round2(left - q);
      updates.push({ orderLineId: l.id, receivedQty: round2(q) });
    });
    if (got < ordered - 1e-9) shorts.push({ supplierProductId: pid, ordered, shipped: round2(got) });
    else if (got > ordered + 1e-9) overs.push({ supplierProductId: pid, ordered, shipped: round2(got) });
  }
  const notOnOrder = [...shipped].filter(([pid, q]) => !byProduct.has(pid) && q > 0).map(([supplierProductId, q]) => ({ supplierProductId, shipped: round2(q) }));
  return { updates, shorts, overs, notOnInvoice, notOnOrder };
}
