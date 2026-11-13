"use server";

import { parseISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { saveCutoffRule } from "@/server/services/planning";
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
