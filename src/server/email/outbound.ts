import "server-only";
import { createHash } from "node:crypto";
import { toISODate } from "@/domain/dates";
import { creditItems } from "@/domain/invoiceMatch";
import { db, num } from "../db";
import { emailConfigured, emailDeliveryStatus, isEmail, sendEmail, type DeliveryEvent } from "../integrations/email";
import { loadOrder, orderAsCsv } from "../services/orders";
import { loadTolerance } from "../services/invoices";
import { emailForUser } from "../services/notify";
import { creditRequestEmail, purchaseOrderEmail } from "./templates";

/**
 * Emails that go to suppliers on a manager's behalf (not notifications — no prefs).
 * Who sent what is kept in the Setting table (`po.sent.<orderId>`) so we don't need a schema change.
 */

export interface SentRecord {
  at: string;
  byUserId: string;
  byName: string;
  to: string;
  cc: string[];
  emailId: string | null;
}

const hash = (parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const sentKey = (orderId: string) => `po.sent.${orderId}`;

export async function poSentRecord(orderId: string): Promise<SentRecord | null> {
  const row = await db.setting.findUnique({ where: { key: sentKey(orderId) } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SentRecord;
  } catch {
    return null;
  }
}

export async function poDelivery(orderId: string): Promise<{ record: SentRecord | null; status: DeliveryEvent | null }> {
  const record = await poSentRecord(orderId);
  return { record, status: record?.emailId ? await emailDeliveryStatus(record.emailId) : null };
}

export const csvFilename = (supplier: string, deliveryDate: Date) => `${supplier}-${toISODate(deliveryDate)}.csv`.replace(/[^\w.-]+/g, "-");

export type OutboundResult = { ok: true; to: string; cc: string[] } | { skipped: string } | { error: string };

export async function sendPurchaseOrder(args: { orderId: string; to: string; copyMe: boolean; by: { userId: string; name: string } }): Promise<OutboundResult> {
  if (!emailConfigured()) return { skipped: "Email isn't set up yet" };
  const o = await loadOrder(args.orderId);
  if (!o) return { error: "That order doesn't exist anymore." };
  if (o.status === "RECEIVED") return { error: "This order was already checked in." };
  const to = args.to.trim();
  if (!isEmail(to)) return { error: "That email address doesn't look right." };
  const me = await emailForUser(args.by.userId);
  if (args.copyMe && !me) return { error: "Add your email in Settings → Notifications to get a copy." };
  const cc = args.copyMe && me ? [me] : [];

  const filename = csvFilename(o.supplier.name, o.deliveryDate);
  const rendered = purchaseOrderEmail({
    supplierName: o.supplier.name,
    deliveryDate: toISODate(o.deliveryDate),
    notes: o.notes,
    senderName: args.by.name,
    replyTo: me,
    csvFilename: filename,
    lines: o.lines.map((l) => ({ sku: l.product.sku, description: l.product.description, qty: l.qty.toNumber(), unit: l.product.purchaseUnit, unitPrice: num(l.unitPrice) })),
  });
  const r = await sendEmail({
    to,
    cc,
    replyTo: me ?? undefined,
    ...rendered,
    attachments: [{ filename, content: orderAsCsv(o), contentType: "text/csv" }],
    tags: { kind: "purchase_order" },
    // A double-click (or a retry after a timeout) won't email the supplier twice.
    idempotencyKey: `po-${o.id}-${hash([to, ...cc, ...o.lines.map((l) => `${l.id}:${l.qty}`)])}`,
  });
  if (!("ok" in r)) return r;

  const record: SentRecord = { at: new Date().toISOString(), byUserId: args.by.userId, byName: args.by.name, to, cc, emailId: r.id };
  await db.$transaction([
    db.setting.upsert({ where: { key: sentKey(o.id) }, create: { key: sentKey(o.id), value: JSON.stringify(record) }, update: { value: JSON.stringify(record) } }),
    ...(o.status === "DRAFT" ? [db.purchaseOrder.update({ where: { id: o.id }, data: { status: "SENT", sentAt: new Date() } })] : []),
    // Remember the address for next time if the supplier didn't have one.
    ...(!o.supplier.email ? [db.supplier.update({ where: { id: o.supplierId }, data: { email: to } })] : []),
  ]);
  return { ok: true, to, cc };
}

/** Record a manual "Mark as sent" so the page can say who did it. */
export async function recordManualSend(orderId: string, by: { userId: string; name: string }) {
  const record: SentRecord = { at: new Date().toISOString(), byUserId: by.userId, byName: by.name, to: "", cc: [], emailId: null };
  await db.setting.upsert({ where: { key: sentKey(orderId) }, create: { key: sentKey(orderId), value: JSON.stringify(record) }, update: { value: JSON.stringify(record) } });
}

/**
 * Email the supplier a credit request for an invoice's short/overcharged lines.
 * For the invoices feature to call from its own action (e.g. a "Send" button in CreditSheet).
 */
export async function sendCreditRequest(args: { invoiceId: string; to?: string; copyMe?: boolean; by: { userId: string; name: string } }): Promise<OutboundResult> {
  if (!emailConfigured()) return { skipped: "Email isn't set up yet" };
  const inv = await db.invoice.findUnique({ where: { id: args.invoiceId }, omit: { image: true }, include: { supplier: true, lines: { orderBy: { id: "asc" } } } });
  if (!inv) return { error: "That invoice doesn't exist anymore." };
  const to = (args.to ?? inv.supplier.email ?? "").trim();
  if (!isEmail(to)) return { error: "Add the supplier's email first." };
  const lines = inv.lines.map((l) => ({ description: l.description, sku: l.sku, qty: num(l.qty)!, unitPrice: num(l.unitPrice)!, expectedQty: num(l.expectedQty), expectedPrice: num(l.expectedPrice) }));
  const items = creditItems(lines, await loadTolerance());
  if (items.length === 0) return { error: "Nothing to request — every line matches." };
  const me = await emailForUser(args.by.userId);
  const rendered = creditRequestEmail({ supplierName: inv.supplier.name, invoiceNumber: inv.invoiceNumber, invoiceDate: toISODate(inv.invoiceDate), items, senderName: args.by.name, replyTo: me });
  const cc = args.copyMe && me ? [me] : [];
  const r = await sendEmail({ to, cc, replyTo: me ?? undefined, ...rendered, tags: { kind: "credit_request" }, idempotencyKey: `credit-${inv.id}-${hash([to, ...cc, ...items.map((i) => String(i.amount))])}` });
  if (!("ok" in r)) return r;
  await db.setting.upsert({
    where: { key: `invoice.credit.${inv.id}` },
    create: { key: `invoice.credit.${inv.id}`, value: JSON.stringify({ at: new Date().toISOString(), byName: args.by.name, to, emailId: r.id }) },
    update: { value: JSON.stringify({ at: new Date().toISOString(), byName: args.by.name, to, emailId: r.id }) },
  });
  return { ok: true, to, cc };
}
