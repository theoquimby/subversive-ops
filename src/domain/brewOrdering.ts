/**
 * Brewery ordering: what to order from each brewing supplier, by when, for each
 * planned brew. Pure; services/brewOrdering.ts feeds it.
 *
 * Each supplier has a lead time in days and a reference day it counts back
 * from: brew day (malt, yeast), the dry-hop day (hops) or packaging day
 * (labels). Order by = reference day − lead time. When a supplier only
 * delivers on some days (Omega: Tue–Fri, live yeast shipped overnight), the
 * order-by day moves earlier until the next day is a delivery day.
 *
 * Stock is given to planned brews in the order they need it (brew day, or the
 * dry-hop day for dry-hop additions), so the earliest brew is covered first and
 * a later one orders what's left short. A dry-hop supplier whose hops also go
 * in on brew day (and are short) is ordered for brew day instead.
 */

import type { AttentionItem } from "./attention";
import { addDays, daysBetween, WEEKDAYS, weekday, type ISODate } from "./dates";

export type LeadRef = "brew" | "dryHop" | "pkg";
export const LEAD_REFS: LeadRef[] = ["brew", "dryHop", "pkg"];
export const LEAD_REF_LABEL: Record<LeadRef, string> = { brew: "Brew day", dryHop: "Dry-hop day", pkg: "Packaging day" };
/**
 * The old Setting that held each brewery supplier's reference day, JSON by
 * supplier id. Ops now keeps it on the supplier (Supplier.brewLeadRef) and no
 * longer reads this; the name stays for the Brew Manager import until it
 * writes the column.
 */
export const LEAD_REFS_KEY = "brewery.supplierLeadRefs";
/** Lead time assumed for an ingredient with no brewery supplier yet. */
export const DEFAULT_LEAD_DAYS = 14;
/** Order-bys this close (or late) go on the Overview and the morning brief. */
export const DUE_SOON_DAYS = 3;
/** Planned brews this far ahead are on the ordering page. */
export const ORDER_HORIZON_DAYS = 84;
export const NO_SUPPLIER = "No supplier set";

export const isLeadRef = (s: unknown): s is LeadRef => s === "brew" || s === "dryHop" || s === "pkg";

/**
 * A brewery supplier's lead time and what it counts back from, from its own
 * columns: brewLeadDays (falling back to leadTimeDays, where the brewery kept
 * it before, and where the Brew Manager import still writes it) and brewLeadRef
 * (brew day when unset).
 */
export function brewLead(s: { brewLeadDays: number | null; brewLeadRef: string | null; leadTimeDays: number }): { leadDays: number; ref: LeadRef } {
  return { leadDays: s.brewLeadDays ?? s.leadTimeDays, ref: isLeadRef(s.brewLeadRef) ? s.brewLeadRef : "brew" };
}

export function parseLeadRefs(raw: string | null | undefined): Record<string, LeadRef> {
  if (!raw) return {};
  try {
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    return Object.fromEntries(Object.entries(o).filter(([, v]) => isLeadRef(v))) as Record<string, LeadRef>;
  } catch {
    return {};
  }
}

/**
 * Placed orders on a brew: { "<supplier id>": "YYYY-MM-DD" }. Entries from
 * before suppliers were linked by id, whose name matched no supplier, are still
 * under the name.
 */
export function parseOrdered(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => k && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) as Record<string, string>;
}

/** When a supplier's order for a brew was placed: by its id, else an older entry under its name. */
export const placedOnFor = (ordered: Readonly<Record<string, string>>, s: { id: string; name: string }): string | null => ordered[s.id] ?? ordered[s.name] ?? null;

/** Mark a supplier's order placed on `on` (or not placed, with null): kept by supplier id; any older entry under its name goes. */
export function withPlaced(ordered: Readonly<Record<string, string>>, s: { id: string; name: string }, on: string | null): Record<string, string> {
  const out = { ...ordered };
  delete out[s.name];
  if (on) out[s.id] = on;
  else delete out[s.id];
  return out;
}

export function orderByDate(ref: ISODate, leadDays: number, deliveryDays: readonly number[]): ISODate {
  let d = addDays(ref, -Math.max(0, Math.round(leadDays)));
  const days = deliveryDays.filter((x) => x >= 0 && x <= 6);
  if (days.length && days.length < 7) for (let i = 0; i < 7 && !days.includes(weekday(addDays(d, 1))); i++) d = addDays(d, -1);
  return d;
}

/** Brew Manager's short names for its suppliers, to guess one from a recipe line. */
const ALIASES: [RegExp, RegExp][] = [
  [/hudson valley|\bhvm\b|\bnys\b/i, /hudson valley/i],
  [/\bnyhg\b|hop guild/i, /hop guild/i],
  [/yakima/i, /yakima/i],
  [/omega/i, /omega/i],
  [/lallemand|morebeer/i, /morebeer/i],
];

/** The brewery supplier a recipe line or ingredient name points at, by its name or a known short name. Null when unsure. */
export function detectBrewSupplier(text: string, suppliers: readonly { id: string; name: string }[]): string | null {
  const t = text.toLowerCase();
  const own = suppliers.find((s) => s.name.trim().length >= 3 && t.includes(s.name.trim().toLowerCase()));
  if (own) return own.id;
  for (const [hint, name] of ALIASES) {
    if (!hint.test(text)) continue;
    const s = suppliers.find((x) => name.test(x.name));
    if (s) return s.id;
  }
  return null;
}

// ---- Planning -----------------------------------------------------------------------------

export interface OrderSupplier {
  id: string;
  name: string;
  leadDays: number;
  ref: LeadRef;
  /** Days it can arrive, 0 = Sun; empty = any day */
  deliveryDays: number[];
}

export interface NeedLine {
  ingredientId: string;
  name: string;
  /** Scaled to the brew, in the ingredient's base unit */
  qtyBase: number;
  /** A dry-hop addition: needed on the dry-hop day, not brew day */
  dryHop: boolean;
  supplierId: string | null;
  /** How the supplier sells it (a 50 lb sack), to suggest whole packs */
  pack?: { qtyBase: number; unit: string } | null;
}

export interface PlannedBrew {
  id: string;
  code: string;
  name: string;
  brewOn: ISODate;
  dryHopOn: ISODate | null;
  packageOn: ISODate | null;
  ordered: Record<string, string>;
  lines: NeedLine[];
}

export interface OrderLine {
  ingredientId: string;
  name: string;
  needOn: ISODate;
  needBase: number;
  fromStockBase: number;
  shortBase: number;
  /** Whole packs to order for the shortfall, when the pack size is known */
  packs: number | null;
  packUnit: string | null;
}

export interface BrewOrder {
  key: string;
  supplierId: string | null;
  supplier: string;
  brewId: string;
  brewCode: string;
  brewName: string;
  brewOn: ISODate;
  ref: LeadRef;
  refOn: ISODate;
  orderBy: ISODate;
  placedOn: string | null;
  /** Something is short (or it's labels): an order is needed */
  needsOrder: boolean;
  /** Needs ordering, isn't placed, and the order-by day has passed */
  overdue: boolean;
  /** A packaging supplier with nothing on the recipe: labels for this brew */
  labelsOnly: boolean;
  lines: OrderLine[];
}

// A millionth of a pack: unit conversion and batch scaling leave float dust (750 lb read back as 750.0000001).
const EPS = 1e-6;

export function planBrewOrders(i: { today: ISODate; brews: PlannedBrew[]; suppliers: OrderSupplier[]; onHand: ReadonlyMap<string, number> }): BrewOrder[] {
  const suppliers = new Map(i.suppliers.map((s) => [s.id, s]));
  // Merge the same ingredient at the same stage within a brew.
  type Need = OrderLine & { brew: PlannedBrew; dryHop: boolean; supplierId: string | null; pack: NeedLine["pack"] };
  const needs: Need[] = [];
  for (const b of i.brews) {
    const merged = new Map<string, Need>();
    for (const l of b.lines) {
      if (!(l.qtyBase > 0)) continue;
      const k = `${l.ingredientId}|${l.dryHop}`;
      const prev = merged.get(k);
      if (prev) {
        prev.needBase += l.qtyBase;
        continue;
      }
      const supplierId = l.supplierId && suppliers.has(l.supplierId) ? l.supplierId : null;
      merged.set(k, { ingredientId: l.ingredientId, name: l.name, needOn: l.dryHop && b.dryHopOn ? b.dryHopOn : b.brewOn, needBase: l.qtyBase, fromStockBase: 0, shortBase: 0, packs: null, packUnit: null, brew: b, dryHop: l.dryHop, supplierId, pack: l.pack ?? null });
    }
    needs.push(...merged.values());
  }
  // Stock to the earliest need first.
  const left = new Map<string, number>();
  for (const n of [...needs].sort((a, b) => a.needOn.localeCompare(b.needOn) || a.brew.brewOn.localeCompare(b.brew.brewOn) || a.brew.code.localeCompare(b.brew.code))) {
    const have = left.get(n.ingredientId) ?? Math.max(0, i.onHand.get(n.ingredientId) ?? 0);
    const take = Math.min(have, n.needBase);
    left.set(n.ingredientId, have - take);
    n.fromStockBase = take;
    n.shortBase = n.needBase - take > EPS ? n.needBase - take : 0;
    n.packs = n.pack && n.pack.qtyBase > 0 ? (n.shortBase > 0 ? Math.ceil(n.shortBase / n.pack.qtyBase - EPS) : 0) : null;
    n.packUnit = n.pack?.unit ?? null;
  }

  const out: BrewOrder[] = [];
  for (const b of i.brews) {
    const mine = needs.filter((n) => n.brew === b);
    const groups = new Map<string | null, Need[]>();
    for (const n of mine) groups.set(n.supplierId, [...(groups.get(n.supplierId) ?? []), n]);
    for (const s of i.suppliers) if (s.ref === "pkg" && !groups.has(s.id)) groups.set(s.id, []);
    for (const [supplierId, lines] of groups) {
      const s = supplierId ? suppliers.get(supplierId)! : null;
      const ref: LeadRef = s?.ref ?? "brew";
      const short = lines.filter((l) => l.shortBase > 0);
      const decides = short.length ? short : lines;
      let refOn = b.brewOn;
      let usedRef: LeadRef = "brew";
      if (ref === "pkg") {
        refOn = b.packageOn ?? b.brewOn;
        usedRef = "pkg";
      } else if (ref === "dryHop" && b.dryHopOn && decides.length && decides.every((l) => l.dryHop)) {
        refOn = b.dryHopOn;
        usedRef = "dryHop";
      }
      const labelsOnly = ref === "pkg" && lines.length === 0;
      const needsOrder = labelsOnly || short.length > 0;
      const orderBy = orderByDate(refOn, s?.leadDays ?? DEFAULT_LEAD_DAYS, s?.deliveryDays ?? []);
      const placedOn = s ? placedOnFor(b.ordered, s) : null;
      out.push({
        key: `${b.id}|${supplierId ?? "-"}`,
        supplierId,
        supplier: s?.name ?? NO_SUPPLIER,
        brewId: b.id,
        brewCode: b.code,
        brewName: b.name,
        brewOn: b.brewOn,
        ref: usedRef,
        refOn,
        orderBy,
        placedOn,
        needsOrder,
        overdue: needsOrder && !placedOn && orderBy < i.today,
        labelsOnly,
        lines: lines.map(({ ingredientId, name, needOn, needBase, fromStockBase, shortBase, packs, packUnit }) => ({ ingredientId, name, needOn, needBase, fromStockBase, shortBase, packs, packUnit })),
      });
    }
  }
  return out.sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.brewOn.localeCompare(b.brewOn) || a.supplier.localeCompare(b.supplier));
}

// ---- Grouping and the Overview ------------------------------------------------------------

export type OrderBucket = "overdue" | "thisWeek" | "nextWeek" | "later" | "placed" | "covered";
export const BUCKETS: { id: OrderBucket; label: string }[] = [
  { id: "overdue", label: "Late" },
  { id: "thisWeek", label: "Order this week" },
  { id: "nextWeek", label: "Next week" },
  { id: "later", label: "Later" },
  { id: "placed", label: "Placed" },
  { id: "covered", label: "Covered by stock" },
];

/** Weeks run Monday to Sunday. */
export const endOfWeek = (d: ISODate): ISODate => addDays(d, (7 - weekday(d)) % 7);

export function orderBucket(o: Pick<BrewOrder, "orderBy" | "placedOn" | "needsOrder">, today: ISODate): OrderBucket {
  if (o.placedOn) return "placed";
  if (!o.needsOrder) return "covered";
  if (o.orderBy < today) return "overdue";
  const end = endOfWeek(today);
  if (o.orderBy <= end) return "thisWeek";
  if (o.orderBy <= addDays(end, 7)) return "nextWeek";
  return "later";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "today", "tomorrow" or "Fri Nov 20". */
export function dayLabel(today: ISODate, d: ISODate): string {
  if (d === today) return "today";
  if (d === addDays(today, 1)) return "tomorrow";
  return `${WEEKDAYS[weekday(d)]} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
}

const sentence = (o: BrewOrder, today: ISODate) => `${o.supplier} by ${dayLabel(today, o.orderBy)} for ${o.brewName}`;

export function brewOrderAttention(orders: readonly BrewOrder[], today: ISODate): AttentionItem[] {
  const soon = addDays(today, DUE_SOON_DAYS);
  const due = orders.filter((o) => o.needsOrder && !o.placedOn && o.supplierId && o.orderBy <= soon).sort((a, b) => a.orderBy.localeCompare(b.orderBy));
  if (!due.length) return [];
  const late = (o: BrewOrder) => daysBetween(o.orderBy, today);
  const detail = (o: BrewOrder) => {
    const what = o.labelsOnly ? "Labels" : o.lines.filter((l) => l.shortBase > 0).map((l) => l.name).slice(0, 3).join(", ");
    const when = o.orderBy < today ? `${late(o)} day${late(o) === 1 ? "" : "s"} late` : `Brew day ${dayLabel(today, o.brewOn)}`;
    return [when, what].filter(Boolean).join(" · ");
  };
  if (due.length > 3) {
    const anyLate = due.some((o) => o.orderBy < today);
    return [{
      key: "brewery.orders",
      title: `${due.length} brewery orders to place`,
      detail: `${sentence(due[0], today)}, and ${due.length - 1} more`,
      href: "/brewery/ordering",
      tone: anyLate ? "bad" : "warn",
      urgency: anyLate ? 70 : 56,
    }];
  }
  return due.map((o) => ({
    key: `brewery.order.${o.supplierId}.${o.brewId}`,
    title: `Order ${sentence(o, today)}`,
    detail: detail(o),
    href: "/brewery/ordering",
    tone: o.orderBy < today ? "bad" : "warn",
    urgency: o.orderBy < today ? 70 : o.orderBy === today ? 62 : 50,
  }));
}
