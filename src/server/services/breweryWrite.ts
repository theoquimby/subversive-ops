import "server-only";
import type { Prisma } from "@prisma/client";
import { addDays, daysBetween, type ISODate } from "@/domain/dates";
import { nextBatchCode, planBrew, stayIntervals, tooSmall, type BrewProposal, type TankKind } from "@/domain/tankPlan";
import { db, num } from "../db";
import { asDate, DEFAULT_CONDITION_KEY, DEFAULT_FERMENT_KEY, breweryDefaults, iso, loadPlan, readExtra, type GravityReading } from "./brewery";
import { brewCostFor } from "./brewCost";
import { businessToday } from "./sales";

/**
 * Brewery writes: tanks and defaults, planning brews onto the schedule,
 * brewing, transfers, packaging (which makes the keg batch kegs are filled
 * from), gravity, dumping and editing a stay's dates. Each returns a plain
 * sentence to show, or `{ error }`.
 */

export type Res = { ok: string } | { error: string };

const put = (key: string, value: string) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
const bblText = (n: number) => `${Number(n.toFixed(2))} bbl`;
const md = (d: ISODate) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(asDate(d));

// ---- Setup ---------------------------------------------------------------------------------------

export async function saveBreweryDefaults(fermentDays: number, conditionDays: number) {
  await Promise.all([put(DEFAULT_FERMENT_KEY, String(fermentDays)), put(DEFAULT_CONDITION_KEY, String(conditionDays))]);
}

export async function addTank(name: string, kind: TankKind, capacityBbl: number): Promise<Res> {
  if (await db.tank.findUnique({ where: { name } })) return { error: `There is already a tank called ${name}.` };
  const max = await db.tank.aggregate({ _max: { sort: true } });
  await db.tank.create({ data: { name, kind, capacityBbl, sort: (max._max.sort ?? 0) + 1 } });
  return { ok: `Added ${name}.` };
}

export type TankField = "name" | "kind" | "capacityBbl" | "sort" | "active" | "notes";

/** The brew in a tank right now, if any (its latest actual stay while it's fermenting or conditioning). */
async function brewInTank(tankId: string, today = businessToday()) {
  const { tanks, planBatches, stays, batches } = await loadPlan(today, 30);
  const cur = stayIntervals(stays, tanks, planBatches, today).find((i) => i.tankId === tankId && i.current);
  return cur ? batches.find((b) => b.id === cur.batchId) ?? null : null;
}

export async function setTankField(id: string, field: TankField, raw: string): Promise<Res> {
  const v = raw.trim();
  const t = await db.tank.findUnique({ where: { id } });
  if (!t) return { error: "That tank is gone." };
  switch (field) {
    case "name": {
      if (!v) return { error: "Give it a name" };
      const other = await db.tank.findUnique({ where: { name: v } });
      if (other && other.id !== id) return { error: "Another tank has that name" };
      await db.tank.update({ where: { id }, data: { name: v.slice(0, 40) } });
      break;
    }
    case "kind":
      if (!["FERMENTER", "BRITE", "OTHER"].includes(v)) return { error: "Pick a kind" };
      await db.tank.update({ where: { id }, data: { kind: v as TankKind } });
      break;
    case "capacityBbl": {
      const n = Number(v.replace(/bbl/i, "").trim());
      if (!Number.isFinite(n) || n <= 0 || n > 1000) return { error: "Barrels, like 7 or 15" };
      await db.tank.update({ where: { id }, data: { capacityBbl: n } });
      break;
    }
    case "sort": {
      const n = Number(v);
      if (!Number.isInteger(n)) return { error: "A whole number" };
      await db.tank.update({ where: { id }, data: { sort: n } });
      break;
    }
    case "active": {
      const on = v === "yes";
      if (!on) {
        const b = await brewInTank(id);
        if (b) return { error: `${b.code} ${b.name} is in it. Move or package it first.` };
      }
      await db.tank.update({ where: { id }, data: { active: on } });
      break;
    }
    case "notes":
      await db.tank.update({ where: { id }, data: { notes: v.slice(0, 500) || null } });
      break;
  }
  return { ok: "Saved" };
}

export async function deleteTank(id: string): Promise<Res> {
  const stays = await db.tankStay.count({ where: { tankId: id } });
  if (stays) return { error: "It has brews in its history. Set it to not in use instead." };
  await db.tank.delete({ where: { id } }).catch(() => undefined);
  return { ok: "Tank deleted." };
}

// ---- What a brew is ------------------------------------------------------------------------------

/** The recipe and beer for a pick (a recipe, or a beer and its live recipe), and the days it spends in tanks. */
async function resolveBrew(recipeId: string | null, beerId: string | null) {
  const defaults = await breweryDefaults();
  const recipe = recipeId
    ? await db.brewRecipe.findUnique({ where: { id: recipeId }, select: { id: true, name: true, beerId: true, batchBbl: true, fermentDays: true, conditionDays: true } })
    : beerId
      ? await db.brewRecipe.findFirst({ where: { beerId, status: "live" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, beerId: true, batchBbl: true, fermentDays: true, conditionDays: true } })
      : null;
  const beer = (recipe?.beerId ?? beerId) ? await db.beer.findUnique({ where: { id: (recipe?.beerId ?? beerId)! }, select: { id: true, name: true } }) : null;
  return {
    recipeId: recipe?.id ?? null,
    beerId: beer?.id ?? null,
    name: beer?.name ?? recipe?.name ?? "the brew",
    fermentDays: recipe?.fermentDays ?? defaults.fermentDays,
    conditionDays: recipe?.conditionDays ?? defaults.conditionDays,
    batchBbl: num(recipe?.batchBbl) ?? null,
  };
}

async function newCode(on: ISODate, typed: string | null | undefined): Promise<{ code: string } | { error: string }> {
  const t = typed?.trim();
  if (t) {
    if (await db.brewBatch.findUnique({ where: { code: t } })) return { error: `Batch code ${t} is already used.` };
    return { code: t.slice(0, 40) };
  }
  const yy = on.slice(2, 4);
  const codes = await db.brewBatch.findMany({ where: { code: { startsWith: `${yy}-` } }, select: { code: true } });
  return { code: nextBatchCode(on, codes.map((c) => c.code)) };
}

/** Freeze the ingredient cost when a brew is brewed (prices change later). */
async function frozenCost(recipeId: string | null, bbl: number | null) {
  if (!recipeId || !bbl) return { cost: null, unpriced: null };
  const c = await brewCostFor(recipeId, bbl).catch(() => null);
  return c ? { cost: Math.round(c.total * 100) / 100, unpriced: c.unpricedLines } : { cost: null, unpriced: null };
}

const extraWith = (extra: unknown, patch: Record<string, unknown>) => ({ ...((extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>), ...patch }) as Prisma.InputJsonObject;

// ---- Planning brews ------------------------------------------------------------------------------

export interface ProposeInput {
  brewOn: ISODate;
  bbl: number;
  recipeId: string | null;
  beerId: string | null;
  /** Only this fermenter. */
  fermenterId?: string | null;
  /** Leave this brew's own stays out (when moving it). */
  exceptBatchId?: string | null;
}

/** Where a brew would go, without saving anything. */
export async function proposeBrew(i: ProposeInput): Promise<{ proposal: BrewProposal; fermentDays: number; conditionDays: number; name: string }> {
  const today = businessToday();
  const [brew, plan] = await Promise.all([resolveBrew(i.recipeId, i.beerId), loadPlan(today, 30)]);
  const busy = stayIntervals(plan.stays, plan.tanks, plan.planBatches, today, { exceptBatchId: i.exceptBatchId ?? undefined }).map((x) => ({ tankId: x.tankId, start: x.start, end: x.end }));
  const tanks = i.fermenterId ? plan.tanks.filter((t) => t.kind !== "FERMENTER" || t.id === i.fermenterId) : plan.tanks;
  const proposal = planBrew({ brewOn: i.brewOn, bbl: i.bbl, fermentDays: brew.fermentDays, conditionDays: brew.conditionDays, tanks, busy });
  return { proposal, fermentDays: brew.fermentDays, conditionDays: brew.conditionDays, name: brew.name };
}

const stayRows = (p: Extract<BrewProposal, { ok: true }>, batchId: string) => [
  { tankId: p.fermenter.tankId, batchId, start: asDate(p.fermenter.start), end: asDate(p.fermenter.end), planned: true },
  ...(p.brite ? [{ tankId: p.brite.tankId, batchId, start: asDate(p.brite.start), end: asDate(p.brite.end), planned: true }] : []),
];

const proposalSentence = (p: Extract<BrewProposal, { ok: true }>) =>
  `${p.fermenter.tankName} from ${md(p.fermenter.start)}${p.brite ? `, ${p.brite.tankName} from ${md(p.brite.start)}` : ""}, ready to package ${md(p.packageOn)}`;

export async function planNewBrew(i: { recipeId: string | null; beerId: string | null; brewOn: ISODate; bbl: number; code?: string | null; fermenterId?: string | null; notes?: string | null }): Promise<Res> {
  const { proposal: p, name } = await proposeBrew(i);
  if (!p.ok) return { error: p.reason };
  const code = await newCode(i.brewOn, i.code);
  if ("error" in code) return code;
  const brew = await resolveBrew(i.recipeId, i.beerId);
  await db.$transaction(async (tx) => {
    const b = await tx.brewBatch.create({ data: { code: code.code, recipeId: brew.recipeId, beerId: brew.beerId, status: "PLANNED", plannedOn: asDate(i.brewOn), bbl: i.bbl, notes: i.notes?.trim() || null } });
    await tx.tankStay.createMany({ data: stayRows(p, b.id) });
  });
  return { ok: `Planned ${code.code} ${name}: ${proposalSentence(p)}.` };
}

/** New brew day (and size or fermenter): works out the tanks again. */
export async function movePlannedBrew(batchId: string, i: { brewOn: ISODate; bbl?: number | null; fermenterId?: string | null }): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId } });
  if (!b || b.status !== "PLANNED") return { error: "Only a planned brew can be moved." };
  const bbl = i.bbl ?? num(b.bbl) ?? 7;
  const { proposal: p } = await proposeBrew({ brewOn: i.brewOn, bbl, recipeId: b.recipeId, beerId: b.beerId, fermenterId: i.fermenterId, exceptBatchId: b.id });
  if (!p.ok) return { error: p.reason };
  await db.$transaction(async (tx) => {
    await tx.tankStay.deleteMany({ where: { batchId } });
    await tx.tankStay.createMany({ data: stayRows(p, batchId) });
    await tx.brewBatch.update({ where: { id: batchId }, data: { plannedOn: asDate(i.brewOn), bbl } });
  });
  return { ok: `Moved ${b.code} to ${md(i.brewOn)}: ${proposalSentence(p)}.` };
}

export async function cancelPlannedBrew(batchId: string): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId } });
  if (!b || b.status !== "PLANNED") return { error: "Only a planned brew can be cancelled. Dump a brew that's in a tank." };
  await db.brewBatch.delete({ where: { id: batchId } });
  return { ok: `Cancelled ${b.code}. Its tanks are free again.` };
}

// ---- Brewing -------------------------------------------------------------------------------------

/** Brewed straight into a tank (not planned first). Pencils in a brite for when fermenting is done if one is free. */
export async function brewIntoTank(i: { tankId: string; recipeId: string | null; beerId: string | null; brewedOn: ISODate; bbl: number; code?: string | null; og?: number | null }): Promise<Res> {
  const tank = await db.tank.findUnique({ where: { id: i.tankId } });
  if (!tank || !tank.active) return { error: "That tank isn't in use." };
  if (tooSmall({ capacityBbl: num(tank.capacityBbl) ?? 0 }, { bbl: i.bbl })) return { error: `${tank.name} holds ${bblText(num(tank.capacityBbl) ?? 0)}; this brew is ${bblText(i.bbl)}.` };
  const busy = await brewInTank(tank.id);
  if (busy) return { error: `${tank.name} still has ${busy.code} ${busy.name} in it. Transfer or package it first.` };
  if (!i.recipeId && !i.beerId) return { error: "Pick a recipe or a beer." };
  const brew = await resolveBrew(i.recipeId, i.beerId);
  const code = await newCode(i.brewedOn, i.code);
  if ("error" in code) return code;
  const { cost, unpriced } = await frozenCost(brew.recipeId, i.bbl);
  // A brite for when fermenting is done, if one is free that day.
  const today = businessToday();
  const plan = await loadPlan(today, 30);
  const transfer = addDays(i.brewedOn, brew.fermentDays);
  const out = addDays(transfer, Math.max(1, brew.conditionDays));
  const iv = stayIntervals(plan.stays, plan.tanks, plan.planBatches, today);
  const brite = brew.conditionDays > 0 ? plan.tanks.filter((t) => t.active && t.kind === "BRITE" && !tooSmall(t, { bbl: i.bbl })).sort((a, b) => a.sort - b.sort).find((t) => !iv.some((x) => x.tankId === t.id && x.start < out && transfer < x.end)) : undefined;
  await db.$transaction(async (tx) => {
    const b = await tx.brewBatch.create({
      data: { code: code.code, recipeId: brew.recipeId, beerId: brew.beerId, status: "FERMENTING", brewedOn: asDate(i.brewedOn), bbl: i.bbl, og: i.og ?? null, cost, extra: unpriced != null ? { unpricedLines: unpriced } : undefined },
    });
    await tx.tankStay.create({ data: { tankId: tank.id, batchId: b.id, start: asDate(i.brewedOn), end: null, planned: false } });
    if (brite) await tx.tankStay.create({ data: { tankId: brite.id, batchId: b.id, start: asDate(transfer), end: asDate(out), planned: true } });
  });
  return { ok: `${code.code} ${brew.name} is in ${tank.name}.${brite ? ` ${brite.name} is pencilled in from ${md(transfer)}.` : ""}${cost == null ? " Cost not known yet." : ""}` };
}

/** A planned brew was brewed: it goes into its fermenter (the plan's later tanks move by the same number of days). */
export async function markBrewed(batchId: string, i: { brewedOn: ISODate; bbl?: number | null; og?: number | null; tankId?: string | null }): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId }, include: { stays: { orderBy: { start: "asc" } } } });
  if (!b || b.status !== "PLANNED") return { error: "Only a planned brew can be marked brewed." };
  const first = b.stays[0];
  const tankId = i.tankId || first?.tankId;
  if (!tankId) return { error: "Pick the fermenter it went into." };
  const tank = await db.tank.findUnique({ where: { id: tankId } });
  if (!tank) return { error: "That tank is gone." };
  const busy = await brewInTank(tankId);
  if (busy) return { error: `${tank.name} still has ${busy.code} ${busy.name} in it. Transfer or package it first.` };
  const bbl = i.bbl ?? num(b.bbl);
  const { cost, unpriced } = await frozenCost(b.recipeId, bbl);
  const delta = first ? daysBetween(iso(first.start)!, i.brewedOn) : 0;
  await db.$transaction(async (tx) => {
    if (first) await tx.tankStay.update({ where: { id: first.id }, data: { tankId, start: asDate(i.brewedOn), end: null, planned: false } });
    else await tx.tankStay.create({ data: { tankId, batchId, start: asDate(i.brewedOn), end: null, planned: false } });
    for (const s of b.stays.slice(1)) {
      if (!s.planned || delta === 0) continue;
      await tx.tankStay.update({ where: { id: s.id }, data: { start: asDate(addDays(iso(s.start)!, delta)), end: s.end ? asDate(addDays(iso(s.end)!, delta)) : null } });
    }
    await tx.brewBatch.update({
      where: { id: batchId },
      data: { status: "FERMENTING", brewedOn: asDate(i.brewedOn), bbl, og: i.og ?? b.og, cost, extra: unpriced != null ? extraWith(b.extra, { unpricedLines: unpriced }) : undefined },
    });
  });
  return { ok: `${b.code} is brewed and in ${tank.name}.${cost == null ? " Cost not known yet." : ""}` };
}

async function batchWithStays(batchId: string) {
  const b = await db.brewBatch.findUnique({ where: { id: batchId }, include: { stays: { orderBy: { start: "asc" }, include: { tank: true } }, beer: { select: { name: true } }, recipe: { select: { name: true } } } });
  if (!b) return null;
  const actual = b.stays.filter((s) => !s.planned);
  const current = b.status === "FERMENTING" || b.status === "CONDITIONING" ? actual[actual.length - 1] ?? null : null;
  return { b, current, name: b.beer?.name ?? b.recipe?.name ?? b.code };
}

export async function transferBatch(batchId: string, i: { tankId: string; on: ISODate }): Promise<Res> {
  const x = await batchWithStays(batchId);
  if (!x || !x.current) return { error: "That brew isn't in a tank." };
  const { b, current } = x;
  if (current.tankId === i.tankId) return { error: `It's already in ${current.tank.name}.` };
  if (i.on < iso(current.start)!) return { error: `It went into ${current.tank.name} on ${md(iso(current.start)!)}; the move can't be before that.` };
  const tank = await db.tank.findUnique({ where: { id: i.tankId } });
  if (!tank || !tank.active) return { error: "That tank isn't in use." };
  const bbl = num(b.bbl);
  if (tooSmall({ capacityBbl: num(tank.capacityBbl) ?? 0 }, { bbl })) return { error: `${tank.name} holds ${bblText(num(tank.capacityBbl) ?? 0)}; this brew is ${bblText(bbl ?? 0)}.` };
  const busy = await brewInTank(tank.id);
  if (busy) return { error: `${tank.name} still has ${busy.code} ${busy.name} in it.` };
  const pencilled = b.stays.find((s) => s.planned && s.tankId === tank.id);
  await db.$transaction(async (tx) => {
    await tx.tankStay.update({ where: { id: current.id }, data: { end: asDate(i.on) } });
    await tx.tankStay.deleteMany({ where: { batchId, planned: true, ...(pencilled ? { id: { not: pencilled.id } } : {}) } });
    if (pencilled) await tx.tankStay.update({ where: { id: pencilled.id }, data: { start: asDate(i.on), end: null, planned: false } });
    else await tx.tankStay.create({ data: { tankId: tank.id, batchId, start: asDate(i.on), end: null, planned: false } });
    await tx.brewBatch.update({ where: { id: batchId }, data: { status: tank.kind === "FERMENTER" ? "FERMENTING" : "CONDITIONING" } });
  });
  return { ok: `${b.code} ${x.name} moved from ${current.tank.name} to ${tank.name}.` };
}

/**
 * Packaged: the stay ends, the brew is done, and a keg batch with the brew's
 * code is made (or linked) so kegs filled from now on can pick it.
 */
export async function packageBatch(batchId: string, i: { on: ISODate }): Promise<Res> {
  const x = await batchWithStays(batchId);
  if (!x || !x.current) return { error: "That brew isn't in a tank." };
  const { b, current } = x;
  if (i.on < iso(current.start)!) return { error: `It went into ${current.tank.name} on ${md(iso(current.start)!)}; packaging can't be before that.` };
  const existing = b.kegBatchId ? await db.kegBatch.findUnique({ where: { id: b.kegBatchId }, include: { brewBatch: { select: { id: true } } } }) : await db.kegBatch.findUnique({ where: { code: b.code }, include: { brewBatch: { select: { id: true } } } });
  if (existing?.brewBatch && existing.brewBatch.id !== b.id) return { error: `Keg batch ${existing.code} already belongs to another brew. Change this brew's code first.` };
  await db.$transaction(async (tx) => {
    await tx.tankStay.update({ where: { id: current.id }, data: { end: asDate(i.on) } });
    await tx.tankStay.deleteMany({ where: { batchId, planned: true } });
    const kb = existing
      ? await tx.kegBatch.update({ where: { id: existing.id }, data: { packagedOn: asDate(i.on), brewedOn: existing.brewedOn ?? b.brewedOn, beerId: existing.beerId ?? b.beerId } })
      : await tx.kegBatch.create({ data: { code: b.code, beerId: b.beerId, brewedOn: b.brewedOn, packagedOn: asDate(i.on) } });
    await tx.brewBatch.update({ where: { id: batchId }, data: { status: "PACKAGED", packagedOn: asDate(i.on), kegBatchId: kb.id } });
  });
  return { ok: `Packaged ${b.code} ${x.name}. ${current.tank.name} is free. When you fill kegs, pick batch ${b.code}.` };
}

export async function dumpBatch(batchId: string, i: { on: ISODate; reason: string }): Promise<Res> {
  const x = await batchWithStays(batchId);
  if (!x) return { error: "That brew is gone." };
  const { b, current } = x;
  if (b.status === "PACKAGED" || b.status === "DUMPED") return { error: "It's already done." };
  if (b.status === "PLANNED") return cancelPlannedBrew(batchId);
  await db.$transaction(async (tx) => {
    if (current) await tx.tankStay.update({ where: { id: current.id }, data: { end: asDate(i.on < iso(current.start)! ? iso(current.start)! : i.on) } });
    await tx.tankStay.deleteMany({ where: { batchId, planned: true } });
    await tx.brewBatch.update({
      where: { id: batchId },
      data: { status: "DUMPED", notes: [b.notes, `Dumped ${md(i.on)}: ${i.reason}`].filter(Boolean).join("\n"), extra: extraWith(b.extra, { dumped: { on: i.on, reason: i.reason } }) },
    });
  });
  return { ok: `Dumped ${b.code} ${x.name}.${current ? ` ${current.tank.name} is free.` : ""}` };
}

/** A gravity reading. "og" and "fg" also set the brew's OG and FG. */
export async function recordGravity(batchId: string, r: GravityReading): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId } });
  if (!b) return { error: "That brew is gone." };
  const { readings } = readExtra(b.extra);
  const list = [...readings, r].sort((a, c) => a.on.localeCompare(c.on));
  await db.brewBatch.update({
    where: { id: batchId },
    data: { ...(r.kind === "og" ? { og: r.sg } : r.kind === "fg" ? { fg: r.sg } : {}), extra: extraWith(b.extra, { readings: list as unknown as Prisma.InputJsonArray }) },
  });
  return { ok: `${r.kind === "og" ? "OG" : r.kind === "fg" ? "FG" : "Reading"} ${r.sg.toFixed(3)} saved for ${b.code}.` };
}

export async function deleteReading(batchId: string, index: number): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId } });
  if (!b) return { error: "That brew is gone." };
  const { readings } = readExtra(b.extra);
  if (!readings[index]) return { error: "That reading is gone." };
  readings.splice(index, 1);
  await db.brewBatch.update({ where: { id: batchId }, data: { extra: extraWith(b.extra, { readings: readings as unknown as Prisma.InputJsonArray }) } });
  return { ok: "Reading removed." };
}

/** New dates for one stay. On the stay a brew is in now, the end is the day it's due out. Keeps the brew's dates in step. */
export async function editStay(stayId: string, i: { start: ISODate; end: ISODate | null }): Promise<Res> {
  const s = await db.tankStay.findUnique({ where: { id: stayId }, include: { tank: true, batch: { include: { stays: { orderBy: { start: "asc" } } } } } });
  if (!s) return { error: "That stay is gone." };
  if (i.end && i.end <= i.start) return { error: "The day out has to be after the day in." };
  const b = s.batch;
  const actual = b.stays.filter((x) => !x.planned);
  const isCurrent = (b.status === "FERMENTING" || b.status === "CONDITIONING") && actual[actual.length - 1]?.id === s.id;
  if (!i.end && !isCurrent && !s.planned) return { error: "Give the day it came out." };
  const isFirst = b.stays[0]?.id === s.id;
  const isLast = b.stays[b.stays.length - 1]?.id === s.id;
  await db.$transaction(async (tx) => {
    await tx.tankStay.update({ where: { id: stayId }, data: { start: asDate(i.start), end: i.end ? asDate(i.end) : null } });
    const data: Prisma.BrewBatchUpdateInput = {};
    if (isFirst && s.planned && b.status === "PLANNED") data.plannedOn = asDate(i.start);
    if (isFirst && !s.planned) data.brewedOn = asDate(i.start);
    if (isLast && b.status === "PACKAGED" && i.end) data.packagedOn = asDate(i.end);
    if (Object.keys(data).length) await tx.brewBatch.update({ where: { id: b.id }, data });
  });
  return { ok: `${s.tank.name}: ${md(i.start)} to ${i.end ? md(i.end) : "still in"}.` };
}

// ---- Editing a brew ------------------------------------------------------------------------------

export type BatchField = "code" | "bbl" | "og" | "fg" | "cost" | "notes" | "beerId" | "recipeId" | "brewedOn" | "packagedOn" | "plannedOn";

/** "1.052" or "52" → 1.052; null for blank; "bad" when it isn't a gravity. */
export function parseGravity(raw: string): number | null | "bad" {
  const v = raw.trim();
  if (!v) return null;
  let n = Number(v);
  if (!Number.isFinite(n)) return "bad";
  if (n >= 2 && n < 200) n = 1 + n / 1000;
  return n >= 0.98 && n <= 1.2 ? Math.round(n * 1000) / 1000 : "bad";
}

export async function setBatchField(id: string, field: BatchField, raw: string): Promise<Res> {
  const v = raw.trim();
  const b = await db.brewBatch.findUnique({ where: { id } });
  if (!b) return { error: "That brew is gone." };
  const data: Prisma.BrewBatchUncheckedUpdateInput = {};
  switch (field) {
    case "code": {
      if (!v) return { error: "It needs a code" };
      const other = await db.brewBatch.findUnique({ where: { code: v } });
      if (other && other.id !== id) return { error: "Another brew has that code" };
      data.code = v.slice(0, 40);
      break;
    }
    case "bbl": {
      if (!v) { data.bbl = null; break; }
      const n = Number(v.replace(/bbl/i, ""));
      if (!Number.isFinite(n) || n <= 0 || n > 1000) return { error: "Barrels, like 7 or 15" };
      data.bbl = n;
      break;
    }
    case "og":
    case "fg": {
      const g = parseGravity(v);
      if (g === "bad") return { error: "Like 1.052" };
      data[field] = g;
      break;
    }
    case "cost": {
      const c = v.replace(/[$,\s]/g, "");
      if (!c) { data.cost = null; break; }
      const n = Number(c);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { error: "Dollars, like 640" };
      data.cost = Math.round(n * 100) / 100;
      break;
    }
    case "notes":
      data.notes = v.slice(0, 4000) || null;
      break;
    case "beerId":
      data.beerId = v || null;
      break;
    case "recipeId":
      data.recipeId = v || null;
      break;
    case "brewedOn":
    case "packagedOn":
    case "plannedOn":
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: "Pick a date" };
      data[field] = v ? asDate(v) : null;
      break;
  }
  await db.brewBatch.update({ where: { id }, data });
  // Keep the keg batch's code in step (fills point at it by id, so they follow).
  if (field === "code" && b.kegBatchId) await db.kegBatch.update({ where: { id: b.kegBatchId }, data: { code: data.code as string } }).catch(() => undefined);
  return { ok: "Saved" };
}
