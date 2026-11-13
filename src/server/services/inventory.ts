import "server-only";
import { CustomConversion, STANDARD_UNITS_BY_BASE, type BaseUnit } from "@/domain/units";
import { db } from "../db";

/**
 * Units an ingredient can be counted in: its count unit first, then the
 * purchase unit ("case" = one pack), custom units, then standard units.
 */
export function countUnitsFor(ing: {
  baseUnit: string;
  countUnit: string | null;
  conversions: { unit: string; baseQty: { toNumber(): number } }[];
  preferredProduct: { purchaseUnit: string; packQtyBase: { toNumber(): number } | null } | null;
}): { units: string[]; conversions: CustomConversion[] } {
  const base = ing.baseUnit as BaseUnit;
  const conversions: CustomConversion[] = ing.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() }));
  const p = ing.preferredProduct;
  if (p?.packQtyBase && !conversions.some((c) => c.unit === p.purchaseUnit) && !STANDARD_UNITS_BY_BASE[base].includes(p.purchaseUnit)) {
    conversions.push({ unit: p.purchaseUnit, baseQty: p.packQtyBase.toNumber() });
  }
  const all = [...conversions.map((c) => c.unit), ...STANDARD_UNITS_BY_BASE[base]];
  const first = ing.countUnit && all.includes(ing.countUnit) ? ing.countUnit : all.includes(p?.purchaseUnit ?? "") && base !== "each" ? p!.purchaseUnit : STANDARD_UNITS_BY_BASE[base][0];
  return { units: [first, ...all.filter((u) => u !== first)], conversions };
}

export const loadCountableIngredients = (area?: string) =>
  db.ingredient.findMany({
    where: { active: true, ...(area && area !== "All" ? { storageArea: area } : {}) },
    include: { conversions: true, preferredProduct: { select: { purchaseUnit: true, packQtyBase: true } } },
    orderBy: [{ storageArea: "asc" }, { category: "asc" }, { name: "asc" }],
  });

export async function storageAreas() {
  const rows = await db.ingredient.findMany({ where: { active: true }, distinct: ["storageArea"], select: { storageArea: true }, orderBy: { storageArea: "asc" } });
  return rows.map((r) => r.storageArea);
}
