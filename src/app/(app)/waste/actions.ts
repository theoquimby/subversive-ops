"use server";

import { toBase, type BaseUnit } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { COUNT_UNITS_INCLUDE, countUnitsFor } from "@/server/services/inventory";
import { buildContext, loadCostingSnapshot } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import { explodeWaste } from "@/domain/prepWaste";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canDeleteWaste, WASTE_UNDO_MINUTES } from "./undo";
import { canUndoWasteEntry, wasteLoggedAt } from "@/domain/purchasing";
import { env } from "@/server/env";

type Who = { name: string };
type Res = { error?: string; ok?: string };

const clientIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional();
const entrySchema = z.object({
  clientId: clientIdSchema,
  mode: z.enum(["ingredient", "recipe"]),
  itemId: z.string().min(1, "Pick an item."),
  qty: z.number({ message: "Enter how much." }).positive("Enter how much.").max(10_000, "That's a lot — check the amount."),
  unit: z.string().max(40),
  reason: z.string().max(40).default("Other"),
  /** Thrown out today, or yesterday (logged the next morning). */
  when: z.enum(["today", "yesterday"]).default("today"),
  /** When the phone logged it (it may have waited for signal), ms. */
  at: z.number().finite().optional(),
});
export type WasteEntry = z.input<typeof entrySchema>;

async function wasteIngredient(s: Who, ingredientId: string, qty: number, unit: string, reason: string, batchId: string | null, loggedAt = new Date()): Promise<Res> {
  if (!ingredientId) return { error: "Pick an item." };
  if (!(qty > 0)) return { error: "Enter how much." };
  const ing = await db.ingredient.findUnique({ where: { id: ingredientId }, include: COUNT_UNITS_INCLUDE });
  if (!ing) return { error: "That item isn't available any more — pick another." };
  const { units, conversions } = countUnitsFor(ing);
  if (!unit) return { error: "Pick a unit." };
  let qtyBase: number;
  try {
    qtyBase = toBase(qty, unit, ing.baseUnit as BaseUnit, conversions);
  } catch {
    return { error: `${ing.name} can't be logged in "${unit}". Use ${units.slice(0, 4).join(", ")}.` };
  }
  await db.wasteLog.create({ data: { ingredientId, qtyBase: new Prisma.Decimal(qtyBase.toFixed(4)), reason, loggedBy: s.name, batchId, loggedAt } });
  revalidatePath("/waste");
  return { ok: `Logged ${qty} ${unit} ${ing.name}` };
}

/**
 * A prep recipe ("2 qt aioli") or a menu item ("3 burgers") thrown out: one
 * waste row per ingredient it's made of, sharing a batch id, so the margin gap
 * and stock estimates count it like any other waste.
 */
async function wasteRecipe(s: Who, recipeId: string, qty: number, unit: string, reason: string, batchId: string, loggedAt = new Date()): Promise<Res> {
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

export async function logWaste(_: unknown, form: FormData): Promise<Res> {
  const s = await requireUser();
  return wasteIngredient(s, String(form.get("ingredientId") ?? ""), Number(form.get("qty")), String(form.get("unit") ?? ""), String(form.get("reason") ?? "Other").slice(0, 40), null);
}

export async function logRecipeWaste(_: unknown, form: FormData): Promise<Res> {
  const s = await requireUser();
  return wasteRecipe(s, String(form.get("recipeId") ?? ""), Number(form.get("qty")), String(form.get("unit") ?? "each"), String(form.get("reason") ?? "Other").slice(0, 40), randomUUID());
}

/**
 * The phone's waste form. `clientId` is made on the phone and stored as the
 * entry's batch id, so a retry from the offline queue (walk-in, no signal)
 * is applied once: if it's already there, it's reported as logged.
 */
export async function logWasteEntry(input: WasteEntry): Promise<Res> {
  const s = await requireUser();
  const p = entrySchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the entry." };
  const { clientId, mode, itemId, qty, unit, reason, when, at } = p.data;
  const batchId = clientId ?? randomUUID();
  if (clientId && (await db.wasteLog.findFirst({ where: { batchId }, select: { id: true } }))) return { ok: "Already logged" };
  const loggedAt = wasteLoggedAt(when, at, new Date(), env.BUSINESS_TIMEZONE);
  return mode === "ingredient" ? wasteIngredient(s, itemId, qty, unit, reason, clientId ?? null, loggedAt) : wasteRecipe(s, itemId, qty, unit || "each", reason, batchId, loggedAt);
}

/**
 * Undo from the "Logged" message: the phone that logged an entry holds its id.
 * Works for your own entry straight after logging it, including one logged for
 * yesterday; a prep or menu item goes as a whole.
 */
export async function undoWasteEntry(clientId: string): Promise<{ error?: string }> {
  const s = await requireUser();
  const v = z.string().regex(/^[A-Za-z0-9-]{8,64}$/).safeParse(clientId);
  if (!v.success) return { error: "That entry can't be found. Remove it from the list below." };
  const rows = await db.wasteLog.findMany({ where: { batchId: v.data }, select: { loggedBy: true, loggedAt: true } });
  if (!rows.length) return { error: "That entry can't be found. Remove it from the list below." };
  if (!rows.every((w) => canUndoWasteEntry(w, s, Date.now(), WASTE_UNDO_MINUTES))) return { error: `Entries can only be removed by whoever logged them, within ${WASTE_UNDO_MINUTES} minutes. Ask a manager.` };
  await db.wasteLog.deleteMany({ where: { batchId: v.data } });
  revalidatePath("/waste");
  return {};
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
