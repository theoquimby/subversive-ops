"use server";

import { toBase, type BaseUnit } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor } from "@/server/services/inventory";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { canDeleteWaste, WASTE_UNDO_MINUTES } from "./undo";

export async function logWaste(_: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const s = await requireUser();
  const ingredientId = String(form.get("ingredientId") ?? "");
  const qty = Number(form.get("qty"));
  const unit = String(form.get("unit") ?? "");
  const reason = String(form.get("reason") ?? "Other");
  if (!ingredientId) return { error: "Pick an item." };
  if (!(qty > 0)) return { error: "Enter how much." };
  const ing = await db.ingredient.findUnique({ where: { id: ingredientId }, include: { conversions: true, preferredProduct: { select: { purchaseUnit: true, packQtyBase: true } } } });
  if (!ing) return { error: "That item isn't available any more — pick another." };
  const { units, conversions } = countUnitsFor(ing);
  if (!unit) return { error: "Pick a unit." };
  let qtyBase: number;
  try {
    qtyBase = toBase(qty, unit, ing.baseUnit as BaseUnit, conversions);
  } catch {
    return { error: `${ing.name} can't be logged in "${unit}". Use ${units.slice(0, 4).join(", ")}.` };
  }
  await db.wasteLog.create({ data: { ingredientId, qtyBase: new Prisma.Decimal(qtyBase.toFixed(4)), reason, loggedBy: s.name } });
  revalidatePath("/waste");
  return { ok: `Logged ${qty} ${unit} ${ing.name}` };
}

export async function deleteWaste(id: string): Promise<{ error?: string }> {
  const s = await requireUser();
  const w = await db.wasteLog.findUnique({ where: { id }, select: { loggedBy: true, loggedAt: true } });
  if (!w) return {};
  if (!canDeleteWaste(w, s)) return { error: `Entries can only be removed by whoever logged them, within ${WASTE_UNDO_MINUTES} minutes. Ask a manager.` };
  await db.wasteLog.delete({ where: { id } });
  revalidatePath("/waste");
  return {};
}
