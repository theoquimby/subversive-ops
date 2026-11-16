import "server-only";
import { Prisma } from "@prisma/client";
import { finishDefaults, newBrewLog, newerLog, readBrewLog, type BrewLog } from "@/domain/brewDay";
import { scaleQty, type BrewLineKind, type HopUse } from "@/domain/brewMath";
import { addDays, type ISODate } from "@/domain/dates";
import { DEFAULT_GRAVITY_UNIT, GRAVITY_UNIT_KEY, gravityUnitOf, type GravityUnit } from "@/domain/gravity";
import { nextBatchCode, stayIntervals } from "@/domain/tankPlan";
import { db, num } from "../db";
import { asDate, iso, loadPlan, readExtra, type GravityReading } from "./brewery";
import { markBrewed, packageBatch } from "./breweryWrite";
import { recordBrewUsage } from "./brewStock";
import { businessToday } from "./sales";

/**
 * Brew day: starting one (from a recipe, a planned brew or a tank), the log
 * written on the phone at each stage, finishing it into a fermenter, and the
 * printed brew sheet. Also where the brewery's gravity unit (°Plato or SG) is kept.
 */

export type Res = { ok: string } | { error: string };

// ---- Gravity unit ------------------------------------------------------------------------

/** The brewery reads and types gravity in °Plato unless it chose SG. */
export async function gravityUnit(): Promise<GravityUnit> {
  const s = await db.setting.findUnique({ where: { key: GRAVITY_UNIT_KEY } }).catch(() => null);
  return s ? gravityUnitOf(s.value) : DEFAULT_GRAVITY_UNIT;
}

export async function setGravityUnit(unit: GravityUnit): Promise<void> {
  await db.setting.upsert({ where: { key: GRAVITY_UNIT_KEY }, create: { key: GRAVITY_UNIT_KEY, value: unit }, update: { value: unit } });
}

// ---- What the brew day shows -------------------------------------------------------------

export interface BrewDayLine {
  kind: BrewLineKind;
  name: string;
  /** Scaled to this brew's volume */
  qty: number;
  unit: string;
  use: HopUse | null;
  minutes: number | null;
  attenuationPct: number | null;
}

export interface BrewDayRecipe {
  id: string;
  name: string;
  style: string | null;
  batchBbl: number;
  boilMinutes: number;
  mashMinutes: number | null;
  strikeF: number | null;
  mashF: number | null;
  targetMt: number | null;
  targetBk: number | null;
  targetKo: number | null;
  targetOg: number | null;
  targetFg: number | null;
  profile: string | null;
  dryHopDay: number | null;
  tapDay: number | null;
  fermentDays: number;
  conditionDays: number;
  notes: string | null;
  lines: BrewDayLine[];
}

export interface BrewDayData {
  today: ISODate;
  unit: GravityUnit;
  batch: {
    id: string;
    code: string;
    name: string;
    status: string;
    plannedOn: ISODate | null;
    brewedOn: ISODate | null;
    bbl: number | null;
    og: number | null;
    fg: number | null;
    notes: string | null;
    /** Tanks it has been in or is planned for, in order */
    tanks: { name: string; start: ISODate; end: ISODate | null; planned: boolean }[];
    readings: GravityReading[];
  };
  recipe: BrewDayRecipe | null;
  log: BrewLog | null;
  /** What finishing fills in */
  finish: { og: number | null; bbl: number | null; tankId: string | null };
  fermenters: { id: string; name: string; capacityBbl: number; busyWith: string | null }[];
}

const batchInclude = {
  recipe: { include: { lines: { orderBy: { sort: "asc" } } } },
  beer: { select: { name: true } },
  stays: { orderBy: { start: "asc" }, include: { tank: { select: { name: true } } } },
} satisfies Prisma.BrewBatchInclude;

type BatchRow = Prisma.BrewBatchGetPayload<{ include: typeof batchInclude }>;

function recipeView(r: NonNullable<BatchRow["recipe"]>, bbl: number | null): BrewDayRecipe {
  const batchBbl = r.batchBbl.toNumber();
  return {
    id: r.id,
    name: r.name,
    style: r.style,
    batchBbl,
    boilMinutes: r.boilMinutes,
    mashMinutes: r.mashMinutes,
    strikeF: num(r.strikeF),
    mashF: num(r.mashF),
    targetMt: num(r.targetMt),
    targetBk: num(r.targetBk),
    targetKo: num(r.targetKo),
    targetOg: num(r.targetOg),
    targetFg: num(r.targetFg),
    profile: r.profile,
    dryHopDay: r.dryHopDay,
    tapDay: r.tapDay,
    fermentDays: r.fermentDays,
    conditionDays: r.conditionDays,
    notes: r.notes,
    lines: r.lines.map((l) => ({
      kind: l.kind as BrewLineKind,
      name: l.name,
      qty: bbl ? scaleQty(l.qty.toNumber(), batchBbl, bbl) : l.qty.toNumber(),
      unit: l.unit,
      use: (l.use as HopUse | null) ?? null,
      minutes: l.minutes,
      attenuationPct: num(l.attenuationPct),
    })),
  };
}

export async function brewDayData(batchId: string): Promise<BrewDayData | null> {
  const today = businessToday();
  const [b, unit, plan] = await Promise.all([db.brewBatch.findUnique({ where: { id: batchId }, include: batchInclude }), gravityUnit(), loadPlan(today, 30)]);
  if (!b) return null;
  const bbl = num(b.bbl);
  const log = readBrewLog(b.brewLog);
  const current = stayIntervals(plan.stays, plan.tanks, plan.planBatches, today).filter((i) => i.current && i.batchId !== b.id);
  const nameOf = new Map(plan.batches.map((x) => [x.id, `${x.code} ${x.name}`]));
  const fermenters = plan.tanks
    .filter((t) => t.active && t.kind === "FERMENTER")
    .map((t) => ({ id: t.id, name: t.name, capacityBbl: t.capacityBbl, busyWith: nameOf.get(current.find((c) => c.tankId === t.id)?.batchId ?? "") ?? null }));
  const firstPlanned = b.stays.find((s) => s.planned);
  const recipe = b.recipe ? recipeView(b.recipe, bbl) : null;
  const f = finishDefaults(log, { bbl: bbl ?? recipe?.batchBbl ?? null });
  return {
    today,
    unit,
    batch: {
      id: b.id,
      code: b.code,
      name: b.beer?.name ?? b.recipe?.name ?? b.code,
      status: b.status,
      plannedOn: iso(b.plannedOn),
      brewedOn: iso(b.brewedOn),
      bbl,
      og: num(b.og),
      fg: num(b.fg),
      notes: b.notes,
      tanks: b.stays.map((s) => ({ name: s.tank.name, start: iso(s.start)!, end: iso(s.end), planned: s.planned })),
      readings: readExtra(b.extra).readings,
    },
    recipe,
    log,
    finish: { og: f.og ?? num(b.og), bbl: f.bbl, tankId: firstPlanned?.tankId ?? null },
    fermenters,
  };
}

// ---- Starting ----------------------------------------------------------------------------

const asJson = (log: BrewLog) => log as unknown as Prisma.InputJsonValue;

/**
 * Open a brew day. A planned brew gets a log and stays what it is. From a
 * recipe (or a beer's live recipe): an unfinished brew day of that recipe is
 * resumed; else a brew of it planned within a week of today is started; else a
 * new planned brew is made for today (in the chosen fermenter, if one was picked).
 */
export async function startBrewDay(i: { batchId?: string | null; recipeId?: string | null; beerId?: string | null; tankId?: string | null; bbl?: number | null }): Promise<{ batchId: string } | { error: string }> {
  const now = new Date();
  if (i.batchId) {
    const b = await db.brewBatch.findUnique({ where: { id: i.batchId }, select: { id: true, status: true, brewLog: true } });
    if (!b) return { error: "That brew is gone." };
    if (b.status === "DUMPED") return { error: "That brew was dumped." };
    if (!readBrewLog(b.brewLog)) await db.brewBatch.update({ where: { id: b.id }, data: { brewLog: asJson(newBrewLog(now)) } });
    return { batchId: b.id };
  }
  const recipe = i.recipeId
    ? await db.brewRecipe.findUnique({ where: { id: i.recipeId }, select: { id: true, name: true, beerId: true, batchBbl: true, fermentDays: true } })
    : i.beerId
      ? await db.brewRecipe.findFirst({ where: { beerId: i.beerId, status: "live" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, beerId: true, batchBbl: true, fermentDays: true } })
      : null;
  if (!recipe && !i.beerId) return { error: "Pick a recipe to brew." };
  const today = businessToday();

  if (recipe) {
    const planned = await db.brewBatch.findMany({ where: { recipeId: recipe.id, status: "PLANNED" }, select: { id: true, brewLog: true, plannedOn: true }, orderBy: { plannedOn: "asc" } });
    const open = planned.find((p) => {
      const l = readBrewLog(p.brewLog);
      return l && !l.finishedAt;
    });
    if (open) return { batchId: open.id };
    const near = planned.find((p) => !readBrewLog(p.brewLog) && p.plannedOn && Math.abs(Date.parse(iso(p.plannedOn)!) - Date.parse(today)) <= 7 * 86400_000);
    if (near) {
      await db.brewBatch.update({ where: { id: near.id }, data: { brewLog: asJson(newBrewLog(now)) } });
      return { batchId: near.id };
    }
  }

  const bbl = i.bbl && i.bbl > 0 ? i.bbl : (num(recipe?.batchBbl) ?? 7);
  let tank: { id: string; name: string } | null = null;
  if (i.tankId) {
    tank = await db.tank.findUnique({ where: { id: i.tankId }, select: { id: true, name: true } });
    if (!tank) return { error: "That tank is gone." };
  }
  const codes = await db.brewBatch.findMany({ where: { code: { startsWith: `${today.slice(2, 4)}-` } }, select: { code: true } });
  const code = nextBatchCode(today, codes.map((c) => c.code));
  const created = await db.$transaction(async (tx) => {
    const b = await tx.brewBatch.create({
      data: { code, recipeId: recipe?.id ?? null, beerId: recipe?.beerId ?? i.beerId ?? null, status: "PLANNED", plannedOn: asDate(today), bbl: new Prisma.Decimal(bbl.toFixed(2)), brewLog: asJson(newBrewLog(now)) },
    });
    if (tank) await tx.tankStay.create({ data: { tankId: tank.id, batchId: b.id, start: asDate(today), end: asDate(addDays(today, Math.max(1, recipe?.fermentDays ?? 14))), planned: true } });
    return b;
  });
  return { batchId: created.id };
}

// ---- Saving the log ----------------------------------------------------------------------

const D = (n: number, places: number) => new Prisma.Decimal(n.toFixed(places));

/**
 * Save the log sent from the phone. When the copy here was changed later (on
 * another phone), that one is kept and sent back. What packaging produced and
 * the final gravity also go on the brew itself.
 */
export async function saveBrewLog(batchId: string, sent: unknown): Promise<{ log: BrewLog; kept: "sent" | "stored" } | { error: string }> {
  const log = readBrewLog(sent);
  if (!log) return { error: "Nothing to save." };
  const b = await db.brewBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true, brewLog: true } });
  if (!b) return { error: "That brew is gone." };
  if (b.status === "DUMPED") return { error: "That brew was dumped." };
  const stored = readBrewLog(b.brewLog);
  const keep = newerLog(log, stored)!;
  if (stored && keep === stored && stored.savedAt !== log.savedAt) return { log: stored, kept: "stored" };
  // A finished brew day stays finished, whatever a stale phone says.
  if (stored?.finishedAt && !keep.finishedAt) keep.finishedAt = stored.finishedAt;
  const p = keep.values.package;
  const kegs = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : undefined);
  await db.brewBatch.update({
    where: { id: batchId },
    data: {
      brewLog: asJson(keep),
      ...(typeof p.fgSg === "number" ? { fg: D(p.fgSg, 4) } : {}),
      ...(kegs("halfKegs") != null ? { halfKegs: kegs("halfKegs") } : {}),
      ...(kegs("sixthKegs") != null ? { sixthKegs: kegs("sixthKegs") } : {}),
      ...(kegs("cases") != null ? { cases: kegs("cases") } : {}),
      ...(typeof p.co2Vols === "number" && p.co2Vols < 10 ? { co2Vols: D(p.co2Vols, 2) } : {}),
    },
  });
  return { log: keep, kept: "sent" };
}

// ---- Finishing ---------------------------------------------------------------------------

/** Brewed: into the fermenter (as the tanks page's "Mark brewed" does), then what it used comes out of stock. */
export async function finishBrewDay(batchId: string, i: { tankId: string | null; brewedOn: ISODate; bbl: number | null; og: number | null }): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId }, select: { status: true, brewLog: true } });
  if (!b) return { error: "That brew is gone." };
  if (b.status !== "PLANNED") return { error: "This brew day is already finished." };
  const res = await markBrewed(batchId, { brewedOn: i.brewedOn, bbl: i.bbl, og: i.og, tankId: i.tankId });
  if ("error" in res) return res;
  const log = readBrewLog(b.brewLog) ?? newBrewLog(new Date());
  const now = new Date().toISOString();
  log.finishedAt = now;
  log.savedAt = now;
  log.stage = "ferment";
  await db.brewBatch.update({ where: { id: batchId }, data: { brewLog: asJson(log) } });
  try {
    await recordBrewUsage(batchId);
  } catch (e) {
    console.error("recordBrewUsage failed", e);
    return { ok: `${res.ok} Brewing stock couldn't be updated; check it on the stock page.` };
  }
  return res;
}

/** Packaged from the brew day's packaging tab: as the tanks page does it (frees the tank, makes the keg batch). */
export async function packageFromBrewDay(batchId: string, on: ISODate): Promise<Res> {
  return packageBatch(batchId, { on });
}

// ---- Brew days to resume, and planned brews to start ---------------------------------------

export interface BrewDayListItem {
  id: string;
  code: string;
  name: string;
  recipeName: string | null;
  plannedOn: ISODate | null;
  bbl: number | null;
  startedAt: string | null;
  stage: string | null;
  tank: string | null;
}

export async function brewDayLists(): Promise<{ today: ISODate; inProgress: BrewDayListItem[]; planned: BrewDayListItem[]; recipes: { id: string; name: string; status: string; batchBbl: number }[]; fermenters: { id: string; name: string }[] }> {
  const today = businessToday();
  const [rows, recipes, fermenters] = await Promise.all([
    db.brewBatch.findMany({
      where: { status: "PLANNED" },
      include: { beer: { select: { name: true } }, recipe: { select: { name: true } }, stays: { orderBy: { start: "asc" }, take: 1, include: { tank: { select: { name: true } } } } },
      orderBy: [{ plannedOn: "asc" }, { code: "asc" }],
    }),
    db.brewRecipe.findMany({ where: { status: { not: "archived" } }, orderBy: [{ status: "desc" }, { name: "asc" }], select: { id: true, name: true, status: true, batchBbl: true } }),
    db.tank.findMany({ where: { active: true, kind: "FERMENTER" }, orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  const items = rows.map((b) => {
    const log = readBrewLog(b.brewLog);
    return {
      log,
      item: {
        id: b.id,
        code: b.code,
        name: b.beer?.name ?? b.recipe?.name ?? b.code,
        recipeName: b.recipe?.name ?? null,
        plannedOn: iso(b.plannedOn),
        bbl: num(b.bbl),
        startedAt: log?.startedAt ?? null,
        stage: log?.stage ?? null,
        tank: b.stays[0]?.tank.name ?? null,
      },
    };
  });
  const horizon = addDays(today, 21);
  return {
    today,
    inProgress: items.filter((x) => x.log && !x.log.finishedAt).map((x) => x.item),
    planned: items.filter((x) => !x.log && x.item.plannedOn != null && x.item.plannedOn <= horizon).map((x) => x.item),
    recipes: recipes.map((r) => ({ id: r.id, name: r.name, status: r.status, batchBbl: r.batchBbl.toNumber() })),
    fermenters,
  };
}

// ---- The printed brew sheet ----------------------------------------------------------------

/** Everything the printed sheet needs; the same data as the brew day. */
export const brewSheetData = brewDayData;
