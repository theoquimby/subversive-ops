import "server-only";
import type { BaseUnit } from "@/domain/units";
import { unitOptions, type UnitOptions } from "@/domain/countUnits";
import { db } from "../db";
import { orderAreas } from "@/domain/storageAreas";

/** What countUnitsFor needs: custom units and every active supplier product's pack. */
export const COUNT_UNITS_INCLUDE = {
  conversions: true,
  products: { where: { active: true }, select: { id: true, sku: true, description: true, purchaseUnit: true, packQtyBase: true, packText: true, supplier: { select: { name: true } } } },
} as const;

/**
 * Units an ingredient can be counted in (see domain/countUnits): its count
 * unit first, then every pack it's bought in, custom units, standard units.
 */
export function countUnitsFor(ing: {
  baseUnit: string;
  countUnit: string | null;
  countUnits?: string[];
  preferredProductId: string | null;
  conversions: { unit: string; baseQty: { toNumber(): number } }[];
  products: { id: string; purchaseUnit: string; packText: string | null; packQtyBase: { toNumber(): number } | null }[];
}): UnitOptions {
  return unitOptions({
    base: ing.baseUnit as BaseUnit,
    countUnit: ing.countUnit,
    allowed: ing.countUnits ?? [],
    conversions: ing.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })),
    products: ing.products.map((p) => ({ id: p.id, purchaseUnit: p.purchaseUnit, packText: p.packText, packQtyBase: p.packQtyBase?.toNumber() ?? null })),
    preferredProductId: ing.preferredProductId,
  });
}

/** Ingredients to count, in walking order (saved area order, then shelf order, then category and name). */
export async function loadCountableIngredients(area?: string) {
  const [rows, order] = await Promise.all([
    db.ingredient.findMany({
      where: { active: true, ...(area && area !== "All" ? { OR: [{ storageArea: area }, { countAreas: { has: area } }] } : {}) },
      include: COUNT_UNITS_INCLUDE,
      orderBy: [{ storageArea: "asc" }, { countOrder: { sort: "asc", nulls: "last" } }, { category: "asc" }, { name: "asc" }],
    }),
    storageAreas(),
  ]);
  const rank = new Map(order.map((a, i) => [a.toLowerCase(), i]));
  return rows.sort((a, b) => (rank.get(a.storageArea.toLowerCase()) ?? 999) - (rank.get(b.storageArea.toLowerCase()) ?? 999));
}

/** Each ingredient's latest official (approved) count, in base units. */
export async function lastCounts(ingredientIds: string[]): Promise<Map<string, { qtyBase: number; at: Date }>> {
  if (ingredientIds.length === 0) return new Map();
  const rows = await db.stockCountLine.findMany({
    where: { ingredientId: { in: ingredientIds }, count: { completed: true } },
    select: { ingredientId: true, qtyBase: true, count: { select: { takenAt: true } } },
    orderBy: { count: { takenAt: "desc" } },
    distinct: ["ingredientId"],
  });
  return new Map(rows.map((r) => [r.ingredientId, { qtyBase: r.qtyBase.toNumber(), at: r.count.takenAt }]));
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

