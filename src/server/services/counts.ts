import "server-only";
import { asCountEvery, homeAreas, isDue, isSupplyCategory, prepKey, usedOnMenu, valueBreakdown, type CountEvery, type ItemKind, type ValuedLine } from "@/domain/countPlan";
import { readParts, unitOptions } from "@/domain/countUnits";
import { Prisma } from "@prisma/client";
import { costRecipe, recipeYieldInBase } from "@/domain/costing";
import type { ISODate } from "@/domain/dates";
import { standardUnit, type BaseUnit } from "@/domain/units";
import { businessDateOf } from "@/lib/format";
import { db } from "../db";
import { buildContext, loadCostingSnapshot } from "./costing";
import { countUnitsFor, lastCounts, loadCountableIngredients, storageAreas } from "./inventory";
import { businessToday } from "./sales";
import { estimatedOnHandAll } from "./planning";

/** One item as the count sheet, count setup and count review show it. */
export interface CountItem {
  /** Ingredient id, or "p_<recipeId>" for a prep item. */
  id: string;
  kind: ItemKind;
  name: string;
  /** Its storage area (first home area). */
  area: string;
  /** Every area it's listed in on counts, storage area first. */
  homeAreas: string[];
  category: string;
  base: BaseUnit;
  /** Units offered (all for managers; the allowed ones for staff). Default first. */
  units: string[];
  /** Every unit the item converts to (managers pick the allowed ones from these). */
  allUnits: string[];
  allowed: string[];
  conversions: { unit: string; baseQty: number }[];
  unitNotes: Record<string, string>;
  /** Supplier products, preferred first (none for prep items). */
  packs: { supplier: string; sku: string; description: string; packText: string | null; purchaseUnit: string; preferred: boolean }[];
  photoUrl: string | null;
  countNote: string | null;
  every: CountEvery;
  due: boolean;
  last: { qtyBase: number; at: string } | null;
  /** Expected on hand now (last count + deliveries − forecast use − waste); ingredients only. */
  expected: number | null;
}

/** Prep recipes on the count (they have a storage area). */
async function loadCountablePreps(area?: string) {
  const rows = await db.recipe.findMany({
    where: { kind: "PREP", active: true, ...(area && area !== "All" ? { OR: [{ countArea: area }, { countArea: { not: null }, countAreas: { has: area } }] } : { countArea: { not: null } }) },
    include: { countUnitList: true },
  });
  const [settings, counts] = await Promise.all([
    db.prepSetting.findMany({ where: { recipeId: { in: rows.map((r) => r.id) } } }),
    db.prepCount.findMany({ where: { recipeId: { in: rows.map((r) => r.id) } }, orderBy: { countedAt: "desc" }, distinct: ["recipeId"] }),
  ]);
  const set = new Map(settings.map((s) => [s.recipeId, s]));
  const last = new Map(counts.map((c) => [c.recipeId, c]));
  return rows.map((r) => ({ r, setting: set.get(r.id) ?? null, last: last.get(r.id) ?? null }));
}

/** Count units for a prep item: a batch, the prep list's unit, its containers, and standard units. */
export function prepUnits(r: { yieldQty: { toNumber(): number }; yieldUnit: string; yieldBase: string; countUnit: string | null; countUnits: string[]; countUnitList: { unit: string; baseQty: { toNumber(): number } }[] }, setting: { unitName: string | null; unitBase: { toNumber(): number } | null } | null) {
  const base = r.yieldBase as BaseUnit;
  const conversions = r.countUnitList.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() }));
  const notes: Record<string, string> = {};
  let batch = 0;
  try { batch = recipeYieldInBase({ yieldQty: r.yieldQty.toNumber(), yieldUnit: r.yieldUnit, yieldBase: base } as never); } catch { batch = 0; }
  if (batch > 0 && !conversions.some((c) => c.unit === "batch")) { conversions.push({ unit: "batch", baseQty: batch }); notes.batch = `${Number(r.yieldQty.toNumber().toFixed(2))} ${r.yieldUnit}`; }
  if (setting?.unitName && setting.unitBase && standardUnit(setting.unitName)?.base !== base && !conversions.some((c) => c.unit === setting.unitName)) conversions.push({ unit: setting.unitName, baseQty: setting.unitBase.toNumber() });
  const o = unitOptions({ base, countUnit: r.countUnit ?? setting?.unitName ?? null, allowed: r.countUnits, conversions, products: [], preferredProductId: null });
  // A prep item defaults to its first container when none is chosen (pans, not grams).
  if (!r.countUnit && !setting?.unitName && r.countUnitList[0]) {
    const first = r.countUnitList[0].unit;
    o.units = [first, ...o.units.filter((u) => u !== first)];
    if (!r.countUnits.length) o.staffUnits = o.units;
  }
  return { ...o, notes: { ...o.notes, ...notes } };
}

/**
 * Everything on the count for an area, in walking order: areas in their saved
 * order, then shelf order. `due` is false for monthly items counted recently
 * and "only when it changes" items: they're left off the sheet and carried.
 */
export async function countItems(area: string | undefined, role: "MANAGER" | "STAFF", opts: { today?: ISODate; expected?: boolean } = {}): Promise<CountItem[]> {
  const today = opts.today ?? businessToday();
  const [ingredients, preps, order, expected] = await Promise.all([loadCountableIngredients(area), loadCountablePreps(area), storageAreas(), opts.expected ? estimatedOnHandAll().catch(() => null) : Promise.resolve(null)]);
  const last = await lastCounts(ingredients.map((i) => i.id));
  const items: (CountItem & { order: number | null })[] = [];
  for (const i of ingredients) {
    const o = countUnitsFor(i);
    const l = last.get(i.id);
    const every = asCountEvery(i.countEvery);
    items.push({
      id: i.id, kind: "ingredient", name: i.name, area: i.storageArea, homeAreas: homeAreas(i.storageArea, i.countAreas), category: i.category, base: i.baseUnit as BaseUnit,
      units: role === "MANAGER" ? o.units : o.staffUnits, allUnits: o.units, allowed: o.staffUnits.length === o.units.length ? [] : o.staffUnits,
      conversions: o.conversions, unitNotes: o.notes,
      packs: [...i.products].sort((a, b) => Number(b.id === i.preferredProductId) - Number(a.id === i.preferredProductId)).map((p) => ({ supplier: p.supplier.name, sku: p.sku, description: p.description, packText: p.packText, purchaseUnit: p.purchaseUnit, preferred: p.id === i.preferredProductId })),
      photoUrl: i.photoAt ? `/count/photo/${i.id}?v=${i.photoAt.getTime()}` : null,
      countNote: i.countNote, every, due: isDue(every, l ? businessDateOf(l.at) : null, today),
      last: l ? { qtyBase: l.qtyBase, at: l.at.toISOString() } : null, order: i.countOrder,
      expected: expected?.get(i.id)?.known ? expected.get(i.id)!.qty : null,
    });
  }
  for (const { r, setting, last: l } of preps) {
    const o = prepUnits(r, setting);
    const every = asCountEvery(r.countEvery);
    const key = prepKey(r.id);
    items.push({
      id: key, kind: "prep", name: r.name, area: r.countArea!, homeAreas: homeAreas(r.countArea!, r.countAreas), category: "Prep", base: r.yieldBase as BaseUnit,
      units: role === "MANAGER" ? o.units : o.staffUnits, allUnits: o.units, allowed: o.staffUnits.length === o.units.length ? [] : o.staffUnits,
      conversions: o.conversions, unitNotes: o.notes, packs: [],
      photoUrl: r.photoAt ? `/count/photo/${key}?v=${r.photoAt.getTime()}` : null,
      countNote: r.countNote, every, due: isDue(every, l ? businessDateOf(l.countedAt) : null, today),
      last: l ? { qtyBase: l.qtyBase.toNumber(), at: l.countedAt.toISOString() } : null, order: r.countOrder,
      expected: null,
    });
  }
  const rank = new Map(order.map((a, i) => [a.toLowerCase(), i]));
  items.sort((a, b) =>
    (rank.get(a.area.toLowerCase()) ?? 999) - (rank.get(b.area.toLowerCase()) ?? 999) ||
    a.area.localeCompare(b.area) ||
    (a.order ?? 1e9) - (b.order ?? 1e9) ||
    Number(a.kind === "prep") - Number(b.kind === "prep") ||
    a.category.localeCompare(b.category) ||
    a.name.localeCompare(b.name));
  return items.map(({ order: _o, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
}

/** Prep recipes not on the count yet (count setup offers to add them). */
export async function prepsOffCount() {
  return db.recipe.findMany({ where: { kind: "PREP", active: true, countArea: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

// ---- Value ------------------------------------------------------------------------------------

/**
 * What everything on the shelves was worth as of a completed count: each item's
 * latest count up to then (carried from an earlier count when it wasn't counted
 * this time), at that day's prices. Prep items are valued at recipe cost.
 */
async function valuesAt(countIds: { id: string; takenAt: Date }[]) {
  if (countIds.length === 0) return new Map<string, ReturnType<typeof valueBreakdown> & { lines: ValuedLine[] }>();
  const until = countIds.reduce((m, c) => (c.takenAt > m ? c.takenAt : m), countIds[0].takenAt);
  const [lines, prepLines, ings, recipes, snap] = await Promise.all([
    db.stockCountLine.findMany({ where: { count: { completed: true, takenAt: { lte: until } } }, select: { ingredientId: true, qtyBase: true, countId: true, count: { select: { takenAt: true } } }, orderBy: { count: { takenAt: "asc" } } }),
    db.stockCountPrepLine.findMany({ where: { count: { completed: true, takenAt: { lte: until } } }, select: { recipeId: true, qtyBase: true, countId: true, count: { select: { takenAt: true } } }, orderBy: { count: { takenAt: "asc" } } }),
    db.ingredient.findMany({ select: { id: true, name: true, storageArea: true, category: true } }),
    db.recipe.findMany({ where: { kind: "PREP" }, select: { id: true, name: true, countArea: true } }),
    loadCostingSnapshot(),
  ]);
  const ingBy = new Map(ings.map((i) => [i.id, i]));
  const recBy = new Map(recipes.map((r) => [r.id, r]));
  const out = new Map<string, ReturnType<typeof valueBreakdown> & { lines: ValuedLine[] }>();
  for (const c of countIds) {
    const date = businessDateOf(c.takenAt);
    const ctx = buildContext(snap, date);
    const latest = new Map<string, { qty: number; countId: string; at: Date }>();
    for (const l of lines) if (l.count.takenAt <= c.takenAt) latest.set(l.ingredientId, { qty: l.qtyBase.toNumber(), countId: l.countId, at: l.count.takenAt });
    const latestPrep = new Map<string, { qty: number; countId: string; at: Date }>();
    for (const l of prepLines) if (l.count.takenAt <= c.takenAt) latestPrep.set(l.recipeId, { qty: l.qtyBase.toNumber(), countId: l.countId, at: l.count.takenAt });
    const valued: ValuedLine[] = [];
    for (const [id, l] of latest) {
      const i = ingBy.get(id);
      const cost = ctx.ingredients.get(id)?.costPerBase;
      if (!i || !l.qty) continue;
      valued.push({ key: id, name: i.name, area: i.storageArea, category: i.category, value: cost != null ? l.qty * cost : 0, carriedFrom: l.countId === c.id ? null : businessDateOf(l.at) });
    }
    for (const [id, l] of latestPrep) {
      const r = recBy.get(id);
      if (!r || !l.qty) continue;
      let perBase = 0;
      try {
        const cost = costRecipe(ctx, id);
        const y = recipeYieldInBase(ctx.recipes.get(id)!);
        perBase = y > 0 ? cost.totalCost / y : 0;
      } catch { perBase = 0; }
      valued.push({ key: prepKey(id), name: r.name, area: r.countArea ?? "Prep", category: "Prep", value: l.qty * perBase, carriedFrom: l.countId === c.id ? null : businessDateOf(l.at) });
    }
    valued.sort((a, b) => b.value - a.value);
    out.set(c.id, { ...valueBreakdown(valued), lines: valued });
  }
  return out;
}

/** The value of the last few completed counts, oldest first (for the trend). */
export async function valueTrend(n = 8) {
  const counts = await db.stockCount.findMany({ where: { completed: true }, orderBy: { takenAt: "desc" }, take: n, select: { id: true, takenAt: true, area: true, _count: { select: { lines: true, prepLines: true } } } });
  const vals = await valuesAt(counts);
  return counts.reverse().map((c) => ({ id: c.id, date: businessDateOf(c.takenAt), area: c.area, items: c._count.lines + c._count.prepLines, total: vals.get(c.id)?.total ?? 0 }));
}

/** One count's result: value by area and category, carried items, change vs the previous count, and stock not on the menu. */
export async function countSummary(countId: string) {
  const count = await db.stockCount.findUnique({ where: { id: countId }, include: { user: { select: { name: true } }, _count: { select: { lines: true, prepLines: true } } } });
  if (!count || !count.completed) return null;
  const prev = await db.stockCount.findFirst({ where: { completed: true, takenAt: { lt: count.takenAt } }, orderBy: { takenAt: "desc" }, select: { id: true, takenAt: true } });
  const vals = await valuesAt(prev ? [count, prev] : [count]);
  const v = vals.get(count.id)!;
  const before = prev ? vals.get(prev.id)! : null;
  const recipes = await db.recipe.findMany({ select: { id: true, kind: true, active: true, lines: { select: { ingredientId: true, subRecipeId: true } } } });
  const used = usedOnMenu(recipes);
  // Food and drink only: napkins and cleaner aren't on any menu, and that's fine.
  const sellable = (l: ValuedLine) => !isSupplyCategory(l.category);
  const offMenu = v.lines.filter((l) => (l.key.startsWith("p_") ? !used.preps.has(l.key.slice(2)) : !used.ingredients.has(l.key)) && l.value > 0 && sellable(l));
  return { count, value: v, prev: before ? { date: businessDateOf(prev!.takenAt), total: before.total } : null, offMenu };
}

export const countDay = (d: Date) => businessDateOf(d);

/** Items a count found outside their home areas ("Fryer oil in Third bay dry storage"), to offer adding that area. */
export async function foundElsewhere(countId: string): Promise<{ key: string; name: string; area: string }[]> {
  const [lines, prepLines] = await Promise.all([
    db.stockCountLine.findMany({ where: { countId, parts: { not: Prisma.DbNull } }, select: { parts: true, ingredient: { select: { id: true, name: true, storageArea: true, countAreas: true } } } }),
    db.stockCountPrepLine.findMany({ where: { countId, parts: { not: Prisma.DbNull } }, select: { parts: true, recipe: { select: { id: true, name: true, countArea: true, countAreas: true } } } }),
  ]);
  const out: { key: string; name: string; area: string }[] = [];
  const check = (key: string, name: string, homes: string[], parts: unknown) => {
    for (const p of readParts(parts) ?? []) {
      if (!p.area || homes.some((h) => h.toLowerCase() === p.area!.toLowerCase()) || out.some((o) => o.key === key && o.area === p.area)) continue;
      out.push({ key, name, area: p.area });
    }
  };
  for (const l of lines) check(l.ingredient.id, l.ingredient.name, homeAreas(l.ingredient.storageArea, l.ingredient.countAreas), l.parts);
  for (const l of prepLines) check(prepKey(l.recipe.id), l.recipe.name, homeAreas(l.recipe.countArea ?? "", l.recipe.countAreas), l.parts);
  return out;
}
