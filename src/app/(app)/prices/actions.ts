"use server";

import type { ISODate } from "@/domain/dates";
import type { ColumnMapping, ParsedRow } from "@/domain/priceSheet";
import { inferPackQty } from "@/domain/priceSheet";
import type { BaseUnit } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { commitImport, previewImport, recordManualPrice, type ImportPreview } from "@/server/services/priceImport";
import { businessToday } from "@/server/services/sales";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function previewPriceSheet(form: FormData): Promise<{ error?: string; preview?: ImportPreview }> {
  await requireUser("MANAGER");
  const file = form.get("file");
  const supplierId = String(form.get("supplierId") ?? "");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (!supplierId) return { error: "Choose a supplier." };
  const mapping = form.get("mapping") ? (JSON.parse(String(form.get("mapping"))) as Partial<ColumnMapping>) : undefined;
  try {
    return { preview: await previewImport(supplierId, file, mapping) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function commitPriceSheet(args: { supplierId: string; filename: string; effectiveDate: ISODate; mapping: ColumnMapping; rows: ParsedRow[] }) {
  await requireUser("MANAGER");
  const res = await commitImport(args);
  revalidatePath("/", "layout");
  return res;
}

const manualSchema = z.array(z.object({ productId: z.string(), price: z.number().nonnegative() })).max(500);

export async function saveManualPrices(entries: { productId: string; price: number }[], effectiveDate?: ISODate) {
  await requireUser("MANAGER");
  const list = manualSchema.parse(entries);
  const date = effectiveDate ?? businessToday();
  for (const e of list) await recordManualPrice(e.productId, e.price, date);
  revalidatePath("/", "layout");
  return { saved: list.length };
}

/** Link a supplier product to an existing ingredient, or create the ingredient on the spot. */
export async function linkProduct(productId: string, form: FormData) {
  await requireUser("MANAGER");
  const product = await db.supplierProduct.findUniqueOrThrow({ where: { id: productId } });
  let ingredientId = String(form.get("ingredientId") ?? "");
  if (ingredientId === "__new") {
    const name = String(form.get("newName") ?? "").trim() || product.description;
    const baseUnit = (String(form.get("newBase") ?? "g") as BaseUnit);
    const existing = await db.ingredient.findUnique({ where: { name } });
    ingredientId = existing?.id ?? (await db.ingredient.create({ data: { name, baseUnit } })).id;
  }
  if (!ingredientId) return;
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  const packQtyBase = product.packQtyBase ?? inferPackQty(product.packText, ing.baseUnit as BaseUnit);
  await db.$transaction([
    db.supplierProduct.update({ where: { id: productId }, data: { ingredientId, packQtyBase: packQtyBase == null ? undefined : new Prisma.Decimal(packQtyBase.toFixed(4)) } }),
    db.ingredient.updateMany({ where: { id: ingredientId, preferredProductId: null }, data: { preferredProductId: productId } }),
  ]);
  revalidatePath("/prices");
  revalidatePath("/ingredients");
}
