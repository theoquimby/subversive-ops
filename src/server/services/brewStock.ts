import "server-only";
import { Prisma } from "@prisma/client";
import { addDays, type ISODate } from "@/domain/dates";
import { detectBrewSupplier, parseOrdered, type NeedLine, type PlannedBrew } from "@/domain/brewOrdering";
import { baseUnitForBrewUnit, BREWING_CATEGORIES, brewToBase } from "@/domain/brewRecipes";
import {
  displayUnitFor,
  entryUnitsFor,
  fromBase,
  onHand,
  RECENT_USE_DAYS,
  scaleBrewQty,
  STOCK_HORIZON_DAYS,
  stockStatus,
  usedBetween,
  weeksOfCover,
  type StockMove,
  type StockMoveKind,
  type StockStatus,
} from "@/domain/brewStock";
import type { BaseUnit, CustomConversion } from "@/domain/units";
import { businessDateOf } from "@/lib/format";
import { db, num } from "../db";
import { breweryDefaults } from "./brewery";
import { businessToday } from "./sales";

/**
 * Brewing stock, kept apart from kitchen counts (BrewStockMove, never
 * StockCount): counts, deliveries, what each brew used, fixes. Only
 * ingredients on the brewery side (department "brewery") are listed.
 */

export const BREWERY = "brewery";
const D = (n: number) => new Prisma.Decimal(n.toFixed(4));
const iso = (d: Date | null | undefined): ISODate | null => (d ? d.toISOString().slice(0, 10) : null);
const conv = (cs: { unit: string; baseQty: Prisma.Decimal }[]): CustomConversion[] => cs.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() }));

// ---- What brews use ------------------------------------------------------------------------

/**
 * Write what this brew used: every recipe line matched to an ingredient, scaled
 * to the brew's barrels (packs round up). Replaces the brew's earlier "used"
 * moves, keeping their time, so marking it brewed twice never counts twice.
 */
export async function recordBrewUsage(batchId: string): Promise<void> {
  const b = await db.brewBatch.findUnique({
    where: { id: batchId },
    select: { id: true, bbl: true, recipe: { select: { batchBbl: true, lines: { select: { qty: true, unit: true, ingredient: { select: { id: true, baseUnit: true, conversions: true } } } } } } },
  });
  if (!b) return;
  const prev = await db.brewStockMove.findFirst({ where: { batchId, kind: "used" }, orderBy: { at: "asc" }, select: { at: true } });
  const at = prev?.at ?? new Date();
  const used = new Map<string, number>();
  if (b.recipe) {
    const recipeBbl = b.recipe.batchBbl.toNumber();
    const bbl = num(b.bbl) ?? recipeBbl;
    for (const l of b.recipe.lines) {
      if (!l.ingredient) continue;
      try {
        const q = brewToBase(scaleBrewQty(l.qty.toNumber(), l.unit, recipeBbl, bbl), l.unit, l.ingredient.baseUnit as BaseUnit, conv(l.ingredient.conversions));
        if (q > 0) used.set(l.ingredient.id, (used.get(l.ingredient.id) ?? 0) + q);
      } catch {
        // A unit that doesn't fit the ingredient (the recipe page flags it): nothing to deduct.
      }
    }
  }
  await db.$transaction([
    db.brewStockMove.deleteMany({ where: { batchId, kind: "used" } }),
    db.brewStockMove.createMany({ data: [...used].map(([ingredientId, q]) => ({ ingredientId, kind: "used", qtyBase: D(q), batchId, at })) }),
  ]);
}

// ---- Planned brews, for stock and ordering -------------------------------------------------

export interface PlannedNeeds {
  brews: PlannedBrew[];
  /** Recipe lines that couldn't be counted: not matched to an ingredient, or a unit that doesn't fit */
  skipped: { brew: string; line: string; why: "unmatched" | "unit" | "kitchen" }[];
}

interface IngredientInfo {
  id: string;
  name: string;
  department: string;
  baseUnit: BaseUnit;
  conversions: CustomConversion[];
}

/** For each ingredient, its brewery supplier: the product it's bought as from a brewery supplier, else a guess from the name. */
export async function brewerySupplierOf(ingredientIds: string[], suppliers: { id: string; name: string }[]): Promise<Map<string, { supplierId: string; pack: { qtyBase: number; unit: string } | null }>> {
  const out = new Map<string, { supplierId: string; pack: { qtyBase: number; unit: string } | null }>();
  if (!ingredientIds.length || !suppliers.length) return out;
  const [products, ings] = await Promise.all([
    db.supplierProduct.findMany({
      where: { ingredientId: { in: ingredientIds }, active: true, supplierId: { in: suppliers.map((s) => s.id) } },
      select: { id: true, ingredientId: true, supplierId: true, packQtyBase: true, purchaseUnit: true, prices: { orderBy: { effectiveDate: "desc" }, take: 1, select: { effectiveDate: true } } },
    }),
    db.ingredient.findMany({ where: { id: { in: ingredientIds } }, select: { id: true, preferredProductId: true } }),
  ]);
  const preferred = new Map(ings.map((i) => [i.id, i.preferredProductId]));
  const byIng = new Map<string, typeof products>();
  for (const p of products) byIng.set(p.ingredientId!, [...(byIng.get(p.ingredientId!) ?? []), p]);
  for (const [id, ps] of byIng) {
    const p = ps.find((x) => x.id === preferred.get(id)) ?? [...ps].sort((a, z) => (z.prices[0]?.effectiveDate.getTime() ?? 0) - (a.prices[0]?.effectiveDate.getTime() ?? 0))[0];
    const pack = p.packQtyBase && p.packQtyBase.toNumber() > 0 ? { qtyBase: p.packQtyBase.toNumber(), unit: p.purchaseUnit } : null;
    out.set(id, { supplierId: p.supplierId, pack });
  }
  return out;
}

/**
 * Brews planned (not brewed yet) with a recipe, from `from` to `until`, and what
 * each needs on the brewery side, scaled to the brew. Dry-hop day: the brew's
 * own, else brew day + the recipe's dry-hop day. Packaging day: the end of its
 * last planned tank stay, else brew day + fermenting + conditioning days.
 */
export async function loadPlannedNeeds(from: ISODate, until: ISODate, suppliers: { id: string; name: string }[] = []): Promise<PlannedNeeds> {
  const [rows, defaults] = await Promise.all([
    db.brewBatch.findMany({
      where: { status: "PLANNED", plannedOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${until}T00:00:00Z`) } },
      orderBy: [{ plannedOn: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        bbl: true,
        plannedOn: true,
        dryHopOn: true,
        ordered: true,
        beer: { select: { name: true } },
        stays: { select: { end: true } },
        recipe: { select: { name: true, batchBbl: true, dryHopDay: true, fermentDays: true, conditionDays: true, lines: { orderBy: { sort: "asc" }, select: { kind: true, name: true, qty: true, unit: true, use: true, ingredientId: true } } } },
      },
    }),
    breweryDefaults(),
  ]);
  const ids = [...new Set(rows.flatMap((b) => b.recipe?.lines.map((l) => l.ingredientId).filter((x): x is string => !!x) ?? []))];
  const ingRows = ids.length ? await db.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, department: true, baseUnit: true, conversions: true } }) : [];
  const ings = new Map<string, IngredientInfo>(ingRows.map((i) => [i.id, { id: i.id, name: i.name, department: i.department, baseUnit: i.baseUnit as BaseUnit, conversions: conv(i.conversions) }]));
  const supplierOf = await brewerySupplierOf(ids, suppliers);
  const skipped: PlannedNeeds["skipped"] = [];
  const brews: PlannedBrew[] = [];
  for (const b of rows) {
    if (!b.recipe || !b.plannedOn) continue;
    const brewOn = iso(b.plannedOn)!;
    const name = b.beer?.name ?? b.recipe.name;
    const recipeBbl = b.recipe.batchBbl.toNumber();
    const bbl = num(b.bbl) ?? recipeBbl;
    const lastEnd = b.stays.map((s) => iso(s.end)).filter((x): x is string => !!x).sort().at(-1) ?? null;
    const lines: NeedLine[] = [];
    for (const l of b.recipe.lines) {
      const ing = l.ingredientId ? ings.get(l.ingredientId) : undefined;
      if (!ing) {
        skipped.push({ brew: name, line: l.name, why: "unmatched" });
        continue;
      }
      if (ing.department !== BREWERY) {
        skipped.push({ brew: name, line: l.name, why: "kitchen" });
        continue;
      }
      let qtyBase: number;
      try {
        qtyBase = brewToBase(scaleBrewQty(l.qty.toNumber(), l.unit, recipeBbl, bbl), l.unit, ing.baseUnit, ing.conversions);
      } catch {
        skipped.push({ brew: name, line: l.name, why: "unit" });
        continue;
      }
      const s = supplierOf.get(ing.id);
      const guess = s ? null : detectBrewSupplier(`${l.name} ${ing.name}`, suppliers);
      lines.push({ ingredientId: ing.id, name: ing.name, qtyBase, dryHop: l.kind === "hop" && l.use === "dryhop", supplierId: s?.supplierId ?? guess, pack: s?.pack ?? null });
    }
    brews.push({
      id: b.id,
      code: b.code,
      name,
      brewOn,
      dryHopOn: iso(b.dryHopOn) ?? (b.recipe.dryHopDay != null ? addDays(brewOn, b.recipe.dryHopDay) : null),
      packageOn: lastEnd ?? addDays(brewOn, (b.recipe.fermentDays ?? defaults.fermentDays) + (b.recipe.conditionDays ?? defaults.conditionDays)),
      ordered: parseOrdered(b.ordered),
      lines,
    });
  }
  return { brews, skipped };
}

/** Planned brews this long overdue (still PLANNED) are still counted. */
export const OVERDUE_LOOKBACK_DAYS = 60;

/** On hand now for each ingredient (base units). */
export async function onHandMap(ingredientIds?: string[]): Promise<Map<string, number>> {
  const moves = await db.brewStockMove.findMany({ where: ingredientIds ? { ingredientId: { in: ingredientIds } } : {}, select: { ingredientId: true, kind: true, qtyBase: true, at: true } });
  const by = new Map<string, StockMove[]>();
  for (const m of moves) by.set(m.ingredientId, [...(by.get(m.ingredientId) ?? []), { kind: m.kind as StockMoveKind, qtyBase: m.qtyBase.toNumber(), at: m.at }]);
  return new Map([...by].map(([id, ms]) => [id, onHand(ms).qtyBase]));
}

// ---- The stock page ------------------------------------------------------------------------

export interface BrewStockRow {
  id: string;
  name: string;
  category: string;
  baseUnit: BaseUnit;
  conversions: CustomConversion[];
  /** The unit amounts are shown in */
  unit: string;
  /** Units an amount can be typed in */
  units: string[];
  onHand: number | null;
  onHandBase: number;
  counted: boolean;
  lastCounted: ISODate | null;
  used30: number | null;
  needed: number | null;
  weeksCover: number | null;
  status: StockStatus;
  firstShortOn: ISODate | null;
  /** Planned brews that need it in the window, earliest first */
  brews: string[];
  supplier: string | null;
  active: boolean;
}

export async function brewStockRows(): Promise<{ today: ISODate; rows: BrewStockRow[]; strays: { id: string; name: string; category: string }[] }> {
  const today = businessToday();
  const suppliers = await db.supplier.findMany({ where: { department: BREWERY, active: true }, select: { id: true, name: true } });
  const [ingredients, moves, needs, strayRows] = await Promise.all([
    db.ingredient.findMany({ where: { department: BREWERY, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true, baseUnit: true, active: true, conversions: true } }),
    db.brewStockMove.findMany({ where: { ingredient: { department: BREWERY } }, select: { ingredientId: true, kind: true, qtyBase: true, at: true } }),
    loadPlannedNeeds(addDays(today, -OVERDUE_LOOKBACK_DAYS), addDays(today, STOCK_HORIZON_DAYS), suppliers),
    // On a brewing recipe, or in a brewing category, but still on the kitchen side.
    db.ingredient.findMany({ where: { active: true, department: { not: BREWERY }, OR: [{ brewLines: { some: {} } }, { category: { in: BREWING_CATEGORIES } }] }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }),
  ]);
  const supplierOf = await brewerySupplierOf(ingredients.map((i) => i.id), suppliers);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const byIng = new Map<string, StockMove[]>();
  for (const m of moves) byIng.set(m.ingredientId, [...(byIng.get(m.ingredientId) ?? []), { kind: m.kind as StockMoveKind, qtyBase: m.qtyBase.toNumber(), at: m.at }]);
  const now = new Date();
  const monthAgo = new Date(now.getTime() - RECENT_USE_DAYS * 86_400_000);
  const rows = ingredients.map((i): BrewStockRow => {
    const base = i.baseUnit as BaseUnit;
    const conversions = conv(i.conversions);
    const unit = displayUnitFor(i.category, base);
    const shown = (q: number) => fromBase(q, unit, base, conversions);
    const ms = byIng.get(i.id) ?? [];
    const oh = onHand(ms);
    const used = usedBetween(ms, monthAgo, new Date(now.getTime() + 86_400_000));
    const mine = needs.brews.flatMap((b) => b.lines.filter((l) => l.ingredientId === i.id).map((l) => ({ on: l.dryHop && b.dryHopOn ? b.dryHopOn : b.brewOn, qtyBase: l.qtyBase, brew: b.name })));
    const st = stockStatus({ onHandBase: oh.qtyBase, needs: mine, today, counted: oh.counted });
    const sid = supplierOf.get(i.id)?.supplierId;
    return {
      id: i.id,
      name: i.name,
      category: i.category,
      baseUnit: base,
      conversions,
      unit,
      units: entryUnitsFor(base, conversions),
      onHand: shown(oh.qtyBase),
      onHandBase: oh.qtyBase,
      counted: oh.counted,
      lastCounted: oh.countedAt ? businessDateOf(oh.countedAt) : null,
      used30: shown(used),
      needed: shown(st.neededBase),
      weeksCover: weeksOfCover(oh.qtyBase, used, st.neededBase),
      status: st.status,
      firstShortOn: st.firstShortOn,
      brews: [...new Set(mine.sort((a, b) => a.on.localeCompare(b.on)).map((m) => m.brew))],
      supplier: sid ? (supplierName.get(sid) ?? null) : null,
      active: i.active,
    };
  });
  return { today, rows, strays: strayRows };
}

export interface StockMoveView {
  id: string;
  kind: StockMoveKind;
  /** In the ingredient's display unit, signed as it changed the shelf (count: the amount counted) */
  qty: number | null;
  at: string;
  note: string | null;
  invoiceId: string | null;
  batch: { id: string; code: string } | null;
  userName: string | null;
}

export async function stockHistory(ingredientId: string, take = 40): Promise<StockMoveView[]> {
  const ing = await db.ingredient.findUnique({ where: { id: ingredientId }, select: { category: true, baseUnit: true, conversions: true } });
  if (!ing) return [];
  const base = ing.baseUnit as BaseUnit;
  const unit = displayUnitFor(ing.category, base);
  const conversions = conv(ing.conversions);
  const rows = await db.brewStockMove.findMany({ where: { ingredientId }, orderBy: { at: "desc" }, take, include: { batch: { select: { id: true, code: true } } } });
  return rows.map((m) => {
    const q = m.qtyBase.toNumber();
    const invoiceId = m.note?.startsWith("invoice:") ? m.note.slice(8) : null;
    return { id: m.id, kind: m.kind as StockMoveKind, qty: fromBase(m.kind === "used" ? -q : q, unit, base, conversions), at: m.at.toISOString(), note: invoiceId ? null : m.note, invoiceId, batch: m.batch, userName: m.userName };
  });
}

// ---- Writing -------------------------------------------------------------------------------

export interface StockEntry {
  ingredientId: string;
  qty: number;
  unit: string;
}

async function toBaseEntries(entries: StockEntry[]): Promise<{ ok: { ingredientId: string; qtyBase: number }[]; errors: { ingredientId: string; error: string }[] }> {
  const ings = await db.ingredient.findMany({ where: { id: { in: entries.map((e) => e.ingredientId) } }, select: { id: true, name: true, baseUnit: true, department: true, conversions: true } });
  const by = new Map(ings.map((i) => [i.id, i]));
  const ok: { ingredientId: string; qtyBase: number }[] = [];
  const errors: { ingredientId: string; error: string }[] = [];
  for (const e of entries) {
    const i = by.get(e.ingredientId);
    if (!i || i.department !== BREWERY) {
      errors.push({ ingredientId: e.ingredientId, error: "That isn't a brewing ingredient any more. Reload the page." });
      continue;
    }
    try {
      ok.push({ ingredientId: i.id, qtyBase: brewToBase(e.qty, e.unit, i.baseUnit as BaseUnit, conv(i.conversions)) });
    } catch {
      errors.push({ ingredientId: i.id, error: `${i.name} can't be measured in ${e.unit}.` });
    }
  }
  return { ok, errors };
}

/** What's on the shelf now, one "count" move each. Blank rows are left out by the page. */
export async function saveCounts(entries: StockEntry[], userName: string): Promise<{ saved: number; errors: { ingredientId: string; error: string }[] }> {
  const { ok, errors } = await toBaseEntries(entries.filter((e) => e.qty >= 0));
  const at = new Date();
  if (ok.length) await db.brewStockMove.createMany({ data: ok.map((e) => ({ ingredientId: e.ingredientId, kind: "count", qtyBase: D(e.qtyBase), at, userName })) });
  return { saved: ok.length, errors };
}

/** A delivery: one "received" move each, with an optional note (who from, invoice number). */
export async function saveReceived(entries: StockEntry[], note: string | null, userName: string): Promise<{ saved: number; errors: { ingredientId: string; error: string }[] }> {
  const { ok, errors } = await toBaseEntries(entries.filter((e) => e.qty > 0));
  const at = new Date();
  if (ok.length) await db.brewStockMove.createMany({ data: ok.map((e) => ({ ingredientId: e.ingredientId, kind: "received", qtyBase: D(e.qtyBase), at, userName, note: note?.trim().slice(0, 200) || null })) });
  return { saved: ok.length, errors };
}

/** A fix (spilled, found a sack, a brew used more): signed, with a note saying why. */
export async function saveAdjust(e: StockEntry, note: string, userName: string): Promise<{ error?: string }> {
  if (!e.qty) return { error: "Type how much more (or, with a minus, less)." };
  const { ok, errors } = await toBaseEntries([{ ...e, qty: Math.abs(e.qty) }]);
  if (errors.length) return { error: errors[0].error };
  await db.brewStockMove.create({ data: { ingredientId: e.ingredientId, kind: "adjust", qtyBase: D(Math.sign(e.qty) * ok[0].qtyBase), note: note.trim().slice(0, 200), userName } });
  return {};
}

/** Take back a count, delivery or fix typed by mistake. What a brew used comes from the brew, so it can't be removed here. */
export async function deleteStockMove(id: string): Promise<{ error?: string }> {
  const m = await db.brewStockMove.findUnique({ where: { id }, select: { kind: true } });
  if (!m) return {};
  if (m.kind === "used") return { error: "What a brew used comes from the brew. Fix it with an adjustment instead." };
  await db.brewStockMove.delete({ where: { id } });
  return {};
}

/**
 * When an invoice is approved: its item lines for brewing ingredients (matched
 * to a product with a pack size) go in as received. Replaces what this invoice
 * added before, so approving again after reopening never counts twice.
 */
export async function receiveBrewStockFromInvoice(invoiceId: string, by: string): Promise<number> {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, approvedAt: true, lines: { where: { kind: "item" }, select: { qty: true, product: { select: { packQtyBase: true, ingredient: { select: { id: true, department: true } } } } } } },
  });
  if (!inv) return 0;
  const note = `invoice:${inv.id}`;
  const got = new Map<string, number>();
  for (const l of inv.lines) {
    const ing = l.product?.ingredient;
    const pack = l.product?.packQtyBase?.toNumber() ?? 0;
    if (!ing || ing.department !== BREWERY || !(pack > 0) || !(l.qty.toNumber() > 0)) continue;
    got.set(ing.id, (got.get(ing.id) ?? 0) + l.qty.toNumber() * pack);
  }
  const prev = await db.brewStockMove.findFirst({ where: { kind: "received", note }, select: { at: true } });
  if (!got.size && !prev) return 0;
  const at = prev?.at ?? inv.approvedAt ?? new Date();
  await db.$transaction([
    db.brewStockMove.deleteMany({ where: { kind: "received", note } }),
    db.brewStockMove.createMany({ data: [...got].map(([ingredientId, q]) => ({ ingredientId, kind: "received", qtyBase: D(q), note, at, userName: by })) }),
  ]);
  return got.size;
}

/** A new brewing ingredient, on the brewery side from the start. */
export async function addBrewingIngredient(name: string, category: string, unit: string): Promise<{ id: string } | { error: string }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!clean) return { error: "Name it first, like Pilsner malt." };
  const cat = BREWING_CATEGORIES.includes(category) ? category : "Brewing";
  const existing = await db.ingredient.findFirst({ where: { name: { equals: clean, mode: "insensitive" } }, select: { id: true, department: true } });
  if (existing) {
    if (existing.department === BREWERY) return { error: `${clean} is already on the list.` };
    return { error: `${clean} is a kitchen ingredient. Use "Bring one over from the kitchen" to move it here.` };
  }
  const baseUnit = baseUnitForBrewUnit(unit);
  const created = await db.ingredient.create({
    data: { name: clean, category: cat, baseUnit, department: BREWERY, storageArea: "Brewery", countUnit: baseUnit === "g" ? "lb" : baseUnit === "ml" ? "gal" : "each", safetyPct: new Prisma.Decimal(0) },
  });
  return { id: created.id };
}

/** Move an ingredient to the brewery side: it leaves kitchen counts and ordering, and shows here. */
export async function moveIngredientToBrewery(id: string): Promise<{ error?: string }> {
  const i = await db.ingredient.findUnique({ where: { id }, select: { id: true } });
  if (!i) return { error: "That ingredient no longer exists." };
  await db.ingredient.update({ where: { id }, data: { department: BREWERY, storageArea: "Brewery" } });
  return {};
}

/** Back to the kitchen side (moved by mistake). Its brewing stock history stays. */
export async function moveIngredientToKitchen(id: string): Promise<{ error?: string }> {
  await db.ingredient.update({ where: { id }, data: { department: "kitchen" } });
  return {};
}
