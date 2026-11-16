/**
 * Brewing recipes demo: an IPA, a lager and a stout that are brewed now (each
 * linked to the beer of the same name when the keg demo made one), and a hazy
 * pale in development. Malt, hops and yeast are priced through supplier
 * products and the price history like any ingredient; gypsum has no price and
 * lactose isn't matched, so "no price yet" shows on the trial recipe.
 *
 * Re-running replaces only the demo recipes (sourceKey "demo:…"); ingredients,
 * suppliers and products are reused by name. No "server-only" import: this also
 * runs from the CLI seed.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { addDays, parseISODate, todayIn } from "../../domain/dates";

const D = (n: number, places = 4) => new Prisma.Decimal(n.toFixed(places));
const LB = 453.59237;

type Base = "g" | "each";
interface IngSpec { name: string; category: "Malt" | "Hops" | "Yeast" | "Brewing"; base: Base; supplier?: string; sku?: string; pack?: string; unit?: string; packQty?: number; prices?: [number, number][] }

const SUPPLIERS = ["Valley Maltings", "Northeast Hop Co.", "Yeast Lab Supply"];

// Prices are per purchase unit: a 50 lb sack, an 11 lb box of pellets, one 500 g brick of yeast. [days ago, price]
export const INGREDIENTS: IngSpec[] = [
  { name: "Pilsner malt", category: "Malt", base: "g", supplier: "Valley Maltings", sku: "VM-PILS-50", pack: "50 lb sack", unit: "sack", packQty: 50 * LB, prices: [[-150, 44.5], [-30, 47.5]] },
  { name: "Pale ale malt", category: "Malt", base: "g", supplier: "Valley Maltings", sku: "VM-PALE-50", pack: "50 lb sack", unit: "sack", packQty: 50 * LB, prices: [[-150, 46], [-30, 49]] },
  { name: "Munich malt", category: "Malt", base: "g", supplier: "Valley Maltings", sku: "VM-MUN-50", pack: "50 lb sack", unit: "sack", packQty: 50 * LB, prices: [[-90, 52.5]] },
  { name: "Crystal 40", category: "Malt", base: "g", supplier: "Valley Maltings", sku: "VM-C40-50", pack: "50 lb sack", unit: "sack", packQty: 50 * LB, prices: [[-90, 65]] },
  { name: "Roasted barley", category: "Malt", base: "g", supplier: "Valley Maltings", sku: "VM-RB-50", pack: "50 lb sack", unit: "sack", packQty: 50 * LB, prices: [[-90, 62.5]] },
  { name: "Chocolate malt", category: "Malt", base: "g", supplier: "Valley Maltings", sku: "VM-CHOC-50", pack: "50 lb sack", unit: "sack", packQty: 50 * LB, prices: [[-90, 70]] },
  { name: "Flaked oats", category: "Malt", base: "g", supplier: "Valley Maltings", sku: "VM-OATS-50", pack: "50 lb sack", unit: "sack", packQty: 50 * LB, prices: [[-90, 45]] },
  { name: "Citra pellets", category: "Hops", base: "g", supplier: "Northeast Hop Co.", sku: "NEH-CIT-11", pack: "11 lb box", unit: "box", packQty: 11 * LB, prices: [[-120, 187], [-20, 198]] },
  { name: "Mosaic pellets", category: "Hops", base: "g", supplier: "Northeast Hop Co.", sku: "NEH-MOS-11", pack: "11 lb box", unit: "box", packQty: 11 * LB, prices: [[-120, 192.5]] },
  { name: "Magnum pellets", category: "Hops", base: "g", supplier: "Northeast Hop Co.", sku: "NEH-MAG-11", pack: "11 lb box", unit: "box", packQty: 11 * LB, prices: [[-120, 88]] },
  { name: "Hallertau Mittelfrüh pellets", category: "Hops", base: "g", supplier: "Northeast Hop Co.", sku: "NEH-HMF-11", pack: "11 lb box", unit: "box", packQty: 11 * LB, prices: [[-120, 121]] },
  { name: "East Kent Goldings pellets", category: "Hops", base: "g", supplier: "Northeast Hop Co.", sku: "NEH-EKG-11", pack: "11 lb box", unit: "box", packQty: 11 * LB, prices: [[-120, 132]] },
  { name: "Dry ale yeast, 500 g", category: "Yeast", base: "each", supplier: "Yeast Lab Supply", sku: "YL-ALE-500", pack: "500 g brick", unit: "brick", packQty: 1, prices: [[-60, 96]] },
  { name: "Dry lager yeast, 500 g", category: "Yeast", base: "each", supplier: "Yeast Lab Supply", sku: "YL-LAG-500", pack: "500 g brick", unit: "brick", packQty: 1, prices: [[-60, 118]] },
  { name: "Gypsum", category: "Brewing", base: "g" },
];

type LineSpec = [kind: string, name: string, qty: number, unit: string, extra?: { ing?: string; ppg?: number; colorL?: number; alpha?: number; use?: string; minutes?: number; att?: number }];

/** Brew-day targets (gravities as SG) and timing, as Brew Manager keeps them. */
interface ProcessSpec { strike: number; mash: number; mashMin: number; mt: number; bk: number; ko: number; og: number; fg: number; profile: string; dryHop?: number; tap: number; artwork?: boolean }

export const RECIPES: { key: string; name: string; beer?: string; style: string; status: "live" | "dev"; bbl: number; ferment: number; condition: number; notes?: string; process: ProcessSpec; lines: LineSpec[] }[] = [
  {
    key: "demo:ipa",
    name: "Subversive IPA",
    beer: "Subversive IPA",
    style: "American IPA",
    status: "live",
    bbl: 7,
    ferment: 12,
    condition: 7,
    notes: "Mash 152°F for 60 min. Dry hop on day 5 at 64°F.",
    process: { strike: 166, mash: 152, mashMin: 60, mt: 1.082, bk: 1.059, ko: 1.064, og: 1.064, fg: 1.013, profile: "custom", dryHop: 5, tap: 21 },
    lines: [
      ["grain", "Pale ale malt", 480, "lb", { ing: "Pale ale malt", ppg: 37, colorL: 3 }],
      ["grain", "Crystal 40", 30, "lb", { ing: "Crystal 40", ppg: 34, colorL: 40 }],
      ["grain", "Flaked oats", 40, "lb", { ing: "Flaked oats", ppg: 33, colorL: 1 }],
      ["hop", "Magnum", 1.5, "lb", { ing: "Magnum pellets", alpha: 13, use: "boil", minutes: 60 }],
      ["hop", "Citra", 4, "lb", { ing: "Citra pellets", alpha: 12.5, use: "whirlpool", minutes: 20 }],
      ["hop", "Citra", 6, "lb", { ing: "Citra pellets", alpha: 12.5, use: "dryhop", minutes: 4 }],
      ["hop", "Mosaic", 6, "lb", { ing: "Mosaic pellets", alpha: 12, use: "dryhop", minutes: 4 }],
      ["yeast", "Dry ale yeast", 2, "pkg", { ing: "Dry ale yeast, 500 g", att: 78 }],
    ],
  },
  {
    key: "demo:lager",
    name: "Golden Lager",
    beer: "Golden Lager",
    style: "Helles",
    status: "live",
    bbl: 7,
    ferment: 21,
    condition: 21,
    notes: "Ferment 50°F, free rise to 58°F for a diacetyl rest, then lager cold.",
    process: { strike: 161, mash: 148, mashMin: 75, mt: 1.07, bk: 1.045, ko: 1.048, og: 1.048, fg: 1.009, profile: "custom", tap: 45 },
    lines: [
      ["grain", "Pilsner malt", 420, "lb", { ing: "Pilsner malt", ppg: 37, colorL: 1.8 }],
      ["grain", "Munich malt", 20, "lb", { ing: "Munich malt", ppg: 37, colorL: 9 }],
      ["hop", "Hallertau Mittelfrüh", 2, "lb", { ing: "Hallertau Mittelfrüh pellets", alpha: 4.5, use: "boil", minutes: 60 }],
      ["hop", "Hallertau Mittelfrüh", 2, "lb", { ing: "Hallertau Mittelfrüh pellets", alpha: 4.5, use: "boil", minutes: 15 }],
      ["yeast", "Dry lager yeast", 3, "pkg", { ing: "Dry lager yeast, 500 g", att: 80 }],
    ],
  },
  {
    key: "demo:stout",
    name: "Catskill Stout",
    beer: "Catskill Stout",
    style: "Dry stout",
    status: "live",
    bbl: 7,
    ferment: 10,
    condition: 7,
    process: { strike: 164, mash: 154, mashMin: 45, mt: 1.075, bk: 1.05, ko: 1.054, og: 1.054, fg: 1.015, profile: "custom", tap: 18 },
    lines: [
      ["grain", "Pale ale malt", 360, "lb", { ing: "Pale ale malt", ppg: 37, colorL: 3 }],
      ["grain", "Flaked oats", 40, "lb", { ing: "Flaked oats", ppg: 33, colorL: 1 }],
      ["grain", "Roasted barley", 40, "lb", { ing: "Roasted barley", ppg: 25, colorL: 500 }],
      ["grain", "Chocolate malt", 20, "lb", { ing: "Chocolate malt", ppg: 28, colorL: 350 }],
      ["hop", "East Kent Goldings", 3, "lb", { ing: "East Kent Goldings pellets", alpha: 5.5, use: "boil", minutes: 60 }],
      ["yeast", "Dry ale yeast", 2, "pkg", { ing: "Dry ale yeast, 500 g", att: 72 }],
    ],
  },
  {
    key: "demo:hazy",
    name: "Hazy pale (trial)",
    style: "Hazy pale ale",
    status: "dev",
    bbl: 3.5,
    ferment: 20,
    condition: 3,
    notes: "Pilot batch. Trying lactose for body.",
    process: { strike: 165, mash: 154, mashMin: 60, mt: 1.078, bk: 1.054, ko: 1.058, og: 1.058, fg: 1.016, profile: "hazy", dryHop: 7, tap: 30, artwork: true },
    lines: [
      ["grain", "Pilsner malt", 200, "lb", { ing: "Pilsner malt", ppg: 37, colorL: 1.8 }],
      ["grain", "Flaked oats", 30, "lb", { ing: "Flaked oats", ppg: 33, colorL: 1 }],
      ["hop", "Citra", 3, "lb", { ing: "Citra pellets", alpha: 12.5, use: "whirlpool", minutes: 20 }],
      ["hop", "Mosaic", 5, "lb", { ing: "Mosaic pellets", alpha: 12, use: "dryhop", minutes: 3 }],
      ["yeast", "Dry ale yeast", 1, "pkg", { ing: "Dry ale yeast, 500 g", att: 75 }],
      ["adjunct", "Lactose", 15, "lb", { ppg: 43 }],
      ["water", "Gypsum", 2, "lb", { ing: "Gypsum" }],
    ],
  },
];

export async function seedBrewRecipes(db: PrismaClient): Promise<void> {
  const today = todayIn(process.env.BUSINESS_TIMEZONE || "America/New_York");

  const supplierId = new Map<string, string>();
  for (const name of SUPPLIERS) {
    const s = (await db.supplier.findUnique({ where: { name } })) ?? (await db.supplier.create({ data: { name, kind: "LOCAL", leadTimeDays: 5 } }));
    supplierId.set(name, s.id);
  }

  const ingId = new Map<string, string>();
  for (const s of INGREDIENTS) {
    const ing =
      (await db.ingredient.findUnique({ where: { name: s.name } })) ??
      (await db.ingredient.create({ data: { name: s.name, category: s.category, baseUnit: s.base, storageArea: "Brewery", countUnit: s.base === "g" ? "lb" : "each", safetyPct: D(0) } }));
    ingId.set(s.name, ing.id);
    if (!s.supplier || !s.sku) continue;
    const sid = supplierId.get(s.supplier)!;
    const product = await db.supplierProduct.upsert({
      where: { supplierId_sku: { supplierId: sid, sku: s.sku } },
      create: { supplierId: sid, ingredientId: ing.id, sku: s.sku, description: `${s.name}, ${s.pack}`, packText: s.pack, purchaseUnit: s.unit ?? "case", packQtyBase: D(s.packQty!) },
      update: { ingredientId: ing.id, active: true },
    });
    if ((await db.priceRecord.count({ where: { supplierProductId: product.id } })) === 0) {
      await db.priceRecord.createMany({ data: s.prices!.map(([offset, price]) => ({ supplierProductId: product.id, price: D(price, 2), effectiveDate: parseISODate(addDays(today, offset)), source: "IMPORT" as const })) });
    }
    if (!ing.preferredProductId) await db.ingredient.update({ where: { id: ing.id }, data: { preferredProductId: product.id } });
  }

  await db.brewRecipe.deleteMany({ where: { sourceKey: { startsWith: "demo:" } } });
  for (const r of RECIPES) {
    const beer = r.beer ? await db.beer.findUnique({ where: { name: r.beer }, select: { id: true } }) : null;
    // A real recipe already has the name: leave it be.
    if (await db.brewRecipe.findUnique({ where: { name: r.name }, select: { id: true } })) continue;
    await db.brewRecipe.create({
      data: {
        name: r.name,
        style: r.style,
        status: r.status,
        beerId: beer?.id ?? null,
        batchBbl: D(r.bbl, 2),
        efficiencyPct: D(72, 2),
        boilMinutes: 60,
        fermentDays: r.ferment,
        conditionDays: r.condition,
        targetOg: D(r.process.og),
        targetFg: D(r.process.fg),
        targetMt: D(r.process.mt),
        targetBk: D(r.process.bk),
        targetKo: D(r.process.ko),
        strikeF: D(r.process.strike, 1),
        mashF: D(r.process.mash, 1),
        mashMinutes: r.process.mashMin,
        profile: r.process.profile,
        dryHopDay: r.process.dryHop ?? null,
        tapDay: r.process.tap,
        artworkDone: r.process.artwork ?? false,
        notes: r.notes ?? null,
        sourceKey: r.key,
        lines: {
          create: r.lines.map(([kind, name, qty, unit, x], i) => ({
            kind,
            name,
            qty: D(qty),
            unit,
            ingredientId: x?.ing ? (ingId.get(x.ing) ?? null) : null,
            potentialPpg: x?.ppg == null ? null : D(x.ppg, 2),
            colorL: x?.colorL == null ? null : D(x.colorL, 1),
            alphaPct: x?.alpha == null ? null : D(x.alpha, 1),
            use: x?.use ?? null,
            minutes: x?.minutes ?? null,
            attenuationPct: x?.att == null ? null : D(x.att, 1),
            sort: i,
          })),
        },
      },
    });
  }

  await seedBrewDay(db, today);
}

/** A brew day under way: the IPA, mashed and lautered, 20 minutes into the boil with the bittering hops in. */
export function demoBrewLog(now: Date) {
  const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();
  return {
    v: 1,
    stage: "boil",
    startedAt: at(200),
    savedAt: at(2),
    finishedAt: null,
    values: {
      mash: { strikeF: 166, mashF: 152.5, mtSg: 1.0815, ph: 5.35, startTime: "07:10", strikeBbl: 4.2 },
      lauter: { bkSg: 1.0585, spargeF: 168, preboilBbl: 8.1, runoffMin: 75 },
      boil: { boilStart: "09:55" },
      ferment: {},
      package: {},
    },
    notes: { mash: "Hit strike a touch high; stirred down to 152.", lauter: "", boil: "", ferment: "", package: "" },
    timers: {
      mash: { startedAt: null, elapsedMs: 60 * 60_000, targetMin: 60 },
      boil: { startedAt: null, elapsedMs: 20 * 60_000, targetMin: 60 },
    },
    hops: { "0|magnum|boil|60": at(20) },
  };
}

async function seedBrewDay(db: PrismaClient, today: string): Promise<void> {
  await db.brewBatch.deleteMany({ where: { sourceKey: "demobrew:brewday" } });
  const ipa = await db.brewRecipe.findUnique({ where: { sourceKey: "demo:ipa" }, select: { id: true, beerId: true } });
  if (!ipa) return;
  const code = `BD-${today.slice(2).replace(/-/g, "")}`;
  if (await db.brewBatch.findUnique({ where: { code }, select: { id: true } })) return;
  await db.brewBatch.create({
    data: { code, recipeId: ipa.id, beerId: ipa.beerId, status: "PLANNED", plannedOn: parseISODate(today), bbl: D(7, 2), sourceKey: "demobrew:brewday", brewLog: demoBrewLog(new Date()) },
  });
}
