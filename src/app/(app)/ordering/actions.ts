"use server";

import { parseISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
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

export async function markSent(id: string) {
  await requireUser("MANAGER");
  await db.purchaseOrder.update({ where: { id, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date() } });
  revalidatePath(`/ordering/po/${id}`);
  revalidatePath("/ordering");
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
