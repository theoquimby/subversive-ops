"use server";

import { parsePrepUnit, type PrepRounding } from "@/domain/prep";
import type { BaseUnit } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { addDays } from "@/domain/dates";
import { loadPrepItems, setCoverDays } from "@/server/services/prep";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => revalidatePath("/prep", "layout");

// ---- Floor actions (staff too; offline-tolerant: each carries a phone-made id) ----

const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("done"), recipeId: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), qtyBase: z.number().nonnegative().max(1e8), clientId: z.string().max(64).nullish() }),
  z.object({ kind: z.literal("undo"), recipeId: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), clientId: z.string().max(64).nullish() }),
  z.object({ kind: z.literal("count"), recipeId: z.string().min(1), qtyBase: z.number().nonnegative().max(1e8), clientId: z.string().max(64).nullish(), at: z.number().nullish() }),
]);

export type PrepActionForm = z.infer<typeof actionSchema>;

export async function prepAction(input: PrepActionForm): Promise<{ ok: true } | { error: string }> {
  const me = await requireUser();
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return { error: "That didn't look right — try again." };
  const a = parsed.data;
  const recipe = await db.recipe.findFirst({ where: { id: a.recipeId, kind: "PREP" }, select: { id: true } });
  if (!recipe) return { error: "That prep item isn't there any more." };
  const today = businessToday();
  if ("day" in a && (a.day < addDays(today, -2) || a.day > addDays(today, 7))) return { error: "That day is too far off." };
  try {
    if (a.kind === "done") {
      if (a.clientId && (await db.prepDone.findUnique({ where: { clientId: a.clientId } }))) return { ok: true };
      const data = { qtyBase: new Prisma.Decimal(a.qtyBase), doneBy: me.name, doneById: me.userId, doneAt: new Date(), clientId: a.clientId ?? null };
      await db.prepDone.upsert({ where: { recipeId_day: { recipeId: a.recipeId, day: a.day } }, create: { recipeId: a.recipeId, day: a.day, ...data }, update: data });
    } else if (a.kind === "undo") {
      await db.prepDone.deleteMany({ where: { recipeId: a.recipeId, day: a.day } });
    } else {
      if (a.clientId && (await db.prepCount.findUnique({ where: { clientId: a.clientId } }))) return { ok: true };
      // A count sent late (no signal) keeps the time it was taken, but never a future one.
      const at = a.at && a.at < Date.now() && a.at > Date.now() - 3 * 86400_000 ? new Date(a.at) : new Date();
      await db.prepCount.create({ data: { recipeId: a.recipeId, qtyBase: new Prisma.Decimal(a.qtyBase), countedBy: me.name, countedAt: at, clientId: a.clientId ?? null } });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: true }; // the same send twice
    throw e;
  }
  refresh();
  return { ok: true };
}

// ---- Setup (managers) ------------------------------------------------------------

const FIELDS = ["onList", "parBase", "shelfLifeDays", "rounding", "station", "unit"] as const;
export type PrepField = (typeof FIELDS)[number];

export async function savePrepField(recipeId: string, field: PrepField, value: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  if (!FIELDS.includes(field)) return { error: "Unknown field." };
  const items = await loadPrepItems();
  const item = items.find((i) => i.id === recipeId);
  if (!item) return { error: "That prep item isn't there any more." };
  const v = String(value ?? "").trim();
  // A first save keeps the item's current on-list default (portions start off).
  const data: Prisma.PrepSettingUncheckedCreateInput = { recipeId, onList: item.settings.onList };
  const number = () => {
    if (!v) return null;
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  switch (field) {
    case "onList":
      data.onList = v === "on";
      break;
    case "parBase": {
      const n = number();
      if (Number.isNaN(n)) return { error: "Enter a number, or leave it blank for no par." };
      data.parBase = n == null || n === 0 ? null : new Prisma.Decimal(n * item.settings.unit!.baseQty);
      break;
    }
    case "shelfLifeDays": {
      const n = number();
      if (Number.isNaN(n) || (n != null && (n < 1 || n > 60))) return { error: "Days it keeps: 1 to 60, or blank." };
      data.shelfLifeDays = n == null ? null : Math.round(n);
      break;
    }
    case "rounding":
      if (!["batch", "half", "exact"].includes(v)) return { error: "Pick how to round." };
      data.rounding = v as PrepRounding;
      break;
    case "station":
      data.station = v ? v.replace(/\s+/g, " ").slice(0, 40) : null;
      break;
    case "unit": {
      if (!v) {
        data.unitName = null;
        data.unitBase = null;
        break;
      }
      const u = parsePrepUnit(v, item.base as BaseUnit);
      if ("error" in u) return { error: u.error };
      data.unitName = u.name;
      data.unitBase = u.container ? new Prisma.Decimal(u.baseQty) : null;
      break;
    }
  }
  const { recipeId: _id, onList: _on, ...rest } = data;
  void _id;
  void _on;
  const update = field === "onList" ? { ...rest, onList: data.onList } : rest;
  await db.prepSetting.upsert({ where: { recipeId }, create: data, update });
  refresh();
  return {};
}

export async function saveCoverDays(n: number): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  if (!Number.isInteger(n) || n < 1 || n > 4) return { error: "Pick 1 to 4 days." };
  await setCoverDays(n);
  refresh();
  return {};
}
