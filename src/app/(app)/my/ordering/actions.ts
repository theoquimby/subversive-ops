"use server";

import { parseISODate } from "@/domain/dates";
import type { SendBy } from "@/domain/supplierPrefs";
import { db } from "@/server/db";
import { recordManualSend, sendPurchaseOrder } from "@/server/email/outbound";
import { requireOrderer } from "@/server/services/supplierPrefs";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Placing orders, for managers and for staff a manager allowed to order.
 * Nothing here contacts a supplier on its own: email goes out only when the
 * person presses Email it, and text, website and phone orders are placed by
 * the person, then marked here with "I sent it" / "I placed it".
 */

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const draftSchema = z.object({
  supplierId: z.string().min(1).max(40),
  deliveryDate: ISO,
  coverUntil: ISO,
  lines: z.array(z.object({ supplierProductId: z.string().min(1).max(40), suggestedQty: z.number().min(0), qty: z.number().min(0).max(10_000), unitPrice: z.number().nullable() })).max(500),
});

function refresh(orderId?: string) {
  revalidatePath("/ordering");
  revalidatePath("/my/ordering");
  if (orderId) revalidatePath(`/ordering/po/${orderId}`);
}

/** Save the reviewed order as a draft (replacing an unsent draft for the same delivery). Returns its id. */
export async function saveOrderForSending(input: z.input<typeof draftSchema>): Promise<{ id?: string; error?: string }> {
  await requireOrderer();
  const v = draftSchema.safeParse(input);
  if (!v.success) return { error: "Something in that order doesn't look right. Reload and try again." };
  const lines = v.data.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) return { error: "Nothing to order: every quantity is zero." };
  const supplier = await db.supplier.findUnique({ where: { id: v.data.supplierId }, select: { department: true } });
  if (!supplier) return { error: "That supplier doesn't exist anymore." };
  if (supplier.department === "brewery") return { error: "Brewery suppliers are ordered from the Brewery." };
  const delivery = parseISODate(v.data.deliveryDate);
  const po = await db.$transaction(async (tx) => {
    await tx.purchaseOrder.deleteMany({ where: { supplierId: v.data.supplierId, deliveryDate: delivery, status: "DRAFT" } });
    return tx.purchaseOrder.create({
      data: {
        supplierId: v.data.supplierId,
        deliveryDate: delivery,
        coverUntil: parseISODate(v.data.coverUntil),
        lines: {
          create: lines.map((l) => ({
            supplierProductId: l.supplierProductId,
            suggestedQty: new Prisma.Decimal(l.suggestedQty),
            qty: new Prisma.Decimal(l.qty),
            unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice.toFixed(2)),
          })),
        },
      },
    });
  });
  refresh(po.id);
  return { id: po.id };
}

const VIA: Record<SendBy, string> = { email: "email", text: "text message", portal: "their website", phone: "phone call" };

/** "I sent it" / "I placed it": the person placed the order themselves (text, their site, a call). */
export async function markOrderPlaced(orderId: string, via: SendBy): Promise<{ ok?: true; error?: string }> {
  const s = await requireOrderer();
  const id = z.string().min(1).max(40).safeParse(orderId);
  const how = z.enum(["email", "text", "portal", "phone"]).safeParse(via);
  if (!id.success || !how.success) return { error: "That order doesn't exist anymore." };
  const r = await db.purchaseOrder.updateMany({ where: { id: id.data, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date() } });
  if (r.count) await recordManualSend(id.data, { userId: s.userId, name: s.name }, VIA[how.data]);
  refresh(id.data);
  return r.count ? { ok: true } : { error: "It's already marked as sent." };
}

/** Email the order to the supplier's order email (pressed by the person; never automatic). */
export async function emailOrderToSupplier(orderId: string): Promise<{ ok?: true; error?: string }> {
  const s = await requireOrderer();
  const id = z.string().min(1).max(40).safeParse(orderId);
  if (!id.success) return { error: "That order doesn't exist anymore." };
  const o = await db.purchaseOrder.findUnique({ where: { id: id.data }, select: { status: true, supplier: { select: { email: true, name: true } } } });
  if (!o) return { error: "That order doesn't exist anymore." };
  if (!o.supplier.email) return { error: `${o.supplier.name} has no order email. Ask a manager to add it, or call the order in.` };
  const r = await sendPurchaseOrder({ orderId: id.data, to: o.supplier.email, copyMe: false, by: { userId: s.userId, name: s.name } });
  refresh(id.data);
  if ("ok" in r) return { ok: true };
  return { error: "skipped" in r ? `${r.skipped}. Call or text the order in instead.` : r.error };
}
