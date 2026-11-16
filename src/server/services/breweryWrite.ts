import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { brewTiming, RECIPE_DAYS, releaseMessage, type BrewTiming, type TimingSource } from "@/domain/brewProfiles";
import { addDays, daysBetween, type ISODate } from "@/domain/dates";
import { formatGravity, parseGravity as parseUnitGravity, type GravityUnit } from "@/domain/gravity";
import { nextBatchCode, planBrew, splitCode, STARTER_TANKS, stayIntervals, tooSmall, type BrewProposal, type TankKind } from "@/domain/tankPlan";
import { db, num } from "../db";
import { gravityUnit } from "./brewDay";
import {
  asDate,
  brewerySnap,
  CALENDAR_TOKEN_KEY,
  DEFAULT_CONDITION_KEY,
  DEFAULT_FERMENT_KEY,
  breweryDefaults,
  iso,
  loadPlan,
  PACKAGE_DAYS_KEY,
  readExtra,
  TRANSFER_DAYS_KEY,
  type GravityReading,
  type TimelineEntry,
} from "./brewery";
import { brewCostFor } from "./brewCost";
import { businessToday } from "./sales";

/**
 * Brewery writes: tanks and defaults, planning brews onto the schedule (with
 * timing profiles and locked releases), brewing, moves between tanks,
 * packaging (which makes the keg batch kegs are filled from), splits,
 * gravity, dumping and editing a stay's dates. Each returns a plain sentence
 * to show, or `{ error }` (with `confirm` when it can go ahead once the
 * user says so, e.g. moving into a tank that has a brew in it).
 */

export type Res = { ok: string; href?: string } | { error: string; confirm?: boolean };

const put = (key: string, value: string) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
const bblText = (n: number) => `${Number(n.toFixed(2))} bbl`;
const md = (d: ISODate) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(asDate(d));

// ---- Setup ---------------------------------------------------------------------------------------

export async function saveBreweryDefaults(fermentDays: number, conditionDays: number) {
  await Promise.all([put(DEFAULT_FERMENT_KEY, String(fermentDays)), put(DEFAULT_CONDITION_KEY, String(conditionDays))]);
}

/** The weekdays transfers or packaging happen on (empty = any day). */
export async function saveSnapDays(which: "transfer" | "package", days: number[]) {
  const clean = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  await put(which === "transfer" ? TRANSFER_DAYS_KEY : PACKAGE_DAYS_KEY, clean.length ? clean.join(",") : "none");
}

export async function addTank(name: string, kind: TankKind, capacityBbl: number): Promise<Res> {
  if (await db.tank.findUnique({ where: { name } })) return { error: `There is already a tank called ${name}.` };
  const max = await db.tank.aggregate({ _max: { sort: true } });
  await db.tank.create({ data: { name, kind, capacityBbl, sort: (max._max.sort ?? 0) + 1 } });
  return { ok: `Added ${name}.` };
}

export interface StarterTank {
  name: string;
  kind: TankKind;
  capacityBbl: number;
  zone: string | null;
  layoutRow: number | null;
  layoutCol: number | null;
}

/** Setup's quick start: several tanks at once, only while there are none. */
export async function addStarterTanks(list: StarterTank[]): Promise<Res> {
  if (!list.length) return { error: "There are no tanks in the list." };
  if (await db.tank.count()) return { error: "There are tanks already. Add more one at a time." };
  const names = list.map((t) => t.name.trim());
  if (names.some((n) => !n)) return { error: "Every tank needs a name." };
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) return { error: `${dupe} is in the list twice.` };
  const sortOf = new Map(STARTER_TANKS.map((t) => [t.name, t.sort]));
  await db.tank.createMany({
    data: list.map((t, i) => ({ name: t.name.trim().slice(0, 40), kind: t.kind, capacityBbl: t.capacityBbl, zone: t.zone?.trim().slice(0, 40) || null, layoutRow: t.layoutRow, layoutCol: t.layoutCol, sort: sortOf.get(t.name.trim()) ?? list.length + i + 1 })),
  });
  return { ok: `Added ${list.length} tanks.` };
}

export type TankField = "name" | "kind" | "capacityBbl" | "sort" | "active" | "notes" | "zone" | "layoutRow" | "layoutCol";

/** The brew in a tank right now, if any (its latest actual stay while it's fermenting or conditioning). */
async function brewInTank(tankId: string, today = businessToday(), except?: string) {
  const { tanks, planBatches, stays, batches } = await loadPlan(today, 30);
  const cur = stayIntervals(stays, tanks, planBatches, today).find((i) => i.tankId === tankId && i.current && i.batchId !== except);
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
    case "zone":
      await db.tank.update({ where: { id }, data: { zone: v.slice(0, 40) || null } });
      break;
    case "layoutRow":
    case "layoutCol": {
      if (!v) {
        await db.tank.update({ where: { id }, data: { [field]: null } });
        break;
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 20) return { error: "1 to 20, or blank" };
      await db.tank.update({ where: { id }, data: { [field]: n } });
      break;
    }
  }
  return { ok: "Saved" };
}

export async function deleteTank(id: string): Promise<Res> {
  const stays = await db.tankStay.count({ where: { tankId: id } });
  if (stays) return { error: "It has brews in its history. Set it to not in use instead." };
  await db.tank.delete({ where: { id } }).catch(() => undefined);
  return { ok: "Tank deleted." };
}

// ---- The calendar feed ---------------------------------------------------------------------------

const newToken = () => randomBytes(18).toString("base64url");

/** The calendar feed's secret token, made the first time it's asked for. */
export async function calendarToken(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: CALENDAR_TOKEN_KEY } });
  if (row?.value) return row.value;
  const token = newToken();
  await put(CALENDAR_TOKEN_KEY, token);
  return token;
}

/** A new token: the old calendar address stops working. */
export async function regenerateCalendarToken(): Promise<string> {
  const token = newToken();
  await put(CALENDAR_TOKEN_KEY, token);
  return token;
}

// ---- What a brew is ------------------------------------------------------------------------------

const recipeSelect = { id: true, name: true, beerId: true, batchBbl: true, fermentDays: true, conditionDays: true, profile: true, dryHopDay: true, tapDay: true } as const;

/** The recipe and beer for a pick (a recipe, or a beer and its live recipe), the days it spends in tanks and its timing. */
async function resolveBrew(recipeId: string | null, beerId: string | null) {
  const defaults = await breweryDefaults();
  const recipe = recipeId
    ? await db.brewRecipe.findUnique({ where: { id: recipeId }, select: recipeSelect })
    : beerId
      ? await db.brewRecipe.findFirst({ where: { beerId, status: "live" }, orderBy: { updatedAt: "desc" }, select: recipeSelect })
      : null;
  const beer = (recipe?.beerId ?? beerId) ? await db.beer.findUnique({ where: { id: (recipe?.beerId ?? beerId)! }, select: { id: true, name: true } }) : null;
  return {
    recipeId: recipe?.id ?? null,
    beerId: beer?.id ?? null,
    name: beer?.name ?? recipe?.name ?? "the brew",
    fermentDays: recipe?.fermentDays ?? defaults.fermentDays,
    conditionDays: recipe?.conditionDays ?? defaults.conditionDays,
    batchBbl: num(recipe?.batchBbl) ?? null,
    profile: recipe?.profile ?? null,
    dryHopDay: recipe?.dryHopDay ?? null,
    tapDay: recipe?.tapDay ?? null,
  };
}

type Brew = Awaited<ReturnType<typeof resolveBrew>>;

/**
 * Where a brew's dates come from: its own profile (picked when planned) or
 * its recipe's. A brew that picked a different profile from its recipe's
 * doesn't take the recipe's own dry-hop and release days.
 */
function timingSource(brew: Brew, own: string | null): TimingSource {
  const profile = own ?? brew.profile;
  const recipeDays = own == null || own === brew.profile || own === RECIPE_DAYS;
  return { profile, dryHopDay: recipeDays ? brew.dryHopDay : null, tapDay: recipeDays ? brew.tapDay : null, fermentDays: brew.fermentDays, conditionDays: brew.conditionDays };
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

/** The extra with one more history line (and reading, when given). */
function withHistory(extra: unknown, entry: TimelineEntry, reading?: GravityReading | null): Prisma.InputJsonObject {
  const x = readExtra(extra);
  return extraWith(extra, {
    timeline: [...x.timeline, entry] as unknown as Prisma.InputJsonArray,
    ...(reading ? { readings: [...x.readings, reading].sort((a, b) => a.on.localeCompare(b.on)) as unknown as Prisma.InputJsonArray } : {}),
  });
}

/** Typed gravity in the brewery's unit → SG; null for blank; "bad" when it can't be read. */
async function readGravity(text: string | null | undefined): Promise<{ sg: number | null; unit: GravityUnit } | { error: string }> {
  const unit = await gravityUnit();
  const t = (text ?? "").trim();
  if (!t) return { sg: null, unit };
  const sg = parseUnitGravity(t, unit);
  if (typeof sg !== "number") return { error: `Gravity like ${formatGravity(1.012, unit)}` };
  return { sg, unit };
}

// ---- Planning brews ------------------------------------------------------------------------------

export interface ProposeInput {
  brewOn: ISODate;
  bbl: number;
  recipeId: string | null;
  beerId: string | null;
  /** Only this fermenter. */
  fermenterId?: string | null;
  /** Leave this brew's own stays out (when moving it); its locked release is kept. */
  exceptBatchId?: string | null;
  /** A timing profile for this brew ("" or null: the recipe's). */
  profile?: string | null;
}

export interface ProposedTiming {
  profile: string | null;
  dryHopOn: ISODate | null;
  fvTransferOn: ISODate | null;
  tapOn: ISODate;
  tapLocked: boolean;
  lockedReason: string | null;
  /** "Brew by Nov 19 to keep the release on Dec 19." when a locked release can't be made. */
  releaseWarning: string | null;
  brewBy: ISODate | null;
}

/** Where a brew would go and its dates, without saving anything. */
export async function proposeBrew(i: ProposeInput): Promise<{ proposal: BrewProposal; fermentDays: number; conditionDays: number; name: string; timing: ProposedTiming }> {
  const today = businessToday();
  const [brew, plan, snap, own] = await Promise.all([
    resolveBrew(i.recipeId, i.beerId),
    loadPlan(today, 30),
    brewerySnap(),
    i.exceptBatchId ? db.brewBatch.findUnique({ where: { id: i.exceptBatchId }, select: { tapOn: true, tapLocked: true, lockedReason: true, extra: true } }) : null,
  ]);
  const profile = i.profile || (own ? readExtra(own.extra).profile : null);
  const locked = own?.tapLocked && own.tapOn ? iso(own.tapOn) : null;
  const t = brewTiming(i.brewOn, timingSource(brew, profile), snap, locked);
  const busy = stayIntervals(plan.stays, plan.tanks, plan.planBatches, today, { exceptBatchId: i.exceptBatchId ?? undefined }).map((x) => ({ tankId: x.tankId, start: x.start, end: x.end }));
  const tanks = i.fermenterId ? plan.tanks.filter((x) => x.kind !== "FERMENTER" || x.id === i.fermenterId) : plan.tanks;
  const proposal = planBrew({ brewOn: i.brewOn, bbl: i.bbl, fermentDays: t.fermentDays, conditionDays: t.conditionDays, tanks, busy, snap });
  return { proposal, fermentDays: t.fermentDays, conditionDays: t.conditionDays, name: brew.name, timing: finalTiming(t, proposal, profile, own?.lockedReason ?? null) };
}

/** The dates to keep once the tanks are known: release no earlier than packaging, and a locked release checked against it. */
function finalTiming(t: BrewTiming, p: BrewProposal, profile: string | null, lockedReason: string | null): ProposedTiming {
  const packageOn = p.ok ? p.packageOn : t.packageOn;
  const release = { ...t.release };
  if (release.locked && packageOn > t.tapOn) release.ok = false;
  return {
    profile,
    dryHopOn: t.dryHopOn,
    fvTransferOn: t.fvTransferOn,
    tapOn: release.locked || t.tapOn >= packageOn ? t.tapOn : packageOn,
    tapLocked: release.locked,
    lockedReason,
    releaseWarning: releaseMessage(release, release.locked ? t.tapOn : null),
    brewBy: release.brewBy,
  };
}

const stayRows = (p: Extract<BrewProposal, { ok: true }>, batchId: string) => [
  { tankId: p.fermenter.tankId, batchId, start: asDate(p.fermenter.start), end: asDate(p.fermenter.end), planned: true },
  ...(p.brite ? [{ tankId: p.brite.tankId, batchId, start: asDate(p.brite.start), end: asDate(p.brite.end), planned: true }] : []),
];

const proposalSentence = (p: Extract<BrewProposal, { ok: true }>) =>
  `${p.fermenter.tankName} from ${md(p.fermenter.start)}${p.brite ? `, ${p.brite.tankName} from ${md(p.brite.start)}` : ""}, ready to package ${md(p.packageOn)}`;

const dateOrNull = (d: ISODate | null) => (d ? asDate(d) : null);

export async function planNewBrew(i: { recipeId: string | null; beerId: string | null; brewOn: ISODate; bbl: number; code?: string | null; fermenterId?: string | null; notes?: string | null; profile?: string | null }): Promise<Res> {
  const { proposal: p, name, timing } = await proposeBrew(i);
  if (!p.ok) return { error: p.reason };
  const code = await newCode(i.brewOn, i.code);
  if ("error" in code) return code;
  const brew = await resolveBrew(i.recipeId, i.beerId);
  await db.$transaction(async (tx) => {
    const b = await tx.brewBatch.create({
      data: {
        code: code.code,
        recipeId: brew.recipeId,
        beerId: brew.beerId,
        status: "PLANNED",
        plannedOn: asDate(i.brewOn),
        bbl: i.bbl,
        notes: i.notes?.trim() || null,
        dryHopOn: dateOrNull(timing.dryHopOn),
        tapOn: asDate(timing.tapOn),
        extra: { ...(i.profile ? { profile: i.profile } : {}), ...(timing.fvTransferOn ? { fvTransferOn: timing.fvTransferOn } : {}) },
      },
    });
    await tx.tankStay.createMany({ data: stayRows(p, b.id) });
  });
  return { ok: `Planned ${code.code} ${name}: ${proposalSentence(p)}.` };
}

/** New brew day (and size, fermenter or profile): works out the tanks and dates again. A locked release stays put. */
export async function movePlannedBrew(batchId: string, i: { brewOn: ISODate; bbl?: number | null; fermenterId?: string | null; profile?: string | null }): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId } });
  if (!b || b.status !== "PLANNED") return { error: "Only a planned brew can be moved." };
  const bbl = i.bbl ?? num(b.bbl) ?? 7;
  const { proposal: p, timing } = await proposeBrew({ brewOn: i.brewOn, bbl, recipeId: b.recipeId, beerId: b.beerId, fermenterId: i.fermenterId, exceptBatchId: b.id, profile: i.profile });
  if (!p.ok) return { error: p.reason };
  if (timing.releaseWarning) return { error: `${timing.releaseWarning} The release is locked${b.lockedReason ? ` (${b.lockedReason})` : ""}.` };
  await db.$transaction(async (tx) => {
    await tx.tankStay.deleteMany({ where: { batchId } });
    await tx.tankStay.createMany({ data: stayRows(p, batchId) });
    await tx.brewBatch.update({
      where: { id: batchId },
      data: {
        plannedOn: asDate(i.brewOn),
        bbl,
        dryHopOn: dateOrNull(timing.dryHopOn),
        tapOn: asDate(timing.tapOn),
        extra: extraWith(b.extra, { fvTransferOn: timing.fvTransferOn, ...(i.profile ? { profile: i.profile } : {}) }),
      },
    });
  });
  return { ok: `Moved ${b.code} to ${md(i.brewOn)}: ${proposalSentence(p)}.${timing.tapLocked ? ` The release stays on ${md(timing.tapOn)}.` : ""}` };
}

export async function cancelPlannedBrew(batchId: string): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId } });
  if (!b || b.status !== "PLANNED") return { error: "Only a planned brew can be cancelled. Dump a brew that's in a tank." };
  await db.brewBatch.delete({ where: { id: batchId } });
  return { ok: `Cancelled ${b.code}. Its tanks are free again.` };
}

/** Lock (or unlock) a brew's release day: moving the brew then keeps it, and says when a new brew day can't make it. */
export async function setReleaseLock(batchId: string, i: { locked: boolean; tapOn?: ISODate | null; reason?: string | null }): Promise<Res> {
  const b = await db.brewBatch.findUnique({ where: { id: batchId } });
  if (!b) return { error: "That brew is gone." };
  const tapOn = i.tapOn ?? iso(b.tapOn);
  if (i.locked && !tapOn) return { error: "Give the release day first." };
  await db.brewBatch.update({ where: { id: batchId }, data: { tapLocked: i.locked, tapOn: tapOn ? asDate(tapOn) : null, lockedReason: i.locked ? i.reason?.trim().slice(0, 120) || b.lockedReason : b.lockedReason } });
  return { ok: i.locked ? `Release locked on ${md(tapOn!)}.` : "Release unlocked: it moves with the brew again." };
}

// ---- Brewing -------------------------------------------------------------------------------------

/** Brewed straight into a tank (not planned first). Pencils in a brite for its transfer day if one is free. */
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
  const today = businessToday();
  const [plan, snap] = await Promise.all([loadPlan(today, 30), brewerySnap()]);
  const t = brewTiming(i.brewedOn, timingSource(brew, null), snap);
  const brite = await freeBrite(plan, today, i.bbl, t);
  await db.$transaction(async (tx) => {
    const b = await tx.brewBatch.create({
      data: {
        code: code.code,
        recipeId: brew.recipeId,
        beerId: brew.beerId,
        status: "FERMENTING",
        brewedOn: asDate(i.brewedOn),
        bbl: i.bbl,
        og: i.og ?? null,
        cost,
        dryHopOn: dateOrNull(t.dryHopOn),
        tapOn: asDate(t.tapOn),
        extra: { ...(unpriced != null ? { unpricedLines: unpriced } : {}), ...(t.fvTransferOn ? { fvTransferOn: t.fvTransferOn } : {}) },
      },
    });
    await tx.tankStay.create({ data: { tankId: tank.id, batchId: b.id, start: asDate(i.brewedOn), end: asDate(t.transferOn), planned: false } });
    if (brite) await tx.tankStay.create({ data: { tankId: brite.id, batchId: b.id, start: asDate(t.transferOn), end: asDate(t.packageOn), planned: true } });
  });
  return { ok: `${code.code} ${brew.name} is in ${tank.name}.${brite ? ` ${brite.name} is pencilled in from ${md(t.transferOn)}.` : ""}${cost == null ? " Cost not known yet." : ""}` };
}

/** The first brite big enough and free from the transfer day to packaging, if there is anything to condition. */
async function freeBrite(plan: Awaited<ReturnType<typeof loadPlan>>, today: ISODate, bbl: number, t: Pick<BrewTiming, "transferOn" | "packageOn" | "conditionDays">, exceptBatchId?: string) {
  if (t.conditionDays <= 0) return undefined;
  const iv = stayIntervals(plan.stays, plan.tanks, plan.planBatches, today, { exceptBatchId });
  return plan.tanks
    .filter((x) => x.active && x.kind === "BRITE" && !tooSmall(x, { bbl }))
    .sort((a, b) => a.sort - b.sort)
    .find((x) => !iv.some((s) => s.tankId === x.id && s.start < t.packageOn && t.transferOn < s.end));
}

/** A planned brew was brewed: it goes into its fermenter (the plan's later dates move by the same number of days; a locked release stays). */
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
  const delta = first ? daysBetween(iso(first.start)!, i.brewedOn) : b.plannedOn ? daysBetween(iso(b.plannedOn)!, i.brewedOn) : 0;
  const shift = (d: Date | null) => (d && delta ? asDate(addDays(iso(d)!, delta)) : d);
  const x = readExtra(b.extra);
  await db.$transaction(async (tx) => {
    if (first) await tx.tankStay.update({ where: { id: first.id }, data: { tankId, start: asDate(i.brewedOn), end: first.end ? shift(first.end) : null, planned: false } });
    else await tx.tankStay.create({ data: { tankId, batchId, start: asDate(i.brewedOn), end: null, planned: false } });
    for (const s of b.stays.slice(1)) {
      if (!s.planned || delta === 0) continue;
      await tx.tankStay.update({ where: { id: s.id }, data: { start: shift(s.start)!, end: shift(s.end) } });
    }
    await tx.brewBatch.update({
      where: { id: batchId },
      data: {
        status: "FERMENTING",
        brewedOn: asDate(i.brewedOn),
        bbl,
        og: i.og ?? b.og,
        cost,
        dryHopOn: shift(b.dryHopOn),
        tapOn: b.tapLocked ? b.tapOn : shift(b.tapOn),
        extra: extraWith(b.extra, { ...(unpriced != null ? { unpricedLines: unpriced } : {}), ...(x.fvTransferOn && delta ? { fvTransferOn: addDays(x.fvTransferOn, delta) } : {}) }),
      },
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

export interface MoveInput {
  tankId: string;
  on: ISODate;
  /** Gravity at the move, in the brewery's unit (blank: none). */
  gravity?: string | null;
  note?: string | null;
  /** Go ahead although the tank has a brew in it or is too small. */
  force?: boolean;
}

const MOVE_NAME = (from: TankKind, to: TankKind) =>
  from === "FERMENTER" && to === "FERMENTER" ? "FV → FV transfer" : to === "BRITE" && from !== "BRITE" ? "To brite" : from === "BRITE" && to === "BRITE" ? "BBT → BBT transfer" : "Moved";

/**
 * A brew moves to another tank: fermenter to fermenter, to a brite, or brite
 * to brite. The stay it was in ends that day and a new one starts (taking
 * over a pencilled-in stay in that tank). A gravity at the move is kept as a
 * reading (moving into a brite, as the FG). A line goes in its history. A
 * tank with a brew in it, or one too small, needs `force`, as Brew Manager
 * asked to confirm.
 */
export async function moveBatch(batchId: string, i: MoveInput): Promise<Res> {
  const x = await batchWithStays(batchId);
  if (!x || !x.current) return { error: "That brew isn't in a tank." };
  const { b, current } = x;
  if (current.tankId === i.tankId) return { error: `It's already in ${current.tank.name}.` };
  if (i.on < iso(current.start)!) return { error: `It went into ${current.tank.name} on ${md(iso(current.start)!)}; the move can't be before that.` };
  const tank = await db.tank.findUnique({ where: { id: i.tankId } });
  if (!tank || !tank.active) return { error: "That tank isn't in use." };
  const g = await readGravity(i.gravity);
  if ("error" in g) return g;
  const bbl = num(b.bbl);
  const small = tooSmall({ capacityBbl: num(tank.capacityBbl) ?? 0 }, { bbl });
  const busy = await brewInTank(tank.id, businessToday(), batchId);
  if ((busy || small) && !i.force) {
    const why = [busy ? `${tank.name} has ${busy.code} ${busy.name} in it` : null, small ? `${tank.name} holds ${bblText(num(tank.capacityBbl) ?? 0)} and this brew is ${bblText(bbl ?? 0)}` : null].filter(Boolean).join(", and ");
    return { error: `${why}. Move it anyway?`, confirm: true };
  }
  const fromKind = current.tank.kind as TankKind, toKind = tank.kind as TankKind;
  const intoBrite = toKind === "BRITE" && fromKind !== "BRITE";
  const fvToFv = fromKind === "FERMENTER" && toKind === "FERMENTER";
  const pencilled = b.stays.find((s) => s.planned && s.tankId === tank.id);
  const keepEnd = fvToFv && current.end && iso(current.end)! > i.on ? current.end : pencilled?.end && iso(pencilled.end)! > i.on ? pencilled.end : null;
  const what = MOVE_NAME(fromKind, toKind);
  const unit = g.unit;
  const reading: GravityReading | null = g.sg != null ? { on: i.on, sg: g.sg, kind: intoBrite ? "fg" : "reading", note: intoBrite ? "At brite transfer" : fvToFv ? "At FV transfer" : "At transfer" } : null;
  const note = i.note?.trim().slice(0, 300) || null;
  const entry: TimelineEntry = { on: i.on, kind: intoBrite || toKind === "BRITE" ? "brite" : "transfer", text: `${what}: ${current.tank.name} → ${tank.name}${g.sg != null ? ` · ${formatGravity(g.sg, unit)}` : ""}${busy ? ` · ${tank.name} still had ${busy.code} in it` : ""}${note ? ` · ${note}` : ""}` };
  await db.$transaction(async (tx) => {
    await tx.tankStay.update({ where: { id: current.id }, data: { end: asDate(i.on) } });
    // Moving between fermenters keeps the pencilled-in brite; anything else replaces the plan.
    await tx.tankStay.deleteMany({ where: { batchId, planned: true, ...(pencilled ? { id: { not: pencilled.id } } : {}), ...(fvToFv ? { tank: { kind: "FERMENTER" } } : {}) } });
    if (pencilled) await tx.tankStay.update({ where: { id: pencilled.id }, data: { start: asDate(i.on), end: keepEnd, planned: false } });
    else await tx.tankStay.create({ data: { tankId: tank.id, batchId, start: asDate(i.on), end: keepEnd, planned: false } });
    await tx.brewBatch.update({
      where: { id: batchId },
      data: {
        status: toKind === "FERMENTER" ? (b.status === "CONDITIONING" ? "CONDITIONING" : "FERMENTING") : "CONDITIONING",
        ...(reading?.kind === "fg" ? { fg: reading.sg } : {}),
        extra: withHistory(b.extra, entry, reading),
      },
    });
  });
  return { ok: `${b.code} ${x.name} moved from ${current.tank.name} to ${tank.name}.` };
}

/** Kept for older callers: a move with no gravity or note. */
export async function transferBatch(batchId: string, i: { tankId: string; on: ISODate }): Promise<Res> {
  return moveBatch(batchId, { ...i, force: false });
}

/** Brew Manager's "Mark conditioning": still in its fermenter, but done fermenting and next going to a brite. */
export async function markConditioning(batchId: string, i: { on: ISODate; gravity?: string | null; note?: string | null }): Promise<Res> {
  const x = await batchWithStays(batchId);
  if (!x || !x.current) return { error: "That brew isn't in a tank." };
  if (x.current.tank.kind !== "FERMENTER") return { error: "It's in a brite already; it conditions there." };
  if (x.b.status === "CONDITIONING") return { error: "It's marked conditioning already." };
  const g = await readGravity(i.gravity);
  if ("error" in g) return g;
  const note = i.note?.trim().slice(0, 300) || null;
  const reading: GravityReading | null = g.sg != null ? { on: i.on, sg: g.sg, kind: "reading", note: "Conditioning" } : null;
  await db.brewBatch.update({
    where: { id: batchId },
    data: { status: "CONDITIONING", extra: withHistory(x.b.extra, { on: i.on, kind: "stage", text: `Conditioning in ${x.current.tank.name}${g.sg != null ? ` · ${formatGravity(g.sg, g.unit)}` : ""}${note ? ` · ${note}` : ""}` }, reading) },
  });
  return { ok: `${x.b.code} ${x.name} is conditioning in ${x.current.tank.name}. Next: transfer to a brite.` };
}

export interface PackageInput {
  on: ISODate;
  /** Final gravity in the brewery's unit (blank: keep what's there). */
  fg?: string | null;
  halfKegs?: number | null;
  sixthKegs?: number | null;
  cases?: number | null;
  co2Vols?: number | null;
  note?: string | null;
}

/** Where to fill this brew's kegs: the keg scanner, many kegs, filling with this beer and batch. */
export const fillHref = (b: { beerId: string | null; code: string }) => `/kegs/scan?${new URLSearchParams({ ...(b.beerId ? { fill: b.beerId } : {}), batch: b.code }).toString()}`;

/**
 * Packaged: the stay ends, the brew is done with what it made (kegs by size,
 * cases, CO₂), and a keg batch with the brew's code is made (or linked) so
 * kegs filled from now on can pick it.
 */
export async function packageBatch(batchId: string, i: PackageInput): Promise<Res> {
  const x = await batchWithStays(batchId);
  if (!x || !x.current) return { error: "That brew isn't in a tank." };
  const { b, current } = x;
  if (i.on < iso(current.start)!) return { error: `It went into ${current.tank.name} on ${md(iso(current.start)!)}; packaging can't be before that.` };
  const g = await readGravity(i.fg);
  if ("error" in g) return g;
  const existing = b.kegBatchId ? await db.kegBatch.findUnique({ where: { id: b.kegBatchId }, include: { brewBatch: { select: { id: true } } } }) : await db.kegBatch.findUnique({ where: { code: b.code }, include: { brewBatch: { select: { id: true } } } });
  if (existing?.brewBatch && existing.brewBatch.id !== b.id) return { error: `Keg batch ${existing.code} already belongs to another brew. Change this brew's code first.` };
  const note = i.note?.trim().slice(0, 1000) || null;
  const made = [i.halfKegs ? `${i.halfKegs} × ½ bbl` : null, i.sixthKegs ? `${i.sixthKegs} × ⅙ bbl` : null, i.cases ? `${i.cases} case${i.cases === 1 ? "" : "s"}` : null].filter(Boolean).join(", ");
  const entry: TimelineEntry = { on: i.on, kind: "package", text: `Packaged from ${current.tank.name}${made ? ` · ${made}` : ""}${i.co2Vols ? ` · ${i.co2Vols} vols CO₂` : ""}${g.sg != null ? ` · FG ${formatGravity(g.sg, g.unit)}` : ""}${note ? ` · ${note}` : ""}` };
  const reading: GravityReading | null = g.sg != null ? { on: i.on, sg: g.sg, kind: "fg", note: "Final FG" } : null;
  await db.$transaction(async (tx) => {
    await tx.tankStay.update({ where: { id: current.id }, data: { end: asDate(i.on) } });
    await tx.tankStay.deleteMany({ where: { batchId, planned: true } });
    const kb = existing
      ? await tx.kegBatch.update({ where: { id: existing.id }, data: { packagedOn: asDate(i.on), brewedOn: existing.brewedOn ?? b.brewedOn, beerId: existing.beerId ?? b.beerId } })
      : await tx.kegBatch.create({ data: { code: b.code, beerId: b.beerId, brewedOn: b.brewedOn, packagedOn: asDate(i.on) } });
    await tx.brewBatch.update({
      where: { id: batchId },
      data: {
        status: "PACKAGED",
        packagedOn: asDate(i.on),
        kegBatchId: kb.id,
        halfKegs: i.halfKegs ?? null,
        sixthKegs: i.sixthKegs ?? null,
        cases: i.cases ?? null,
        co2Vols: i.co2Vols ?? null,
        ...(reading ? { fg: reading.sg } : {}),
        extra: extraWith(withHistory(b.extra, entry, reading), note ? { packageNote: note } : {}),
      },
    });
  });
  const kegs = (i.halfKegs ?? 0) + (i.sixthKegs ?? 0);
  return { ok: `Packaged ${b.code} ${x.name}. ${current.tank.name} is free.${kegs ? ` Fill ${kegs} keg${kegs === 1 ? "" : "s"} with batch ${b.code}.` : ` When you fill kegs, pick batch ${b.code}.`}`, href: fillHref(b) };
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

// ---- Splitting a brew ----------------------------------------------------------------------------

export interface SplitInput {
  /** What the split part becomes. */
  recipeId: string | null;
  beerId: string | null;
  /** Barrels taken from the brew. */
  bbl: number;
  /** The fermenter it goes into. */
  tankId: string;
  /** The day it's split off. */
  on: ISODate;
  force?: boolean;
}

/**
 * Split part of a brew into another fermenter as its own brew (brewed
 * together, then each its own beer, like the two lagers from one base). The
 * new brew gets the next letter on the code (26-014B), its share of the
 * volume and cost, its own fermenter stay from the split day and its own
 * dates from its recipe, counted from the shared brew day.
 */
export async function splitBatch(parentId: string, i: SplitInput): Promise<Res> {
  const parent = await db.brewBatch.findUnique({ where: { id: parentId }, include: { stays: { orderBy: { start: "asc" } }, beer: { select: { name: true } }, recipe: { select: { name: true } } } });
  if (!parent) return { error: "That brew is gone." };
  if (!["PLANNED", "FERMENTING", "CONDITIONING"].includes(parent.status)) return { error: "Only a planned brew or one in a tank can be split." };
  if (!i.recipeId && !i.beerId) return { error: "Pick what the split part becomes." };
  const planned = parent.status === "PLANNED";
  const brewOn = iso(planned ? parent.plannedOn : parent.brewedOn);
  if (!brewOn) return { error: "Give the brew its brew day first." };
  if (i.on < brewOn) return { error: `It's brewed on ${md(brewOn)}; the split can't be before that.` };
  const parentBbl = num(parent.bbl);
  if (parentBbl != null && i.bbl >= parentBbl) return { error: `The brew is ${bblText(parentBbl)}; split off less than that.` };
  const tank = await db.tank.findUnique({ where: { id: i.tankId } });
  if (!tank || !tank.active) return { error: "That tank isn't in use." };
  const [brew, snap, plan] = await Promise.all([resolveBrew(i.recipeId, i.beerId), brewerySnap(), loadPlan(businessToday(), 30)]);
  const t = brewTiming(brewOn, timingSource(brew, null), snap);
  const end = t.transferOn > i.on ? t.transferOn : null;
  const today = businessToday();
  const iv = stayIntervals(plan.stays, plan.tanks, plan.planBatches, today);
  const clash = iv.find((s) => s.tankId === tank.id && s.start < (end ?? addDays(i.on, Math.max(1, t.fermentDays))) && i.on < s.end);
  const small = tooSmall({ capacityBbl: num(tank.capacityBbl) ?? 0 }, { bbl: i.bbl });
  if ((clash || small) && !i.force) {
    const who = clash ? plan.batches.find((b) => b.id === clash.batchId) : null;
    const why = [clash ? `${tank.name} has ${who ? `${who.code} ${who.name}` : "another brew"} in it then` : null, small ? `${tank.name} holds ${bblText(num(tank.capacityBbl) ?? 0)}` : null].filter(Boolean).join(", and ");
    return { error: `${why}. Split into it anyway?`, confirm: true };
  }
  const siblings = await db.brewBatch.findMany({ where: { code: { startsWith: parent.code } }, select: { code: true } });
  const code = splitCode(parent.code, siblings.map((s) => s.code));
  const share = parentBbl ? i.bbl / parentBbl : 0;
  const parentCost = num(parent.cost);
  const childCost = parentCost != null && share ? Math.round(parentCost * share * 100) / 100 : null;
  const brite = await freeBrite(plan, today, i.bbl, t);
  const parentName = parent.beer?.name ?? parent.recipe?.name ?? parent.code;
  const status = planned ? "PLANNED" : tank.kind === "FERMENTER" ? (parent.status === "CONDITIONING" ? "CONDITIONING" : "FERMENTING") : "CONDITIONING";
  await db.$transaction(async (tx) => {
    const child = await tx.brewBatch.create({
      data: {
        code,
        recipeId: brew.recipeId,
        beerId: brew.beerId,
        status,
        plannedOn: parent.plannedOn,
        brewedOn: parent.brewedOn,
        bbl: i.bbl,
        og: parent.og,
        cost: childCost,
        dryHopOn: dateOrNull(t.dryHopOn),
        tapOn: asDate(t.tapOn),
        splitFromId: parent.id,
        extra: {
          ...(t.fvTransferOn ? { fvTransferOn: t.fvTransferOn } : {}),
          readings: readExtra(parent.extra).readings.filter((r) => r.on <= i.on) as unknown as Prisma.InputJsonArray,
          timeline: [{ on: i.on, kind: "split", text: `Split from ${parent.code} ${parentName}: ${bblText(i.bbl)} into ${tank.name}` }],
        },
      },
    });
    await tx.tankStay.create({ data: { tankId: tank.id, batchId: child.id, start: asDate(i.on), end: end ? asDate(end) : null, planned } });
    if (brite) await tx.tankStay.create({ data: { tankId: brite.id, batchId: child.id, start: asDate(t.transferOn), end: asDate(t.packageOn), planned: true } });
    await tx.brewBatch.update({
      where: { id: parent.id },
      data: {
        ...(parentBbl != null ? { bbl: Math.round((parentBbl - i.bbl) * 100) / 100 } : {}),
        ...(parentCost != null && childCost != null ? { cost: Math.round((parentCost - childCost) * 100) / 100 } : {}),
        extra: withHistory(parent.extra, { on: i.on, kind: "split", text: `Split ${bblText(i.bbl)} into ${code} ${brew.name} in ${tank.name}` }),
      },
    });
  });
  return { ok: `${code} ${brew.name}: ${bblText(i.bbl)} split from ${parent.code} into ${tank.name}.` };
}

// ---- Gravity -------------------------------------------------------------------------------------

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
  return { ok: `${r.kind === "og" ? "OG" : r.kind === "fg" ? "FG" : "Reading"} ${formatGravity(r.sg, await gravityUnit())} saved for ${b.code}.` };
}

/** A reading typed in the brewery's unit. */
export async function recordGravityText(batchId: string, i: { on: ISODate; text: string; kind: GravityReading["kind"]; note: string | null }): Promise<Res> {
  const g = await readGravity(i.text);
  if ("error" in g) return g;
  if (g.sg == null) return { error: `Type the gravity, like ${formatGravity(1.012, g.unit)}` };
  return recordGravity(batchId, { on: i.on, sg: g.sg, kind: i.kind, note: i.note });
}

/** Gravity typed in the brewery's unit → SG, for the brew forms (blank → null). */
export async function gravityFromText(text: string | null | undefined): Promise<{ sg: number | null } | { error: string }> {
  return readGravity(text);
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

export type BatchField = "code" | "bbl" | "og" | "fg" | "cost" | "notes" | "beerId" | "recipeId" | "brewedOn" | "packagedOn" | "plannedOn" | "dryHopOn" | "tapOn" | "lockedReason" | "halfKegs" | "sixthKegs" | "cases" | "co2Vols";

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
      const g = await readGravity(v);
      if ("error" in g) return g;
      data[field] = g.sg;
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
    case "lockedReason":
      data.lockedReason = v.slice(0, 120) || null;
      break;
    case "beerId":
      data.beerId = v || null;
      break;
    case "recipeId":
      data.recipeId = v || null;
      break;
    case "halfKegs":
    case "sixthKegs":
    case "cases": {
      if (!v) { data[field] = null; break; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10_000) return { error: "A whole number" };
      data[field] = n;
      break;
    }
    case "co2Vols": {
      if (!v) { data.co2Vols = null; break; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 9.99) return { error: "Volumes, like 2.5" };
      data.co2Vols = Math.round(n * 100) / 100;
      break;
    }
    case "tapOn":
      if (!v && b.tapLocked) return { error: "Unlock the release before clearing its day" };
    // falls through
    case "brewedOn":
    case "packagedOn":
    case "plannedOn":
    case "dryHopOn":
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: "Pick a date" };
      data[field] = v ? asDate(v) : null;
      break;
  }
  await db.brewBatch.update({ where: { id }, data });
  // Keep the keg batch's code in step (fills point at it by id, so they follow).
  if (field === "code" && b.kegBatchId) await db.kegBatch.update({ where: { id: b.kegBatchId }, data: { code: data.code as string } }).catch(() => undefined);
  return { ok: "Saved" };
}
