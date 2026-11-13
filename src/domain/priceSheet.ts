/**
 * Distributor price-sheet parsing.
 *
 * Sheets differ per distributor, so the column mapping is detected from the
 * header row and then remembered per supplier. Rows are diffed against current
 * prices so the person importing sees exactly what changed before committing.
 */

import { BaseUnit, standardUnit } from "./units";

export interface ColumnMapping {
  sku: string;
  description: string;
  price: string;
  pack?: string;
  unit?: string; // purchase unit column, e.g. "CS" / "EA"
}

const CANDIDATES: Record<keyof ColumnMapping, RegExp[]> = {
  sku: [/^(item|product)?\s*(#|no\.?|num(ber)?|code|id)$/i, /sku/i, /item\s*(#|no|num|code)/i, /^supc$/i, /product\s*(#|code|no)/i],
  description: [/desc/i, /^(item|product)\s*name$/i, /^name$/i, /^item$/i, /^product$/i],
  price: [/^(case\s*)?price$/i, /unit\s*price/i, /^cost$/i, /price/i, /cost/i],
  pack: [/pack\s*\/?\s*size/i, /^pack$/i, /^size$/i, /pk\s*\/?\s*sz/i, /pack/i],
  unit: [/^(uom|unit|u\/m|sell\s*unit)$/i, /uom/i],
};

export function detectMapping(headers: string[]): Partial<ColumnMapping> {
  const found: Partial<ColumnMapping> = {};
  const used = new Set<string>();
  for (const key of ["sku", "price", "pack", "unit", "description"] as const) {
    for (const re of CANDIDATES[key]) {
      const h = headers.find((x) => !used.has(x) && re.test(x.trim()));
      if (h) {
        found[key] = h;
        used.add(h);
        break;
      }
    }
  }
  return found;
}

export function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface ParsedRow {
  row: number; // 1-based sheet row incl. header
  sku: string;
  description: string;
  price: number;
  packText: string | null;
  purchaseUnit: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: { row: number; message: string }[];
}

export function parseRows(records: Record<string, unknown>[], mapping: ColumnMapping): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseResult["errors"] = [];
  const seen = new Set<string>();
  records.forEach((rec, i) => {
    const rowNum = i + 2;
    const sku = String(rec[mapping.sku] ?? "").trim();
    const description = String(rec[mapping.description] ?? "").trim();
    if (!sku && !description) return; // blank row
    if (!sku) return void errors.push({ row: rowNum, message: "Missing item number" });
    const price = parsePrice(rec[mapping.price]);
    if (price == null) return void errors.push({ row: rowNum, message: `Unreadable price "${String(rec[mapping.price] ?? "")}"` });
    if (seen.has(sku)) return void errors.push({ row: rowNum, message: `Duplicate item number ${sku}` });
    seen.add(sku);
    const packText = mapping.pack ? String(rec[mapping.pack] ?? "").trim() || null : null;
    const unitRaw = mapping.unit ? String(rec[mapping.unit] ?? "").trim() : "";
    rows.push({ row: rowNum, sku, description, price, packText, purchaseUnit: normalizePurchaseUnit(unitRaw) });
  });
  return { rows, errors };
}

function normalizePurchaseUnit(u: string): string {
  const x = u.toLowerCase();
  if (!x || ["cs", "case", "cse"].includes(x)) return "case";
  if (["ea", "each"].includes(x)) return "each";
  if (["bg", "bag"].includes(x)) return "bag";
  if (["lb", "lbs"].includes(x)) return "lb";
  return x;
}

/**
 * Infer how many base units a pack holds from text like "6/32 OZ", "4/1 GAL",
 * "25 LB", "1/10LB", "200 CT". Returns null when it can't be sure — the user
 * then sets it once and it's remembered on the product.
 *
 * Note "OZ" is ambiguous (weight vs fluid); it's treated as weight for g-based
 * ingredients and fluid ounces for ml-based ones.
 */
export function inferPackQty(packText: string | null, base: BaseUnit): number | null {
  if (!packText) return null;
  const t = packText.toUpperCase().replace(/\s+/g, " ").trim();
  const m = t.match(/^(?:(\d+(?:\.\d+)?)\s*[/X]\s*)?(\d+(?:\.\d+)?)\s*-?\s*([A-Z ]+?)\.?$/);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const size = Number(m[2]);
  let unit = m[3].trim().toLowerCase();
  if (unit === "oz" && base === "ml") unit = "fl oz";
  if (unit === "#") unit = "lb";
  if (["ct", "ea", "pc", "count"].includes(unit)) unit = "each";
  const s = standardUnit(unit);
  if (!s || s.base !== base) return null;
  return count * size * s.factor;
}

export interface CurrentProduct {
  sku: string;
  description: string;
  currentPrice: number | null;
}

export interface PriceDiff {
  newProducts: ParsedRow[];
  changed: { row: ParsedRow; oldPrice: number; changePct: number }[];
  unchanged: ParsedRow[];
  /** Products we have on file that weren't in this sheet. */
  missing: CurrentProduct[];
}

export function diffPrices(rows: ParsedRow[], current: CurrentProduct[]): PriceDiff {
  const bySku = new Map(current.map((c) => [c.sku, c]));
  const inSheet = new Set(rows.map((r) => r.sku));
  const diff: PriceDiff = { newProducts: [], changed: [], unchanged: [], missing: [] };
  for (const row of rows) {
    const cur = bySku.get(row.sku);
    if (!cur || cur.currentPrice == null) diff.newProducts.push(row);
    else if (Math.abs(cur.currentPrice - row.price) >= 0.005) {
      diff.changed.push({ row, oldPrice: cur.currentPrice, changePct: cur.currentPrice > 0 ? (row.price - cur.currentPrice) / cur.currentPrice : 0 });
    } else diff.unchanged.push(row);
  }
  diff.missing = current.filter((c) => !inSheet.has(c.sku));
  diff.changed.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return diff;
}
