"use server";

import { toBase, type BaseUnit } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor } from "@/server/services/inventory";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function logWaste(_: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const s = await requireUser();
  const ingredientId = String(form.get("ingredientId") ?? "");
  const qty = Number(form.get("qty"));
  const unit = String(form.get("unit") ?? "");
  const reason = String(form.get("reason") ?? "Other");
  if (!ingredientId) return { error: "Pick an item." };
  if (!(qty > 0)) return { error: "Enter how much." };
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId }, include: { conversions: true, preferredProduct: { select: { purchaseUnit: true, packQtyBase: true } } } });
  let qtyBase: number;
  try {
    qtyBase = toBase(qty, unit, ing.baseUnit as BaseUnit, countUnitsFor(ing).conversions);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await db.wasteLog.create({ data: { ingredientId, qtyBase: new Prisma.Decimal(qtyBase.toFixed(4)), reason, loggedBy: s.name } });
  revalidatePath("/waste");
  return { ok: `Logged ${qty} ${unit} ${ing.name}` };
}
