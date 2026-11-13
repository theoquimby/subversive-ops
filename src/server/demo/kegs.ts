import type { PrismaClient } from "@prisma/client";
import { addDays, dateRange, type ISODate } from "@/domain/dates";
import { newKegCode } from "@/domain/kegs";

/**
 * Keg demo: six house beers sold on Square since 2023 (with a summer bump),
 * ~40 kegs across the walk-in, keg cooler and taps, a few accounts, and a
 * history of taps and kicks so the yield is measured. Safe to run on a
 * database with real menu data: it only adds Square sales under "demo-keg-*"
 * ids and keg rows, and clears its own rows first.
 */

const BEERS = [
  { name: "Golden Lager", color: "straw", pints: 26, sq: "Golden Lager" },
  { name: "New York Nectar", color: "haze", pints: 34, sq: "New York Nectar*" },
  { name: "Subversive IPA", color: "gold", pints: 30, sq: "Subversive IPA" },
  { name: "Catskill Stout", color: "black", pints: 12, sq: "Catskill Stout", winter: true },
  { name: "Raspberry Gose", color: "pink", pints: 9, sq: "Raspberry Gose", from: "2026-05-01" },
  { name: "Märzen", color: "amber", pints: 14, sq: "Märzen", fall: true },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export async function seedKegs(db: PrismaClient, today: ISODate): Promise<void> {
  const r = rng(42);
  await db.kegEvent.deleteMany({});
  await db.kegFill.deleteMany({});
  await db.keg.deleteMany({});
  await db.kegSpot.deleteMany({});
  await db.kegAccount.deleteMany({});
  await db.kegBatch.deleteMany({});
  await db.beer.deleteMany({});
  await db.dailySale.deleteMany({ where: { squareId: { startsWith: "demo-keg-" } } });
  await db.setting.upsert({ where: { key: "kegs.config" }, create: { key: "kegs.config", value: JSON.stringify({ tapLines: 10, tapArea: "Bar", coldArea: "Walk-in", fillDays: 7, pours: {} }) }, update: { value: JSON.stringify({ tapLines: 10, tapArea: "Bar", coldArea: "Walk-in", fillDays: 7, pours: {} }) } });

  const beers = [];
  for (const b of BEERS) beers.push(await db.beer.create({ data: { name: b.name, color: b.color, squareNames: [b.sq], minFull: b.pints > 20 ? 2 : 1 } }));

  // Square sales: Full Pour / Half Pour / Taster, closed Mondays.
  const start = "2023-01-02";
  const rows: { date: Date; squareId: string; name: string; qty: number; netSales: number }[] = [];
  for (const d of dateRange(start, today)) {
    const dt = new Date(`${d}T00:00:00Z`);
    const wd = dt.getUTCDay();
    if (wd === 1) continue;
    const m = dt.getUTCMonth() + 1;
    const season = m >= 6 && m <= 8 ? 1.35 : m === 1 || m === 2 ? 0.7 : m === 12 ? 0.85 : 1;
    const dow = wd === 5 || wd === 6 ? 1.6 : wd === 0 ? 1.2 : 0.75;
    BEERS.forEach((b, i) => {
      if (b.from && d < b.from) return;
      let s = season;
      if (b.winter) s = m >= 11 || m <= 3 ? 1.6 : 0.5;
      if (b.fall) { if (m < 9 || m > 11) return; s = 1.4; }
      const pints = b.pints * s * dow * (0.75 + r() * 0.5);
      const full = Math.round(pints * 0.7), half = Math.round(pints * 0.5), taster = Math.round(r() * 3);
      const add = (v: string, q: number, price: number) => q > 0 && rows.push({ date: dt, squareId: `demo-keg-${i}-${v}`, name: `${b.sq} · ${v === "full" ? "Full Pour" : v === "half" ? "Half Pour" : "Taster"}`, qty: q, netSales: q * price });
      add("full", full, 8);
      add("half", half, 5);
      add("taster", taster, 2.5);
    });
  }
  for (let i = 0; i < rows.length; i += 5000) await db.dailySale.createMany({ data: rows.slice(i, i + 5000), skipDuplicates: true });
  // Oz per beer per day, to time taps and kicks so the demo's gauges and yield line up with its sales.
  const ozDay = BEERS.map(() => new Map<ISODate, number>());
  for (const x of rows) {
    const i = Number(x.squareId.split("-")[2]);
    const oz = x.name.endsWith("Full Pour") ? 16 : x.name.endsWith("Half Pour") ? 8 : 4;
    const d = x.date.toISOString().slice(0, 10);
    ozDay[i].set(d, (ozDay[i].get(d) ?? 0) + x.qty * oz);
  }
  /** Walk back from `end` (a date, whole days) until `oz` have been poured; returns the start date. */
  const backFrom = (bi: number, end: ISODate, oz: number) => {
    let d = end, sum = 0;
    while (sum < oz) { sum += ozDay[bi].get(d) ?? 0; d = addDays(d, -1); if (d < start) break; }
    return addDays(d, 1);
  };
  const at5pm = (d: ISODate) => new Date(`${d}T21:00:00Z`);

  // Hourly shape for the recent days (4pm–11pm), so a tap's first day is shared fairly.
  for (const d of dateRange(addDays(today, -45), addDays(today, 1))) {
    const date = new Date(`${d}T00:00:00Z`);
    await db.hourlySale.deleteMany({ where: { date } });
    await db.hourlySale.createMany({ data: Array.from({ length: 24 }, (_, h) => ({ date, hour: h, netSales: h >= 12 && h < 23 ? (h >= 17 && h < 21 ? 420 : 180) : 0, orders: h >= 12 && h < 23 ? 20 : 0 })), skipDuplicates: true });
  }

  const spots = {
    "Walk-in": ["Back left", "Back right", "Door, low", "Middle stack"],
    "Keg cooler": ["Top shelf", "Bottom"],
  };
  const spotRows: { id: string; area: string; name: string }[] = [];
  for (const [area, names] of Object.entries(spots)) {
    let i = 0;
    for (const name of names) spotRows.push(await db.kegSpot.create({ data: { area, name, sort: i++ } }));
  }
  const accounts = await Promise.all(["Catskill Tap House", "The Avalon Lounge", "Hudson Wedding Co."].map((name, i) => db.kegAccount.create({ data: { name, kind: i === 2 ? "consumer" : "bar", contact: ["Jo Martin", "Sam Reyes", "Priya"][i], phone: `518-555-01${i}0` } })));

  const max = await db.user.findFirst({ where: { role: "MANAGER" } });
  const who = { userId: max?.id ?? null, userName: max?.name ?? "Max" };
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  let code = 0;
  const codes = new Set<string>();
  const mk = () => { let c; do c = newKegCode(rng(1000 + code++)); while (codes.has(c)); codes.add(c); return c; };

  // Kicked history: two past kegs per main beer, tapped and kicked before the current one went on.
  const LEFT = [0.12, 0.7, 0.45, 0.6, 0.3, 0.85];
  const tapDay = BEERS.map((_, bi) => backFrom(bi, today, (1 - LEFT[bi]) * 0.86 * (bi === 4 ? 660.5 : 1984)));
  for (const [bi, b] of beers.entries()) {
    if (bi > 2) continue;
    let end = addDays(tapDay[bi], -1);
    for (let k = 0; k < 2; k++) {
      const y = 0.72 + r() * 0.06; // backFrom overshoots by up to a day, landing ~0.8–0.9
      const begin = backFrom(bi, end, 1984 * y);
      const keg = await db.keg.create({ data: { code: mk(), sizeId: "half", status: "EMPTY", area: "Brewhouse", statusAt: at5pm(end) } });
      const tapped = new Date(`${begin}T21:00:00Z`), kicked = new Date(`${addDays(end, 1)}T03:30:00Z`);
      await db.kegFill.create({ data: { kegId: keg.id, beerId: b.id, filledOn: new Date(`${addDays(begin, -10)}T00:00:00Z`), tappedAt: tapped, tapLine: bi + 1, kickedAt: kicked } });
      await db.kegEvent.createMany({ data: [
        { kegId: keg.id, ...who, at: tapped, action: "TAPPED", toStatus: "ON_TAP", beerId: b.id, tapLine: bi + 1, toPlace: `Tap ${bi + 1}` },
        { kegId: keg.id, ...who, at: kicked, action: "KICKED", fromStatus: "ON_TAP", toStatus: "KICKED", beerId: b.id, fromPlace: `Tap ${bi + 1}`, toPlace: "Bar" },
        { kegId: keg.id, ...who, at: new Date(kicked.getTime() + 86_400_000), action: "CLEANED", toStatus: "EMPTY", toPlace: "Brewhouse" },
      ] });
      end = addDays(begin, -1);
    }
  }

  // On tap now: lines 1–6 (Golden Lager low, nothing behind it).
  const onTap = [0, 1, 2, 3, 4, 5].map((b) => ({ b, line: b + 1, hrs: (now.getTime() - new Date(`${tapDay[b]}T04:00:00Z`).getTime()) / 3_600_000 }));
  for (const t of onTap) {
    const keg = await db.keg.create({ data: { code: mk(), sizeId: t.b === 4 ? "sixtel" : "half", status: "ON_TAP", tapLine: t.line, area: "Bar", beerId: beers[t.b].id, statusAt: hoursAgo(t.hrs) } });
    const fill = await db.kegFill.create({ data: { kegId: keg.id, beerId: beers[t.b].id, filledOn: new Date(hoursAgo(t.hrs + 24 * 12).toISOString().slice(0, 10)), tappedAt: hoursAgo(t.hrs), tapLine: t.line } });
    await db.keg.update({ where: { id: keg.id }, data: { fillId: fill.id } });
    await db.kegEvent.create({ data: { kegId: keg.id, ...who, at: hoursAgo(t.hrs), action: "TAPPED", toStatus: "ON_TAP", beerId: beers[t.b].id, tapLine: t.line, fromPlace: "Walk-in · Back left", toPlace: `Tap ${t.line}` } });
  }

  // Full kegs in cold storage (none of Golden Lager), plus a couple just filled.
  const full: [number, string, string | null, number][] = [
    [1, "Walk-in", "Back left", 3], [1, "Walk-in", "Back left", 3], [1, "Walk-in", "Middle stack", 2],
    [2, "Walk-in", "Back right", 2], [2, "Walk-in", "Back right", 2],
    [3, "Keg cooler", "Bottom", 1],
    [4, "Keg cooler", "Top shelf", 1],
    [5, "Walk-in", "Door, low", 2], [5, "Walk-in", "Door, low", 2],
  ];
  let n = 0;
  for (const [b, area, spot, stack] of full) {
    const s = spotRows.find((x) => x.area === area && x.name === spot);
    const filledOn = addDays(today, -(6 + (n++ % 9)));
    const keg = await db.keg.create({ data: { code: mk(), sizeId: b === 4 ? "sixtel" : "half", status: "COLD", area, spotId: s?.id ?? null, spotNote: `stack ${stack}`, beerId: beers[b].id, statusAt: new Date(`${filledOn}T20:00:00Z`) } });
    const fill = await db.kegFill.create({ data: { kegId: keg.id, beerId: beers[b].id, filledOn: new Date(`${filledOn}T00:00:00Z`), batchCode: `${beers[b].name.slice(0, 2).toUpperCase()}-${filledOn.slice(5, 7)}${filledOn.slice(8)}` } });
    await db.keg.update({ where: { id: keg.id }, data: { fillId: fill.id } });
    await db.kegEvent.createMany({ data: [
      { kegId: keg.id, ...who, at: new Date(`${filledOn}T16:00:00Z`), action: "FILLED", toStatus: "FILLED", beerId: beers[b].id, toPlace: "Brewhouse" },
      { kegId: keg.id, ...who, at: new Date(`${filledOn}T20:00:00Z`), action: "STORED", fromStatus: "FILLED", toStatus: "COLD", beerId: beers[b].id, fromPlace: "Brewhouse", toPlace: `${area} · ${spot}` },
    ] });
  }
  for (const b of [2, 1]) {
    const keg = await db.keg.create({ data: { code: mk(), sizeId: "half", status: "FILLED", area: "Brewhouse", beerId: beers[b].id, statusAt: hoursAgo(5) } });
    const fill = await db.kegFill.create({ data: { kegId: keg.id, beerId: beers[b].id, filledOn: new Date(`${today}T00:00:00Z`) } });
    await db.keg.update({ where: { id: keg.id }, data: { fillId: fill.id } });
    await db.kegEvent.create({ data: { kegId: keg.id, ...who, at: hoursAgo(5), action: "FILLED", toStatus: "FILLED", beerId: beers[b].id, toPlace: "Brewhouse" } });
  }

  // Empties, kegs to clean, and kegs out at accounts.
  for (let i = 0; i < 8; i++) await db.keg.create({ data: { code: mk(), sizeId: i < 6 ? "half" : "sixtel", status: "EMPTY", area: "Walk-in", spotId: spotRows.find((x) => x.name === "Door, low")?.id, spotNote: "empties" } });
  for (let i = 0; i < 3; i++) await db.keg.create({ data: { code: mk(), sizeId: "half", status: "CLEANING", area: "Brewhouse" } });
  await db.keg.create({ data: { code: mk(), sizeId: "half", status: "KICKED", area: "Bar", beerId: beers[0].id, statusAt: hoursAgo(26) } });
  for (let i = 0; i < 4; i++) {
    const a = accounts[i % 2];
    const keg = await db.keg.create({ data: { code: mk(), sizeId: "half", status: "OUT", accountId: a.id, beerId: beers[i % 3].id, statusAt: hoursAgo(24 * (3 + i * 4)), owner: i === 3 ? "DEPOSIT" : "OURS", legacyCode: `SB-${1001 + i}` } });
    await db.kegEvent.create({ data: { kegId: keg.id, ...who, at: hoursAgo(24 * (3 + i * 4)), action: "OUT", toStatus: "OUT", accountId: a.id, beerId: beers[i % 3].id, toPlace: `Out at ${a.name}` } });
  }
}
