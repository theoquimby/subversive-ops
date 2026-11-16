import "server-only";
import { Prisma } from "@prisma/client";
import { recipeStats, type BrewLineInput, type BrewLineKind, type HopUse } from "@/domain/brewMath";
import { baseUnitForBrewUnit, brewToBase, BREWING_CATEGORIES, categoryForKind, costBrewRecipe, type BrewRecipeStatus } from "@/domain/brewRecipes";
import { STANDARD_UNITS_BY_BASE, type BaseUnit } from "@/domain/units";
import { db, num } from "../db";
import { costLine, pricedIngredients } from "./brewCost";
import { ingredientCostSource, loadCostingSnapshot } from "./costing";
import { recordManualPrice } from "./priceImport";
import { businessToday } from "./sales";

/** Brewing recipes: the list with live numbers, the editor's data, saving, and brewing ingredient prices. */

const D = (n: number, places = 4) => new Prisma.Decimal(n.toFixed(places));

type DbLine = Prisma.BrewRecipeLineGetPayload<object>;

export const statsLine = (l: DbLine): BrewLineInput => ({
  kind: l.kind as BrewLineKind,
  name: l.name,
  qty: l.qty.toNumber(),
  unit: l.unit,
  potentialPpg: num(l.potentialPpg),
  colorL: num(l.colorL),
  alphaPct: num(l.alphaPct),
  use: (l.use as HopUse | null) ?? null,
  minutes: l.minutes,
  attenuationPct: num(l.attenuationPct),
});

// ---- The list ------------------------------------------------------------------------

export interface BrewRecipeRow {
  id: string;
  name: string;
  style: string | null;
  status: BrewRecipeStatus;
  beer: string | null;
  batchBbl: number;
  og: number;
  fg: number;
  abv: number;
  ibu: number;
  srm: number;
  colorHex: string;
  total: number;
  perPint: number | null;
  unpricedLines: number;
  lineCount: number;
}

export async function listBrewRecipes(): Promise<BrewRecipeRow[]> {
  const [recipes, priced] = await Promise.all([
    db.brewRecipe.findMany({ include: { lines: { orderBy: { sort: "asc" } }, beer: { select: { name: true } } }, orderBy: { name: "asc" } }),
    pricedIngredients(),
  ]);
  return recipes.map((r) => {
    const batchBbl = r.batchBbl.toNumber();
    const s = recipeStats({ batchBbl, efficiencyPct: r.efficiencyPct.toNumber(), boilMinutes: r.boilMinutes, lines: r.lines.map(statsLine) });
    const c = costBrewRecipe(r.lines.map(costLine), priced, batchBbl);
    return {
      id: r.id,
      name: r.name,
      style: r.style,
      status: (["live", "dev", "archived"].includes(r.status) ? r.status : "live") as BrewRecipeStatus,
      beer: r.beer?.name ?? null,
      batchBbl,
      og: s.og,
      fg: s.fg,
      abv: s.abv,
      ibu: s.ibu,
      srm: s.srm,
      colorHex: s.colorHex,
      total: c.total,
      perPint: c.perPint,
      unpricedLines: c.unpricedLines,
      lineCount: r.lines.length,
    };
  });
}

// ---- Ingredients for the picker ------------------------------------------------------

export interface BrewCatalogIngredient {
  id: string;
  name: string;
  category: string;
  baseUnit: BaseUnit;
  /** What one base unit costs today (after yield), or null */
  costPerBase: number | null;
  conversions: { unit: string; baseQty: number }[];
  /** Where today's price comes from */
  source: { supplier: string; price: number; purchaseUnit: string; date: string } | null;
}

export async function brewCatalog(): Promise<{ ingredients: BrewCatalogIngredient[]; beers: { id: string; name: string }[] }> {
  const [snap, priced, beers] = await Promise.all([
    loadCostingSnapshot(),
    pricedIngredients(),
    db.beer.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const today = businessToday();
  const sources = new Map(snap.ingredients.map((i) => [i.id, ingredientCostSource(snap, i, today)] as const));
  const productIds = [...sources.values()].flatMap((x) => (x ? [x.productId] : []));
  const products = new Map(
    (await db.supplierProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, purchaseUnit: true, supplier: { select: { name: true } } } })).map((p) => [p.id, p]),
  );
  // Brewing ingredients first in the picker; everything else after (water salts and finings often live under kitchen names).
  const rank = (cat: string) => (BREWING_CATEGORIES.includes(cat) ? 0 : 1);
  const ingredients = snap.ingredients
    .map((i) => {
      const p = priced.get(i.id)!;
      const src = sources.get(i.id);
      const prod = src ? products.get(src.productId) : undefined;
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        baseUnit: p.baseUnit,
        costPerBase: p.costPerBase,
        conversions: p.conversions,
        source: src && prod ? { supplier: prod.supplier.name, price: src.price, purchaseUnit: prod.purchaseUnit, date: src.date } : null,
      };
    })
    .sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));
  return { ingredients, beers };
}

// ---- One recipe ---------------------------------------------------------------------

export interface BrewLineData {
  id: string | null;
  kind: BrewLineKind;
  name: string;
  ingredientId: string | null;
  qty: number;
  unit: string;
  potentialPpg: number | null;
  colorL: number | null;
  alphaPct: number | null;
  use: HopUse | null;
  minutes: number | null;
  attenuationPct: number | null;
}

export interface BrewRecipeData {
  id: string | null;
  name: string;
  style: string | null;
  status: BrewRecipeStatus;
  beerId: string | null;
  batchBbl: number;
  efficiencyPct: number;
  boilMinutes: number;
  fermentDays: number;
  conditionDays: number;
  targetOg: number | null;
  targetFg: number | null;
  notes: string | null;
  lines: BrewLineData[];
}

export async function brewRecipeData(id: string): Promise<(BrewRecipeData & { brews: number; sourceKey: string | null; extra: unknown }) | null> {
  const r = await db.brewRecipe.findUnique({ where: { id }, include: { lines: { orderBy: { sort: "asc" } }, _count: { select: { batches: true } } } });
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    style: r.style,
    status: (["live", "dev", "archived"].includes(r.status) ? r.status : "live") as BrewRecipeStatus,
    beerId: r.beerId,
    batchBbl: r.batchBbl.toNumber(),
    efficiencyPct: r.efficiencyPct.toNumber(),
    boilMinutes: r.boilMinutes,
    fermentDays: r.fermentDays,
    conditionDays: r.conditionDays,
    targetOg: num(r.targetOg),
    targetFg: num(r.targetFg),
    notes: r.notes,
    lines: r.lines.map((l) => ({ ...statsLine(l), id: l.id, ingredientId: l.ingredientId, use: (l.use as HopUse | null) ?? null, minutes: l.minutes ?? null, potentialPpg: num(l.potentialPpg), colorL: num(l.colorL), alphaPct: num(l.alphaPct), attenuationPct: num(l.attenuationPct) })),
    brews: r._count.batches,
    sourceKey: r.sourceKey,
    extra: r.extra,
  };
}

const lineData = (l: BrewLineData, i: number) => ({
  kind: l.kind,
  name: l.name.trim().slice(0, 160),
  ingredientId: l.ingredientId,
  qty: D(Math.max(0, l.qty)),
  unit: l.unit,
  potentialPpg: l.potentialPpg == null ? null : D(l.potentialPpg, 2),
  colorL: l.colorL == null ? null : D(l.colorL, 1),
  alphaPct: l.alphaPct == null ? null : D(l.alphaPct, 1),
  use: l.kind === "hop" ? (l.use ?? "boil") : null,
  minutes: l.minutes == null ? null : Math.round(l.minutes),
  attenuationPct: l.attenuationPct == null ? null : D(l.attenuationPct, 1),
  sort: i,
});

export async function saveBrewRecipe(id: string | null, r: BrewRecipeData): Promise<{ id: string } | { error: string }> {
  const data = {
    name: r.name.trim(),
    style: r.style?.trim() || null,
    status: r.status,
    beerId: r.beerId,
    batchBbl: D(r.batchBbl, 2),
    efficiencyPct: D(r.efficiencyPct, 2),
    boilMinutes: Math.round(r.boilMinutes),
    fermentDays: Math.round(r.fermentDays),
    conditionDays: Math.round(r.conditionDays),
    targetOg: r.targetOg == null ? null : D(r.targetOg, 3),
    targetFg: r.targetFg == null ? null : D(r.targetFg, 3),
    notes: r.notes?.trim() || null,
  };
  const lines = r.lines.map(lineData);
  try {
    const saved = await db.$transaction(async (tx) => {
      if (id) {
        await tx.brewRecipeLine.deleteMany({ where: { recipeId: id } });
        return tx.brewRecipe.update({ where: { id }, data: { ...data, lines: { create: lines } } });
      }
      return tx.brewRecipe.create({ data: { ...data, lines: { create: lines } } });
    });
    return { id: saved.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Another recipe already has that name." };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return { error: "That recipe was deleted. Reload the page." };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") return { error: "A beer or ingredient on this recipe no longer exists. Reload the page." };
    throw e;
  }
}

/** A copy named "<name> (copy)", in development, not linked to a beer. */
export async function duplicateBrewRecipe(id: string): Promise<{ id: string } | { error: string }> {
  const r = await db.brewRecipe.findUnique({ where: { id }, include: { lines: { orderBy: { sort: "asc" } } } });
  if (!r) return { error: "That recipe no longer exists." };
  let name = `${r.name} (copy)`;
  for (let n = 2; await db.brewRecipe.findUnique({ where: { name }, select: { id: true } }); n++) name = `${r.name} (copy ${n})`;
  const copy = await db.brewRecipe.create({
    data: {
      name,
      style: r.style,
      status: "dev",
      batchBbl: r.batchBbl,
      efficiencyPct: r.efficiencyPct,
      boilMinutes: r.boilMinutes,
      targetOg: r.targetOg,
      targetFg: r.targetFg,
      fermentDays: r.fermentDays,
      conditionDays: r.conditionDays,
      notes: r.notes,
      lines: {
        create: r.lines.map((l) => ({ kind: l.kind, name: l.name, ingredientId: l.ingredientId, qty: l.qty, unit: l.unit, potentialPpg: l.potentialPpg, colorL: l.colorL, alphaPct: l.alphaPct, use: l.use, minutes: l.minutes, attenuationPct: l.attenuationPct, sort: l.sort })),
      },
    },
  });
  return { id: copy.id };
}

/** Delete when no brew points at it; otherwise archive, so the brews keep their recipe. */
export async function removeBrewRecipe(id: string): Promise<{ deleted: true } | { archived: true } | { error: string }> {
  const r = await db.brewRecipe.findUnique({ where: { id }, select: { _count: { select: { batches: true } } } });
  if (!r) return { error: "That recipe no longer exists." };
  if (r._count.batches > 0) {
    await db.brewRecipe.update({ where: { id }, data: { status: "archived" } });
    return { archived: true };
  }
  await db.brewRecipe.delete({ where: { id } });
  return { deleted: true };
}

/** A new Ingredient for a recipe line: Malt, Hops, Yeast or Brewing, measured in the line's kind of unit. */
export async function createBrewIngredient(name: string, kind: BrewLineKind, unit: string): Promise<BrewCatalogIngredient | { error: string }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!clean) return { error: "Name the ingredient first." };
  const existing = await db.ingredient.findFirst({ where: { name: { equals: clean, mode: "insensitive" } }, include: { conversions: true } });
  if (existing) {
    if (!existing.active) await db.ingredient.update({ where: { id: existing.id }, data: { active: true } });
    const p = (await pricedIngredients()).get(existing.id);
    return { id: existing.id, name: existing.name, category: existing.category, baseUnit: existing.baseUnit as BaseUnit, costPerBase: p?.costPerBase ?? null, conversions: existing.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })), source: null };
  }
  const baseUnit = baseUnitForBrewUnit(unit);
  const category = categoryForKind(kind);
  const created = await db.ingredient.create({
    data: { name: clean, category, baseUnit, storageArea: "Brewery", countUnit: baseUnit === "g" ? "lb" : baseUnit === "ml" ? "gal" : "each", safetyPct: new Prisma.Decimal(0) },
  });
  return { id: created.id, name: created.name, category, baseUnit, costPerBase: null, conversions: [], source: null };
}

// ---- Brewing ingredient prices --------------------------------------------------------

export const MANUAL_SUPPLIER = "Manual prices";

/** The unit a brewer prices this in: lb for weighed things, a package for counted ones, a gallon for liquids. */
export const priceUnitFor = (base: BaseUnit) => (base === "g" ? "lb" : base === "ml" ? "gal" : "pkg");

export interface BrewPriceRow {
  id: string;
  name: string;
  category: string;
  baseUnit: BaseUnit;
  unit: string;
  /** Today's price per `unit` (the purchase price, before yield) */
  price: number | null;
  perOz: number | null;
  source: { supplier: string; date: string; how: "IMPORT" | "MANUAL" | "SCRAPE" } | null;
  usedBy: number;
}

export async function brewingPriceRows(): Promise<BrewPriceRow[]> {
  const [snap, used] = await Promise.all([
    loadCostingSnapshot(),
    db.brewRecipeLine.findMany({ where: { ingredientId: { not: null } }, select: { ingredientId: true, recipeId: true }, distinct: ["ingredientId", "recipeId"] }),
  ]);
  const usedBy = new Map<string, number>();
  for (const u of used) usedBy.set(u.ingredientId!, (usedBy.get(u.ingredientId!) ?? 0) + 1);
  const today = businessToday();
  const rows = snap.ingredients.filter((i) => usedBy.has(i.id) || BREWING_CATEGORIES.includes(i.category));
  const sources = new Map(rows.map((i) => [i.id, ingredientCostSource(snap, i, today)] as const));
  const productIds = [...sources.values()].flatMap((x) => (x ? [x.productId] : []));
  const [products, latest] = await Promise.all([
    db.supplierProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, supplier: { select: { name: true } } } }),
    db.priceRecord.findMany({ where: { supplierProductId: { in: productIds } }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], select: { supplierProductId: true, source: true }, distinct: ["supplierProductId"] }),
  ]);
  const supplierOf = new Map(products.map((p) => [p.id, p.supplier.name]));
  const howOf = new Map(latest.map((p) => [p.supplierProductId, p.source]));
  return rows
    .map((i) => {
      const base = i.baseUnit as BaseUnit;
      const unit = priceUnitFor(base);
      const src = sources.get(i.id);
      const perBase = src ? src.price / src.pack : null;
      let price: number | null = null;
      try {
        price = perBase == null ? null : perBase * brewToBase(1, unit, base, i.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })));
      } catch {
        price = null;
      }
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        baseUnit: base,
        unit,
        price,
        perOz: base === "g" && perBase != null ? perBase * 28.349523125 : null,
        source: src ? { supplier: supplierOf.get(src.productId) ?? "", date: src.date, how: howOf.get(src.productId) ?? "MANUAL" } : null,
        usedBy: usedBy.get(i.id) ?? 0,
      };
    })
    .sort((a, b) => Number(a.price != null) - Number(b.price != null) || BREWING_CATEGORIES.indexOf(a.category) - BREWING_CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
}

export async function brewSuppliers(): Promise<{ id: string; name: string }[]> {
  return db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/**
 * Record a price typed by hand, through the usual price history (a PriceRecord,
 * source MANUAL, dated today). It goes on the product this ingredient is costed
 * from when there is one (from the chosen supplier, if one is chosen), so price
 * sheets and invoices for that product keep it current; otherwise on a new
 * product under the chosen supplier, or under "Manual prices".
 */
export async function setBrewingPrice(ingredientId: string, price: number, unit: string, supplierId: string | null): Promise<{ error?: string }> {
  const ing = await db.ingredient.findUnique({ where: { id: ingredientId }, include: { conversions: true, products: { where: { active: true }, include: { prices: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1 } } } } });
  if (!ing) return { error: "That ingredient no longer exists." };
  const base = ing.baseUnit as BaseUnit;
  let perUnitBase: number;
  try {
    perUnitBase = brewToBase(1, unit, base, ing.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })));
  } catch {
    return { error: `${ing.name} is measured in ${base}; price it per ${STANDARD_UNITS_BY_BASE[base].join(", ")}.` };
  }
  if (!(perUnitBase > 0)) return { error: "That unit doesn't work for this ingredient." };
  const usable = ing.products.filter((p) => p.packQtyBase && p.packQtyBase.toNumber() > 0 && (!supplierId || p.supplierId === supplierId));
  let product = usable.find((p) => p.id === ing.preferredProductId) ?? usable.sort((a, b) => (b.prices[0]?.effectiveDate.getTime() ?? 0) - (a.prices[0]?.effectiveDate.getTime() ?? 0))[0];
  if (!product) {
    const supplier = supplierId
      ? await db.supplier.findUnique({ where: { id: supplierId } })
      : ((await db.supplier.findUnique({ where: { name: MANUAL_SUPPLIER } })) ?? (await db.supplier.create({ data: { name: MANUAL_SUPPLIER, kind: "LOCAL", notes: "Prices typed in by hand." } })));
    if (!supplier) return { error: "That supplier no longer exists." };
    const sku = `BREW-${ing.id.slice(-8)}`.toUpperCase();
    const created = await db.supplierProduct.upsert({
      where: { supplierId_sku: { supplierId: supplier.id, sku } },
      create: { supplierId: supplier.id, ingredientId: ing.id, sku, description: ing.name, packText: `1 ${unit}`, purchaseUnit: unit, packQtyBase: D(perUnitBase) },
      update: { ingredientId: ing.id, active: true, purchaseUnit: unit, packText: `1 ${unit}`, packQtyBase: D(perUnitBase) },
      include: { prices: { take: 0 } },
    });
    product = created;
  }
  const packPrice = (price * product.packQtyBase!.toNumber()) / perUnitBase;
  await recordManualPrice(product.id, packPrice, businessToday());
  // Costing uses the preferred product first: when the price went on another one
  // (a supplier was picked), that one becomes preferred so the typed price counts.
  if (ing.preferredProductId && ing.preferredProductId !== product.id) await db.ingredient.update({ where: { id: ing.id }, data: { preferredProductId: product.id } });
  return {};
}
