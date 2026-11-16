import "server-only";
import { Prisma } from "@prisma/client";
import { abvView, brewCostPerMl, brewingKegPrice, kegCostSource, kegIngredientMatches, kegPrice, kegPriceFromBrew, looksLikeBrewCode, sameMoney, type BrewingKegPrice, type KegCostSource } from "@/domain/beerLinks";
import { liveRecipeForBeer } from "@/domain/brewRecipes";
import { addDays } from "@/domain/dates";
import { classifyItem } from "@/domain/linking";
import { beersNamed, matchSquareItem } from "@/domain/kegPours";
import { abv } from "@/domain/tankPlan";
import { db, num } from "../db";
import { iso } from "./brewery";
import { brewCostFor } from "./brewCost";
import { beerMatchers } from "./kegs";
import { businessToday } from "./sales";

/**
 * Beers linked up: the keg ingredient each beer pours from and where its price
 * comes from (a packaged brew, the brewing recipe, or typed), the ABV measured
 * by the brewery, and the "Needs a look" list for what doesn't link cleanly.
 */

type Tx = Prisma.TransactionClient | typeof db;

const productSelect = { id: true, packQtyBase: true, purchaseUnit: true } as const;

/** The supplier product a keg ingredient is priced on: the preferred one, else one sold by the keg. */
async function kegProductOf(ingredientId: string, tx: Tx = db) {
  const ing = await tx.ingredient.findUnique({
    where: { id: ingredientId },
    select: { id: true, conversions: { where: { unit: "keg" }, select: { baseQty: true } }, preferredProduct: { select: productSelect }, products: { where: { active: true }, select: productSelect } },
  });
  if (!ing) return null;
  const sized = (p: { packQtyBase: Prisma.Decimal | null } | null | undefined) => !!p && (p.packQtyBase?.toNumber() ?? 0) > 0;
  const product = sized(ing.preferredProduct) ? ing.preferredProduct! : ing.products.find((p) => sized(p) && p.purchaseUnit === "keg") ?? ing.products.find(sized) ?? null;
  return product ? { productId: product.id, kegMl: product.packQtyBase!.toNumber() } : null;
}

/** The latest price on a product as of today, with the brew or brewing recipe it came from. */
async function latestPrice(productId: string, tx: Tx = db) {
  return tx.priceRecord.findFirst({
    where: { supplierProductId: productId, effectiveDate: { lte: new Date(`${businessToday()}T00:00:00Z`) } },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
    select: { price: true, effectiveDate: true, brewBatchId: true, brewRecipeId: true, brewBatch: { select: { code: true, packagedOn: true } }, brewRecipe: { select: { name: true } } },
  });
}

export type BrewingCost = { kind: "brew"; brewBatchId: string; code: string; packagedOn: string | null; perMl: number } | { kind: "recipe"; brewRecipeId: string; name: string; perMl: number };

/** Brewing's cost per ml for a beer: the latest packaged brew with a cost, else the live brewing recipe when every line is priced. */
export async function brewingCostFor(beerId: string): Promise<BrewingCost | null> {
  const brew = await db.brewBatch.findFirst({ where: { beerId, status: "PACKAGED", cost: { not: null }, bbl: { not: null } }, orderBy: [{ packagedOn: "desc" }, { updatedAt: "desc" }], select: { id: true, code: true, packagedOn: true, cost: true, bbl: true } });
  const fromBrew = brew ? brewCostPerMl({ cost: num(brew.cost), bbl: num(brew.bbl) }) : null;
  if (brew && fromBrew != null) return { kind: "brew", brewBatchId: brew.id, code: brew.code, packagedOn: iso(brew.packagedOn), perMl: fromBrew };
  const recipes = await db.brewRecipe.findMany({ where: { beerId, status: "live" }, select: { id: true, name: true, beerId: true, status: true, updatedAt: true, batchBbl: true } });
  const r = liveRecipeForBeer(recipes, beerId);
  if (!r) return null;
  const bbl = r.batchBbl.toNumber();
  const c = await brewCostFor(r.id, bbl).catch(() => null);
  const perMl = c && c.unpricedLines === 0 ? brewCostPerMl({ cost: c.total, bbl }) : null;
  return perMl == null ? null : { kind: "recipe", brewRecipeId: r.id, name: r.name, perMl };
}

/** Brewing's keg cost for a beer, for a keg of `kegMl`. */
export async function brewingKegPriceFor(beerId: string, kegMl: number): Promise<BrewingKegPrice | null> {
  const c = await brewingCostFor(beerId);
  if (!c || !(kegMl > 0)) return null;
  const price = kegPrice(c.perMl, kegMl);
  return c.kind === "brew"
    ? brewingKegPrice({ brew: { brewBatchId: c.brewBatchId, code: c.code, packagedOn: c.packagedOn, price }, recipe: null })
    : brewingKegPrice({ brew: null, recipe: { brewRecipeId: c.brewRecipeId, name: c.name, price } });
}

/**
 * Record a brewing keg price on the beer's keg ingredient (dated the packaging
 * day for a brew, else today), unless the latest price is already that one.
 * Returns the price recorded, or null when nothing was recorded.
 */
export async function recordBrewingKegPrice(beerId: string, price: BrewingKegPrice): Promise<number | null> {
  const beer = await db.beer.findUnique({ where: { id: beerId }, select: { ingredientId: true } });
  if (!beer?.ingredientId) return null;
  const kp = await kegProductOf(beer.ingredientId);
  if (!kp) return null;
  const last = await latestPrice(kp.productId);
  const sameSource = price.kind === "brew" ? last?.brewBatchId === price.brewBatchId : last?.brewRecipeId === price.brewRecipeId;
  if (last && sameSource && sameMoney(last.price.toNumber(), price.price)) return null;
  const on = price.kind === "brew" && price.packagedOn ? price.packagedOn : businessToday();
  await db.priceRecord.create({
    data: {
      supplierProductId: kp.productId,
      price: new Prisma.Decimal(price.price.toFixed(2)),
      effectiveDate: new Date(`${on}T00:00:00Z`),
      source: "MANUAL",
      ...(price.kind === "brew" ? { brewBatchId: price.brewBatchId } : { brewRecipeId: price.brewRecipeId }),
    },
  });
  return price.price;
}

/** Packaged: the beer's keg ingredient takes this brew's cost per keg. Never throws (packaging is already saved). */
export async function priceKegFromBrew(brewId: string): Promise<number | null> {
  try {
    const b = await db.brewBatch.findUnique({ where: { id: brewId }, select: { id: true, code: true, beerId: true, cost: true, bbl: true, packagedOn: true, beer: { select: { ingredientId: true } } } });
    if (!b?.beerId || !b.beer?.ingredientId) return null;
    const kp = await kegProductOf(b.beer.ingredientId);
    if (!kp) return null;
    const price = kegPriceFromBrew({ cost: num(b.cost), bbl: num(b.bbl) }, kp.kegMl);
    if (price == null) return null;
    return await recordBrewingKegPrice(b.beerId, { kind: "brew", brewBatchId: b.id, code: b.code, packagedOn: iso(b.packagedOn), price });
  } catch (e) {
    console.error("beer links: keg price from brew skipped", (e as Error).message);
    return null;
  }
}

// ---- Square items ↔ beers ----------------------------------------------------------------

/**
 * Link Square items with no beer to a beer whose names match them, only when
 * exactly one beer matches (the same rule the migration used). `onlyBeer`
 * limits it to items that match that beer. Returns how many were linked.
 */
export async function linkSquareItemsByName(onlyBeer?: string): Promise<number> {
  const [maps, beers] = await Promise.all([
    db.squareMapping.findMany({ where: { beerId: null }, select: { squareId: true, squareName: true } }),
    db.beer.findMany({ select: { id: true, name: true, squareNames: true } }),
  ]);
  const by = new Map<string, string[]>();
  for (const m of maps) {
    const ids = beersNamed(m.squareName, beers);
    if (ids.length !== 1 || (onlyBeer && ids[0] !== onlyBeer)) continue;
    by.set(ids[0], [...(by.get(ids[0]) ?? []), m.squareId]);
  }
  let n = 0;
  for (const [beerId, squareIds] of by) n += (await db.squareMapping.updateMany({ where: { squareId: { in: squareIds }, beerId: null }, data: { beerId } })).count;
  return n;
}

/** A manager links one Square item to a beer (or unlinks it). */
export async function setSquareItemBeer(squareId: string, beerId: string | null): Promise<{ error?: string }> {
  const m = await db.squareMapping.findUnique({ where: { squareId }, select: { squareId: true } });
  if (!m) return { error: "That Square item is gone. Reload." };
  if (beerId && !(await db.beer.findUnique({ where: { id: beerId }, select: { id: true } }))) return { error: "That beer is gone. Reload." };
  await db.squareMapping.update({ where: { squareId }, data: { beerId } });
  return {};
}

/** A beer's keg ingredient: the one Draft beer made for it, or picked on Needs a look. A new beer finds "<name> (keg)" when exactly one exists. */
export async function linkKegIngredientByName(beerId: string): Promise<boolean> {
  const b = await db.beer.findUnique({ where: { id: beerId }, select: { name: true, ingredientId: true } });
  if (!b || b.ingredientId) return false;
  const hits = await db.ingredient.findMany({ where: { name: { equals: `${b.name.trim()} (keg)`, mode: "insensitive" } }, select: { id: true, beers: { select: { id: true } } } });
  if (hits.length !== 1 || hits[0].beers.length) return false;
  await db.beer.update({ where: { id: beerId }, data: { ingredientId: hits[0].id } });
  return true;
}

// ---- The Draft beer page -------------------------------------------------------------------

export interface KegCostRow {
  beerId: string | null;
  beer: string | null;
  ingredientId: string;
  price: number | null;
  source: KegCostSource;
  /** What brewing says a keg costs now, when it differs from the price in use. */
  brewing: BrewingKegPrice | null;
}

/** Each keg ingredient's price and where it comes from, with brewing's cost when it's newer or different. */
export async function kegCostRows(ingredientIds: string[]): Promise<Map<string, KegCostRow>> {
  const out = new Map<string, KegCostRow>();
  if (!ingredientIds.length) return out;
  const beers = await db.beer.findMany({ where: { ingredientId: { in: ingredientIds } }, select: { id: true, name: true, ingredientId: true } });
  for (const id of ingredientIds) {
    const beer = beers.find((b) => b.ingredientId === id) ?? null;
    const kp = await kegProductOf(id);
    const last = kp ? await latestPrice(kp.productId) : null;
    const source = kegCostSource(last ? { price: last.price.toNumber(), brewBatch: last.brewBatch ? { code: last.brewBatch.code, packagedOn: iso(last.brewBatch.packagedOn) } : null, brewRecipe: last.brewRecipe } : null);
    const brewing = beer && kp ? await brewingKegPriceFor(beer.id, kp.kegMl) : null;
    const current = last?.price.toNumber() ?? null;
    const differs = brewing && !(sameMoney(current, brewing.price) && (brewing.kind === "brew" ? last?.brewBatchId === brewing.brewBatchId : last?.brewRecipeId === brewing.brewRecipeId));
    out.set(id, { beerId: beer?.id ?? null, beer: beer?.name ?? null, ingredientId: id, price: current, source, brewing: differs ? brewing : null });
  }
  return out;
}

// ---- ABV -------------------------------------------------------------------------------------

/** ABV from each beer's latest packaged brew with an OG and FG. */
export async function measuredAbvByBeer(beerIds?: string[]): Promise<Map<string, { abv: number; code: string; packagedOn: string | null }>> {
  const rows = await db.brewBatch.findMany({
    where: { status: "PACKAGED", beerId: beerIds ? { in: beerIds } : { not: null }, og: { not: null }, fg: { not: null } },
    orderBy: [{ packagedOn: "desc" }, { updatedAt: "desc" }],
    select: { beerId: true, code: true, og: true, fg: true, packagedOn: true },
  });
  const out = new Map<string, { abv: number; code: string; packagedOn: string | null }>();
  for (const r of rows) {
    if (!r.beerId || out.has(r.beerId)) continue;
    const a = abv(num(r.og), num(r.fg));
    if (a != null) out.set(r.beerId, { abv: Math.round(a * 10) / 10, code: r.code, packagedOn: iso(r.packagedOn) });
  }
  return out;
}

// ---- Needs a look ------------------------------------------------------------------------------

export interface NeedsALook {
  beersNoKeg: { beerId: string; beer: string; suggestions: { id: string; name: string }[] }[];
  /** Keg ingredients no beer links to, for the picker. */
  kegIngredients: { id: string; name: string }[];
  squareNoBeer: { squareId: string; name: string; sold90: number; suggestion: { beerId: string; beer: string } | null }[];
  kegBatchesNoBrew: { id: string; code: string; beer: string | null; brew: { id: string; code: string; beer: string | null } | null }[];
  brewsOffRecipe: { id: string; code: string; beer: string | null; recipe: string; recipeBeerId: string; recipeBeer: string }[];
  abvDiffers: { beerId: string; beer: string; typed: number; measured: number; code: string }[];
  beers: { id: string; name: string }[];
  count: number;
}

/** Everything around beers that doesn't link cleanly, for a manager to fix (each with a one-tap fix where it's obvious). */
export async function needsALook(): Promise<NeedsALook> {
  const since = new Date(`${addDays(businessToday(), -90)}T00:00:00Z`);
  const [beers, kegIngs, maps, sold, batches, brews, matchers] = await Promise.all([
    db.beer.findMany({ select: { id: true, name: true, active: true, ingredientId: true, abv: true }, orderBy: { name: "asc" } }),
    db.ingredient.findMany({ where: { active: true, baseUnit: "ml", conversions: { some: { unit: "keg" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.squareMapping.findMany({ where: { beerId: null, ignored: false, squareType: "ITEM_VARIATION" }, select: { squareId: true, squareName: true, recipe: { select: { category: true } } } }),
    db.dailySale.groupBy({ by: ["squareId"], _sum: { qty: true }, where: { date: { gte: since } } }),
    db.kegBatch.findMany({ where: { brewBatch: null }, select: { id: true, code: true, beer: { select: { name: true } }, beerId: true }, orderBy: { code: "desc" } }),
    db.brewBatch.findMany({ where: { recipe: { beerId: { not: null } } }, select: { id: true, code: true, beerId: true, beer: { select: { name: true } }, recipe: { select: { name: true, beerId: true, beer: { select: { name: true } } } } }, orderBy: { code: "desc" } }),
    beerMatchers(),
  ]);
  const linkedIngs = new Set(beers.map((b) => b.ingredientId).filter(Boolean));
  const freeKegs = kegIngs.filter((k) => !linkedIngs.has(k.id));
  const beersNoKeg = beers.filter((b) => b.active && !b.ingredientId).map((b) => ({ beerId: b.id, beer: b.name, suggestions: kegIngredientMatches(b.name, freeKegs).slice(0, 3) }));

  const soldBy = new Map(sold.map((s) => [s.squareId, s._sum.qty?.toNumber() ?? 0]));
  const names = matchers.map((m) => ({ ...m, squareIds: [] }));
  const squareNoBeer = maps
    .filter((m) => (soldBy.get(m.squareId) ?? 0) > 0)
    .filter((m) => m.recipe?.category === "Beer" || classifyItem({ squareId: m.squareId, name: m.squareName, baseName: m.squareName, modifier: false, category: null, price: null }, names).kind === "beer")
    .map((m) => {
      const id = matchSquareItem(null, m.squareName, names);
      const b = id ? beers.find((x) => x.id === id) : null;
      return { squareId: m.squareId, name: m.squareName, sold90: soldBy.get(m.squareId) ?? 0, suggestion: b ? { beerId: b.id, beer: b.name } : null };
    })
    .sort((a, b) => b.sold90 - a.sold90);

  const brewByCode = new Map((await db.brewBatch.findMany({ where: { kegBatchId: null, code: { in: batches.map((k) => k.code) } }, select: { id: true, code: true, beerId: true, beer: { select: { name: true } } } })).map((b) => [b.code, b]));
  const kegBatchesNoBrew = batches
    .filter((k) => looksLikeBrewCode(k.code))
    .map((k) => {
      const b = brewByCode.get(k.code);
      // Offer the brew only when nothing disagrees: same beer, or the keg batch has none.
      const ok = b && (!k.beerId || !b.beerId || k.beerId === b.beerId);
      return { id: k.id, code: k.code, beer: k.beer?.name ?? null, brew: ok ? { id: b.id, code: b.code, beer: b.beer?.name ?? null } : null };
    });

  const brewsOffRecipe = brews
    .filter((b) => b.recipe?.beerId && b.beerId !== b.recipe.beerId)
    .map((b) => ({ id: b.id, code: b.code, beer: b.beer?.name ?? null, recipe: b.recipe!.name, recipeBeerId: b.recipe!.beerId!, recipeBeer: b.recipe!.beer?.name ?? "its beer" }));

  const measured = await measuredAbvByBeer(beers.map((b) => b.id));
  const abvDiffers = beers.flatMap((b) => {
    const m = measured.get(b.id);
    const v = abvView(num(b.abv), m?.abv ?? null);
    return v.differs && m ? [{ beerId: b.id, beer: b.name, typed: num(b.abv)!, measured: m.abv, code: m.code }] : [];
  });

  return {
    beersNoKeg,
    kegIngredients: freeKegs,
    squareNoBeer,
    kegBatchesNoBrew,
    brewsOffRecipe,
    abvDiffers,
    beers: beers.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name })),
    count: beersNoKeg.length + squareNoBeer.length + kegBatchesNoBrew.length + brewsOffRecipe.length + abvDiffers.length,
  };
}
