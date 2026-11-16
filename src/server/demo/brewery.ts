import type { PrismaClient } from "@prisma/client";
import { addDays, type ISODate } from "@/domain/dates";
import { STARTER_TANKS } from "@/domain/tankPlan";

/**
 * Brewery demo: Brew Manager's 11 tanks where they stand (back wall, front,
 * separate room), with brews in every stage: one past due to transfer, a
 * hazy on its dry-hop day, a sour marked conditioning in its fermenter, a
 * lager in a brite ready to package, two packaged (with keg and can counts,
 * one already in kegs), a lager split into a second fermenter (26-0xxB), and
 * three planned, two of which want the same fermenter for a while so the
 * schedule shows a clash, and one with a locked release. Uses the keg
 * demo's beers by name when they're there. Clears its own brews ("demo:"
 * keys) first; tanks are only made when there are none (existing tanks with
 * Brew Manager's names get their places if they have none).
 */

const D = (d: ISODate) => new Date(`${d}T00:00:00Z`);

export async function seedBrewery(db: PrismaClient, today: ISODate): Promise<void> {
  await db.brewBatch.deleteMany({ where: { sourceKey: { startsWith: "demo:" } } });
  if ((await db.tank.count()) === 0) {
    await db.tank.createMany({ data: STARTER_TANKS.map((t) => ({ ...t })) });
  } else {
    for (const t of STARTER_TANKS) await db.tank.updateMany({ where: { name: t.name, zone: null }, data: { zone: t.zone, layoutRow: t.layoutRow, layoutCol: t.layoutCol } });
  }
  const tanks = new Map((await db.tank.findMany()).map((t) => [t.name, t.id]));
  const beers = new Map((await db.beer.findMany({ select: { id: true, name: true } })).map((b) => [b.name, b.id]));
  const T = (n: number) => addDays(today, n);

  type Stay = [tank: string, start: number, end: number | null, planned?: boolean];
  type Brew = {
    key: string;
    beer: string;
    status: "PLANNED" | "FERMENTING" | "CONDITIONING" | "PACKAGED";
    bbl: number;
    on: number;
    stays: Stay[];
    profile?: string;
    og?: number;
    fg?: number;
    cost?: number;
    packaged?: number;
    notes?: string;
    dryHop?: number;
    tap?: number;
    fvMove?: number;
    locked?: string;
    half?: number;
    sixth?: number;
    cases?: number;
    co2?: number;
    splitOf?: string;
    history?: [day: number, kind: string, text: string][];
  };
  const brews: Brew[] = [
    { key: "marzen", beer: "Märzen", status: "PACKAGED", profile: "lager", bbl: 9, on: -70, stays: [["FV4", -70, -21], ["BBT3", -21, -18]], og: 1.056, fg: 1.013, cost: 905.2, packaged: -18, tap: -10, half: 12, sixth: 14, co2: 2.6, history: [[-21, "brite", "To brite: FV4 → BBT3 · 3.4 °P"], [-18, "package", "Packaged from BBT3 · 12 × ½ bbl, 14 × ⅙ bbl · 2.6 vols CO₂"]] },
    { key: "stout", beer: "Catskill Stout", status: "PACKAGED", profile: "pale", bbl: 7, on: -40, stays: [["FV2", -40, -26], ["BBT2", -26, -19]], og: 1.068, fg: 1.018, cost: 612.4, packaged: -19, tap: -12, half: 8, sixth: 10, cases: 6, co2: 2.2, notes: "Oat-heavy; ran the mash 10 minutes longer." },
    { key: "lager", beer: "Golden Lager", status: "CONDITIONING", profile: "lager", bbl: 7, on: -56, stays: [["FV1", -56, -35], ["FV5", -35, -7], ["BBT1", -7, null]], og: 1.048, fg: 1.009, cost: 701.85, tap: 4, fvMove: -35, history: [[-35, "transfer", "FV → FV transfer: FV1 → FV5 · 4.1 °P"], [-7, "brite", "To brite: FV5 → BBT1 · 2.3 °P"]] },
    { key: "pickle", beer: "Pickle Beer", status: "CONDITIONING", profile: "sour", bbl: 5, on: -36, stays: [["FV6", -36, 3]], og: 1.05, cost: 402.5, tap: 13, history: [[-2, "stage", "Conditioning in FV6 · 2.8 °P"]] },
    { key: "ipa", beer: "Subversive IPA", status: "FERMENTING", bbl: 7, on: -15, stays: [["FV1", -15, null]], og: 1.062, cost: 688.1, notes: "Dry hopped day 7." },
    { key: "nectar", beer: "New York Nectar", status: "FERMENTING", profile: "hazy", bbl: 9, on: -7, stays: [["FV3", -7, 13], ["BBT2", 13, 16, true]], og: 1.066, cost: 1180.0, dryHop: 0, tap: 23 },
    { key: "hoppy", beer: "Hoppy American Lager", status: "FERMENTING", profile: "lager", bbl: 5.5, on: -16, stays: [["FV2", -16, 33]], og: 1.04, cost: 510.0, fvMove: 5, tap: 44, notes: "Split batch with Golden Lime Lager: 9.5 bbl base, split at two weeks.", history: [[-2, "split", "Split 4 bbl into the lime lager in FV7"]] },
    { key: "lime", beer: "Golden Lime Lager", status: "FERMENTING", profile: "lager", bbl: 4, on: -16, stays: [["FV7", -2, 33]], og: 1.04, cost: 371.0, tap: 44, splitOf: "hoppy", notes: "25 lb whole calamansi in at the split.", history: [[-2, "split", "Split from the hoppy lager: 4 bbl into FV7"]] },
    { key: "lager2", beer: "Golden Lager", status: "PLANNED", profile: "lager", bbl: 9, on: 2, stays: [["FV4", 2, 51, true], ["BBT3", 51, 53, true]], fvMove: 23, tap: 62 },
    { key: "gose", beer: "Raspberry Gose", status: "PLANNED", profile: "sour", bbl: 5, on: 14, stays: [["FV6", 14, 50, true], ["BBT2", 50, 52, true]], tap: 63, locked: "Summer release party" },
    { key: "ipa2", beer: "Subversive IPA", status: "PLANNED", profile: "pale", bbl: 9, on: 9, stays: [["FV4", 9, 39, true], ["BBT1", 39, 42, true]], tap: 51 },
  ];
  // Codes in brew-day order, numbered within each year; a split takes its parent's code and a letter.
  const counters = new Map<string, number>();
  const codeOf = new Map<string, string>();
  for (const b of [...brews].filter((x) => !x.splitOf).sort((a, b) => a.on - b.on)) {
    const yy = T(b.on).slice(2, 4);
    const n = (counters.get(yy) ?? 30) + 1;
    counters.set(yy, n);
    codeOf.set(b.key, `${yy}-${String(n).padStart(3, "0")}`);
  }
  for (const b of brews) if (b.splitOf) codeOf.set(b.key, `${codeOf.get(b.splitOf)}B`);

  const idOf = new Map<string, string>();
  for (const b of brews) {
    if (b.stays.some(([t]) => !tanks.has(t))) continue; // someone's own tanks: leave them be
    if (b.splitOf && !idOf.has(b.splitOf)) continue;
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
    const readings = b.og ? [{ on: T(b.on), sg: b.og, kind: "og", note: null }, ...(b.fg ? [{ on: T(b.on + 12), sg: b.fg, kind: "fg", note: "Stable two days" }] : [{ on: T(Math.min(-1, b.on + 5)), sg: Math.round((b.og - 0.03) * 1000) / 1000, kind: "reading", note: null }])] : [];
    const created = await db.brewBatch.create({
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
        dryHopOn: b.dryHop != null ? D(T(b.dryHop)) : null,
        tapOn: b.tap != null ? D(T(b.tap)) : null,
        tapLocked: !!b.locked,
        lockedReason: b.locked ?? null,
        halfKegs: b.half ?? null,
        sixthKegs: b.sixth ?? null,
        cases: b.cases ?? null,
        co2Vols: b.co2 ?? null,
        splitFromId: b.splitOf ? idOf.get(b.splitOf)! : null,
        extra: {
          ...(b.profile ? { profile: b.profile } : {}),
          ...(b.fvMove != null ? { fvTransferOn: T(b.fvMove) } : {}),
          ...(readings.length ? { readings } : {}),
          ...(b.history ? { timeline: b.history.map(([d, kind, text]) => ({ on: T(d), kind, text })) } : {}),
        },
        stays: { create: b.stays.map(([tank, start, end, planned]) => ({ tankId: tanks.get(tank)!, start: D(T(start)), end: end == null ? null : D(T(end)), planned: !!planned })) },
      },
    });
    idOf.set(b.key, created.id);
  }
}
