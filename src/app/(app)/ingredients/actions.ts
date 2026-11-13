"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor } from "@/server/services/inventory";
import { setPar } from "@/server/services/planning";
import { canConvert, toBase } from "@/domain/units";
import { archivedName, baseName } from "@/domain/archiveName";
import { shortDate } from "@/lib/format";
import { businessToday } from "@/server/services/sales";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const ingredientSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  category: z.string().trim().min(1).default("Other"),
  storageArea: z.string().trim().min(1).default("Dry storage"),
  baseUnit: z.enum(["g", "ml", "each"]),
  yieldPct: z.coerce.number().min(1).max(100),
  safetyPct: z.coerce.number().min(0).max(200),
  countUnit: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const fields = (form: FormData) => Object.fromEntries(["name", "category", "storageArea", "baseUnit", "yieldPct", "safetyPct", "countUnit", "notes"].map((k) => [k, form.get(k) ?? undefined]));

export async function saveIngredient(id: string | null, _: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  await requireUser("MANAGER");
  const parsed = ingredientSchema.safeParse(fields(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const data = {
    name: v.name,
    category: v.category,
    storageArea: v.storageArea,
    baseUnit: v.baseUnit,
    yieldPct: new Prisma.Decimal(v.yieldPct / 100),
    safetyPct: new Prisma.Decimal(v.safetyPct / 100),
    countUnit: v.countUnit || null,
    notes: v.notes || null,
  };
  try {
    if (id) {
      const current = await db.ingredient.findUniqueOrThrow({ where: { id }, include: { conversions: true } });
      if (current.baseUnit !== v.baseUnit) {
        const used = await db.recipeLine.count({ where: { ingredientId: id } });
        if (used > 0) return { error: "Base unit can't change while recipes use this ingredient." };
      }
      if (data.countUnit && !canConvert(data.countUnit, v.baseUnit, current.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })))) {
        return { error: `Count unit "${data.countUnit}" doesn't convert to ${v.baseUnit} — add a conversion first.` };
      }
      await db.ingredient.update({ where: { id }, data });
    } else {
      const created = await db.ingredient.create({ data });
      revalidatePath("/ingredients");
      redirect(`/ingredients/${created.id}`);
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "An ingredient with that name already exists." };
    throw e;
  }
  revalidatePath("/ingredients");
  revalidatePath(`/ingredients/${id}`);
  revalidatePath("/menu");
  return { ok: true };
}

export async function addConversion(ingredientId: string, form: FormData) {
  await requireUser("MANAGER");
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  const unit = String(form.get("unit") ?? "").trim().toLowerCase();
  const amount = Number(form.get("amount"));
  const amountUnit = String(form.get("amountUnit") ?? ing.baseUnit);
  if (!unit || !(amount > 0)) return;
  const baseQty = toBase(amount, amountUnit, ing.baseUnit);
  await db.unitConversion.upsert({
    where: { ingredientId_unit: { ingredientId, unit } },
    create: { ingredientId, unit, baseQty: new Prisma.Decimal(baseQty.toFixed(4)) },
    update: { baseQty: new Prisma.Decimal(baseQty.toFixed(4)) },
  });
  revalidatePath(`/ingredients/${ingredientId}`);
}

export async function removeConversion(ingredientId: string, conversionId: string) {
  await requireUser("MANAGER");
  await db.unitConversion.delete({ where: { id: conversionId } });
  revalidatePath(`/ingredients/${ingredientId}`);
}

export async function setPreferredProduct(ingredientId: string, productId: string) {
  await requireUser("MANAGER");
  await db.ingredient.update({ where: { id: ingredientId }, data: { preferredProductId: productId } });
  revalidatePath(`/ingredients/${ingredientId}`);
  revalidatePath("/menu");
}

/** Pack size: "how much is in one case", entered in any unit. */
export async function setPackSize(productId: string, form: FormData) {
  await requireUser("MANAGER");
  const p = await db.supplierProduct.findUniqueOrThrow({ where: { id: productId }, include: { ingredient: { include: { conversions: true } } } });
  if (!p.ingredient) return;
  const amount = Number(form.get("amount"));
  const unit = String(form.get("unit") ?? p.ingredient.baseUnit);
  if (!(amount > 0)) return;
  const base = toBase(amount, unit, p.ingredient.baseUnit, p.ingredient.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })));
  await db.supplierProduct.update({ where: { id: productId }, data: { packQtyBase: new Prisma.Decimal(base.toFixed(4)), purchaseUnit: String(form.get("purchaseUnit") || p.purchaseUnit) } });
  revalidatePath(`/ingredients/${p.ingredient.id}`);
  revalidatePath("/prices");
  revalidatePath("/menu");
}

export async function unlinkProduct(ingredientId: string, productId: string) {
  await requireUser("MANAGER");
  await db.$transaction([
    db.ingredient.updateMany({ where: { id: ingredientId, preferredProductId: productId }, data: { preferredProductId: null } }),
    db.supplierProduct.update({ where: { id: productId }, data: { ingredientId: null } }),
  ]);
  revalidatePath(`/ingredients/${ingredientId}`);
}

/** Archive from the ingredients list. Blocked while an active recipe uses it. */
export async function archiveIngredient(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const ing = await db.ingredient.findUnique({ where: { id } });
  if (!ing) return { error: "That ingredient no longer exists." };
  if (!ing.active) return {};
  const used = await db.recipeLine.findMany({ where: { ingredientId: id, recipe: { active: true } }, select: { recipe: { select: { name: true } } }, distinct: ["recipeId"], take: 4 });
  if (used.length > 0) {
    const names = used.slice(0, 3).map((u) => u.recipe.name);
    return { error: `Used in ${names.join(", ")}${used.length > 3 ? " and more" : ""}. Take it out of ${used.length === 1 ? "that recipe" : "those recipes"} first.` };
  }
  // Names are unique across active and archived ingredients, so park the old name under a readable suffix.
  const label = shortDate(businessToday());
  let name = archivedName(ing.name, label);
  for (let n = 2; await db.ingredient.findUnique({ where: { name }, select: { id: true } }); n++) name = archivedName(ing.name, label, n);
  await db.ingredient.update({ where: { id }, data: { active: false, name } });
  revalidatePath("/ingredients");
  revalidatePath("/count");
  return {};
}

export async function restoreIngredient(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const ing = await db.ingredient.findUnique({ where: { id } });
  if (!ing) return { error: "That ingredient no longer exists." };
  if (ing.active) return {};
  const name = baseName(ing.name);
  const clash = await db.ingredient.findUnique({ where: { name }, select: { id: true } });
  if (clash && clash.id !== id) return { error: `There's already an ingredient called "${name}". Rename it first, then restore this one.` };
  await db.ingredient.update({ where: { id }, data: { active: true, name } });
  revalidatePath("/ingredients");
  revalidatePath("/count");
  return {};
}

/** Minimum on hand, typed in the ingredient's count unit. Used for items no recipe uses. */
export async function setMinOnHand(ingredientId: string, raw: string) {
  await requireUser("MANAGER");
  const ing = await db.ingredient.findUnique({ where: { id: ingredientId }, include: { conversions: true, preferredProduct: { select: { purchaseUnit: true, packQtyBase: true } } } });
  if (!ing) return { error: "That ingredient is gone." };
  const text = raw.trim();
  if (text === "") {
    await setPar(ingredientId, null);
  } else {
    const n = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) return { error: "Enter a quantity, or leave blank." };
    const { units, conversions } = countUnitsFor(ing);
    try {
      await setPar(ingredientId, n === 0 ? null : toBase(n, units[0], ing.baseUnit, conversions));
    } catch {
      return { error: `Can't convert ${units[0]} for this ingredient.` };
    }
  }
  revalidatePath("/ingredients");
}

// ---- Bulk actions (Ingredients table) ----------------------------------------------------

const bulkIds = z.array(z.string().min(1).max(64)).min(1).max(2000);
type BulkResult = { error?: string; message?: string };
const count = (n: number) => `${n} ingredient${n === 1 ? "" : "s"}`;

/** Set category, storage area or order buffer % on several ingredients at once. */
export async function bulkSetIngredients(ids: string[], field: "category" | "storageArea" | "safetyPct", raw: string): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = bulkIds.safeParse(ids);
  if (!p.success) return { error: "Pick at least one ingredient." };
  const value = raw.trim();
  if (field === "safetyPct") {
    const n = Number(value.replace(/%$/, ""));
    if (!Number.isFinite(n) || n < 0 || n > 200) return { error: "Buffer is 0–200%." };
    await db.ingredient.updateMany({ where: { id: { in: p.data } }, data: { safetyPct: new Prisma.Decimal(n / 100) } });
  } else {
    if (!value || value.length > 80) return { error: "Type a name." };
    await db.ingredient.updateMany({ where: { id: { in: p.data } }, data: { [field]: value } });
  }
  revalidatePath("/", "layout");
  const what = field === "category" ? `category to ${value}` : field === "storageArea" ? `storage to ${value}` : `buffer to ${value.replace(/%$/, "")}%`;
  return { message: `Set ${what} on ${count(p.data.length)}.` };
}

/** Same minimum on hand for several ingredients, each in its own count unit (blank clears). */
export async function bulkSetMinOnHand(ids: string[], raw: string): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = bulkIds.safeParse(ids);
  if (!p.success) return { error: "Pick at least one ingredient." };
  const errors: string[] = [];
  for (const id of p.data) {
    const r = await setMinOnHand(id, raw);
    if (r?.error) errors.push(r.error);
  }
  revalidatePath("/ingredients");
  if (errors.length === p.data.length) return { error: errors[0] };
  return { message: `${raw.trim() ? "Set" : "Cleared"} minimum on hand for ${count(p.data.length - errors.length)}${errors.length ? `; ${errors.length} couldn't convert` : ""}.` };
}

/** Archive several. Ingredients still in a recipe are skipped and named. */
export async function archiveIngredients(ids: string[]): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = bulkIds.safeParse(ids);
  if (!p.success) return { error: "Pick at least one ingredient." };
  let done = 0;
  const kept: string[] = [];
  for (const id of p.data) {
    const r = await archiveIngredient(id);
    if (r.error) {
      const ing = await db.ingredient.findUnique({ where: { id }, select: { name: true } });
      kept.push(ing?.name ?? id);
    } else done++;
  }
  if (!done) return { error: `${kept.length === 1 ? `${kept[0]} is` : "All of them are"} still used in recipes.` };
  return { message: `Archived ${count(done)}.${kept.length ? ` Kept ${kept.slice(0, 3).join(", ")}${kept.length > 3 ? ` and ${kept.length - 3} more` : ""}: still in recipes.` : ""}` };
}
