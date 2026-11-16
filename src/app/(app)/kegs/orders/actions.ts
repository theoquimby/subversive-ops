"use server";

import { MAX_LINES, MAX_QUANTITY } from "@/domain/kegOrders";
import { requireUser } from "@/server/auth";
import { checkKegStock } from "@/server/services/keg-alerts";
import {
  addOrderLine,
  addOrderNote,
  cancelOrder,
  createOrder,
  fulfilOrder,
  removeOrderLine,
  scanForOrder,
  setLineUnscanned,
  setOrderField,
  setOrderLineField,
  undoOrderScan,
  type OrderScanResult,
  type OrderScanState,
} from "@/server/services/kegOrders";
import { pingWebsite } from "@/server/services/website";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => revalidatePath("/kegs", "layout");
const id = z.string().min(1).max(64);
const MISSING = "Something's missing. Try again.";

// ---- Managers: making and editing an order -----------------------------------------------------

const lineSchema = z.object({ beerId: z.string().max(64), sizeId: z.string().max(32), quantity: z.number() });
const orderSchema = z.object({
  accountId: z.string().max(64),
  transit: z.string().max(16),
  dueOn: z.string().max(10).nullable(),
  lines: z.array(lineSchema).max(MAX_LINES * 2),
  note: z.string().max(1000).nullish(),
});
export type NewOrderForm = z.infer<typeof orderSchema>;

export async function createKegOrder(input: NewOrderForm): Promise<{ ok: true; id: string } | { error: string }> {
  const me = await requireUser("MANAGER");
  const v = orderSchema.safeParse(input);
  if (!v.success) return { error: MISSING };
  const r = await createOrder(me, v.data);
  if ("error" in r) return r;
  if (v.data.note?.trim()) await addOrderNote(me, r.id, v.data.note);
  refresh();
  return { ok: true, id: r.id };
}

export async function saveOrderField(orderId: string, field: "transit" | "dueOn" | "accountId", value: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = z.object({ orderId: id, field: z.enum(["transit", "dueOn", "accountId"]), value: z.string().max(64) }).safeParse({ orderId, field, value });
  if (!v.success) return { error: MISSING };
  const r = await setOrderField(v.data.orderId, v.data.field, v.data.value);
  refresh();
  return r;
}

export async function addKegOrderLine(orderId: string, line: z.infer<typeof lineSchema>): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = z.object({ orderId: id, line: lineSchema }).safeParse({ orderId, line });
  if (!v.success) return { error: MISSING };
  const r = await addOrderLine(v.data.orderId, v.data.line);
  refresh();
  return r;
}

export async function saveOrderLineField(lineId: string, field: "beerId" | "sizeId" | "quantity", value: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = z.object({ lineId: id, field: z.enum(["beerId", "sizeId", "quantity"]), value: z.string().max(64) }).safeParse({ lineId, field, value });
  if (!v.success) return { error: MISSING };
  const r = await setOrderLineField(v.data.lineId, v.data.field, v.data.value);
  refresh();
  return r;
}

export async function removeKegOrderLine(lineId: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = id.safeParse(lineId);
  if (!v.success) return { error: MISSING };
  const r = await removeOrderLine(v.data);
  refresh();
  return r;
}

/** Kegs on a line delivered without scanning (the line's new total; blank is none). */
export async function saveLineUnscanned(lineId: string, value: string): Promise<{ error?: string }> {
  const me = await requireUser("MANAGER");
  const v = z.object({ lineId: id, count: z.number().int().min(0).max(MAX_QUANTITY) }).safeParse({ lineId, count: String(value ?? "").trim() === "" ? 0 : Number(value) });
  if (!v.success) return { error: "A whole number, 0 or more" };
  const r = await setLineUnscanned(me, v.data.lineId, v.data.count);
  refresh();
  return r;
}

export async function cancelKegOrder(orderId: string): Promise<{ ok: true } | { error: string }> {
  const me = await requireUser("MANAGER");
  const v = id.safeParse(orderId);
  if (!v.success) return { error: MISSING };
  const r = await cancelOrder(me, v.data);
  refresh();
  return r;
}

// ---- Everyone: notes, scanning, marking a complete order fulfilled ---------------------------

export async function addKegOrderNote(orderId: string, text: string): Promise<{ error?: string }> {
  const me = await requireUser();
  const v = z.object({ orderId: id, text: z.string().trim().min(1).max(1000) }).safeParse({ orderId, text });
  if (!v.success) return { error: String(text ?? "").trim() ? "Keep a note under 1,000 characters." : "Write the note first." };
  const r = await addOrderNote(me, v.data.orderId, v.data.text);
  refresh();
  return r;
}

/** Mark an order fulfilled: anyone once it is complete; `short` (a manager) with what has gone out so far. */
export async function fulfilKegOrder(orderId: string, short = false): Promise<{ ok: true } | { error: string }> {
  const me = await requireUser();
  const v = z.object({ orderId: id, short: z.boolean() }).safeParse({ orderId, short });
  if (!v.success) return { error: MISSING };
  const r = await fulfilOrder(me, v.data.orderId, { short: v.data.short });
  refresh();
  return r;
}

const scanSchema = z.object({ orderId: id, text: z.string().min(1).max(500), clientId: z.string().min(8).max(64) });
export type OrderScanForm = z.infer<typeof scanSchema>;

/** One keg scanned for an order: checked against its lines, sent out to its account and recorded on the order. */
export async function scanOrderKeg(input: OrderScanForm): Promise<OrderScanResult> {
  const me = await requireUser();
  const v = scanSchema.safeParse(input);
  if (!v.success) return { error: MISSING };
  const r = await scanForOrder(me, v.data);
  if ("ok" in r) {
    checkKegStock(r.beerId);
    refresh();
    pingWebsite("menu");
  }
  return r;
}

/** Undo a keg scanned onto an order: it goes back where it was and comes off the order. */
export async function undoOrderKeg(input: { orderId: string; kegId: string }): Promise<{ ok: true; state: OrderScanState } | { error: string }> {
  const me = await requireUser();
  const v = z.object({ orderId: id, kegId: id }).safeParse(input);
  if (!v.success) return { error: MISSING };
  const r = await undoOrderScan(me, v.data);
  refresh();
  pingWebsite("menu");
  return r;
}
