import type { PrismaClient } from "@prisma/client";
import { addDays, type ISODate } from "@/domain/dates";

/**
 * Brewery demo: four fermenters (two 7 bbl, two 15 bbl) and two brite
 * tanks, with brews in every stage: one past due to transfer, one fermenting,
 * one conditioning that's ready to package, two packaged (one already in
 * kegs), and three planned, two of which want the same fermenter for a
 * couple of days so the schedule shows a clash. Uses the keg demo's beers by
 * name when they're there. Clears its own brews ("demo:" keys) first; the
 * tanks are only made when there are none.
 */

const D = (d: ISODate) => new Date(`${d}T00:00:00Z`);

export async function seedBrewery(db: PrismaClient, today: ISODate): Promise<void> {
  await db.brewBatch.deleteMany({ where: { sourceKey: { startsWith: "demo:" } } });
  if ((await db.tank.count()) === 0) {
    await db.tank.createMany({
      data: [
        { name: "FV1", kind: "FERMENTER", capacityBbl: 7, sort: 1 },
        { name: "FV2", kind: "FERMENTER", capacityBbl: 7, sort: 2 },
        { name: "FV3", kind: "FERMENTER", capacityBbl: 15, sort: 3 },
        { name: "FV4", kind: "FERMENTER", capacityBbl: 15, sort: 4 },
        { name: "BT1", kind: "BRITE", capacityBbl: 15, sort: 5 },
        { name: "BT2", kind: "BRITE", capacityBbl: 7, sort: 6 },
      ],
    });
  }
  const tanks = new Map((await db.tank.findMany()).map((t) => [t.name, t.id]));
  const beers = new Map((await db.beer.findMany({ select: { id: true, name: true } })).map((b) => [b.name, b.id]));
  const T = (n: number) => addDays(today, n);

  type Stay = [tank: string, start: number, end: number | null, planned?: boolean];
  type Brew = { key: string; beer: string; status: "PLANNED" | "FERMENTING" | "CONDITIONING" | "PACKAGED"; bbl: number; on: number; stays: Stay[]; og?: number; fg?: number; cost?: number; packaged?: number; notes?: string };
  const brews: Brew[] = [
    { key: "marzen", beer: "Märzen", status: "PACKAGED", bbl: 15, on: -70, stays: [["FV4", -70, -49], ["BT1", -49, -42]], og: 1.056, fg: 1.013, cost: 905.2, packaged: -42 },
    { key: "stout", beer: "Catskill Stout", status: "PACKAGED", bbl: 7, on: -40, stays: [["FV2", -40, -26], ["BT2", -26, -19]], og: 1.068, fg: 1.018, cost: 612.4, packaged: -19, notes: "Oat-heavy; ran the mash 10 minutes longer." },
    { key: "lager", beer: "Golden Lager", status: "CONDITIONING", bbl: 15, on: -28, stays: [["FV4", -28, -7], ["BT1", -7, null]], og: 1.048, fg: 1.009, cost: 701.85 },
    { key: "ipa", beer: "Subversive IPA", status: "FERMENTING", bbl: 7, on: -15, stays: [["FV1", -15, null]], og: 1.062, cost: 688.1, notes: "Dry hopped day 7." },
    { key: "nectar", beer: "New York Nectar", status: "FERMENTING", bbl: 15, on: -6, stays: [["FV3", -6, null], ["BT1", 8, 15, true]], og: 1.066, cost: 1180.0 },
    { key: "lager2", beer: "Golden Lager", status: "PLANNED", bbl: 7, on: 2, stays: [["FV2", 2, 16, true], ["BT2", 16, 23, true]] },
    { key: "gose", beer: "Raspberry Gose", status: "PLANNED", bbl: 7, on: 14, stays: [["FV2", 14, 28, true], ["BT2", 28, 35, true]] },
    { key: "ipa2", beer: "Subversive IPA", status: "PLANNED", bbl: 15, on: 9, stays: [["FV4", 9, 23, true], ["BT1", 23, 30, true]] },
  ];
  // Codes in brew-day order, numbered within each year.
  const counters = new Map<string, number>();
  const ordered = [...brews].sort((a, b) => a.on - b.on);
  const codeOf = new Map<string, string>();
  for (const b of ordered) {
    const yy = T(b.on).slice(2, 4);
    const n = (counters.get(yy) ?? 30) + 1;
    counters.set(yy, n);
    codeOf.set(b.key, `${yy}-${String(n).padStart(3, "0")}`);
  }

  for (const b of brews) {
    if (b.stays.some(([t]) => !tanks.has(t))) continue; // someone's own tanks: leave them be
    const code = codeOf.get(b.key)!;
    const beerId = beers.get(b.beer) ?? null;
    let kegBatchId: string | null = null;
    if (b.status === "PACKAGED") {
      const kb = await db.kegBatch.upsert({
        where: { code },
        create: { code, beerId, brewedOn: D(T(b.on)), packagedOn: D(T(b.packaged!)) },
        update: { beerId, brewedOn: D(T(b.on)), packagedOn: D(T(b.packaged!)) },
      });
      kegBatchId = kb.id;
      // The stout's full kegs in the keg demo were filled from this brew.
      if (b.key === "stout" && beerId) await db.kegFill.updateMany({ where: { beerId, kickedAt: null, tappedAt: null }, data: { batchId: kb.id, batchCode: code } });
    }
    await db.brewBatch.create({
      data: {
        code,
        sourceKey: `demo:${b.key}`,
        beerId,
        status: b.status,
        plannedOn: b.status === "PLANNED" ? D(T(b.on)) : null,
        brewedOn: b.status === "PLANNED" ? null : D(T(b.on)),
        packagedOn: b.packaged != null ? D(T(b.packaged)) : null,
        bbl: b.bbl,
        og: b.og ?? null,
        fg: b.fg ?? null,
        cost: b.cost ?? null,
        notes: b.notes ?? null,
        kegBatchId,
        extra: b.og ? { readings: [{ on: T(b.on), sg: b.og, kind: "og", note: null }, ...(b.fg ? [{ on: T(b.on + 12), sg: b.fg, kind: "fg", note: "Stable two days" }] : [{ on: T(Math.min(-1, b.on + 5)), sg: Math.round((b.og - 0.03) * 1000) / 1000, kind: "reading", note: null }])] } : undefined,
        stays: { create: b.stays.map(([tank, start, end, planned]) => ({ tankId: tanks.get(tank)!, start: D(T(start)), end: end == null ? null : D(T(end)), planned: !!planned })) },
      },
    });
  }
}
