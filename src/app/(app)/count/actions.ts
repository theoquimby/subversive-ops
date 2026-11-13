"use server";

import { toBase } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor } from "@/server/services/inventory";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BaseUnit } from "@/domain/units";

export async function startCount(form: FormData) {
  const s = await requireUser();
  const area = String(form.get("area") ?? "All");
  const open = await db.stockCount.findFirst({ where: { completed: false, area } });
  const count = open ?? (await db.stockCount.create({ data: { area, userId: s.userId } }));
  redirect(`/count/${count.id}`);
}

/** Save one line as staff type. qty null clears the line. */
export async function saveCountLine(countId: string, ingredientId: string, qty: number | null, unit: string) {
  await requireUser();
  const count = await db.stockCount.findUniqueOrThrow({ where: { id: countId } });
  if (count.completed) return { error: "This count is already finished." };
  if (qty == null || !Number.isFinite(qty)) {
    await db.stockCountLine.deleteMany({ where: { countId, ingredientId } });
    return { ok: true };
  }
  if (qty < 0) return { error: "Can't be negative." };
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId }, include: { conversions: true, preferredProduct: { select: { purchaseUnit: true, packQtyBase: true } } } });
  const { conversions } = countUnitsFor(ing);
  const qtyBase = toBase(qty, unit, ing.baseUnit as BaseUnit, conversions);
  await db.stockCountLine.upsert({
    where: { countId_ingredientId: { countId, ingredientId } },
    create: { countId, ingredientId, qtyBase: new Prisma.Decimal(qtyBase.toFixed(4)) },
    update: { qtyBase: new Prisma.Decimal(qtyBase.toFixed(4)) },
  });
  return { ok: true };
}

export async function finishCount(countId: string) {
  await requireUser();
  await db.stockCount.update({ where: { id: countId }, data: { completed: true, takenAt: new Date() } });
  revalidatePath("/count");
  redirect("/count?done=1");
}

export async function discardCount(countId: string) {
  await requireUser();
  await db.stockCount.delete({ where: { id: countId, completed: false } });
  redirect("/count");
}
