"use server";

import { kegSize, planDraftBeer } from "@/domain/draftBeer";
import { isRevenueClass } from "@/domain/revenueClass";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { sameMoney } from "@/domain/beerLinks";
import { brewingKegPriceFor, recordBrewingKegPrice } from "@/server/services/beerLinks";
import { saveClassSettings } from "@/server/services/insights";
import { businessToday } from "@/server/services/sales";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => {
  revalidatePath("/menu");
  revalidatePath("/");
  revalidatePath("/pnl");
  revalidatePath("/variance");
};

// ---- Revenue classes (edited inline on /menu) --------------------------------------

export async function saveCategoryClass(category: string, raw: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  if (!isRevenueClass(raw)) return { error: "Pick a class" };
  if (!category.trim()) return { error: "No category" };
  await saveClassSettings({ category, cls: raw });
  refresh();
  return {};
}

export async function saveBevTarget(raw: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = raw.replace(/[%\s]/g, "");
  if (v === "") {
    await saveClassSettings({ bevTarget: null });
    refresh();
    return {};
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return { error: "Enter a percentage between 1 and 99" };
  await saveClassSettings({ bevTarget: n / 100 });
  refresh();
  return {};
}

// ---- Draft beer helper -------------------------------------------------------------

const schema = z.object({
  beer: z.string().trim().min(1, "Name the beer.").max(80),
  kegSizeId: z.string(),
  kegCost: z.number().positive("Enter what a keg costs."),
  yieldPct: z.number().gt(0).max(1),
  supplierId: z.string().nullable(),
  pours: z
    .array(z.object({ label: z.string().trim().max(40), oz: z.number(), price: z.number().nullable(), squareId: z.string().nullable() }))
    .max(8),
});

export type DraftBeerForm = z.infer<typeof schema>;

const HOUSE_SUPPLIER = "House brewery";

/**
 * Create (or update) a draft beer in one step: the keg as an ingredient
 * (base unit ml, counted in kegs) with its keg price, one menu recipe per pour,
 * and Square links for the pours. A beer on the Kegs list keeps one keg
 * ingredient (Beer.ingredientId): running this again reuses it, never makes a
 * second "(keg)". Re-running it with a new keg cost records a new price; when
 * the cost is brewing's (a packaged brew or the brewing recipe), the price says
 * so. Existing pour recipes are updated in place.
 */
export async function createDraftBeer(input: DraftBeerForm): Promise<{ error: string } | { ok: true; recipes: number; ingredientId: string }> {
  await requireUser("MANAGER");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const f = parsed.data;
  const plan = planDraftBeer({ beer: f.beer, kegSizeId: f.kegSizeId, kegCost: f.kegCost, yieldPct: f.yieldPct, pours: f.pours });
  if ("error" in plan) return plan;
  const size = kegSize(f.kegSizeId)!;
  const today = businessToday();

  const clash = await db.recipe.findMany({ where: { name: { in: plan.pours.map((p) => p.recipeName) }, NOT: { category: "Beer" } }, select: { name: true } });
  if (clash.length) return { error: `"${clash[0].name}" already exists as a non-beer recipe. Rename the pour.` };

  // The beer on the Kegs list with this name, and what brewing says a keg of this size costs.
  const beer = await db.beer.findFirst({ where: { name: { equals: f.beer.trim(), mode: "insensitive" } }, select: { id: true, ingredientId: true } });
  const brewing = beer ? await brewingKegPriceFor(beer.id, plan.kegMl).catch(() => null) : null;
  const fromBrewing = brewing && sameMoney(brewing.price, f.kegCost) ? brewing : null;

  try {
    const ingredientId = await db.$transaction(async (tx) => {
      const supplier = f.supplierId
        ? await tx.supplier.findUniqueOrThrow({ where: { id: f.supplierId } })
        : ((await tx.supplier.findUnique({ where: { name: HOUSE_SUPPLIER } })) ?? (await tx.supplier.create({ data: { name: HOUSE_SUPPLIER, kind: "LOCAL", notes: "Our own beer, costed per keg." } })));

      // The beer's linked keg ingredient first; else the one with the "(keg)" name; else a new one.
      const existing = (beer?.ingredientId ? await tx.ingredient.findUnique({ where: { id: beer.ingredientId } }) : null) ?? (await tx.ingredient.findUnique({ where: { name: plan.ingredientName } }));
      const ing = existing
        ? await tx.ingredient.update({ where: { id: existing.id }, data: { yieldPct: new Prisma.Decimal(f.yieldPct.toFixed(4)), active: true } })
        : await tx.ingredient.create({
            data: { name: plan.ingredientName, category: "Beer", storageArea: "Keg cooler", baseUnit: "ml", yieldPct: new Prisma.Decimal(f.yieldPct.toFixed(4)), safetyPct: new Prisma.Decimal(0), countUnit: "keg" },
          });
      if (existing && existing.baseUnit !== "ml") throw new Error(`${plan.ingredientName} isn't measured in ml.`);
      await tx.unitConversion.upsert({
        where: { ingredientId_unit: { ingredientId: ing.id, unit: "keg" } },
        create: { ingredientId: ing.id, unit: "keg", baseQty: new Prisma.Decimal(plan.kegMl.toFixed(4)) },
        update: { baseQty: new Prisma.Decimal(plan.kegMl.toFixed(4)) },
      });

      const sku = `KEG-${size.id}-${ing.id.slice(-6)}`.toUpperCase();
      const product = await tx.supplierProduct.upsert({
        where: { supplierId_sku: { supplierId: supplier.id, sku } },
        create: { supplierId: supplier.id, ingredientId: ing.id, sku, description: `${f.beer} — ${size.label}`, packText: size.label, purchaseUnit: "keg", packQtyBase: new Prisma.Decimal(plan.kegMl.toFixed(4)) },
        update: { ingredientId: ing.id, active: true, packQtyBase: new Prisma.Decimal(plan.kegMl.toFixed(4)) },
      });
      const last = await tx.priceRecord.findFirst({ where: { supplierProductId: product.id }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] });
      const link = fromBrewing ? (fromBrewing.kind === "brew" ? { brewBatchId: fromBrewing.brewBatchId } : { brewRecipeId: fromBrewing.brewRecipeId }) : {};
      const sameSource = (last?.brewBatchId ?? null) === ("brewBatchId" in link ? link.brewBatchId : null) && (last?.brewRecipeId ?? null) === ("brewRecipeId" in link ? link.brewRecipeId : null);
      if (!last || Math.abs(last.price.toNumber() - f.kegCost) >= 0.005 || !sameSource) {
        await tx.priceRecord.create({ data: { supplierProductId: product.id, price: new Prisma.Decimal(f.kegCost.toFixed(2)), effectiveDate: new Date(`${today}T00:00:00Z`), source: "MANUAL", ...link } });
      }
      await tx.ingredient.update({ where: { id: ing.id }, data: { preferredProductId: product.id } });
      // Link the beer to its keg ingredient (one beer per keg ingredient).
      if (beer && !beer.ingredientId && !(await tx.beer.findFirst({ where: { ingredientId: ing.id, id: { not: beer.id } }, select: { id: true } }))) {
        await tx.beer.update({ where: { id: beer.id }, data: { ingredientId: ing.id } });
      }

      for (const p of plan.pours) {
        const data = { kind: "MENU" as const, category: "Beer", menuPrice: p.price == null ? null : new Prisma.Decimal(p.price.toFixed(2)), yieldQty: new Prisma.Decimal(1), yieldUnit: "each", yieldBase: "each" as const, active: true };
        const line = { ingredientId: ing.id, qty: new Prisma.Decimal(p.oz.toFixed(4)), unit: "fl oz", sort: 0 };
        const r = await tx.recipe.findUnique({ where: { name: p.recipeName } });
        const recipe = r
          ? await tx.recipe.update({ where: { id: r.id }, data: { ...data, lines: { deleteMany: {}, create: [line] } } })
          : await tx.recipe.create({ data: { name: p.recipeName, ...data, notes: p.label.toLowerCase().includes("flight") ? "Costed as this beer only. Edit the lines to mix beers." : null, lines: { create: [line] } } });
        if (p.squareId) {
          await tx.squareMapping.update({ where: { squareId: p.squareId }, data: { recipeId: recipe.id, ignored: false } });
          // The pour is this beer: link the Square item to it when it isn't linked to a beer yet.
          if (beer) await tx.squareMapping.updateMany({ where: { squareId: p.squareId, beerId: null }, data: { beerId: beer.id } });
        }
      }
      return ing.id;
    });
    refresh();
    revalidatePath("/ingredients");
    revalidatePath("/sales");
    revalidatePath("/kegs", "layout");
    return { ok: true, recipes: plan.pours.length, ingredientId };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Something with that name already exists. Try a different beer name." };
    if (e instanceof Error && e.message.includes("isn't measured")) return { error: e.message };
    throw e;
  }
}

/** "Use brewing's cost": record what brewing says a keg of this beer costs (a packaged brew, else the brewing recipe). */
export async function applyBrewingKegCost(beerId: string): Promise<{ error?: string; ok?: string }> {
  await requireUser("MANAGER");
  if (!z.string().min(1).max(64).safeParse(beerId).success) return { error: "Can't save that." };
  const beer = await db.beer.findUnique({ where: { id: beerId }, select: { name: true, ingredient: { select: { preferredProduct: { select: { packQtyBase: true } } } } } });
  const kegMl = beer?.ingredient?.preferredProduct?.packQtyBase?.toNumber() ?? 0;
  if (!beer || !(kegMl > 0)) return { error: "Set this beer's keg up above first." };
  const price = await brewingKegPriceFor(beerId, kegMl);
  if (!price) return { error: "Brewing has no cost for this beer yet." };
  await recordBrewingKegPrice(beerId, price);
  refresh();
  revalidatePath("/kegs", "layout");
  return { ok: `${beer.name}: $${price.price.toFixed(2)} a keg, from ${price.kind === "brew" ? `brew ${price.code}` : "the brewing recipe"}.` };
}
