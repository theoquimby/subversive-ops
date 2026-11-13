"use server";

/**
 * Single-field updates for spreadsheet-style editing. Each takes the raw cell
 * text, validates it, saves, and returns { error } on bad input so the cell
 * can revert and show why.
 */

import type { BaseUnit } from "@/domain/units";
import { canConvert } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor } from "@/server/services/inventory";
import { recordManualPrice } from "@/server/services/priceImport";
import { businessToday } from "@/server/services/sales";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

type R = Promise<{ error?: string } | void>;

const money = (raw: string) => {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return raw.trim() === "" ? null : Number.isFinite(n) && n >= 0 ? n : NaN;
};

const percent = (raw: string) => {
  const n = Number(raw.replace(/[%\s]/g, ""));
  return raw.trim() === "" ? null : Number.isFinite(n) ? n : NaN;
};

function refresh() {
  revalidatePath("/", "layout");
}

export async function setIngredientField(id: string, field: "name" | "category" | "storageArea" | "yieldPct" | "safetyPct" | "countUnit", raw: string): R {
  await requireUser("MANAGER");
  const value = raw.trim();
  try {
    if (field === "name" || field === "category" || field === "storageArea") {
      if (!value) return { error: "Can't be empty" };
      await db.ingredient.update({ where: { id }, data: { [field]: value } });
    } else if (field === "yieldPct" || field === "safetyPct") {
      const n = percent(value);
      if (n == null || Number.isNaN(n)) return { error: "Enter a percentage" };
      if (field === "yieldPct" && (n <= 0 || n > 100)) return { error: "Yield is 1–100%" };
      if (field === "safetyPct" && (n < 0 || n > 200)) return { error: "Buffer is 0–200%" };
      await db.ingredient.update({ where: { id }, data: { [field]: new Prisma.Decimal(n / 100) } });
    } else if (field === "countUnit") {
      const ing = await db.ingredient.findUniqueOrThrow({ where: { id }, include: { conversions: true, preferredProduct: { select: { purchaseUnit: true, packQtyBase: true } } } });
      if (value && !canConvert(value, ing.baseUnit as BaseUnit, countUnitsFor(ing).conversions)) return { error: `"${value}" doesn't convert — add it as a custom unit` };
      await db.ingredient.update({ where: { id }, data: { countUnit: value || null } });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "That name is taken" };
    throw e;
  }
  refresh();
}

export async function setRecipeField(id: string, field: "name" | "category" | "menuPrice" | "targetFoodCostPct", raw: string): R {
  await requireUser("MANAGER");
  const value = raw.trim();
  try {
    if (field === "name" || field === "category") {
      if (!value) return { error: "Can't be empty" };
      await db.recipe.update({ where: { id }, data: { [field]: value } });
    } else if (field === "menuPrice") {
      const n = money(value);
      if (Number.isNaN(n)) return { error: "Enter a price" };
      await db.recipe.update({ where: { id }, data: { menuPrice: n == null ? null : new Prisma.Decimal(n) } });
    } else {
      const n = percent(value);
      if (Number.isNaN(n) || (n != null && (n <= 0 || n >= 100))) return { error: "Enter 1–99%" };
      await db.recipe.update({ where: { id }, data: { targetFoodCostPct: n == null ? null : new Prisma.Decimal(n / 100) } });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "That name is taken" };
    throw e;
  }
  refresh();
}

/** Typing a new price in a table records it as a manual price effective today. */
export async function setProductPrice(productId: string, raw: string): R {
  await requireUser("MANAGER");
  const n = money(raw);
  if (n == null) return;
  if (Number.isNaN(n)) return { error: "Enter a price" };
  await recordManualPrice(productId, n, businessToday());
  refresh();
}

export async function setSquareMapping(squareId: string, value: string): R {
  await requireUser("MANAGER");
  await db.squareMapping.update({
    where: { squareId },
    data: value === "__ignore" ? { recipeId: null, ignored: true } : { recipeId: value || null, ignored: false },
  });
  refresh();
}

export async function linkProductToIngredient(productId: string, ingredientId: string): R {
  await requireUser("MANAGER");
  if (!ingredientId) return;
  const { inferPackQty } = await import("@/domain/priceSheet");
  const product = await db.supplierProduct.findUniqueOrThrow({ where: { id: productId } });
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  const pack = product.packQtyBase ?? inferPackQty(product.packText, ing.baseUnit as BaseUnit);
  await db.$transaction([
    db.supplierProduct.update({ where: { id: productId }, data: { ingredientId, packQtyBase: pack == null ? undefined : new Prisma.Decimal(Number(pack).toFixed(4)) } }),
    db.ingredient.updateMany({ where: { id: ingredientId, preferredProductId: null }, data: { preferredProductId: productId } }),
  ]);
  refresh();
}
