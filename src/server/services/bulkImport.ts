import "server-only";
import { buildPlan, googleSheetXlsxUrl, type ImportPlan, type Mapping, type RawTable, type TableKind } from "@/domain/bulkImport";
import { parseISODate } from "@/domain/dates";
import type { BaseUnit } from "@/domain/units";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { priceAsOf } from "./costing";
import { parseWorkbook } from "./priceImport";
import { businessToday } from "./sales";

export interface TableSpec {
  table: RawTable;
  kind: TableKind;
  mapping: Mapping;
}

async function existing() {
  const [ingredients, recipes, suppliers] = await Promise.all([
    db.ingredient.findMany({ where: { active: true }, select: { id: true, name: true, baseUnit: true } }),
    db.recipe.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.supplier.findMany({ select: { id: true, name: true } }),
  ]);
  return { ingredients: ingredients.map((i) => ({ ...i, baseUnit: i.baseUnit as BaseUnit })), recipes, suppliers };
}

export async function planImport(specs: TableSpec[]): Promise<ImportPlan> {
  return buildPlan(specs, await existing());
}

/** Download a Google Sheet shared as "anyone with the link" — every tab. */
export async function fetchGoogleSheet(url: string): Promise<RawTable[]> {
  const xlsx = googleSheetXlsxUrl(url);
  if (!xlsx) throw new Error("That doesn't look like a Google Sheets link.");
  const res = await fetch(xlsx, { redirect: "follow", cache: "no-store" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) {
    throw new Error("Couldn't open the sheet. In Google Sheets: Share → General access → \"Anyone with the link\" (Viewer), then try again — or copy the cells and paste them instead.");
  }
  return parseWorkbook(new Uint8Array(await res.arrayBuffer())).map((t) => ({ name: t.name, headers: t.headers, rows: t.records }));
}

export interface ApplyResult {
  suppliers: number;
  ingredientsCreated: number;
  ingredientsUpdated: number;
  products: number;
  prices: number;
  recipesCreated: number;
  recipesUpdated: number;
}

/** Apply a plan in one transaction. Re-running the same import is safe (upserts; prices only added when changed). */
export async function applyImport(specs: TableSpec[]): Promise<ApplyResult> {
  const plan = await planImport(specs);
  const today = businessToday();
  const r: ApplyResult = { suppliers: 0, ingredientsCreated: 0, ingredientsUpdated: 0, products: 0, prices: 0, recipesCreated: 0, recipesUpdated: 0 };

  await db.$transaction(
    async (tx) => {
      // Suppliers
      const supplierId = new Map<string, string>();
      for (const name of plan.suppliers) {
        const found = await tx.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
        const s = found ?? (await tx.supplier.create({ data: { name, kind: name === "Unassigned supplier" ? "LOCAL" : "DISTRIBUTOR" } }));
        if (!found) r.suppliers++;
        supplierId.set(name, s.id);
      }

      // Ingredients + supplier products + prices
      const ingredientId = new Map<string, string>();
      for (const ing of plan.ingredients) {
        let id = ing.existingId;
        if (id) {
          await tx.ingredient.update({ where: { id }, data: { category: ing.category, storageArea: ing.storageArea, yieldPct: new Prisma.Decimal(ing.yieldPct) } });
          r.ingredientsUpdated++;
        } else {
          id = (await tx.ingredient.create({ data: { name: ing.name, category: ing.category, storageArea: ing.storageArea, baseUnit: ing.baseUnit, yieldPct: new Prisma.Decimal(ing.yieldPct) } })).id;
          r.ingredientsCreated++;
        }
        ingredientId.set(ing.name.toLowerCase(), id);

        const p = ing.product;
        if (!p) continue;
        const sid = supplierId.get(p.supplier)!;
        const product = await tx.supplierProduct.upsert({
          where: { supplierId_sku: { supplierId: sid, sku: p.sku } },
          create: { supplierId: sid, sku: p.sku, description: p.description, packText: p.packText, purchaseUnit: p.purchaseUnit, ingredientId: id, packQtyBase: p.packQtyBase == null ? null : new Prisma.Decimal(p.packQtyBase.toFixed(4)) },
          update: { ingredientId: id, packText: p.packText ?? undefined, packQtyBase: p.packQtyBase == null ? undefined : new Prisma.Decimal(p.packQtyBase.toFixed(4)), active: true },
          include: { prices: { select: { price: true, effectiveDate: true }, orderBy: { effectiveDate: "asc" } } },
        });
        r.products++;
        await tx.ingredient.updateMany({ where: { id, preferredProductId: null }, data: { preferredProductId: product.id } });
        if (p.price != null) {
          const current = priceAsOf(product.prices.map((x) => ({ date: x.effectiveDate.toISOString().slice(0, 10), price: x.price.toNumber() })), today);
          if (current == null || Math.abs(current - p.price) >= 0.005) {
            await tx.priceRecord.create({ data: { supplierProductId: product.id, price: new Prisma.Decimal(p.price.toFixed(2)), effectiveDate: parseISODate(today), source: "IMPORT" } });
            r.prices++;
          }
        }
      }
      for (const i of await tx.ingredient.findMany({ where: { active: true }, select: { id: true, name: true } })) {
        if (!ingredientId.has(i.name.toLowerCase())) ingredientId.set(i.name.toLowerCase(), i.id);
      }

      // Recipes: create/update headers first so sub-recipes can be referenced in any order.
      const recipeId = new Map<string, string>();
      for (const rec of plan.recipes) {
        const data = {
          kind: rec.kind,
          category: rec.category,
          menuPrice: rec.menuPrice == null ? undefined : new Prisma.Decimal(rec.menuPrice),
          yieldQty: new Prisma.Decimal(rec.yieldQty),
          yieldUnit: rec.yieldUnit,
          yieldBase: rec.yieldBase,
        };
        const saved = rec.existingId ? await tx.recipe.update({ where: { id: rec.existingId }, data }) : await tx.recipe.create({ data: { name: rec.name, ...data } });
        if (rec.existingId) r.recipesUpdated++;
        else r.recipesCreated++;
        recipeId.set(rec.name.toLowerCase(), saved.id);
      }
      for (const x of await tx.recipe.findMany({ where: { active: true }, select: { id: true, name: true } })) {
        if (!recipeId.has(x.name.toLowerCase())) recipeId.set(x.name.toLowerCase(), x.id);
      }
      for (const rec of plan.recipes) {
        const id = recipeId.get(rec.name.toLowerCase())!;
        await tx.recipeLine.deleteMany({ where: { recipeId: id } });
        await tx.recipeLine.createMany({
          data: rec.lines.map((l, sort) => ({
            recipeId: id,
            ingredientId: l.ingredient ? ingredientId.get(l.ingredient.toLowerCase()) ?? null : null,
            subRecipeId: l.subRecipe ? recipeId.get(l.subRecipe.toLowerCase()) ?? null : null,
            qty: new Prisma.Decimal(l.qty),
            unit: l.unit,
            sort,
          })).filter((l) => l.ingredientId || l.subRecipeId),
        });
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return r;
}
