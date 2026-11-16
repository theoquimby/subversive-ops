"use server";

import { readParts, sumParts } from "@/domain/countUnits";
import { mergeAreaParts, parseItemKey, prepKey } from "@/domain/countPlan";
import { countItems, prepUnits } from "@/server/services/counts";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { COUNT_UNITS_INCLUDE, countUnitsFor, saveAreas, storageAreas } from "@/server/services/inventory";
import { cleanAreaName, moveArea } from "@/domain/storageAreas";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BaseUnit } from "@/domain/units";

export async function startCount(form: FormData) {
  const s = await requireUser();
  const area = String(form.get("area") ?? "All");
  // A count waiting for approval is closed; starting again begins a fresh one.
  const open = await db.stockCount.findFirst({ where: { completed: false, submittedAt: null, area } });
  const count = open ?? (await db.stockCount.create({ data: { area, userId: s.userId } }));
  redirect(`/count/${count.id}`);
}

type Part = { qty: number; unit: string };
const partsSchema = z.array(z.object({ qty: z.number().finite().min(0, "Can't be negative."), unit: z.string().trim().min(1).max(60) })).max(8);

/**
 * Save one line as staff type. qty null clears the line. Idempotent (an upsert),
 * so the offline queue can retry it. `parts` is a line counted in several units
 * ("2 jug + 3 can"); when given it wins over qty/unit.
 */
export async function saveCountLine(countId: string, itemKey: string, qty: number | null, unit: string, parts?: Part[] | null, area?: string | null) {
  const me = await requireUser();
  const count = await db.stockCount.findUnique({ where: { id: countId } });
  if (!count) return { error: "This count was discarded." };
  if (count.completed) return { error: "This count is already finished." };
  if (count.submittedAt && me.role !== "MANAGER") return { error: "This count was sent to the manager. Ask them to send it back to change it." };
  const { kind, id } = parseItemKey(itemKey);
  const list: Part[] = parts && parts.length ? (() => { const r = partsSchema.safeParse(parts); return r.success ? r.data : []; })() : qty == null || !Number.isFinite(qty) ? [] : [{ qty, unit }];
  if (parts && parts.length && !list.length) return { error: "Enter numbers like 2 or 1.5." };
  if (list.some((p) => p.qty < 0)) return { error: "Can't be negative." };
  let name: string, base: BaseUnit, home: string, opts: { staffUnits: string[]; conversions: { unit: string; baseQty: number }[] };
  if (kind === "prep") {
    const r = await db.recipe.findUnique({ where: { id }, include: { countUnitList: true } });
    if (!r) return { error: "That item isn't on the count any more." };
    opts = prepUnits(r, await db.prepSetting.findUnique({ where: { recipeId: id } }));
    name = r.name;
    base = r.yieldBase as BaseUnit;
    home = r.countArea ?? "Prep";
  } else {
    const ing = await db.ingredient.findUnique({ where: { id }, include: COUNT_UNITS_INCLUDE });
    if (!ing) return { error: "That item isn't on the count any more." };
    opts = countUnitsFor(ing);
    name = ing.name;
    base = ing.baseUnit as BaseUnit;
    home = ing.storageArea;
  }
  // Staff count only in the units the manager allowed.
  const bad = me.role !== "MANAGER" ? list.find((p) => !opts.staffUnits.includes(p.unit)) : undefined;
  if (bad) return { error: `${name} isn't counted in "${bad.unit}". Pick one of: ${opts.staffUnits.join(", ")}.` };
  const where = cleanAreaName(area ?? "") || home;
  try {
    sumParts(list, base, opts.conversions);
  } catch {
    return { error: `${name} can't be counted in "${list.map((p) => p.unit).join(" + ")}".` };
  }
  // One line per item per count; what was counted in each place lives in its parts and qtyBase is the total.
  await db.$transaction(async (tx) => {
    const key = kind === "prep" ? { countId_recipeId: { countId, recipeId: id } } : { countId_ingredientId: { countId, ingredientId: id } };
    const cur = kind === "prep" ? await tx.stockCountPrepLine.findUnique({ where: key as { countId_recipeId: { countId: string; recipeId: string } } }) : await tx.stockCountLine.findUnique({ where: key as { countId_ingredientId: { countId: string; ingredientId: string } } });
    // An old line without parts was counted in one go, at home.
    const before = readParts(cur?.parts) ?? (cur ? [{ area: home, qty: cur.qtyBase.toNumber(), unit: base as string }] : []);
    const merged = mergeAreaParts(before, where, list, home);
    if (merged.length === 0) {
      if (kind === "prep") await tx.stockCountPrepLine.deleteMany({ where: { countId, recipeId: id } });
      else await tx.stockCountLine.deleteMany({ where: { countId, ingredientId: id } });
      return;
    }
    const total = sumParts(merged, base, opts.conversions);
    const data = { qtyBase: new Prisma.Decimal(total.toFixed(4)), parts: merged as unknown as Prisma.InputJsonValue };
    if (kind === "prep") await tx.stockCountPrepLine.upsert({ where: { countId_recipeId: { countId, recipeId: id } }, create: { countId, recipeId: id, ...data }, update: data });
    else await tx.stockCountLine.upsert({ where: { countId_ingredientId: { countId, ingredientId: id } }, create: { countId, ingredientId: id, ...data }, update: data });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(async (e) => {
    // Two phones saving the same item at once: try once more.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") return saveCountLine(countId, itemKey, qty, unit, parts, area);
    throw e;
  });
  return { ok: true };
}

/** "Always list Fryer oil in Third bay": add a home area after finding it there. */
export async function addHomeArea(itemKey: string, raw: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const area = cleanAreaName(raw);
  if (!area) return { error: "Choose an area." };
  const { kind, id } = parseItemKey(itemKey);
  if (kind === "prep") {
    const r = await db.recipe.findUnique({ where: { id }, select: { countArea: true, countAreas: true } });
    if (!r) return { error: "That item isn't there any more." };
    if (!r.countArea) await db.recipe.update({ where: { id }, data: { countArea: area } });
    else if (r.countArea !== area && !r.countAreas.includes(area)) await db.recipe.update({ where: { id }, data: { countAreas: [...r.countAreas, area] } });
  } else {
    const i = await db.ingredient.findUnique({ where: { id }, select: { storageArea: true, countAreas: true } });
    if (!i) return { error: "That item isn't there any more." };
    if (i.storageArea !== area && !i.countAreas.includes(area)) await db.ingredient.update({ where: { id }, data: { countAreas: [...i.countAreas, area] } });
  }
  revalidatePath("/count", "layout");
  return {};
}

/** Due items with no number yet. A count can't be finished while any are left (0 is an answer). */
async function missingLines(count: { id: string; area: string | null }, role: "MANAGER" | "STAFF") {
  const [items, lines, prepLines] = await Promise.all([
    countItems(count.area ?? undefined, role),
    db.stockCountLine.findMany({ where: { countId: count.id }, select: { ingredientId: true } }),
    db.stockCountPrepLine.findMany({ where: { countId: count.id }, select: { recipeId: true } }),
  ]);
  const have = new Set([...lines.map((l) => l.ingredientId), ...prepLines.map((l) => prepKey(l.recipeId))]);
  return items.filter((i) => i.due && !have.has(i.id));
}

/**
 * Done counting. Every due line needs a number first. A manager's count is
 * official at once; a staff count goes to the manager to approve (it doesn't
 * move stock, ordering or variance until then).
 */
export async function finishCount(countId: string): Promise<{ error?: string } | void> {
  const me = await requireUser();
  const count = await db.stockCount.findUnique({ where: { id: countId } });
  if (!count || count.completed) redirect("/count");
  const missing = await missingLines(count, me.role === "MANAGER" ? "MANAGER" : "STAFF");
  if (missing.length) return { error: `${missing.length} item${missing.length === 1 ? " still needs" : "s still need"} a number: ${missing.slice(0, 3).map((m) => m.name).join(", ")}${missing.length > 3 ? "…" : ""}. Enter 0 if there's none.` };
  if (me.role === "MANAGER") {
    await makeOfficial(countId, count.submittedAt ?? new Date(), me.name);
    refreshCounts();
    redirect(`/count/${countId}/summary`);
  }
  await db.stockCount.update({ where: { id: countId }, data: { submittedAt: new Date() } });
  refreshCounts();
  redirect("/count?sent=1");
}

/** Official: counts stock, and prep lines become the prep list's on-hand. */
async function makeOfficial(countId: string, takenAt: Date, by: string) {
  const prep = await db.stockCountPrepLine.findMany({ where: { countId } });
  await db.$transaction([
    db.stockCount.update({ where: { id: countId }, data: { completed: true, takenAt, submittedAt: takenAt, approvedAt: new Date(), approvedBy: by } }),
    ...prep.map((l) => db.prepCount.upsert({ where: { clientId: `count:${countId}:${l.recipeId}` }, create: { recipeId: l.recipeId, qtyBase: l.qtyBase, countedAt: takenAt, countedBy: by, clientId: `count:${countId}:${l.recipeId}` }, update: { qtyBase: l.qtyBase, countedAt: takenAt } })),
  ]);
}

/** "Something's missing?" — a note for the manager on this count. */
export async function addCountNote(countId: string, raw: string): Promise<{ error?: string }> {
  const me = await requireUser();
  const text = raw.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!text) return { error: "Type what's missing or wrong." };
  const count = await db.stockCount.findUnique({ where: { id: countId }, select: { staffNote: true, completed: true } });
  if (!count) return { error: "This count was discarded." };
  const line = `${me.name}: ${text}`;
  await db.stockCount.update({ where: { id: countId }, data: { staffNote: count.staffNote ? `${count.staffNote}\n${line}` : line } });
  refreshCounts();
  return {};
}

/** Manager: make a submitted count the official one. */
export async function approveCount(countId: string): Promise<{ error?: string }> {
  const me = await requireUser("MANAGER");
  const count = await db.stockCount.findUnique({ where: { id: countId } });
  if (!count) return { error: "That count was discarded." };
  if (count.completed) return {};
  await makeOfficial(countId, count.submittedAt ?? new Date(), me.name);
  refreshCounts();
  return {};
}

/** Manager: send a submitted count back so whoever counted can fix it. */
export async function sendBackCount(countId: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await db.stockCount.updateMany({ where: { id: countId, completed: false }, data: { submittedAt: null } });
  refreshCounts();
  return {};
}

function refreshCounts() {
  revalidatePath("/count");
  revalidatePath("/ordering");
  revalidatePath("/variance");
  revalidatePath("/prep");
}

export async function discardCount(countId: string) {
  const me = await requireUser();
  const count = await db.stockCount.findUnique({ where: { id: countId }, select: { submittedAt: true } });
  // Once it's with the manager, only the manager can throw it away.
  if (count?.submittedAt && me.role !== "MANAGER") redirect("/count");
  await db.stockCount.deleteMany({ where: { id: countId, completed: false } });
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
