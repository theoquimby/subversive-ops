/**
 * Demo data so every screen has something real-looking before the actual
 * spreadsheet is imported. Safe to re-run: it wipes and recreates everything.
 *
 * Used by `npm run db:seed` and the in-app "Load demo data" button.
 *
 *   npm run db:seed
 *
 * SEED_MODE=empty wipes everything and creates only the logins.
 *
 * Logins: "Max" / 1234 (manager), "Line" / 0000 (staff) — override with
 * SEED_MANAGER_PIN / SEED_STAFF_PIN when seeding anything reachable online.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const D = (n: number | string) => new Prisma.Decimal(n);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (offset: number) => {
  const d = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

// Deterministic pseudo-random so the demo looks the same every run.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export async function seedDemo(db: PrismaClient, opts: { managerPin?: string; staffPin?: string; mode?: "demo" | "empty"; wipe?: boolean; keepUsers?: boolean } = {}) {
  if (opts.wipe !== false) await db.$transaction([
    db.purchaseOrderLine.deleteMany(), db.purchaseOrder.deleteMany(), db.wasteLog.deleteMany(),
    db.stockCountLine.deleteMany(), db.stockCount.deleteMany(), db.dailySale.deleteMany(), db.squareMapping.deleteMany(),
    db.recipeLine.deleteMany(), db.recipe.deleteMany(), db.priceRecord.deleteMany(), db.priceImport.deleteMany(),
    db.ingredient.updateMany({ data: { preferredProductId: null } }),
    db.supplierProduct.deleteMany(), db.unitConversion.deleteMany(), db.ingredient.deleteMany(), db.supplier.deleteMany(),
    ...(opts.keepUsers ? [] : [db.user.deleteMany()]), db.setting.deleteMany(),
  ]);

  if (!opts.keepUsers) await db.user.createMany({
    data: [
      ...(opts.managerPin === undefined || opts.managerPin ? [{ name: "Max", role: "MANAGER" as const, pinHash: await bcrypt.hash(opts.managerPin ?? "1234", 10) }] : []),
      ...(opts.staffPin === undefined || opts.staffPin ? [{ name: "Line", role: "STAFF" as const, pinHash: await bcrypt.hash(opts.staffPin ?? "0000", 10) }] : []),
    ],
  });
  await db.setting.create({ data: { key: "costing.targetFoodCostPct", value: "0.30" } });

  // SEED_MODE=empty → a clean slate with just the logins, ready for the real import.
  if (opts.mode === "empty") {
    console.log("Reset to empty.");
    return;
  }

  const broadline = await db.supplier.create({ data: { name: "Hudson Valley Foodservice", kind: "DISTRIBUTOR", deliveryDays: [1, 4], leadTimeDays: 1, minOrder: D(350), email: "orders@example.com" } });
  const bakery = await db.supplier.create({ data: { name: "Catskill Bread Co.", kind: "LOCAL", deliveryDays: [3, 5], leadTimeDays: 1 } });
  const beef = await db.supplier.create({ data: { name: "Greene County Beef", kind: "LOCAL", deliveryDays: [3], leadTimeDays: 2 } });

  type IngSpec = { name: string; cat: string; area: string; base: "g" | "ml" | "each"; yieldPct?: number; countUnit?: string; conv?: [string, number][];
    supplier: string; sku: string; desc: string; pack: string; packQty: number; unit?: string; prices: [number, number][] };
  const lb = 453.59237, gal = 3785.411784, oz = 28.349523125;
  const specs: IngSpec[] = [
    { name: "Ground beef 80/20", cat: "Protein", area: "Walk-in", base: "g", countUnit: "lb", supplier: beef.id, sku: "GCB-80", desc: "Ground chuck 80/20, 10 lb", pack: "10 LB", packQty: 10 * lb, unit: "case", prices: [[-120, 52], [-40, 58], [-9, 61.5]] },
    { name: "Chicken thigh, boneless", cat: "Protein", area: "Walk-in", base: "g", yieldPct: 0.92, countUnit: "lb", supplier: broadline.id, sku: "40112", desc: "Chicken thigh bnls sknls 4/10 lb", pack: "4/10 LB", packQty: 40 * lb, prices: [[-120, 98], [-20, 104]] },
    { name: "Bacon, sliced", cat: "Protein", area: "Walk-in", base: "g", yieldPct: 0.6, countUnit: "lb", supplier: broadline.id, sku: "40890", desc: "Bacon applewood 14/18 ct 15 lb", pack: "15 LB", packQty: 15 * lb, prices: [[-120, 71]] },
    { name: "Burger bun", cat: "Bakery", area: "Dry storage", base: "each", countUnit: "each", supplier: bakery.id, sku: "CBC-BUN", desc: "Potato bun, dozen", pack: "12 CT", packQty: 12, unit: "dozen", prices: [[-120, 7.2], [-55, 7.8]] },
    { name: "Sourdough loaf", cat: "Bakery", area: "Dry storage", base: "each", countUnit: "each", conv: [["slice", 1 / 16]], supplier: bakery.id, sku: "CBC-SD", desc: "Country sourdough loaf", pack: "1 EA", packQty: 1, unit: "each", prices: [[-120, 6.5]] },
    { name: "Cheddar, sliced", cat: "Dairy", area: "Walk-in", base: "g", countUnit: "lb", conv: [["slice", 21]], supplier: broadline.id, sku: "20455", desc: "Cheddar sharp sliced 4/2.5 lb", pack: "4/2.5 LB", packQty: 10 * lb, prices: [[-120, 41], [-30, 44.6]] },
    { name: "Butter", cat: "Dairy", area: "Walk-in", base: "g", countUnit: "lb", supplier: broadline.id, sku: "20010", desc: "Butter unsalted 36/1 lb", pack: "36/1 LB", packQty: 36 * lb, prices: [[-120, 142], [-60, 151]] },
    { name: "Mayonnaise", cat: "Pantry", area: "Dry storage", base: "ml", countUnit: "gal", supplier: broadline.id, sku: "30120", desc: "Mayonnaise heavy duty 4/1 gal", pack: "4/1 GAL", packQty: 4 * gal, prices: [[-120, 58], [-25, 63]] },
    { name: "Garlic, peeled", cat: "Produce", area: "Walk-in", base: "g", countUnit: "lb", supplier: broadline.id, sku: "10777", desc: "Garlic peeled 5 lb", pack: "5 LB", packQty: 5 * lb, prices: [[-120, 18.5], [-12, 23.9]] },
    { name: "Lemon", cat: "Produce", area: "Walk-in", base: "each", countUnit: "each", supplier: broadline.id, sku: "10301", desc: "Lemons 115 ct", pack: "115 CT", packQty: 115, prices: [[-120, 44]] },
    { name: "Lettuce, green leaf", cat: "Produce", area: "Walk-in", base: "g", yieldPct: 0.8, countUnit: "case", supplier: broadline.id, sku: "10450", desc: "Lettuce green leaf 24 ct", pack: "24 CT", packQty: 24 * 400, prices: [[-120, 38], [-15, 46]] },
    { name: "Tomato", cat: "Produce", area: "Walk-in", base: "g", yieldPct: 0.9, countUnit: "lb", conv: [["slice", 25]], supplier: broadline.id, sku: "10512", desc: "Tomato 5x6 25 lb", pack: "25 LB", packQty: 25 * lb, prices: [[-120, 34], [-35, 39]] },
    { name: "Red onion", cat: "Produce", area: "Dry storage", base: "g", yieldPct: 0.88, countUnit: "lb", supplier: broadline.id, sku: "10630", desc: "Onion red jumbo 25 lb", pack: "25 LB", packQty: 25 * lb, prices: [[-120, 27]] },
    { name: "Pickles, chips", cat: "Pantry", area: "Dry storage", base: "g", countUnit: "each", supplier: broadline.id, sku: "30410", desc: "Pickle chips 5 gal pail", pack: "1/5 GAL", packQty: 5 * 3600, prices: [[-120, 39]] },
    { name: "Fries, 3/8 skin-on", cat: "Frozen", area: "Freezer", base: "g", countUnit: "case", supplier: broadline.id, sku: "50215", desc: "Fries 3/8 skin-on 6/5 lb", pack: "6/5 LB", packQty: 30 * lb, prices: [[-120, 39.5], [-45, 42], [-6, 47.8]] },
    { name: "Fryer oil", cat: "Pantry", area: "Dry storage", base: "ml", countUnit: "each", supplier: broadline.id, sku: "30990", desc: "Canola fry oil 35 lb jug", pack: "35 LB", packQty: 35 * lb * 1.09, prices: [[-120, 38], [-50, 44]] },
    { name: "Kosher salt", cat: "Pantry", area: "Dry storage", base: "g", countUnit: "each", supplier: broadline.id, sku: "31001", desc: "Kosher salt 3 lb box", pack: "3 LB", packQty: 3 * lb, prices: [[-120, 4.1]] },
    { name: "Hot sauce", cat: "Pantry", area: "Dry storage", base: "ml", countUnit: "each", supplier: broadline.id, sku: "30777", desc: "Hot sauce 4/1 gal", pack: "4/1 GAL", packQty: 4 * gal, prices: [[-120, 61]] },
    { name: "All-purpose flour", cat: "Pantry", area: "Dry storage", base: "g", countUnit: "each", conv: [["cup", 120]], supplier: broadline.id, sku: "31200", desc: "Flour AP 50 lb", pack: "50 LB", packQty: 50 * lb, prices: [[-120, 24], [-28, 27.5]] },
    { name: "Buttermilk", cat: "Dairy", area: "Walk-in", base: "ml", countUnit: "each", supplier: broadline.id, sku: "20220", desc: "Buttermilk 1/2 gal", pack: "1/2 GAL", packQty: gal / 2, unit: "each", prices: [[-120, 4.6]] },
    { name: "Pretzel, soft", cat: "Frozen", area: "Freezer", base: "each", countUnit: "case", supplier: broadline.id, sku: "50440", desc: "Bavarian pretzel 10 oz 24 ct", pack: "24 CT", packQty: 24, prices: [[-120, 52], [-18, 55]] },
    { name: "Mustard, whole grain", cat: "Pantry", area: "Dry storage", base: "ml", countUnit: "each", supplier: broadline.id, sku: "30155", desc: "Whole grain mustard 4/1 gal", pack: "4/1 GAL", packQty: 4 * gal, prices: [[-120, 74]] },
  ];
  void oz;

  const ing = new Map<string, string>();
  for (const s of specs) {
    const i = await db.ingredient.create({
      data: {
        name: s.name, category: s.cat, storageArea: s.area, baseUnit: s.base, yieldPct: D(s.yieldPct ?? 1), countUnit: s.countUnit,
        conversions: s.conv ? { create: s.conv.map(([unit, baseQty]) => ({ unit, baseQty: D(baseQty.toFixed(4)) })) } : undefined,
      },
    });
    const p = await db.supplierProduct.create({
      data: {
        supplierId: s.supplier, ingredientId: i.id, sku: s.sku, description: s.desc, packText: s.pack, purchaseUnit: s.unit ?? "case", packQtyBase: D(s.packQty.toFixed(4)),
        prices: { create: s.prices.map(([offset, price]) => ({ price: D(price), effectiveDate: day(offset), source: s.supplier === broadline.id ? "IMPORT" : "MANUAL" })) },
      },
    });
    await db.ingredient.update({ where: { id: i.id }, data: { preferredProductId: p.id } });
    ing.set(s.name, i.id);
  }
  // A product on the sheet that isn't linked to an ingredient yet.
  await db.supplierProduct.create({ data: { supplierId: broadline.id, sku: "30888", description: "Sriracha 12/17 oz", packText: "12/17 OZ", prices: { create: [{ price: D(48), effectiveDate: day(-120), source: "IMPORT" }] } } });

  const L = (name: string, qty: number, unit: string) => ({ ingredientId: ing.get(name)!, qty: D(qty), unit });
  const prep = async (name: string, yieldQty: number, yieldUnit: string, yieldBase: "g" | "ml" | "each", lines: ReturnType<typeof L>[]) =>
    db.recipe.create({ data: { name, kind: "PREP", category: "Prep", yieldQty: D(yieldQty), yieldUnit, yieldBase, lines: { create: lines.map((l, i) => ({ ...l, sort: i })) } } });

  const aioli = await prep("Garlic aioli", 2, "l", "ml", [L("Mayonnaise", 1800, "ml"), L("Garlic, peeled", 120, "g"), L("Lemon", 3, "each"), L("Kosher salt", 10, "g")]);
  const pickledOnion = await prep("Pickled red onion", 1, "l", "ml", [L("Red onion", 2, "lb"), L("Kosher salt", 20, "g")]);
  const dredge = await prep("Chicken dredge", 3, "kg", "g", [L("All-purpose flour", 2.8, "kg"), L("Kosher salt", 80, "g")]);
  const beerCheese = await prep("Beer cheese", 2, "l", "ml", [L("Cheddar, sliced", 1.5, "lb"), L("Butter", 0.25, "lb"), L("All-purpose flour", 0.5, "cup")]);

  const menu = async (name: string, category: string, price: number, lines: { ingredientId?: string; subRecipeId?: string; qty: Prisma.Decimal; unit: string }[], squareId: string) => {
    const r = await db.recipe.create({ data: { name, kind: "MENU", category, menuPrice: D(price), lines: { create: lines.map((l, i) => ({ ...l, sort: i })) } } });
    await db.squareMapping.create({ data: { squareId, squareName: name, squareType: "ITEM_VARIATION", recipeId: r.id } });
    return r;
  };
  const S = (id: string, qty: number, unit: string) => ({ subRecipeId: id, qty: D(qty), unit });

  const fries = await menu("Hand-cut fries", "Sides", 7, [L("Fries, 3/8 skin-on", 7, "oz"), L("Fryer oil", 30, "ml"), L("Kosher salt", 2, "g"), S(aioli.id, 2, "tbsp")], "SQ-FRIES");
  const burger = await menu("Subversive burger", "Mains", 19, [L("Ground beef 80/20", 6, "oz"), L("Burger bun", 1, "each"), L("Cheddar, sliced", 2, "slice"), L("Lettuce, green leaf", 20, "g"), L("Tomato", 2, "slice"), L("Pickles, chips", 15, "g"), S(pickledOnion.id, 30, "ml"), S(aioli.id, 1, "tbsp"), L("Fries, 3/8 skin-on", 6, "oz"), L("Fryer oil", 25, "ml")], "SQ-BURGER");
  const chicken = await menu("Hot chicken sandwich", "Mains", 18, [L("Chicken thigh, boneless", 6, "oz"), S(dredge.id, 60, "g"), L("Buttermilk", 60, "ml"), L("Hot sauce", 30, "ml"), L("Burger bun", 1, "each"), L("Pickles, chips", 15, "g"), S(aioli.id, 1, "tbsp"), L("Fryer oil", 40, "ml")], "SQ-CHX");
  const pretzel = await menu("Pretzel & beer cheese", "Snacks", 13, [L("Pretzel, soft", 1, "each"), S(beerCheese.id, 120, "ml"), L("Mustard, whole grain", 30, "ml")], "SQ-PRETZEL");
  const grilled = await menu("Grilled cheese", "Mains", 14, [L("Sourdough loaf", 2, "slice"), L("Cheddar, sliced", 3, "slice"), L("Butter", 15, "g"), L("Fries, 3/8 skin-on", 5, "oz")], "SQ-GRILLED");
  const bacon = await db.recipe.create({ data: { name: "Add bacon", kind: "MODIFIER", category: "Add-ons", menuPrice: D(3), lines: { create: [{ ...L("Bacon, sliced", 2, "oz"), sort: 0 }] } } });
  await db.squareMapping.create({ data: { squareId: "SQ-MOD-BACON", squareName: "Add bacon (Burger add-ons)", squareType: "MODIFIER", recipeId: bacon.id } });
  await db.squareMapping.createMany({
    data: [
      { squareId: "SQ-IPA-16", squareName: "Draft IPA · 16 oz", squareType: "ITEM_VARIATION" },
      { squareId: "SQ-GIFT", squareName: "Gift card", squareType: "ITEM_VARIATION", ignored: true },
    ],
  });

  // ~10 weeks of sales, closed Tuesdays, busier weekends, gentle upward trend.
  const profile: Record<string, { id: string; base: number; price: number }> = {
    burger: { id: "SQ-BURGER", base: 22, price: 19 }, fries: { id: "SQ-FRIES", base: 14, price: 7 }, chicken: { id: "SQ-CHX", base: 15, price: 18 },
    pretzel: { id: "SQ-PRETZEL", base: 11, price: 13 }, grilled: { id: "SQ-GRILLED", base: 7, price: 14 }, bacon: { id: "SQ-MOD-BACON", base: 6, price: 3 }, ipa: { id: "SQ-IPA-16", base: 60, price: 8 },
  };
  const dow = [1.5, 0.75, 0, 0.8, 0.9, 1.35, 1.8]; // Sun..Sat
  const rows: Prisma.DailySaleCreateManyInput[] = [];
  for (let o = -72; o < 0; o++) {
    const d = day(o);
    const f = dow[d.getUTCDay()];
    if (f === 0) continue;
    const trend = 1 + (o + 72) * 0.002;
    for (const [name, p] of Object.entries(profile)) {
      const q = Math.max(0, Math.round(p.base * f * trend * (0.8 + rand() * 0.4)));
      rows.push({ date: d, squareId: p.id, name, qty: D(q), netSales: D((q * p.price).toFixed(2)) });
    }
  }
  await db.dailySale.createMany({ data: rows });
  void [fries, burger, chicken, pretzel, grilled];

  // Two counts a week apart with a delivery and some waste in between, so the
  // margin-gap report has a realistic story: beef and cheese run heavy.
  const counted: [string, number][] = [
    ["Ground beef 80/20", 18 * lb], ["Burger bun", 70], ["Fries, 3/8 skin-on", 2.5 * 30 * lb], ["Cheddar, sliced", 6 * lb], ["Mayonnaise", 1.5 * gal],
    ["Chicken thigh, boneless", 22 * lb], ["Fryer oil", 2 * 35 * lb * 1.09], ["Pretzel, soft", 30], ["Lettuce, green leaf", 3000], ["Tomato", 8 * lb],
  ];
  const gap: Record<string, number> = { "Ground beef 80/20": 0.09, "Cheddar, sliced": 0.14, "Fries, 3/8 skin-on": 0.04, "Burger bun": -0.01, "Lettuce, green leaf": 0.03 };
  const delivered: [string, number][] = [["Fries, 3/8 skin-on", 2], ["Chicken thigh, boneless", 1]];
  const wasted: [string, number, string, string, number][] = [
    ["Lettuce, green leaf", 800, "Spoiled", "Line", -1], ["Tomato", 600, "Spoiled", "Line", -5], ["Fries, 3/8 skin-on", 900, "Dropped", "Max", -6], ["Chicken thigh, boneless", 450, "Overcooked", "Line", -8],
  ];

  // Theoretical usage for the week between the counts, from the seeded sales.
  const { explodeUsage } = await import("../domain/costing");
  const ingRows = await db.ingredient.findMany({ include: { conversions: true } });
  const recRows = await db.recipe.findMany({ include: { lines: true } });
  const ctx = {
    ingredients: new Map(ingRows.map((i) => [i.id, { id: i.id, name: i.name, baseUnit: i.baseUnit as "g" | "ml" | "each", yieldPct: i.yieldPct.toNumber(), conversions: i.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })), costPerBase: null }])),
    recipes: new Map(recRows.map((r) => [r.id, { id: r.id, name: r.name, yieldQty: r.yieldQty.toNumber(), yieldUnit: r.yieldUnit, yieldBase: r.yieldBase as "g" | "ml" | "each", menuPrice: null, lines: r.lines.map((l) => ({ ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: l.qty.toNumber(), unit: l.unit })) }])),
  };
  const recipeBySquare = new Map((await db.squareMapping.findMany({ where: { recipeId: { not: null } } })).map((m) => [m.squareId, m.recipeId!]));
  const theo = new Map<string, number>();
  for (const r of rows) {
    const d = r.date as Date;
    if (d < day(-10) || d >= day(-3)) continue;
    const recipeId = recipeBySquare.get(r.squareId);
    if (recipeId) explodeUsage(ctx, recipeId, Number(r.qty), theo);
  }

  const max = await db.user.findFirst({ where: { role: "MANAGER" } });
  const hvf = await db.supplierProduct.findMany({ where: { supplierId: broadline.id } });
  const po = await db.purchaseOrder.create({
    data: {
      supplierId: broadline.id, status: "RECEIVED", deliveryDate: day(-7), coverUntil: day(-4), sentAt: day(-8), receivedAt: new Date(day(-7).getTime() + 15 * 3600_000),
      lines: { create: delivered.map(([n, q]) => { const p = hvf.find((x) => x.ingredientId === ing.get(n))!; return { supplierProductId: p.id, suggestedQty: D(q), qty: D(q), receivedQty: D(q) }; }) },
    },
    include: { lines: { include: { product: true } } },
  });
  const receivedBase = new Map(po.lines.map((l) => [l.product.ingredientId!, l.qty.toNumber() * (l.product.packQtyBase?.toNumber() ?? 0)]));
  for (const [n, q, reason, by, offset] of wasted) {
    await db.wasteLog.create({ data: { ingredientId: ing.get(n)!, qtyBase: D(q), reason, loggedBy: by, loggedAt: new Date(day(offset).getTime() + 20 * 3600_000) } });
  }
  const wasteBase = new Map<string, number>();
  for (const [n, q, , , offset] of wasted) if (offset > -10 && offset <= -3) wasteBase.set(ing.get(n)!, (wasteBase.get(ing.get(n)!) ?? 0) + q);

  const opening = counted.map(([n, closing]) => {
    const id = ing.get(n)!;
    const used = (theo.get(id) ?? 0) * (1 + (gap[n] ?? 0.01)) + (wasteBase.get(id) ?? 0);
    return [n, Math.max(0, closing + used - (receivedBase.get(id) ?? 0))] as [string, number];
  });
  for (const [offset, list] of [[-10, opening], [-3, counted]] as const) {
    await db.stockCount.create({
      data: { takenAt: new Date(day(offset).getTime() + 14 * 3600_000), userId: max?.id, completed: true, area: "All",
        lines: { create: list.map(([n, q]) => ({ ingredientId: ing.get(n)!, qtyBase: D(q.toFixed(4)) })) } },
    });
  }
  // Feature demo data (see src/server/demo/README.md).
  const { seedForecast } = await import("./demo/forecast");
  await seedForecast(db);
  const { seedLabor } = await import("./demo/labor");
  await seedLabor(db);
  const { seedScheduling } = await import("./demo/scheduling");
  await seedScheduling(db);
  const { seedInvoices } = await import("./demo/invoices");
  await seedInvoices(db);
  const { seedReviews } = await import("./demo/reviews");
  await seedReviews(db);

  await db.setting.create({ data: { key: "square.lastSync", value: new Date(Date.now() - 3 * 3600_000).toISOString() } });

  console.log(`Seeded ${specs.length} ingredients, ${rows.length} sales rows. Users: Max (manager), Line (staff).`);
  void iso;
}

