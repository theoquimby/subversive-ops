import type { PrismaClient } from "@prisma/client";
import { newKegCode } from "@/domain/kegs";

/**
 * Tap list demo (run after the keg demo): board details for the six house
 * beers, Square items with catalog prices for their pours (the "demo-keg-*"
 * ids the keg demo sells under), one pour recipe whose price differs from
 * Square, and optionally extra guest beers on more tap lines so the board
 * can be seen with up to 16 taps. Clears its own rows first.
 */

const DETAILS: Record<string, { style: string; abv: number; ibu?: number; description: string; diet?: string; prices: [number, number, number] }> = {
  "Golden Lager": { style: "Helles lager", abv: 4.8, ibu: 18, description: "Bready, crisp and clean. Our everyday beer.", prices: [7, 4.5, 2.5] },
  "New York Nectar": { style: "Hazy IPA", abv: 6.8, ibu: 35, description: "Citra and Mosaic, soft and juicy with a little pine.", prices: [8, 5, 3] },
  "Subversive IPA": { style: "West Coast IPA", abv: 6.5, ibu: 62, description: "Bitter, resinous and bright. Dry finish.", prices: [8, 5, 3] },
  "Catskill Stout": { style: "Oatmeal stout", abv: 5.6, ibu: 30, description: "Roasty, smooth, a touch of chocolate.", diet: "Contains lactose", prices: [7.5, 4.5, 2.5] },
  "Raspberry Gose": { style: "Fruited gose", abv: 4.2, ibu: 8, description: "Tart raspberry, a pinch of sea salt.", diet: "Gluten-reduced", prices: [8, 5, 3] },
  "Märzen": { style: "Märzen", abv: 5.9, ibu: 22, description: "Toasty malt, amber and smooth.", prices: [7, 4.5, 2.5] },
};

const GUESTS = [
  { name: "Hudson Valley Pils", style: "Pilsner", abv: 5.0, color: "straw", pours: "16 oz $7, 10 oz $5" },
  { name: "Rondout Red", style: "Irish red ale", abv: 5.4, color: "red", pours: "16 oz $7, 10 oz $5" },
  { name: "Kaaterskill Kölsch", style: "Kölsch", abv: 4.7, color: "straw", pours: "16 oz $7, 10 oz $5" },
  { name: "Overlook Porter", style: "Robust porter", abv: 6.2, color: "black", pours: "16 oz $8, 10 oz $5.50" },
  { name: "Saugerties Saison", style: "Farmhouse saison", abv: 6.0, color: "gold", pours: "16 oz $8, 10 oz $5.50" },
  { name: "Esopus Dry Cider", style: "Dry cider", abv: 6.4, color: "blue", pours: "12 oz $8" },
  { name: "Woodstock Wit", style: "Belgian witbier", abv: 4.9, color: "straw", pours: "16 oz $7, 10 oz $5" },
  { name: "Palenville Pale", style: "American pale ale", abv: 5.3, color: "gold", pours: "16 oz $7, 10 oz $5" },
  { name: "Black Dome Barleywine", style: "English barleywine", abv: 10.5, color: "copper", pours: "10 oz $9" },
  { name: "Plattekill Peach Sour", style: "Kettle sour", abv: 5.1, color: "pink", pours: "16 oz $8, 10 oz $5.50" },
];

/** Not on tap yet: a full keg in the walk-in, so it shows as coming soon. */
const SOON = { name: "Snowed In Winter Ale", style: "Winter warmer", abv: 7.2, color: "brown" };

export async function seedTaps(db: PrismaClient, opts: { extraTaps?: number } = {}): Promise<void> {
  // Clean our own rows.
  const guests = await db.beer.findMany({ where: { name: { in: [...GUESTS.map((g) => g.name), SOON.name] } }, select: { id: true } });
  await db.keg.deleteMany({ where: { label: "demo-taps" } });
  await db.beer.deleteMany({ where: { id: { in: guests.map((g) => g.id) } } });
  await db.squareMapping.deleteMany({ where: { squareId: { startsWith: "demo-keg-" } } });
  await db.recipe.deleteMany({ where: { name: "Subversive IPA · Full Pour", category: "Beer" } });

  const beers = await db.beer.findMany({ where: { name: { in: Object.keys(DETAILS) } } });
  const meta = (await db.setting.findUnique({ where: { key: "square.catalog" } }))?.value;
  const catalog: Record<string, unknown> = meta ? JSON.parse(meta) : {};
  for (const k of Object.keys(catalog)) if (k.startsWith("demo-keg-")) delete catalog[k];

  const order = ["Golden Lager", "New York Nectar", "Subversive IPA", "Catskill Stout", "Raspberry Gose", "Märzen"];
  for (const b of beers) {
    const d = DETAILS[b.name];
    await db.beer.update({ where: { id: b.id }, data: { style: d.style, abv: d.abv, ibu: d.ibu ?? null, description: d.description, diet: d.diet ?? null, boardPours: null, comingSoon: null } });
    const i = order.indexOf(b.name);
    const sq = b.squareNames[0] ?? b.name;
    const pours: [string, string, number][] = [["full", "Full Pour", d.prices[0]], ["half", "Half Pour", d.prices[1]], ["taster", "Taster", d.prices[2]]];
    for (const [suffix, v, price] of pours) {
      const id = `demo-keg-${i}-${suffix}`;
      await db.squareMapping.create({ data: { squareId: id, squareName: `${sq} · ${v}`, squareType: "ITEM_VARIATION" } });
      catalog[id] = { baseName: `${sq} · ${v}`, price, category: "Draft beer", archived: false, deleted: false };
    }
  }
  // A pour recipe priced differently from Square, so the Square check has something to say.
  const ipa = beers.find((b) => b.name === "Subversive IPA");
  if (ipa) {
    const r = await db.recipe.create({ data: { name: "Subversive IPA · Full Pour", kind: "MENU", category: "Beer", menuPrice: 7.5, yieldQty: 1, yieldUnit: "each", yieldBase: "each" } });
    await db.squareMapping.update({ where: { squareId: "demo-keg-2-full" }, data: { recipeId: r.id } });
  }
  await db.setting.upsert({ where: { key: "square.catalog" }, create: { key: "square.catalog", value: JSON.stringify(catalog) }, update: { value: JSON.stringify(catalog) } });

  const soon = await db.beer.create({ data: { name: SOON.name, style: SOON.style, abv: SOON.abv, color: SOON.color, description: "Cinnamon, orange peel and a warm malty finish." } });
  await db.keg.create({ data: { code: newKegCode(), label: "demo-taps", sizeId: "half", status: "COLD", beerId: soon.id, area: "Walk-in" } });

  // Extra guest beers on the next tap lines.
  const extra = Math.max(0, Math.min(GUESTS.length, opts.extraTaps ?? 0));
  const busy = new Set((await db.keg.findMany({ where: { status: "ON_TAP" }, select: { tapLine: true } })).map((k) => k.tapLine));
  let line = 1;
  for (const g of GUESTS.slice(0, extra)) {
    while (busy.has(line)) line++;
    const beer = await db.beer.create({ data: { name: g.name, style: g.style, abv: g.abv, color: g.color, house: false, boardPours: g.pours } });
    const tappedAt = new Date(Date.now() - (line % 3 === 0 ? 20 : 120) * 3_600_000);
    const keg = await db.keg.create({ data: { code: newKegCode(), label: "demo-taps", sizeId: "sixtel", status: "ON_TAP", statusAt: tappedAt, beerId: beer.id, tapLine: line, area: "Bar" } });
    const fill = await db.kegFill.create({ data: { kegId: keg.id, beerId: beer.id, tappedAt, tapLine: line } });
    await db.keg.update({ where: { id: keg.id }, data: { fillId: fill.id } });
    busy.add(line);
  }
  const cfg = await db.setting.findUnique({ where: { key: "kegs.config" } });
  const v = cfg ? JSON.parse(cfg.value) : {};
  const lines = Math.max(12, ...[...busy].filter((x): x is number => x != null));
  await db.setting.upsert({ where: { key: "kegs.config" }, create: { key: "kegs.config", value: JSON.stringify({ ...v, tapLines: lines }) }, update: { value: JSON.stringify({ ...v, tapLines: lines }) } });
}
