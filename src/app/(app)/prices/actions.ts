"use server";

import type { ISODate } from "@/domain/dates";
import type { ColumnMapping, ParsedRow } from "@/domain/priceSheet";
import { inferPackQty } from "@/domain/priceSheet";
import type { BaseUnit } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { commitImport, previewImport, recordManualPrice, type ImportPreview } from "@/server/services/priceImport";
import { alertPriceSpikes, inBackground, saveSpikeThreshold } from "@/server/services/notify";
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
  if (res.priceChanges > 0) inBackground(() => alertPriceSpikes());
  revalidatePath("/", "layout");
  return res;
}

const manualSchema = z.object({
  entries: z.array(z.object({
    productId: z.string().min(1).max(64),
    price: z.number({ error: "One of the prices isn't a number." }).finite("One of the prices isn't a number.").nonnegative("Prices can't be below $0.").max(1_000_000, "One of the prices is too big. Check it."),
  })).min(1, "Type at least one new price.").max(500, "Save up to 500 prices at a time."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date the prices start.").optional(),
});

/** Prices typed on "Update prices by hand". Says what's wrong rather than failing. */
export async function saveManualPrices(entries: { productId: string; price: number }[], effectiveDate?: ISODate): Promise<{ error?: string; saved: number }> {
  await requireUser("MANAGER");
  const p = manualSchema.safeParse({ entries, date: effectiveDate });
  if (!p.success) return { error: p.error.issues[0].message, saved: 0 };
  const date = (p.data.date as ISODate | undefined) ?? businessToday();
  const found = new Set((await db.supplierProduct.findMany({ where: { id: { in: p.data.entries.map((e) => e.productId) } }, select: { id: true } })).map((x) => x.id));
  const missing = p.data.entries.filter((e) => !found.has(e.productId)).length;
  if (missing) return { error: `${missing === 1 ? "One product was" : `${missing} products were`} removed since you started. Refresh the page and try again.`, saved: 0 };
  for (const e of p.data.entries) await recordManualPrice(e.productId, e.price, date);
  revalidatePath("/", "layout");
  return { saved: p.data.entries.length };
}

const baseSchema = z.enum(["g", "ml", "each"]);

/** Link a supplier product to an existing ingredient, or create the ingredient on the spot. */
export async function linkProduct(productId: string, form: FormData) {
  await requireUser("MANAGER");
  const product = await db.supplierProduct.findUniqueOrThrow({ where: { id: productId } });
  let ingredientId = String(form.get("ingredientId") ?? "");
  if (ingredientId === "__new") {
    const name = String(form.get("newName") ?? "").trim() || product.description;
    const baseUnit = baseSchema.catch("g").parse(form.get("newBase"));
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

/** "Alert me when a price rises by at least N%" — typed as a percent. */
export async function savePriceAlertThreshold(value: string): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  const n = Number(value.trim().replace(/%$/, ""));
  if (!Number.isFinite(n) || n < 1 || n > 100) return { error: "Enter a percent from 1 to 100." };
  await saveSpikeThreshold(n / 100);
  revalidatePath("/prices");
}

// ---- Bulk actions (Prices table) -------------------------------------------------------

const productIds = z.array(z.string().min(1).max(64)).min(1).max(2000);
type BulkResult = { error?: string; message?: string };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Link several supplier products to one ingredient (pack sizes are read from the pack text when possible). */
export async function linkProducts(ids: string[], ingredientId: string): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = productIds.safeParse(ids);
  if (!p.success || !ingredientId) return { error: "Pick products and an ingredient." };
  const ing = await db.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ing) return { error: "That ingredient is gone." };
  const products = await db.supplierProduct.findMany({ where: { id: { in: p.data } } });
  await db.$transaction([
    ...products.map((product) => {
      const pack = product.packQtyBase ?? inferPackQty(product.packText, ing.baseUnit as BaseUnit);
      return db.supplierProduct.update({ where: { id: product.id }, data: { ingredientId, packQtyBase: pack == null ? undefined : new Prisma.Decimal(Number(pack).toFixed(4)) } });
    }),
    ...(products[0] ? [db.ingredient.updateMany({ where: { id: ingredientId, preferredProductId: null }, data: { preferredProductId: products[0].id } })] : []),
  ]);
  revalidatePath("/", "layout");
  return { message: `Linked ${plural(products.length, "product")} to ${ing.name}.` };
}

/** One new ingredient per product, named after it (or linked to an ingredient that already has that name). */
export async function createIngredientsFromProducts(ids: string[], base: BaseUnit = "g"): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = productIds.safeParse(ids);
  if (!p.success) return { error: "Pick at least one product." };
  const b = baseSchema.safeParse(base);
  if (!b.success) return { error: "Pick weight, volume or count." };
  const baseUnit = b.data;
  const products = await db.supplierProduct.findMany({ where: { id: { in: p.data }, ingredientId: null } });
  let created = 0;
  for (const product of products) {
    const name = product.description.trim();
    const existing = await db.ingredient.findUnique({ where: { name } });
    const ing = existing ?? (await db.ingredient.create({ data: { name, baseUnit } }));
    if (!existing) created++;
    const pack = product.packQtyBase ?? inferPackQty(product.packText, ing.baseUnit as BaseUnit);
    await db.supplierProduct.update({ where: { id: product.id }, data: { ingredientId: ing.id, packQtyBase: pack == null ? undefined : new Prisma.Decimal(Number(pack).toFixed(4)) } });
    await db.ingredient.updateMany({ where: { id: ing.id, preferredProductId: null }, data: { preferredProductId: product.id } });
  }
  revalidatePath("/", "layout");
  return { message: `Created ${plural(created, "ingredient")}${products.length > created ? `, linked ${products.length - created} to ones you had` : ""}. Check their units on Ingredients.` };
}

/** Hide products you don't buy (they leave this list, ordering and imports' "new" pile) or bring them back. */
export async function setProductsActive(ids: string[], active: boolean): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = productIds.safeParse(ids);
  if (!p.success) return { error: "Pick at least one product." };
  const r = await db.supplierProduct.updateMany({ where: { id: { in: p.data } }, data: { active } });
  revalidatePath("/", "layout");
  return { message: `${active ? "Restored" : "Hid"} ${plural(r.count, "product")}.` };
}

const linkPairs = z.array(z.object({ productId: z.string().min(1).max(64), ingredientId: z.string().min(1).max(64) })).min(1).max(500);

/** Apply the suggested product → ingredient links the manager ticked (Prices → "We can link these"). */
export async function applyLinkSuggestions(pairs: { productId: string; ingredientId: string }[]): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = linkPairs.safeParse(pairs);
  if (!p.success) return { error: "Tick at least one link." };
  const [products, ingredients] = await Promise.all([
    db.supplierProduct.findMany({ where: { id: { in: p.data.map((x) => x.productId) }, ingredientId: null } }),
    db.ingredient.findMany({ where: { id: { in: p.data.map((x) => x.ingredientId) } }, select: { id: true, baseUnit: true } }),
  ]);
  const byId = new Map(products.map((x) => [x.id, x]));
  const ingById = new Map(ingredients.map((x) => [x.id, x]));
  const ops = p.data.flatMap(({ productId, ingredientId }) => {
    const product = byId.get(productId);
    const ing = ingById.get(ingredientId);
    if (!product || !ing) return [];
    const pack = product.packQtyBase ?? inferPackQty(product.packText, ing.baseUnit as BaseUnit);
    return [
      db.supplierProduct.update({ where: { id: productId }, data: { ingredientId, packQtyBase: pack == null ? undefined : new Prisma.Decimal(Number(pack).toFixed(4)) } }),
      db.ingredient.updateMany({ where: { id: ingredientId, preferredProductId: null }, data: { preferredProductId: productId } }),
    ];
  });
  if (!ops.length) return { error: "Those are already linked." };
  await db.$transaction(ops);
  revalidatePath("/", "layout");
  return { message: `Linked ${plural(ops.length / 2, "product")}. Their prices now count toward plate costs.` };
}
