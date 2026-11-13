/**
 * Unit conversion. Every ingredient has a base unit (g, ml or each); recipes,
 * counts and price sheets can use any unit, converted here.
 *
 * Lookup order: ingredient-specific conversions first ("1 slice = 21 g",
 * "1 cup = 120 g" for flour), then standard units of the same dimension.
 */

export type BaseUnit = "g" | "ml" | "each";

const STANDARD: Record<string, { base: BaseUnit; factor: number }> = {
  // mass → g
  g: { base: "g", factor: 1 },
  gram: { base: "g", factor: 1 },
  grams: { base: "g", factor: 1 },
  kg: { base: "g", factor: 1000 },
  oz: { base: "g", factor: 28.349523125 },
  lb: { base: "g", factor: 453.59237 },
  lbs: { base: "g", factor: 453.59237 },
  // volume → ml
  ml: { base: "ml", factor: 1 },
  l: { base: "ml", factor: 1000 },
  liter: { base: "ml", factor: 1000 },
  tsp: { base: "ml", factor: 4.92892159375 },
  tbsp: { base: "ml", factor: 14.78676478125 },
  "fl oz": { base: "ml", factor: 29.5735295625 },
  floz: { base: "ml", factor: 29.5735295625 },
  cup: { base: "ml", factor: 236.5882365 },
  cups: { base: "ml", factor: 236.5882365 },
  pt: { base: "ml", factor: 473.176473 },
  qt: { base: "ml", factor: 946.352946 },
  gal: { base: "ml", factor: 3785.411784 },
  // US beer barrel = 31 gal; hectolitre = 100 l
  bbl: { base: "ml", factor: 31 * 3785.411784 },
  hl: { base: "ml", factor: 100000 },
  // count → each
  each: { base: "each", factor: 1 },
  ea: { base: "each", factor: 1 },
  ct: { base: "each", factor: 1 },
  pc: { base: "each", factor: 1 },
  pcs: { base: "each", factor: 1 },
  dozen: { base: "each", factor: 12 },
  dz: { base: "each", factor: 12 },
};

export const STANDARD_UNITS_BY_BASE: Record<BaseUnit, string[]> = {
  g: ["g", "kg", "oz", "lb"],
  ml: ["ml", "l", "tsp", "tbsp", "fl oz", "cup", "pt", "qt", "gal", "bbl", "hl"],
  each: ["each", "dozen"],
};

export interface CustomConversion {
  unit: string;
  baseQty: number; // amount of base unit in 1 of `unit`
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitError";
  }
}

export const normalizeUnit = (unit: string) => unit.trim().toLowerCase().replace(/\.$/, "");

export function standardUnit(unit: string) {
  return STANDARD[normalizeUnit(unit)];
}

/** Convert `qty` of `unit` into the ingredient's base unit. Throws UnitError if impossible. */
export function toBase(
  qty: number,
  unit: string,
  base: BaseUnit,
  custom: readonly CustomConversion[] = [],
): number {
  const u = normalizeUnit(unit);
  const c = custom.find((x) => normalizeUnit(x.unit) === u);
  if (c) return qty * c.baseQty;
  const s = STANDARD[u];
  if (s && s.base === base) return qty * s.factor;
  if (s) {
    throw new UnitError(
      `Can't convert ${unit} to ${base} — add a conversion (e.g. "1 ${unit} = ? ${base}") on the ingredient.`,
    );
  }
  throw new UnitError(`Unknown unit "${unit}" — add it as a conversion on the ingredient.`);
}

export function canConvert(unit: string, base: BaseUnit, custom: readonly CustomConversion[] = []) {
  try {
    toBase(1, unit, base, custom);
    return true;
  } catch {
    return false;
  }
}

/** Human-friendly display of a base quantity: 1500 g → "1.5 kg", 3785 ml → "3.79 l". */
export function formatBase(qtyBase: number, base: BaseUnit): string {
  const n = (v: number, d = 2) => Number(v.toFixed(d)).toLocaleString("en-US");
  if (base === "g") return Math.abs(qtyBase) >= 1000 ? `${n(qtyBase / 1000)} kg` : `${n(qtyBase, 1)} g`;
  if (base === "ml") return Math.abs(qtyBase) >= 1000 ? `${n(qtyBase / 1000)} l` : `${n(qtyBase, 1)} ml`;
  return `${n(qtyBase, 2)} ea`;
}
