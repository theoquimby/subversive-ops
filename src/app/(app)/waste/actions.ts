"use server";

import { toBase, type BaseUnit } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor } from "@/server/services/inventory";
import { buildContext, loadCostingSnapshot } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import { explodeWaste } from "@/domain/prepWaste";
import { randomUUID } from "node:crypto";
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

/**
 * A prep recipe ("2 qt aioli") or a menu item ("3 burgers") thrown out: one
 * waste row per ingredient it's made of, sharing a batch id, so the margin gap
 * and stock estimates count it like any other waste.
 */
export async function logRecipeWaste(_: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const s = await requireUser();
  const recipeId = String(form.get("recipeId") ?? "");
  const qty = Number(form.get("qty"));
  const unit = String(form.get("unit") ?? "each");
  const reason = String(form.get("reason") ?? "Other").slice(0, 40);
  if (!recipeId) return { error: "Pick an item." };
  if (!(qty > 0) || qty > 10_000) return { error: "Enter how much." };
  const recipe = await db.recipe.findUnique({ where: { id: recipeId }, select: { name: true, kind: true, active: true } });
  if (!recipe?.active) return { error: "That item isn't available any more — pick another." };
  const ctx = buildContext(await loadCostingSnapshot(), businessToday());
  let exploded;
  try {
    exploded = explodeWaste(ctx, recipeId, qty, unit, recipe.kind);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (exploded.usage.size === 0) return { error: `${recipe.name} has no ingredients set up yet, so there's nothing to log. Ask a manager to finish the recipe.` };
  const batchId = randomUUID();
  const loggedAt = new Date();
  await db.wasteLog.createMany({
    data: [...exploded.usage].map(([ingredientId, q]) => ({
      ingredientId,
      qtyBase: new Prisma.Decimal(q.toFixed(4)),
      reason,
      loggedBy: s.name,
      loggedAt,
      sourceRecipeId: recipeId,
      sourceQty: new Prisma.Decimal(qty.toFixed(3)),
      sourceUnit: unit,
      batchId,
    })),
  });
  revalidatePath("/waste");
  const n = exploded.usage.size;
  return { ok: `Logged ${qty} ${unit === "each" ? "" : `${unit} `}${recipe.name} (${n} ingredient${n === 1 ? "" : "s"})` };
}

export async function deleteWaste(id: string): Promise<{ error?: string }> {
  const s = await requireUser();
  const w = await db.wasteLog.findUnique({ where: { id }, select: { loggedBy: true, loggedAt: true, batchId: true } });
  if (!w) return {};
  if (!canDeleteWaste(w, s)) return { error: `Entries can only be removed by whoever logged them, within ${WASTE_UNDO_MINUTES} minutes. Ask a manager.` };
  // An exploded prep/menu entry goes as a whole.
  await db.wasteLog.deleteMany({ where: w.batchId ? { batchId: w.batchId } : { id } });
  revalidatePath("/waste");
  return {};
}
