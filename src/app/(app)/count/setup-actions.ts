"use server";

/**
 * Count setup (managers only): what each item looks like, how to count it,
 * which units staff may use, how often it's counted and where it sits on the
 * shelf. Items are ingredients or prep recipes ("p_<recipeId>").
 */

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { COUNT_UNITS_INCLUDE, countUnitsFor, storageAreas } from "@/server/services/inventory";
import { prepUnits } from "@/server/services/counts";
import { cleanAreaName } from "@/domain/storageAreas";
import { asCountEvery, parseItemKey } from "@/domain/countPlan";
import { toBase, type BaseUnit } from "@/domain/units";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { archiveIngredient } from "../ingredients/actions";

type R = { error?: string };
const GONE = { error: "That item isn't there any more." };
const refresh = (key?: string) => {
  revalidatePath("/count", "layout");
  if (key) {
    const { kind, id } = parseItemKey(key);
    revalidatePath(kind === "prep" ? `/menu/${id}` : `/ingredients/${id}`);
  }
};

/** Every unit an item converts to, its current default and allowed list. */
async function unitsOf(key: string) {
  const { kind, id } = parseItemKey(key);
  if (kind === "prep") {
    const r = await db.recipe.findUnique({ where: { id }, include: { countUnitList: true } });
    if (!r) return null;
    const setting = await db.prepSetting.findUnique({ where: { recipeId: id } });
    const o = prepUnits({ ...r, countUnits: [] }, setting);
    return { name: r.name, base: r.yieldBase as BaseUnit, units: o.units, conversions: o.conversions, countUnit: r.countUnit, allowed: r.countUnits };
  }
  const ing = await db.ingredient.findUnique({ where: { id }, include: COUNT_UNITS_INCLUDE });
  if (!ing) return null;
  const o = countUnitsFor({ ...ing, countUnits: [] });
  return { name: ing.name, base: ing.baseUnit as BaseUnit, units: o.units, conversions: o.conversions, countUnit: ing.countUnit, allowed: ing.countUnits };
}

/** Update the ingredient or the prep recipe behind a key. */
async function update(key: string, data: { countNote?: string | null; countUnit?: string | null; countUnits?: string[]; countEvery?: string; countOrder?: number | null; photoAt?: Date | null; area?: string | null }) {
  const { kind, id } = parseItemKey(key);
  const { area, ...rest } = data;
  if (kind === "prep") return db.recipe.update({ where: { id }, data: { ...rest, ...(area !== undefined ? { countArea: area } : {}) } }).then(() => true).catch(() => false);
  return db.ingredient.update({ where: { id }, data: { ...rest, ...(area ? { storageArea: area } : {}) } }).then(() => true).catch(() => false);
}

export async function setCountNote(key: string, raw: string): Promise<R> {
  await requireUser("MANAGER");
  if (!(await update(key, { countNote: raw.trim().slice(0, 600) || null }))) return GONE;
  refresh(key);
  return {};
}

export async function setCountEvery(key: string, raw: string): Promise<R> {
  await requireUser("MANAGER");
  if (!(await update(key, { countEvery: asCountEvery(raw) }))) return GONE;
  refresh(key);
  return {};
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 700 * 1024;

/** A photo of the item (the browser shrinks it to ~900 px JPEG first). Stored in the database, like beer labels. */
export async function uploadItemPhoto(form: FormData): Promise<R> {
  await requireUser("MANAGER");
  const key = String(form.get("key") ?? "");
  const file = form.get("file");
  if (!key || !(file instanceof File)) return { error: "Pick a photo." };
  if (!PHOTO_TYPES.includes(file.type)) return { error: "Use a JPEG, PNG or WebP photo." };
  if (file.size > PHOTO_MAX) return { error: "That photo is too big. Try again — it's shrunk before sending." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(png && file.type === "image/png") && !(jpg && file.type === "image/jpeg") && !(webp && file.type === "image/webp")) return { error: "That file isn't a readable photo." };
  const { kind, id } = parseItemKey(key);
  const where = kind === "prep" ? { recipeId: id } : { ingredientId: id };
  const exists = kind === "prep" ? await db.recipe.findUnique({ where: { id }, select: { id: true } }) : await db.ingredient.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return GONE;
  await db.countPhoto.upsert({ where, create: { ...where, mime: file.type, bytes }, update: { mime: file.type, bytes } });
  await update(key, { photoAt: new Date() });
  refresh(key);
  return {};
}

export async function removeItemPhoto(key: string): Promise<R> {
  await requireUser("MANAGER");
  const { kind, id } = parseItemKey(key);
  await db.countPhoto.deleteMany({ where: kind === "prep" ? { recipeId: id } : { ingredientId: id } });
  await update(key, { photoAt: null });
  refresh(key);
  return {};
}

/** Units staff may count this item in (empty = any). */
export async function setAllowedUnits(key: string, units: string[]): Promise<R> {
  await requireUser("MANAGER");
  const u = await unitsOf(key);
  if (!u) return GONE;
  const keep = [...new Set(units.filter((x) => u.units.includes(x)))];
  // The default count unit stays one of the allowed ones.
  const countUnit = keep.length && !keep.includes(u.countUnit ?? u.units[0]) ? keep[0] : u.countUnit;
  await update(key, { countUnits: keep, countUnit });
  refresh(key);
  return {};
}

export async function setDefaultCountUnit(key: string, unit: string): Promise<R> {
  await requireUser("MANAGER");
  const u = await unitsOf(key);
  if (!u) return GONE;
  if (!u.units.includes(unit)) return { error: `"${unit}" doesn't convert for ${u.name}.` };
  await update(key, { countUnit: unit, ...(u.allowed.length && !u.allowed.includes(unit) ? { countUnits: [unit, ...u.allowed] } : {}) });
  refresh(key);
  return {};
}

/** Add a unit right from the count sheet: "1 jug = 114 oz", "1/3 pan = 30 each". */
export async function addCountUnit(key: string, rawUnit: string, amount: number, amountUnit: string): Promise<R & { unit?: string }> {
  await requireUser("MANAGER");
  const unit = rawUnit.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
  if (!unit) return { error: "Name the unit, like jug or 1/3 pan." };
  if (!(amount > 0) || !Number.isFinite(amount)) return { error: "Enter how much is in one." };
  if (unit === amountUnit.trim().toLowerCase()) return { error: "Use a different unit for the amount." };
  const u = await unitsOf(key);
  if (!u) return GONE;
  let baseQty: number;
  try {
    baseQty = toBase(amount, amountUnit, u.base, u.conversions);
  } catch {
    return { error: `"${amountUnit}" doesn't convert for ${u.name}.` };
  }
  const { kind, id } = parseItemKey(key);
  const qty = new Prisma.Decimal(baseQty.toFixed(4));
  if (kind === "prep") await db.recipeCountUnit.upsert({ where: { recipeId_unit: { recipeId: id, unit } }, create: { recipeId: id, unit, baseQty: qty }, update: { baseQty: qty } });
  else await db.unitConversion.upsert({ where: { ingredientId_unit: { ingredientId: id, unit } }, create: { ingredientId: id, unit, baseQty: qty }, update: { baseQty: qty } });
  // If staff are limited to some units, the new one joins them.
  if (u.allowed.length && !u.allowed.includes(unit)) await update(key, { countUnits: [...u.allowed, unit] });
  refresh(key);
  return { unit };
}

/** Every item in an area (ingredients and prep), in shelf order. */
async function shelf(area: string) {
  const [ings, preps] = await Promise.all([
    db.ingredient.findMany({ where: { active: true, storageArea: area, department: { not: "brewery" } }, select: { id: true, countOrder: true, category: true, name: true } }),
    db.recipe.findMany({ where: { kind: "PREP", active: true, countArea: area }, select: { id: true, countOrder: true, name: true } }),
  ]);
  return [...ings.map((i) => ({ key: i.id, order: i.countOrder, kind: 0, category: i.category, name: i.name })), ...preps.map((p) => ({ key: `p_${p.id}`, order: p.countOrder, kind: 1, category: "Prep", name: p.name }))]
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.kind - b.kind || a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    .map((x) => x.key);
}

async function areaOf(key: string) {
  const { kind, id } = parseItemKey(key);
  if (kind === "prep") return (await db.recipe.findUnique({ where: { id }, select: { countArea: true } }))?.countArea ?? null;
  return (await db.ingredient.findUnique({ where: { id }, select: { storageArea: true } }))?.storageArea ?? null;
}

/** Move an item one place up or down its shelf (within its storage area). */
export async function moveCountItem(key: string, dir: -1 | 1): Promise<R> {
  await requireUser("MANAGER");
  const area = await areaOf(key);
  if (!area) return GONE;
  const keys = await shelf(area);
  const i = keys.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return {};
  [keys[i], keys[j]] = [keys[j], keys[i]];
  for (let k = 0; k < keys.length; k++) await update(keys[k], { countOrder: (k + 1) * 10 });
  refresh();
  return {};
}

/** Move an item to another storage area (it goes to the end of that shelf). A prep item can come off the count with "". */
export async function setCountItemArea(key: string, raw: string): Promise<R> {
  await requireUser("MANAGER");
  const { kind } = parseItemKey(key);
  const area = cleanAreaName(raw);
  if (!area && kind !== "prep") return { error: "Choose an area." };
  const n = area ? (await shelf(area)).length : 0;
  if (!(await update(key, { area: area || null, countOrder: area ? (n + 1) * 10 : null }))) return GONE;
  refresh(key);
  revalidatePath("/ingredients");
  return {};
}

/** Put prep recipes on the count, in an area. */
export async function addPrepToCount(recipeIds: string[], raw: string): Promise<R> {
  await requireUser("MANAGER");
  const area = cleanAreaName(raw) || (await storageAreas())[0];
  if (!area || !recipeIds.length) return { error: "Pick prep items and an area." };
  await db.recipe.updateMany({ where: { id: { in: recipeIds.slice(0, 200) }, kind: "PREP" }, data: { countArea: area } });
  refresh();
  return {};
}

/** Take an item off the count: an ingredient is archived (blocked while a recipe uses it); a prep item just leaves the count. */
export async function retireCountItem(key: string): Promise<R> {
  const { kind, id } = parseItemKey(key);
  if (kind === "prep") return setCountItemArea(key, "");
  const r = await archiveIngredient(id);
  refresh();
  return r;
}

/** More home areas an item is listed in on counts (besides its storage area). */
export async function setExtraHomeAreas(key: string, areas: string[]): Promise<R> {
  await requireUser("MANAGER");
  const clean = [...new Set(areas.map(cleanAreaName).filter(Boolean))].slice(0, 6);
  const { kind, id } = parseItemKey(key);
  const ok = kind === "prep"
    ? await db.recipe.update({ where: { id }, data: { countAreas: clean } }).then(() => true).catch(() => false)
    : await db.ingredient.update({ where: { id }, data: { countAreas: clean } }).then(() => true).catch(() => false);
  if (!ok) return GONE;
  refresh(key);
  return {};
}
