"use server";

import { parseISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { deliveryWindow, draftSuggestedOrder, loadCutoffRules, localNow, saveCutoffRule, supplierCutoffs } from "@/server/services/planning";
import { cutoffRule, nextCutoff } from "@/domain/ordering";
import { recordManualSend, sendPurchaseOrder } from "@/server/email/outbound";
import { businessToday } from "@/server/services/sales";
import { currentPrices } from "./estimate";
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

export async function createOrder(input: z.infer<typeof draftSchema>) {
  await requireUser("MANAGER");
  const v = draftSchema.parse(input);
  const lines = v.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) return { error: "Nothing to order — every quantity is zero." };
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

export async function receiveOrder(id: string, form: FormData) {
  await requireUser("MANAGER");
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  await db.$transaction([
    ...po.lines.map((l) => {
      const raw = form.get(`received_${l.id}`);
      const received = raw === null || raw === "" ? l.qty.toNumber() : Number(raw);
      return db.purchaseOrderLine.update({ where: { id: l.id }, data: { receivedQty: new Prisma.Decimal(Number.isFinite(received) ? received : 0) } });
    }),
    db.purchaseOrder.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date(), sentAt: po.sentAt ?? new Date() } }),
  ]);
  revalidatePath(`/ordering/po/${id}`);
  revalidatePath("/ordering");
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
      db.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED", receivedAt: new Date(), sentAt: po.sentAt ?? new Date() } }),
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