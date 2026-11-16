import "server-only";
import { toISODate, weekday, addDays, type ISODate } from "@/domain/dates";
import { cutoffRule, deadlineFor, hoursUntil } from "@/domain/ordering";
import { usualQty } from "@/domain/orderGuards";
import { sortByGuide, type SendLine } from "@/domain/orderSend";
import type { SupplierPrefs } from "@/domain/supplierPrefs";
import { db } from "../db";
import { loadCutoffRules, localNow } from "./planning";
import { getBusinessContact } from "./settings";
import { loadSupplierPrefs, prefsOf } from "./supplierPrefs";
import { loadOrder } from "./orders";

/**
 * What placing an order needs beyond the order itself: the usual quantity of
 * each item (for "far above usual" warnings), the supplier's own item order
 * (for keying into their site), the deadline for that delivery, and how the
 * supplier takes orders.
 */

/** The middle quantity of each product over its last few sent or received orders. */
export async function usualQuantities(productIds: string[], last = 8): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (productIds.length === 0) return out;
  const rows = await db.purchaseOrderLine.findMany({
    where: { supplierProductId: { in: productIds }, qty: { gt: 0 }, order: { status: { in: ["SENT", "RECEIVED"] } } },
    orderBy: { order: { createdAt: "desc" } },
    select: { supplierProductId: true, qty: true },
    take: productIds.length * last * 2,
  });
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const list = by.get(r.supplierProductId) ?? [];
    if (list.length < last) list.push(r.qty.toNumber());
    by.set(r.supplierProductId, list);
  }
  for (const id of productIds) out.set(id, usualQty(by.get(id) ?? []));
  return out;
}

/**
 * The supplier's own order for its items, where known: the line order of its most
 * recent invoices (invoices follow their order guide / warehouse order). SKU → rank.
 */
export async function guideOrder(supplierId: string): Promise<Map<string, number>> {
  const invoices = await db.invoice.findMany({
    where: { supplierId },
    orderBy: { invoiceDate: "desc" },
    take: 6,
    select: { lines: { orderBy: { id: "asc" }, select: { sku: true } } },
  });
  const rank = new Map<string, number>();
  let i = 0;
  for (const inv of invoices) for (const l of inv.lines) if (l.sku && !rank.has(l.sku)) rank.set(l.sku, i++);
  return rank;
}

/** Minutes until the order cutoff for a delivery (negative once passed); null without delivery days. */
export async function minutesToCutoff(supplier: { id: string; leadTimeDays: number; deliveryDays: number[] }, deliveryDate: ISODate, now = new Date()): Promise<{ mins: number; cutoffDate: ISODate; cutoffTime: string } | null> {
  if (!supplier.deliveryDays.includes(weekday(deliveryDate))) return null;
  const rule = cutoffRule((await loadCutoffRules())[supplier.id], supplier.leadTimeDays);
  const d = deadlineFor(rule, weekday(deliveryDate));
  const cutoffDate = addDays(deliveryDate, -d.daysBefore);
  const local = localNow(now);
  return { mins: Math.round(hoursUntil(local.date, local.time, cutoffDate, d.time) * 60), cutoffDate, cutoffTime: d.time };
}

export interface OrderToSend {
  id: string;
  status: "DRAFT" | "SENT" | "RECEIVED";
  supplier: { id: string; name: string; email: string | null };
  prefs: SupplierPrefs;
  deliveryDate: ISODate;
  /** In the supplier's own item order where known. */
  lines: SendLine[];
  cutoff: { mins: number; cutoffDate: ISODate; cutoffTime: string } | null;
  /** Business name, for the sign-off. */
  from: string;
}

export async function orderToSend(orderId: string): Promise<OrderToSend | null> {
  const o = await loadOrder(orderId);
  if (!o) return null;
  const [allPrefs, guide, cutoff, contact] = await Promise.all([loadSupplierPrefs(), guideOrder(o.supplierId), minutesToCutoff(o.supplier, toISODate(o.deliveryDate)), getBusinessContact()]);
  const lines = o.lines
    .filter((l) => l.qty.toNumber() > 0)
    .map((l) => ({ qty: l.qty.toNumber(), unit: l.product.purchaseUnit, name: l.product.description, sku: l.product.sku }));
  return {
    id: o.id,
    status: o.status,
    supplier: { id: o.supplier.id, name: o.supplier.name, email: o.supplier.email },
    prefs: prefsOf(allPrefs, o.supplierId),
    deliveryDate: toISODate(o.deliveryDate),
    lines: sortByGuide(lines, guide),
    cutoff,
    from: contact.name,
  };
}
