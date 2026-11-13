"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor } from "@/server/services/inventory";
import { setPar } from "@/server/services/planning";
import { canConvert, toBase } from "@/domain/units";
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

export async function archiveIngredient(id: string) {
  await requireUser("MANAGER");
  const used = await db.recipeLine.count({ where: { ingredientId: id, recipe: { active: true } } });
  if (used > 0) return { error: `Used in ${used} recipe line${used > 1 ? "s" : ""}.` };
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id } });
  await db.ingredient.update({ where: { id }, data: { active: false, name: `${ing.name} (archived ${Date.now()})` } });
  revalidatePath("/ingredients");
  redirect("/ingredients");
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
