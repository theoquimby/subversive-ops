"use server";

import { parseISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { deliveryWindow, draftSuggestedOrder, loadCutoffRules, localNow, saveCutoffRule, supplierCutoffs } from "@/server/services/planning";
import { cutoffRule, nextCutoff } from "@/domain/ordering";
import { recordManualSend, sendPurchaseOrder } from "@/server/email/outbound";
import { businessToday } from "@/server/services/sales";
import { dismissCadenceNotice, saveStaffOrderers, saveSupplierPrefs } from "@/server/services/supplierPrefs";
import { currentPrices } from "./estimate";
import { mergeIntoDraft } from "@/domain/purchasing";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const draftSchema = z.object({
  supplierId: z.string(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(z.object({ supplierProductId: z.string(), suggestedQty: z.number().min(0), qty: z.number().min(0), unitPrice: z.number().nullable() })),
});

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

/**
 * Save the builder's order as a draft. When a draft for the same supplier and
 * delivery is already there, the lines go into it (an item on both takes the
 * new quantity) instead of making a second draft; the order page says so.
 */
export async function createOrder(input: z.infer<typeof draftSchema>) {
  await requireUser("MANAGER");
  const p = draftSchema.safeParse(input);
  if (!p.success) return { error: "Some quantities don't look right. Check them and save again." };
  const v = p.data;
  const lines = v.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) return { error: "Nothing to order. Every quantity is zero." };
  const existing = await db.purchaseOrder.findFirst({
    where: { supplierId: v.supplierId, status: "DRAFT", deliveryDate: parseISODate(v.deliveryDate) },
    include: { lines: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    const m = mergeIntoDraft(
      existing.lines.map((l) => ({ id: l.id, supplierProductId: l.supplierProductId, qty: l.qty.toNumber(), suggestedQty: l.suggestedQty.toNumber(), unitPrice: l.unitPrice?.toNumber() ?? null })),
      lines,
    );
    const until = parseISODate(v.coverUntil);
    await db.$transaction([
      ...m.update.map((u) => db.purchaseOrderLine.update({ where: { id: u.id }, data: { qty: dec(u.qty), suggestedQty: dec(u.suggestedQty), unitPrice: u.unitPrice == null ? null : dec(u.unitPrice) } })),
      ...(m.create.length ? [db.purchaseOrderLine.createMany({ data: m.create.map((l) => ({ orderId: existing.id, supplierProductId: l.supplierProductId, suggestedQty: dec(l.suggestedQty), qty: dec(l.qty), unitPrice: l.unitPrice == null ? null : dec(l.unitPrice) })) })] : []),
      ...(until > existing.coverUntil ? [db.purchaseOrder.update({ where: { id: existing.id }, data: { coverUntil: until } })] : []),
    ]);
    revalidatePath("/ordering");
    revalidatePath(`/ordering/po/${existing.id}`);
    redirect(`/ordering/po/${existing.id}?merged=${m.update.length}-${m.create.length}`);
  }
  const po = await db.purchaseOrder.create({
    data: {
      supplierId: v.supplierId,
      deliveryDate: parseISODate(v.deliveryDate),
      coverUntil: parseISODate(v.coverUntil),
      lines: {
        create: lines.map((l) => ({
          supplierProductId: l.supplierProductId,
          suggestedQty: new Prisma.Decimal(l.suggestedQty),
          qty: new Prisma.Decimal(l.qty),
          unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice),
        })),
      },
    },
  });
  revalidatePath("/ordering");
  redirect(`/ordering/po/${po.id}`);
}

const orderId = z.string().min(1).max(40);
const qtySchema = z.number().finite().min(0).max(99_999_999.99);
const receiveSchema = z.object({ id: orderId, lines: z.array(z.object({ lineId: z.string().min(1).max(40), received: qtySchema })).max(500) });

function orderChanged(id: string) {
  revalidatePath(`/ordering/po/${id}`);
  revalidatePath("/ordering");
}

/**
 * Check in a delivery: what came in, line by line (a line left out counts as
 * received as ordered). Works from a sent order, or straight from a draft that
 * was phoned in. Received quantities go into estimated stock from the moment
 * of check-in until the next count. A receipt being fixed (reopened) keeps its
 * first check-in time, so a count taken since isn't counted twice.
 */
export async function receiveOrder(input: z.input<typeof receiveSchema>): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = receiveSchema.safeParse(input);
  if (!v.success) return { error: "Some received amounts aren't numbers. Check them and try again." };
  const po = await db.purchaseOrder.findUnique({ where: { id: v.data.id }, include: { lines: true } });
  if (!po) return { error: "That order doesn't exist anymore." };
  if (po.status === "RECEIVED") return { error: "This delivery is already checked in. Reopen it to fix it." };
  const got = new Map(v.data.lines.map((l) => [l.lineId, l.received]));
  const now = new Date();
  await db.$transaction([
    ...po.lines.map((l) => db.purchaseOrderLine.update({ where: { id: l.id }, data: { receivedQty: dec(got.get(l.id) ?? l.qty.toNumber()) } })),
    db.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED", receivedAt: po.receivedAt ?? now, sentAt: po.sentAt ?? now } }),
  ]);
  orderChanged(po.id);
  revalidatePath("/brief");
  return {};
}

/** Undo a check-in to fix what was received. The amounts entered stay as the starting point. */
export async function reopenOrder(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = orderId.safeParse(id);
  if (!v.success) return { error: "That order doesn't exist anymore." };
  const r = await db.purchaseOrder.updateMany({ where: { id: v.data, status: "RECEIVED" }, data: { status: "SENT" } });
  if (!r.count) return { error: "Only a checked-in delivery can be reopened." };
  orderChanged(v.data);
  revalidatePath("/brief");
  return {};
}

// ---- Editing a draft order, line by line ----------------------------------------------

async function draftLine(lineId: string) {
  const l = await db.purchaseOrderLine.findUnique({ where: { id: lineId }, include: { order: { select: { id: true, status: true } } } });
  if (!l) return { error: "That line is gone. Reload the page." } as const;
  if (l.order.status !== "DRAFT") return { error: "Only a draft can be changed. This order has been sent." } as const;
  return { line: l } as const;
}

/** A new quantity for one line of a draft. */
export async function updateOrderLine(lineId: string, qty: number): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = z.object({ lineId: orderId, qty: qtySchema.positive() }).safeParse({ lineId, qty });
  if (!v.success) return { error: "Enter a quantity above zero, like 2 or 1.5." };
  const d = await draftLine(v.data.lineId);
  if ("error" in d) return { error: d.error };
  await db.purchaseOrderLine.update({ where: { id: d.line.id }, data: { qty: dec(v.data.qty) } });
  orderChanged(d.line.order.id);
  return {};
}

export interface RemovedLine { orderId: string; supplierProductId: string; qty: number; suggestedQty: number; unitPrice: number | null }

/** Take a line off a draft. Returns what was removed, so Undo can put it back. */
export async function removeOrderLine(lineId: string): Promise<{ error?: string; removed?: RemovedLine }> {
  await requireUser("MANAGER");
  const v = orderId.safeParse(lineId);
  if (!v.success) return { error: "That line is gone. Reload the page." };
  const d = await draftLine(v.data);
  if ("error" in d) return { error: d.error };
  const l = d.line;
  await db.purchaseOrderLine.delete({ where: { id: l.id } });
  orderChanged(l.order.id);
  return { removed: { orderId: l.order.id, supplierProductId: l.supplierProductId, qty: l.qty.toNumber(), suggestedQty: l.suggestedQty.toNumber(), unitPrice: l.unitPrice?.toNumber() ?? null } };
}

const addLineSchema = z.object({
  orderId,
  supplierProductId: z.string().min(1).max(40),
  qty: qtySchema.positive(),
  suggestedQty: qtySchema.optional(),
  unitPrice: z.number().finite().min(0).max(99_999_999.99).nullable().optional(),
});

/**
 * Add one of the supplier's items to a draft (or put back a removed line).
 * Priced from the current price list when no price is given. An item already
 * on the draft gets the quantity added to it.
 */
export async function addOrderLine(input: z.input<typeof addLineSchema>): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = addLineSchema.safeParse(input);
  if (!v.success) return { error: "Pick an item and a quantity above zero." };
  const { supplierProductId, qty } = v.data;
  const po = await db.purchaseOrder.findUnique({ where: { id: v.data.orderId }, select: { id: true, status: true, supplierId: true, lines: { where: { supplierProductId }, select: { id: true, qty: true } } } });
  if (!po) return { error: "That order doesn't exist anymore." };
  if (po.status !== "DRAFT") return { error: "Only a draft can be changed. This order has been sent." };
  const product = await db.supplierProduct.findUnique({ where: { id: supplierProductId }, select: { supplierId: true } });
  if (!product || product.supplierId !== po.supplierId) return { error: "That item isn't sold by this supplier." };
  const same = po.lines[0];
  if (same) {
    await db.purchaseOrderLine.update({ where: { id: same.id }, data: { qty: dec(same.qty.toNumber() + qty) } });
  } else {
    const price = v.data.unitPrice !== undefined ? v.data.unitPrice : (await currentPrices([supplierProductId], businessToday())).get(supplierProductId) ?? null;
    await db.purchaseOrderLine.create({ data: { orderId: po.id, supplierProductId, qty: dec(qty), suggestedQty: dec(v.data.suggestedQty ?? 0), unitPrice: price == null ? null : dec(price) } });
  }
  orderChanged(po.id);
  return {};
}

export async function deleteDraft(id: string) {
  await requireUser("MANAGER");
  await db.purchaseOrder.delete({ where: { id, status: "DRAFT" } });
  revalidatePath("/ordering");
  redirect("/ordering");
}

// ---- Order cutoffs ------------------------------------------------------------------

const cutoffField = z.discriminatedUnion("field", [
  z.object({ field: z.literal("time"), value: z.string().trim() }),
  z.object({ field: z.literal("daysBefore"), value: z.string().trim() }),
  z.object({ field: z.literal("autoDraft"), value: z.enum(["on", "off"]) }),
]);

/** "2pm", "14:00", "2:30 pm" → "14:00" / "14:30". */
function parseTime(raw: string): string | null {
  const m = raw.toLowerCase().replace(/\s+/g, "").match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export async function saveCutoff(supplierId: string, field: string, value: string) {
  await requireUser("MANAGER");
  const v = cutoffField.safeParse({ field, value });
  if (!v.success) return { error: "That doesn't look right." };
  if (v.data.field === "time") {
    const t = parseTime(v.data.value);
    if (!t) return { error: "Enter a time like 2pm or 14:00." };
    await saveCutoffRule(supplierId, { time: t });
  } else if (v.data.field === "daysBefore") {
    const n = Number(v.data.value);
    if (!Number.isInteger(n) || n < 0 || n > 14) return { error: "Enter whole days, 0–14." };
    await saveCutoffRule(supplierId, { daysBefore: n });
  } else {
    await saveCutoffRule(supplierId, { autoDraft: v.data.value === "on" });
  }
  revalidatePath("/ordering");
}

const scheduleSchema = z.object({
  deliveryDays: z.array(z.number().int().min(0).max(6)).max(7),
  perDay: z.record(z.string().regex(/^[0-6]$/), z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })),
  autoDraft: z.boolean(),
});

/** Delivery days and an order deadline for each: "Friday delivery → order by Wednesday 5pm". */
export async function saveDeliverySchedule(supplierId: string, input: z.input<typeof scheduleSchema>): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = scheduleSchema.safeParse(input);
  if (!v.success) return { error: "Something in that schedule doesn't look right." };
  const days = [...new Set(v.data.deliveryDays)].sort();
  const perDay = Object.fromEntries(Object.entries(v.data.perDay).filter(([k]) => days.includes(Number(k))).map(([k, x]) => [Number(k), x]));
  await db.supplier.update({ where: { id: supplierId }, data: { deliveryDays: days } });
  await saveCutoffRule(supplierId, { perDay, autoDraft: v.data.autoDraft });
  revalidatePath("/ordering");
  revalidatePath("/settings", "layout");
  return {};
}

// ---- Ordering table: bulk and quick actions ------------------------------------------

type Result = { error?: string; message?: string };
const ids = z.array(z.string().min(1).max(40)).min(1).max(200);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function done() {
  revalidatePath("/ordering");
  revalidatePath("/brief");
}

/**
 * "Draft orders": build each supplier's suggested order for its next delivery and save
 * it as a draft, the same way the daily auto-draft does. Suppliers that already have an
 * order for that delivery, have no delivery days, or need nothing are skipped (and named).
 */
export async function draftOrders(supplierIds: string[]): Promise<Result & { orderIds?: string[] }> {
  await requireUser("MANAGER");
  const v = ids.safeParse(supplierIds);
  if (!v.success) return { error: "Pick at least one supplier." };
  const cutoffs = new Map((await supplierCutoffs()).map((c) => [c.supplierId, c]));
  const drafted: string[] = [];
  const orderIds: string[] = [];
  const skipped: string[] = [];
  for (const id of v.data) {
    const c = cutoffs.get(id);
    if (!c) continue;
    if (!c.next) { skipped.push(`${c.name} (no delivery days)`); continue; }
    if (c.draftId) { skipped.push(`${c.name} (already ordered)`); continue; }
    try {
      const r = await draftSuggestedOrder(id, c.next, "Drafted from the suggested order. Review and send.");
      if (r.status === "drafted") { drafted.push(c.name); orderIds.push(r.orderId); }
      else skipped.push(`${c.name} (${r.reason})`);
    } catch (e) {
      console.error("draftOrders failed", c.name, e);
      skipped.push(`${c.name} (couldn't build the order)`);
    }
  }
  done();
  const parts = [drafted.length ? `Drafted ${plural(drafted.length, "order")}: ${drafted.join(", ")}.` : "No drafts made.", skipped.length ? `Skipped ${skipped.join(", ")}.` : ""];
  return drafted.length ? { message: parts.join(" ").trim(), orderIds } : { error: parts.join(" ").trim() };
}

/** Auto-draft on or off for several suppliers. */
export async function setAutoDraft(supplierIds: string[], on: boolean): Promise<Result> {
  await requireUser("MANAGER");
  const v = ids.safeParse(supplierIds);
  if (!v.success) return { error: "Pick at least one supplier." };
  for (const id of v.data) await saveCutoffRule(id, { autoDraft: on });
  revalidatePath("/ordering");
  revalidatePath("/settings", "layout");
  return { message: `Auto-draft ${on ? "on" : "off"} for ${plural(v.data.length, "supplier")}.` };
}

// ---- Cadence, reminders and how each supplier takes orders --------------------------------

/** Every delivery ("regular") or when stock runs low ("as_needed"), for one or several suppliers. */
export async function setCadence(supplierIds: string[], cadence: string): Promise<Result> {
  await requireUser("MANAGER");
  const v = ids.safeParse(supplierIds);
  const c = z.enum(["regular", "as_needed"]).safeParse(cadence);
  if (!v.success || !c.success) return { error: "Pick at least one supplier." };
  await db.supplier.updateMany({ where: { id: { in: v.data } }, data: { orderCadence: c.data } });
  done();
  revalidatePath("/settings", "layout");
  return { message: `${plural(v.data.length, "supplier")} now ${c.data === "regular" ? "ordered every delivery" : "ordered when stock runs low"}.` };
}

const prefField = z.discriminatedUnion("field", [
  z.object({ field: z.literal("alert"), value: z.enum(["auto", "on", "low", "off"]) }),
  z.object({ field: z.literal("first"), value: z.enum(["24h", "4h", "morning", "none"]) }),
  z.object({ field: z.literal("lastCallMins"), value: z.enum(["30", "60", "120", "off"]) }),
  z.object({ field: z.literal("recipients"), value: z.enum(["managers", "people", "shift"]) }),
  z.object({ field: z.literal("people"), value: z.string().max(2000) }),
  z.object({ field: z.literal("sendBy"), value: z.enum(["email", "text", "portal", "phone"]) }),
  z.object({ field: z.literal("phone"), value: z.string().trim().max(40).refine((v) => v === "" || v.replace(/\D/g, "").length >= 7, "Enter a phone number with the area code") }),
  z.object({ field: z.literal("portal"), value: z.string().trim().max(60) }),
  z.object({ field: z.literal("portalUrl"), value: z.string().trim().max(300).refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Paste the full web address, starting with https://") }),
]);

/** One reminder or "send orders by" setting for a supplier (stored as JSON in Settings; no schema change). */
export async function saveSupplierPref(supplierId: string, field: string, value: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = prefField.safeParse({ field, value });
  if (!p.success || !z.string().min(1).max(40).safeParse(supplierId).success) return { error: p.success ? "That supplier doesn't exist." : p.error.issues[0].message };
  const d = p.data;
  const patch =
    d.field === "alert" ? { alert: d.value === "auto" ? null : d.value }
    : d.field === "lastCallMins" ? { lastCallMins: d.value === "off" ? null : Number(d.value) }
    : d.field === "people" ? { people: d.value.split(",").map((x) => x.trim()).filter(Boolean) }
    : d.field === "phone" || d.field === "portal" || d.field === "portalUrl" ? { [d.field]: d.value || null }
    : { [d.field]: d.value };
  await saveSupplierPrefs(supplierId, patch);
  done();
  revalidatePath("/settings", "layout");
  return {};
}

/** Hide the "these suppliers are now when stock runs low" note on Ordering. */
export async function hideCadenceNotice(): Promise<void> {
  await requireUser("MANAGER");
  await dismissCadenceNotice();
  revalidatePath("/ordering");
}

/** Which staff logins may place orders (managers always can). */
export async function setStaffOrderers(userIds: string[]): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = z.array(z.string().min(1).max(40)).max(50).safeParse(userIds);
  if (!v.success) return { error: "Pick people from the list." };
  await saveStaffOrderers(v.data);
  revalidatePath("/settings", "layout");
  revalidatePath("/my");
  return {};
}

/** "Mark as sent" for drafts sent another way. Records who did it, like the order page. */
export async function markOrdersSent(orderIds: string[]): Promise<Result> {
  const s = await requireUser("MANAGER");
  const v = ids.safeParse(orderIds);
  if (!v.success) return { error: "Pick at least one order." };
  let n = 0;
  for (const id of v.data) {
    const r = await db.purchaseOrder.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date() } });
    if (r.count) { n++; await recordManualSend(id, { userId: s.userId, name: s.name }); }
  }
  done();
  return n ? { message: `Marked ${plural(n, "order")} as sent.` } : { error: "Only drafts can be marked as sent." };
}

/** Email each draft to its supplier with the spreadsheet attached (needs email set up and an order email). */
export async function emailDrafts(orderIds: string[]): Promise<Result> {
  const s = await requireUser("MANAGER");
  const v = ids.safeParse(orderIds);
  if (!v.success) return { error: "Pick at least one order." };
  const orders = await db.purchaseOrder.findMany({ where: { id: { in: v.data }, status: "DRAFT" }, include: { supplier: { select: { name: true, email: true } } } });
  const sent: string[] = [];
  const problems: string[] = [];
  for (const o of orders) {
    if (!o.supplier.email) { problems.push(`${o.supplier.name} has no order email`); continue; }
    const r = await sendPurchaseOrder({ orderId: o.id, to: o.supplier.email, copyMe: false, by: { userId: s.userId, name: s.name } });
    if ("ok" in r) sent.push(o.supplier.name);
    else problems.push(`${o.supplier.name}: ${"skipped" in r ? r.skipped : r.error}`);
  }
  done();
  const msg = [sent.length ? `Emailed ${sent.join(", ")}.` : "", problems.length ? `Not sent: ${problems.join("; ")}.` : ""].join(" ").trim();
  return sent.length ? { message: msg } : { error: msg || "Only drafts can be emailed." };
}

/**
 * Check in sent orders exactly as ordered (no shorts) — the quick version of the order
 * page's Check in delivery. Lines already checked in keep what was entered.
 */
export async function receiveOrders(orderIds: string[]): Promise<Result> {
  await requireUser("MANAGER");
  const v = ids.safeParse(orderIds);
  if (!v.success) return { error: "Pick at least one order." };
  const orders = await db.purchaseOrder.findMany({ where: { id: { in: v.data }, status: "SENT" }, include: { lines: true } });
  for (const po of orders) {
    await db.$transaction([
      ...po.lines.filter((l) => l.receivedQty == null).map((l) => db.purchaseOrderLine.update({ where: { id: l.id }, data: { receivedQty: l.qty } })),
      db.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED", receivedAt: po.receivedAt ?? new Date(), sentAt: po.sentAt ?? new Date() } }),
    ]);
    revalidatePath(`/ordering/po/${po.id}`);
  }
  done();
  return orders.length ? { message: `Checked in ${plural(orders.length, "order")} as ordered.` } : { error: "Only sent orders can be checked in." };
}

/**
 * Copy an order into a new draft for the supplier's next delivery, at today's prices.
 * Returns the new order's id (the caller opens it).
 */
export async function duplicateOrder(orderId: string): Promise<Result & { id?: string }> {
  await requireUser("MANAGER");
  const v = z.string().min(1).max(40).safeParse(orderId);
  if (!v.success) return { error: "That order doesn't exist anymore." };
  const src = await db.purchaseOrder.findUnique({ where: { id: v.data }, include: { lines: true, supplier: true } });
  if (!src) return { error: "That order doesn't exist anymore." };
  const today = businessToday();
  const now = localNow();
  const rule = cutoffRule((await loadCutoffRules())[src.supplierId], src.supplier.leadTimeDays);
  const next = nextCutoff(src.supplier.deliveryDays, rule, now.date, now.time);
  const win = next ? { deliveryDate: next.deliveryDate, coverUntil: deliveryWindow({ ...src.supplier, leadTimeDays: 0 }, next.deliveryDate).coverUntil } : deliveryWindow(src.supplier, today);
  const prices = await currentPrices(src.lines.map((l) => l.supplierProductId), today);
  const po = await db.purchaseOrder.create({
    data: {
      supplierId: src.supplierId,
      deliveryDate: parseISODate(win.deliveryDate),
      coverUntil: parseISODate(win.coverUntil),
      notes: "Copied from an earlier order. Review and send.",
      lines: {
        create: src.lines.map((l) => {
          const p = prices.get(l.supplierProductId) ?? l.unitPrice?.toNumber() ?? null;
          return { supplierProductId: l.supplierProductId, suggestedQty: l.qty, qty: l.qty, unitPrice: p == null ? null : new Prisma.Decimal(p.toFixed(2)) };
        }),
      },
    },
  });
  done();
  return { id: po.id, message: `Copied to a new draft for ${win.deliveryDate}.` };
}