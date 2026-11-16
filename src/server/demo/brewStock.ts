/**
 * Brewing stock and ordering demo: the six brewing suppliers from Brew Manager
 * with their lead times (and what each counts back from), malt, hops and yeast
 * bought from them at the prices the recipe demo set, a stock count twelve
 * days ago and a malt delivery since, and the planned brews linked to their
 * beer's live recipe so "what to order when" has something to show. Citra is
 * left short on purpose.
 *
 * Run after the brewery and brewing recipe demos. Suppliers and products are
 * reused by name; stock moves are only added when there are none yet. No
 * "server-only" import: this also runs from the CLI seed.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { addDays, parseISODate } from "../../domain/dates";

const D = (n: number, places = 4) => new Prisma.Decimal(n.toFixed(places));
const LB = 453.59237;
const LEAD_REFS_KEY = "brewery.supplierLeadRefs";

export const BREW_SUPPLIERS: { name: string; leadDays: number; ref: "brew" | "dryHop" | "pkg"; deliveryDays?: number[]; notes?: string }[] = [
  { name: "Hudson Valley Malt", leadDays: 14, ref: "brew" },
  { name: "NY Hop Guild", leadDays: 7, ref: "dryHop" },
  { name: "Yakima Quality Hops", leadDays: 10, ref: "dryHop" },
  { name: "Omega Yeast", leadDays: 10, ref: "brew", deliveryDays: [2, 3, 4, 5], notes: "Live yeast: must arrive Tuesday to Friday." },
  { name: "MoreBeer", leadDays: 14, ref: "brew" },
  { name: "Labels", leadDays: 10, ref: "pkg" },
];

/** Which demo supplier sells each kind, and how (a 50 lb sack, an 11 lb box, one pack). */
function sourceFor(name: string, category: string): { supplier: string; unit: string; packBase: number; pack: string } | null {
  if (category === "Malt") return { supplier: "Hudson Valley Malt", unit: "sack", packBase: 50 * LB, pack: "50 lb sack" };
  if (category === "Hops") return /citra|mosaic/i.test(name) ? { supplier: "Yakima Quality Hops", unit: "box", packBase: 11 * LB, pack: "11 lb box" } : { supplier: "NY Hop Guild", unit: "box", packBase: 11 * LB, pack: "11 lb box" };
  if (category === "Yeast") return { supplier: /lager/i.test(name) ? "MoreBeer" : "Omega Yeast", unit: "pack", packBase: 1, pack: "1 pack" };
  return null;
}

/** Shelf at the count, in lb (packs for yeast). Citra is low on purpose. */
const COUNTED: Record<string, number> = { "Pilsner malt": 650, "Pale ale malt": 380, "Munich malt": 120, "Crystal 40": 45, "Roasted barley": 30, "Chocolate malt": 22, "Flaked oats": 60, "Citra pellets": 2, "Mosaic pellets": 9, "Magnum pellets": 4, "Hallertau Mittelfrüh pellets": 6, "East Kent Goldings pellets": 3, "Dry ale yeast, 500 g": 3, "Dry lager yeast, 500 g": 1 };

export async function seedBrewStock(db: PrismaClient, today: string): Promise<void> {
  // Suppliers, on the brewery side, and what each lead time counts back from.
  const ids = new Map<string, string>();
  for (const s of BREW_SUPPLIERS) {
    const row = await db.supplier.upsert({
      where: { name: s.name },
      create: { name: s.name, kind: "LOCAL", department: "brewery", orderCadence: "as_needed", leadTimeDays: s.leadDays, deliveryDays: s.deliveryDays ?? [], notes: s.notes ?? null },
      update: { department: "brewery", leadTimeDays: s.leadDays, deliveryDays: s.deliveryDays ?? [] },
    });
    ids.set(s.name, row.id);
  }
  const existing = await db.setting.findUnique({ where: { key: LEAD_REFS_KEY } });
  let refs: Record<string, string> = {};
  try { refs = JSON.parse(existing?.value ?? "{}") as Record<string, string>; } catch { refs = {}; }
  for (const s of BREW_SUPPLIERS) refs[ids.get(s.name)!] = s.ref;
  await db.setting.upsert({ where: { key: LEAD_REFS_KEY }, create: { key: LEAD_REFS_KEY, value: JSON.stringify(refs) }, update: { value: JSON.stringify(refs) } });

  // Brewing ingredients belong to the brewery side.
  await db.ingredient.updateMany({ where: { category: { in: ["Malt", "Hops", "Yeast", "Brewing"] } }, data: { department: "brewery" } });
  const ings = await db.ingredient.findMany({
    where: { department: "brewery", active: true },
    include: { products: { where: { active: true }, include: { prices: { orderBy: { effectiveDate: "desc" }, take: 1 } } } },
  });

  // Bought from the brewing suppliers at today's price per base unit, so recipe costs don't move.
  for (const i of ings) {
    const src = sourceFor(i.name, i.category);
    if (!src) continue;
    const priced = i.products.find((p) => p.prices.length && p.packQtyBase && p.packQtyBase.toNumber() > 0);
    const perBase = priced ? priced.prices[0].price.toNumber() / priced.packQtyBase!.toNumber() : null;
    const sku = `DEMO-${src.supplier.replace(/\W+/g, "").slice(0, 6).toUpperCase()}-${i.id.slice(-6).toUpperCase()}`;
    const product = await db.supplierProduct.upsert({
      where: { supplierId_sku: { supplierId: ids.get(src.supplier)!, sku } },
      create: { supplierId: ids.get(src.supplier)!, ingredientId: i.id, sku, description: i.name, packText: src.pack, purchaseUnit: src.unit, packQtyBase: D(src.packBase) },
      update: { ingredientId: i.id, active: true },
    });
    if (perBase != null && !(await db.priceRecord.count({ where: { supplierProductId: product.id } }))) {
      await db.priceRecord.create({ data: { supplierProductId: product.id, price: D(perBase * src.packBase, 2), effectiveDate: parseISODate(today), source: "MANUAL" } });
    }
    await db.ingredient.update({ where: { id: i.id }, data: { preferredProductId: product.id } }).catch(() => undefined);
  }

  // Planned brews without a recipe take their beer's live recipe.
  const live = await db.brewRecipe.findMany({ where: { status: "live", beerId: { not: null } }, select: { id: true, beerId: true }, orderBy: { updatedAt: "desc" } });
  for (const b of await db.brewBatch.findMany({ where: { status: "PLANNED", recipeId: null, beerId: { not: null } }, select: { id: true, beerId: true } })) {
    const r = live.find((x) => x.beerId === b.beerId);
    if (r) await db.brewBatch.update({ where: { id: b.id }, data: { recipeId: r.id } });
  }
  // The first planned brew's malt is already ordered.
  const first = await db.brewBatch.findFirst({ where: { status: "PLANNED", recipeId: { not: null } }, orderBy: { plannedOn: "asc" }, select: { id: true } });
  if (first) await db.brewBatch.update({ where: { id: first.id }, data: { ordered: { "Hudson Valley Malt": addDays(today, -3) } } });

  // A count twelve days ago and a malt delivery five days ago.
  if (await db.brewStockMove.count()) return;
  const at = (days: number) => new Date(`${addDays(today, days)}T15:00:00Z`);
  const moves: Prisma.BrewStockMoveCreateManyInput[] = [];
  for (const i of ings) {
    const n = COUNTED[i.name];
    if (n == null) continue;
    moves.push({ ingredientId: i.id, kind: "count", qtyBase: D(i.baseUnit === "each" ? n : n * LB), at: at(-12), userName: "Max" });
  }
  const pils = ings.find((i) => i.name === "Pilsner malt");
  if (pils) moves.push({ ingredientId: pils.id, kind: "received", qtyBase: D(500 * LB), at: at(-5), userName: "Max", note: "Hudson Valley Malt, 10 sacks" });
  const oats = ings.find((i) => i.name === "Flaked oats");
  if (oats) moves.push({ ingredientId: oats.id, kind: "adjust", qtyBase: D(-8 * LB), at: at(-4), userName: "Max", note: "Torn sack" });
  if (moves.length) await db.brewStockMove.createMany({ data: moves });
}
