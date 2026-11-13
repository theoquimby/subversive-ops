"use server";

import { toBase } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor, saveAreas, storageAreas } from "@/server/services/inventory";
import { cleanAreaName, moveArea } from "@/domain/storageAreas";
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

// ---- Storage areas (managers) -------------------------------------------------

type AreaResult = { error?: string };
const refreshAreas = () => {
  revalidatePath("/count");
  revalidatePath("/settings/areas");
  revalidatePath("/ingredients");
};

export async function addArea(raw: string): Promise<AreaResult> {
  await requireUser("MANAGER");
  const name = cleanAreaName(raw);
  if (!name) return { error: "Type a name for the area." };
  const list = await storageAreas();
  if (list.some((a) => a.toLowerCase() === name.toLowerCase())) return { error: `“${name}” is already an area.` };
  await saveAreas([...list, name]);
  refreshAreas();
  return {};
}

export async function renameArea(from: string, raw: string): Promise<AreaResult> {
  await requireUser("MANAGER");
  const to = cleanAreaName(raw);
  if (!to) return { error: "Type a name for the area." };
  const list = await storageAreas();
  if (to.toLowerCase() !== from.toLowerCase() && list.some((a) => a.toLowerCase() === to.toLowerCase())) {
    return { error: `“${to}” is already an area. To merge them, remove “${from}” and move its items there.` };
  }
  await db.$transaction([
    db.ingredient.updateMany({ where: { storageArea: from }, data: { storageArea: to } }),
    db.stockCount.updateMany({ where: { completed: false, area: from }, data: { area: to } }),
  ]);
  await saveAreas(list.map((a) => (a === from ? to : a)));
  refreshAreas();
  return {};
}

/** Remove an area; its ingredients move to `moveTo` first. */
export async function removeArea(name: string, moveTo: string | null): Promise<AreaResult> {
  await requireUser("MANAGER");
  const items = await db.ingredient.count({ where: { storageArea: name } });
  if (items > 0) {
    const target = cleanAreaName(moveTo ?? "");
    if (!target || target === name) return { error: "Choose where its items should go." };
    await db.ingredient.updateMany({ where: { storageArea: name }, data: { storageArea: target } });
  }
  await saveAreas((await storageAreas()).filter((a) => a !== name));
  refreshAreas();
  return {};
}

export async function reorderArea(name: string, dir: -1 | 1): Promise<AreaResult> {
  await requireUser("MANAGER");
  await saveAreas(moveArea(await storageAreas(), name, dir));
  refreshAreas();
  return {};
}
