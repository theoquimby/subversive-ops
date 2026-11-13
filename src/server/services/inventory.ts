import "server-only";
import { CustomConversion, STANDARD_UNITS_BY_BASE, type BaseUnit } from "@/domain/units";
import { db } from "../db";
import { orderAreas } from "@/domain/storageAreas";

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

/** Ingredients to count, in walking order (saved area order, then category and name). */
export async function loadCountableIngredients(area?: string) {
  const [rows, order] = await Promise.all([
    db.ingredient.findMany({
      where: { active: true, ...(area && area !== "All" ? { storageArea: area } : {}) },
      include: { conversions: true, preferredProduct: { select: { purchaseUnit: true, packQtyBase: true } } },
      orderBy: [{ storageArea: "asc" }, { category: "asc" }, { name: "asc" }],
    }),
    storageAreas(),
  ]);
  const rank = new Map(order.map((a, i) => [a.toLowerCase(), i]));
  return rows.sort((a, b) => (rank.get(a.storageArea.toLowerCase()) ?? 999) - (rank.get(b.storageArea.toLowerCase()) ?? 999));
}

export const AREAS_KEY = "inventory.areas";

/** Saved areas in walking order (Settings → Storage areas). */
export async function savedAreas(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: AREAS_KEY } });
  try {
    const v = row ? JSON.parse(row.value) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveAreas(list: string[]) {
  const value = JSON.stringify(list);
  await db.setting.upsert({ where: { key: AREAS_KEY }, create: { key: AREAS_KEY, value }, update: { value } });
}

/** Every storage area, in walking order: the saved list, then any other area an ingredient uses. */
export async function storageAreas() {
  const [saved, rows] = await Promise.all([
    savedAreas(),
    db.ingredient.findMany({ where: { active: true }, distinct: ["storageArea"], select: { storageArea: true } }),
  ]);
  return orderAreas(saved, rows.map((r) => r.storageArea));
}

/** Areas with how many ingredients are in each. */
export async function storageAreasWithCounts() {
  const [areas, counts] = await Promise.all([
    storageAreas(),
    db.ingredient.groupBy({ by: ["storageArea"], where: { active: true }, _count: { _all: true } }),
  ]);
  const by = new Map(counts.map((c) => [c.storageArea.toLowerCase(), c._count._all]));
  return areas.map((name) => ({ name, items: by.get(name.toLowerCase()) ?? 0 }));
}
