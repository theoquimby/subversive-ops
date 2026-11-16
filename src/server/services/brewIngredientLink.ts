import "server-only";
import { Prisma } from "@prisma/client";
import { brewIngredientIdentity, ingredientKey, planBrewIngredientLinks, productSkuFor, purchaseUnitFor, type LinkSummary } from "@/domain/brewIngredientLink";
import type { BaseUnit } from "@/domain/units";
import { db } from "../db";

/**
 * Link brewing recipe lines to ingredients (see domain/brewIngredientLink.ts
 * for the naming): every line with no ingredient gets one, existing or new.
 * New ones go on the brewery side, and when the line names a brewery supplier
 * they get a product there (no price yet), so ordering knows who sells it and
 * the brewing price table has something to price. Running it again adds nothing.
 */

export type { LinkSummary } from "@/domain/brewIngredientLink";

const BREWERY = "brewery";
const D = (n: number) => new Prisma.Decimal(n.toFixed(4));
const countUnitFor = (base: BaseUnit) => (base === "g" ? "lb" : base === "ml" ? "gal" : "each");

export async function linkBrewIngredients(opts: { recipeIds?: string[] } = {}): Promise<LinkSummary> {
  const scope: Prisma.BrewRecipeLineWhereInput = opts.recipeIds ? { recipeId: { in: opts.recipeIds } } : {};
  if (opts.recipeIds && !opts.recipeIds.length) return { ingredientsCreated: 0, ingredientsReused: 0, linesLinked: 0, linesLeft: [], productsCreated: 0 };

  return db.$transaction(
    async (tx) => {
      const [lines, ingredients, suppliers] = await Promise.all([
        tx.brewRecipeLine.findMany({ where: { ...scope, ingredientId: null }, orderBy: [{ recipe: { name: "asc" } }, { sort: "asc" }], select: { id: true, kind: true, name: true, unit: true, recipe: { select: { name: true } } } }),
        tx.ingredient.findMany({ select: { id: true, name: true, baseUnit: true, department: true, active: true, conversions: { select: { unit: true, baseQty: true } } } }),
        tx.supplier.findMany({ where: { department: BREWERY }, select: { id: true, name: true } }),
      ]);
      const plan = planBrewIngredientLinks(
        lines.map((l) => ({ id: l.id, recipe: l.recipe.name, kind: l.kind, name: l.name, unit: l.unit })),
        ingredients.map((i) => ({ id: i.id, name: i.name, baseUnit: i.baseUnit as BaseUnit, conversions: i.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })) })),
      );

      // New ingredients, on the brewery side.
      const idByKey = new Map<string, string>();
      for (const c of plan.creates) {
        const created = await tx.ingredient.create({
          data: { name: c.name, category: c.category, baseUnit: c.baseUnit, department: BREWERY, storageArea: "Brewery", countUnit: countUnitFor(c.baseUnit), safetyPct: new Prisma.Decimal(0) },
          select: { id: true },
        });
        idByKey.set(c.key, created.id);
      }

      // Link the lines, a batch per ingredient.
      const byIngredient = new Map<string, string[]>();
      for (const l of plan.links) {
        const id = l.ingredientId ?? idByKey.get(l.key);
        if (id) byIngredient.set(id, [...(byIngredient.get(id) ?? []), l.lineId]);
      }
      let linesLinked = 0;
      for (const [ingredientId, ids] of byIngredient) linesLinked += (await tx.brewRecipeLine.updateMany({ where: { id: { in: ids }, ingredientId: null }, data: { ingredientId } })).count;

      // A brewery ingredient switched off earlier is in use again.
      const ingById = new Map(ingredients.map((i) => [i.id, i]));
      const wake = plan.reused.filter((id) => ingById.get(id)?.department === BREWERY && !ingById.get(id)?.active);
      if (wake.length) await tx.ingredient.updateMany({ where: { id: { in: wake } }, data: { active: true } });

      // ---- Products at the line's supplier
      // For the ingredients this made (new now, or on an earlier run, recognised by
      // name), on any line in scope, that no brewery supplier sells yet.
      const supplierId = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
      const want = new Map<string, { supplierId: string; key: string }>();
      const consider = (ingredientId: string, key: string, hint: string | null) => {
        const sid = hint ? supplierId.get(hint.trim().toLowerCase()) : undefined;
        if (sid && !want.has(ingredientId)) want.set(ingredientId, { supplierId: sid, key });
      };
      for (const [key, id] of idByKey) consider(id, key, plan.identities.get(key)?.supplierHint ?? null);
      const linked = await tx.brewRecipeLine.findMany({
        where: { ...scope, ingredientId: { not: null }, ingredient: { department: BREWERY } },
        select: { kind: true, name: true, unit: true, ingredient: { select: { id: true, name: true } } },
      });
      for (const l of linked) {
        const ident = brewIngredientIdentity(l);
        if (l.ingredient && ident && ident.key === ingredientKey(l.ingredient.name)) consider(l.ingredient.id, ident.key, ident.supplierHint);
      }

      let productsCreated = 0;
      if (want.size) {
        const ings = await tx.ingredient.findMany({
          where: { id: { in: [...want.keys()] } },
          select: { id: true, name: true, baseUnit: true, preferredProductId: true, products: { where: { supplier: { department: BREWERY } }, select: { id: true } } },
        });
        for (const ing of ings) {
          if (ing.products.length) continue;
          const w = want.get(ing.id)!;
          const sku = productSkuFor(w.key);
          // A product with this code already at the supplier, for something else: leave it be.
          const clash = await tx.supplierProduct.findUnique({ where: { supplierId_sku: { supplierId: w.supplierId, sku } }, select: { id: true, ingredientId: true } });
          if (clash && clash.ingredientId && clash.ingredientId !== ing.id) continue;
          const pu = purchaseUnitFor(ing.baseUnit as BaseUnit);
          const data = { ingredientId: ing.id, description: ing.name, packText: `1 ${pu.unit}`, purchaseUnit: pu.unit, packQtyBase: D(pu.packQtyBase), active: true };
          const product = clash ? await tx.supplierProduct.update({ where: { id: clash.id }, data, select: { id: true } }) : await tx.supplierProduct.create({ data: { ...data, supplierId: w.supplierId, sku }, select: { id: true } });
          productsCreated++;
          if (!ing.preferredProductId) await tx.ingredient.update({ where: { id: ing.id }, data: { preferredProductId: product.id } });
        }
      }

      return {
        ingredientsCreated: idByKey.size,
        ingredientsReused: plan.reused.length,
        linesLinked,
        linesLeft: plan.left.map(({ recipe, line, why }) => ({ recipe, line, why })),
        productsCreated,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/** Recipes, and recipe lines with no ingredient, for the banners. */
export async function brewLinkStatus(): Promise<{ recipes: number; unlinkedLines: number }> {
  const [recipes, unlinkedLines] = await Promise.all([db.brewRecipe.count(), db.brewRecipeLine.count({ where: { ingredientId: null } })]);
  return { recipes, unlinkedLines };
}
