"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { recordManualSend, sendPurchaseOrder } from "@/server/email/outbound";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const sendSchema = z.object({ id: z.string().min(1), to: z.string().trim().max(320), copyMe: z.boolean() });

/** Email the order to the supplier with the CSV attached and mark it sent. */
export async function sendOrderToSupplier(input: z.infer<typeof sendSchema>): Promise<{ ok?: true; skipped?: string; error?: string }> {
  const s = await requireUser("MANAGER");
  const v = sendSchema.safeParse(input);
  if (!v.success) return { error: "Add the supplier's email address." };
  const r = await sendPurchaseOrder({ orderId: v.data.id, to: v.data.to, copyMe: v.data.copyMe, by: { userId: s.userId, name: s.name } });
  revalidatePath(`/ordering/po/${v.data.id}`);
  revalidatePath("/ordering");
  if ("ok" in r) return { ok: true };
  return r;
}

/** "Mark as sent" for orders sent another way (phone, portal, your own mail app). Records who did it. */
export async function markOrderSent(id: string) {
  const s = await requireUser("MANAGER");
  const r = await db.purchaseOrder.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date() } });
  if (r.count) await recordManualSend(id, { userId: s.userId, name: s.name });
  revalidatePath(`/ordering/po/${id}`);
  revalidatePath("/ordering");
}
