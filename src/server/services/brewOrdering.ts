import "server-only";
import { Prisma } from "@prisma/client";
import type { AttentionItem } from "@/domain/attention";
import {
  brewLead,
  brewOrderAttention,
  DUE_SOON_DAYS,
  isLeadRef,
  ORDER_HORIZON_DAYS,
  parseOrdered,
  planBrewOrders,
  withPlaced,
  type BrewOrder,
  type LeadRef,
  type OrderSupplier,
} from "@/domain/brewOrdering";
import { displayUnitFor, fromBase } from "@/domain/brewStock";
import { addDays, type ISODate } from "@/domain/dates";
import type { BaseUnit } from "@/domain/units";
import { db } from "../db";
import { BREWERY, loadPlannedNeeds, onHandMap, OVERDUE_LOOKBACK_DAYS, type PlannedNeeds } from "./brewStock";
import { businessToday } from "./sales";

/**
 * Brewery ordering: what to order from which brewing supplier, by when, for
 * each planned brew; placing and un-placing orders; brewery suppliers' lead
 * times. Kitchen ordering never sees these suppliers (department "brewery").
 *
 * A brewery supplier's lead is its own: Supplier.brewLeadDays and brewLeadRef
 * (days before brew, dry-hop or packaging day). leadTimeDays stays the
 * kitchen's "days before delivery"; it is only read here when brewLeadDays is
 * empty. Placed orders on a brew are kept by supplier id.
 */

export interface BrewerySupplierRow {
  id: string;
  name: string;
  leadDays: number;
  ref: LeadRef;
  deliveryDays: number[];
  email: string | null;
  notes: string | null;
  active: boolean;
  products: number;
}

export async function brewerySuppliers(includeInactive = true): Promise<BrewerySupplierRow[]> {
  const rows = await db.supplier.findMany({
    where: { department: BREWERY, ...(includeInactive ? {} : { active: true }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, leadTimeDays: true, brewLeadDays: true, brewLeadRef: true, deliveryDays: true, email: true, notes: true, active: true, _count: { select: { products: true } } },
  });
  return rows.map((s) => ({ id: s.id, name: s.name, ...brewLead(s), deliveryDays: s.deliveryDays, email: s.email, notes: s.notes, active: s.active, products: s._count.products }));
}

const toOrderSupplier = (s: BrewerySupplierRow): OrderSupplier => ({ id: s.id, name: s.name, leadDays: s.leadDays, ref: s.ref, deliveryDays: s.deliveryDays });

/** Planned brews up to `until` (and overdue ones still planned), their needs, and the orders. */
async function computeOrders(today: ISODate, until: ISODate): Promise<{ orders: BrewOrder[]; needs: PlannedNeeds; suppliers: BrewerySupplierRow[] }> {
  const suppliers = (await brewerySuppliers(false));
  const needs = await loadPlannedNeeds(addDays(today, -OVERDUE_LOOKBACK_DAYS), until, suppliers);
  const ids = [...new Set(needs.brews.flatMap((b) => b.lines.map((l) => l.ingredientId)))];
  const onHand = await onHandMap(ids);
  return { orders: planBrewOrders({ today, brews: needs.brews, suppliers: suppliers.map(toOrderSupplier), onHand }), needs, suppliers };
}

// ---- What others call -----------------------------------------------------------------------

/**
 * For the tank schedule: each brew's supplier orders that are needed (or
 * already placed), with the order-by day. Stock is shared out across every
 * planned brew up to the latest of these, earliest first.
 */
export async function brewOrderNeeds(batchIds: string[]): Promise<Map<string, { supplier: string; orderBy: string; placedOn: string | null }[]>> {
  const out = new Map<string, { supplier: string; orderBy: string; placedOn: string | null }[]>();
  if (!batchIds.length) return out;
  const today = businessToday();
  const latest = await db.brewBatch.aggregate({ where: { id: { in: batchIds }, status: "PLANNED" }, _max: { plannedOn: true } });
  const until = latest._max.plannedOn ? latest._max.plannedOn.toISOString().slice(0, 10) : null;
  if (!until) return out;
  const { orders } = await computeOrders(today, until > addDays(today, ORDER_HORIZON_DAYS) ? until : addDays(today, ORDER_HORIZON_DAYS));
  const wanted = new Set(batchIds);
  for (const o of orders) {
    if (!wanted.has(o.brewId) || !o.supplierId || !(o.needsOrder || o.placedOn)) continue;
    out.set(o.brewId, [...(out.get(o.brewId) ?? []), { supplier: o.supplier, orderBy: o.orderBy, placedOn: o.placedOn }]);
  }
  return out;
}

/** Overview "Needs you" and the morning brief: brewery orders due within three days, or late. */
export async function brewOrderingNeedsYou(today: ISODate = businessToday()): Promise<AttentionItem[]> {
  if (!(await db.brewBatch.count({ where: { status: "PLANNED", recipeId: { not: null }, plannedOn: { lte: new Date(`${addDays(today, ORDER_HORIZON_DAYS)}T00:00:00Z`) } } }))) return [];
  const { orders } = await computeOrders(today, addDays(today, ORDER_HORIZON_DAYS));
  return brewOrderAttention(orders.filter((o) => o.orderBy <= addDays(today, DUE_SOON_DAYS)), today);
}

// ---- The ordering page ----------------------------------------------------------------------

export interface OrderLineView {
  ingredientId: string;
  name: string;
  unit: string;
  need: number | null;
  fromStock: number | null;
  short: number | null;
  packs: number | null;
  packUnit: string | null;
  needOn: ISODate;
}

export type OrderView = Omit<BrewOrder, "lines"> & { lines: OrderLineView[] };

export interface OrderingView {
  today: ISODate;
  orders: OrderView[];
  suppliers: BrewerySupplierRow[];
  /** Kitchen suppliers, to move one over */
  kitchenSuppliers: { id: string; name: string }[];
  skipped: PlannedNeeds["skipped"];
  brews: number;
}

export async function orderingView(): Promise<OrderingView> {
  const today = businessToday();
  const [{ orders, needs }, all, kitchen] = await Promise.all([
    computeOrders(today, addDays(today, ORDER_HORIZON_DAYS)),
    brewerySuppliers(true),
    db.supplier.findMany({ where: { department: { not: BREWERY }, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const ids = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.ingredientId)))];
  const ings = ids.length ? await db.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true, category: true, baseUnit: true, conversions: true } }) : [];
  const info = new Map(ings.map((i) => [i.id, { base: i.baseUnit as BaseUnit, unit: displayUnitFor(i.category, i.baseUnit as BaseUnit), conversions: i.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })) }]));
  const views: OrderView[] = orders.map((o) => ({
    ...o,
    lines: o.lines.map((l) => {
      const i = info.get(l.ingredientId);
      const show = (q: number) => (i ? fromBase(q, i.unit, i.base, i.conversions) : null);
      return { ingredientId: l.ingredientId, name: l.name, unit: i?.unit ?? "", need: show(l.needBase), fromStock: show(l.fromStockBase), short: show(l.shortBase), packs: l.packs, packUnit: l.packUnit, needOn: l.needOn };
    }),
  }));
  return { today, orders: views, suppliers: all, kitchenSuppliers: kitchen, skipped: needs.skipped, brews: needs.brews.length };
}

// ---- Writing ---------------------------------------------------------------------------------

/** Mark a supplier's order for a brew placed (on `on`, default today) or not placed. Kept by supplier id. */
export async function setOrderPlaced(batchId: string, supplierId: string, placed: boolean, on: ISODate = businessToday()): Promise<{ error?: string }> {
  const [b, s] = await Promise.all([
    db.brewBatch.findUnique({ where: { id: batchId }, select: { ordered: true } }),
    db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }),
  ]);
  if (!b) return { error: "That brew no longer exists. Reload the page." };
  if (!s) return { error: "That supplier no longer exists. Reload the page." };
  const ordered = withPlaced(parseOrdered(b.ordered), s, placed ? on : null);
  await db.brewBatch.update({ where: { id: batchId }, data: { ordered: Object.keys(ordered).length ? ordered : Prisma.DbNull } });
  return {};
}

export type SupplierField = "name" | "leadDays" | "ref" | "deliveryDays" | "email" | "notes" | "active";

export async function setBrewerySupplierField(id: string, field: SupplierField, raw: string): Promise<{ error?: string }> {
  const s = await db.supplier.findUnique({ where: { id }, select: { id: true, department: true } });
  if (!s || s.department !== BREWERY) return { error: "That supplier isn't on the brewery side any more. Reload the page." };
  const v = raw.trim();
  switch (field) {
    case "name": {
      if (!v) return { error: "A supplier needs a name." };
      const clash = await db.supplier.findFirst({ where: { name: { equals: v, mode: "insensitive" }, id: { not: id } }, select: { id: true } });
      if (clash) return { error: "Another supplier already has that name." };
      // Placed orders are kept by supplier id, so they follow the new name.
      await db.supplier.update({ where: { id }, data: { name: v.slice(0, 120) } });
      return {};
    }
    case "leadDays": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 120) return { error: "Whole days, like 14" };
      await db.supplier.update({ where: { id }, data: { brewLeadDays: n } });
      return {};
    }
    case "ref": {
      if (!isLeadRef(v)) return { error: "Pick brew day, dry-hop day or packaging day." };
      await db.supplier.update({ where: { id }, data: { brewLeadRef: v } });
      return {};
    }
    case "deliveryDays": {
      const days = [...new Set(v.split(",").filter(Boolean).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
      await db.supplier.update({ where: { id }, data: { deliveryDays: days } });
      return {};
    }
    case "email":
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: "That doesn't look like an email address." };
      await db.supplier.update({ where: { id }, data: { email: v || null } });
      return {};
    case "notes":
      await db.supplier.update({ where: { id }, data: { notes: v.slice(0, 500) || null } });
      return {};
    case "active":
      await db.supplier.update({ where: { id }, data: { active: v === "yes" } });
      return {};
  }
}

/** A new brewing supplier, on the brewery side from the start. */
export async function addBrewerySupplier(name: string, leadDays: number, ref: LeadRef): Promise<{ id: string } | { error: string }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!clean) return { error: "Name the supplier." };
  const existing = await db.supplier.findFirst({ where: { name: { equals: clean, mode: "insensitive" } }, select: { id: true, department: true } });
  if (existing) return { error: existing.department === BREWERY ? `${clean} is already here.` : `${clean} is a kitchen supplier. Pick it under "Move a kitchen supplier here".` };
  const s = await db.supplier.create({ data: { name: clean, kind: "LOCAL", department: BREWERY, orderCadence: "as_needed", brewLeadDays: leadDays, brewLeadRef: ref } });
  return { id: s.id };
}

/** Move a supplier to the brewery side: it leaves kitchen ordering and shows here. */
export async function moveSupplierToBrewery(id: string): Promise<{ error?: string }> {
  const s = await db.supplier.findUnique({ where: { id }, select: { id: true } });
  if (!s) return { error: "That supplier no longer exists." };
  await db.supplier.update({ where: { id }, data: { department: BREWERY, orderCadence: "as_needed" } });
  return {};
}

export async function moveSupplierToKitchen(id: string): Promise<{ error?: string }> {
  await db.supplier.update({ where: { id }, data: { department: "kitchen" } });
  return {};
}
