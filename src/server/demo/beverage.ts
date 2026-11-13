/**
 * Beverage demo data: the house IPA as a costed half-barrel keg (with an
 * older, cheaper keg price so as-of-date costing shows), three pour recipes,
 * the existing "Draft IPA · 16 oz" Square item linked to the pint, and keg
 * counts on the latest two completed stock counts (about 4% over recipe, as
 * foam and comps usually run) so the Margin gap has a beverage line.
 *
 * Idempotent: does nothing if the keg ingredient already exists. No
 * "server-only" import — this also runs from the CLI.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { addDays, parseISODate, todayIn, toISODate } from "../../domain/dates";
import { ML_PER_FL_OZ, planDraftBeer } from "../../domain/draftBeer";

const D = (n: number, places = 4) => new Prisma.Decimal(n.toFixed(places));

export async function seedBeverage(db: PrismaClient): Promise<void> {
  const today = todayIn(process.env.BUSINESS_TIMEZONE || "America/New_York");
  const plan = planDraftBeer({
    beer: "Subversive IPA",
    kegSizeId: "half",
    kegCost: 140,
    yieldPct: 0.95,
    pours: [
      { label: "16 oz", oz: 16, price: 8, squareId: "SQ-IPA-16" },
      { label: "10 oz", oz: 10, price: 6 },
      { label: "Flight (4 × 4 oz)", oz: 16, price: 12 },
    ],
  });
  if ("error" in plan) throw new Error(plan.error);
  if (await db.ingredient.findUnique({ where: { name: plan.ingredientName } })) return;

  const supplier = (await db.supplier.findUnique({ where: { name: "House brewery" } })) ?? (await db.supplier.create({ data: { name: "House brewery", kind: "LOCAL", notes: "Our own beer, costed per keg." } }));
  const ing = await db.ingredient.create({
    data: { name: plan.ingredientName, category: "Beer", storageArea: "Keg cooler", baseUnit: "ml", yieldPct: D(0.95), safetyPct: D(0), countUnit: "keg", conversions: { create: { unit: "keg", baseQty: D(plan.kegMl) } } },
  });
  const product = await db.supplierProduct.create({
    data: { supplierId: supplier.id, ingredientId: ing.id, sku: "KEG-HALF-IPA", description: "Subversive IPA — 1/2 bbl keg (15.5 gal)", packText: "1/2 bbl", purchaseUnit: "keg", packQtyBase: D(plan.kegMl) },
  });
  // Malt and hops went up mid-October: older days should still cost at $128.
  await db.priceRecord.createMany({
    data: [
      { supplierProductId: product.id, price: D(128, 2), effectiveDate: parseISODate(addDays(today, -150)), source: "MANUAL" },
      { supplierProductId: product.id, price: D(140, 2), effectiveDate: parseISODate(addDays(today, -29)), source: "MANUAL" },
    ],
  });
  await db.ingredient.update({ where: { id: ing.id }, data: { preferredProductId: product.id } });

  for (const p of plan.pours) {
    const recipe = await db.recipe.upsert({
      where: { name: p.recipeName },
      create: {
        name: p.recipeName,
        kind: "MENU",
        category: "Beer",
        menuPrice: p.price == null ? null : D(p.price, 2),
        lines: { create: [{ ingredientId: ing.id, qty: D(p.oz), unit: "fl oz", sort: 0 }] },
      },
      update: {},
    });
    if (p.squareId && (await db.squareMapping.findUnique({ where: { squareId: p.squareId } }))) {
      await db.squareMapping.update({ where: { squareId: p.squareId }, data: { recipeId: recipe.id, ignored: false } });
    }
  }

  // Keg counts on the latest two completed counts: actual ≈ theoretical × 1.04.
  const counts = await db.stockCount.findMany({ where: { completed: true }, orderBy: { takenAt: "desc" }, take: 2 });
  if (counts.length === 2) {
    const [end, start] = counts;
    const pints = await db.dailySale.aggregate({
      _sum: { qty: true },
      where: { squareId: "SQ-IPA-16", date: { gte: parseISODate(toISODate(start.takenAt)), lt: parseISODate(toISODate(end.takenAt)) } },
    });
    const theoreticalMl = ((pints._sum.qty?.toNumber() ?? 0) * 16 * ML_PER_FL_OZ) / 0.95;
    const opening = Math.ceil((theoreticalMl * 1.04) / plan.kegMl + 1.5) * plan.kegMl;
    const closing = opening - theoreticalMl * 1.04;
    await db.stockCountLine.createMany({
      data: [
        { countId: start.id, ingredientId: ing.id, qtyBase: D(opening) },
        { countId: end.id, ingredientId: ing.id, qtyBase: D(closing) },
      ],
      skipDuplicates: true,
    });
  }
}
