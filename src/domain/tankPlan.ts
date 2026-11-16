/**
 * The tank plan: what is in each tank today, what is booked next, where two
 * brews would clash, where a new brew fits, and which beers need brewing
 * before they run out. Pure: plain data in, plain data out.
 *
 * THE STAY RULE. A stay runs from `start` (the day the beer goes in) up to
 * `end`, the day it comes out (transfer or packaging day). The tank is free
 * again on `end`, so another brew may go in that same day: a stay ending on
 * the 15th and one starting on the 15th do NOT clash. In other words a stay
 * is the half-open range [start, end) and its length in days is end − start.
 *
 * A stay with no end is still in the tank with no day out planned; it is
 * taken to run for the recipe's days (fermenting in a fermenter, conditioning
 * in a brite), and never less than until tomorrow while the beer is in there.
 *
 * Where a brew is now comes from its status: a FERMENTING or CONDITIONING
 * brew is in its latest actual (not planned) stay. On that current stay,
 * `end` is the planned day out; it becomes the actual day when it moves on.
 */

import { addDays, daysBetween, type ISODate } from "./dates";

export type TankKind = "FERMENTER" | "BRITE" | "OTHER";
export type BrewStatus = "PLANNED" | "FERMENTING" | "CONDITIONING" | "PACKAGED" | "DUMPED";

/**
 * Which beers to plan brews for. Every active beer for now; this becomes
 * "core beers" (the ones we never want to run out of) once Beer.core exists.
 */
export const plansFor = (b: { active: boolean }) => b.active;

export interface PlanTank {
  id: string;
  name: string;
  kind: TankKind;
  capacityBbl: number;
  sort: number;
  active: boolean;
}

export interface PlanBatch {
  id: string;
  code: string;
  /** Beer (or recipe) name, for wording. */
  name?: string;
  status: BrewStatus;
  bbl: number | null;
  fermentDays: number;
  conditionDays: number;
  plannedOn?: ISODate | null;
}

export interface PlanStay {
  id: string;
  tankId: string;
  batchId: string;
  start: ISODate;
  /** The day it comes out (exclusive); null = still in, no day out planned. */
  end: ISODate | null;
  planned: boolean;
}

export type Stage = "ferment" | "condition";

const LIVE: BrewStatus[] = ["PLANNED", "FERMENTING", "CONDITIONING"];
const IN_TANK: BrewStatus[] = ["FERMENTING", "CONDITIONING"];
export const isLive = (s: BrewStatus) => LIVE.includes(s);
export const isInTank = (s: BrewStatus) => IN_TANK.includes(s);

const KIND_ORDER: Record<TankKind, number> = { FERMENTER: 0, BRITE: 1, OTHER: 2 };
export const byTankOrder = (a: PlanTank, b: PlanTank) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sort - b.sort || a.name.localeCompare(b.name, undefined, { numeric: true });

const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 13". */
export const monthDay = (d: ISODate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

/** Fermenting or conditioning: by the tank, and for an "other" tank by where the brew is in its life. */
export function stageOf(kind: TankKind, status: BrewStatus, stayIndex = 0): Stage {
  if (kind === "FERMENTER") return "ferment";
  if (kind === "BRITE") return "condition";
  if (status === "CONDITIONING") return "condition";
  if (status === "FERMENTING") return "ferment";
  return stayIndex > 0 ? "condition" : "ferment";
}

/** The ids of stays that brews are in right now (their latest actual stay). */
export function currentStayIds(stays: PlanStay[], batches: PlanBatch[]): Set<string> {
  const status = new Map(batches.map((b) => [b.id, b.status]));
  const latest = new Map<string, PlanStay>();
  for (const s of stays) {
    if (s.planned || !isInTank(status.get(s.batchId) ?? "PACKAGED")) continue;
    const l = latest.get(s.batchId);
    if (!l || s.start > l.start || (s.start === l.start && s.end == null)) latest.set(s.batchId, s);
  }
  return new Set([...latest.values()].map((s) => s.id));
}

export interface Interval {
  stayId: string;
  tankId: string;
  batchId: string;
  start: ISODate;
  /** Exclusive: the day the tank is free again. */
  end: ISODate;
  planned: boolean;
  /** No day out recorded; `end` is worked out from the recipe. */
  open: boolean;
  /** The brew is in this tank now. */
  current: boolean;
  stage: Stage;
}

/** Days this stay is meant to last, from the recipe. */
const daysFor = (stage: Stage, b: PlanBatch) => Math.max(1, stage === "ferment" ? b.fermentDays : b.conditionDays);

/**
 * Every stay that holds a tank, as a [start, end) range. Planned stays of
 * brews that were packaged or dumped are left out (they never happened);
 * `exceptBatchId` leaves one brew out (when working out where to move it).
 */
export function stayIntervals(stays: PlanStay[], tanks: PlanTank[], batches: PlanBatch[], today: ISODate, opts: { exceptBatchId?: string } = {}): Interval[] {
  const tankById = new Map(tanks.map((t) => [t.id, t]));
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const current = currentStayIds(stays, batches);
  const order = new Map<string, number>();
  for (const b of batches) {
    const mine = stays.filter((s) => s.batchId === b.id).sort((x, y) => x.start.localeCompare(y.start));
    mine.forEach((s, i) => order.set(s.id, i));
  }
  const out: Interval[] = [];
  for (const s of stays) {
    const t = tankById.get(s.tankId);
    const b = batchById.get(s.batchId);
    if (!t || !b || s.batchId === opts.exceptBatchId) continue;
    if (s.planned && !isLive(b.status)) continue;
    const stage = stageOf(t.kind, b.status, order.get(s.id) ?? 0);
    const isCurrent = current.has(s.id);
    const due = s.end ?? addDays(s.start, daysFor(stage, b));
    const end = isCurrent ? maxDate(due, addDays(today, 1)) : due;
    out.push({ stayId: s.id, tankId: s.tankId, batchId: s.batchId, start: s.start, end: end > s.start ? end : addDays(s.start, 1), planned: s.planned, open: s.end == null, current: isCurrent, stage });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Half-open ranges: touching at a day boundary is not an overlap. */
export const overlaps = (a: { start: ISODate; end: ISODate }, b: { start: ISODate; end: ISODate }) => a.start < b.end && b.start < a.end;

export interface Clash {
  tankId: string;
  a: string;
  b: string;
  /** First day both are in the tank. */
  from: ISODate;
  /** Day the overlap ends (exclusive). */
  to: ISODate;
}

/** Two stays in one tank at once. With a window, only clashes that touch it. */
export function findClashes(intervals: Interval[], window?: { from: ISODate; to: ISODate }): Clash[] {
  const out: Clash[] = [];
  const byTank = new Map<string, Interval[]>();
  for (const i of intervals) byTank.set(i.tankId, [...(byTank.get(i.tankId) ?? []), i]);
  for (const [tankId, list] of byTank) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = list[x], b = list[y];
        if (!overlaps(a, b)) continue;
        const c = { tankId, a: a.stayId, b: b.stayId, from: maxDate(a.start, b.start), to: minDate(a.end, b.end) };
        if (window && !overlaps({ start: c.from, end: c.to }, { start: window.from, end: window.to })) continue;
        out.push(c);
      }
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** The brew is bigger than the tank. Unknown size never counts as too big. */
export const tooSmall = (tank: { capacityBbl: number }, batch: { bbl: number | null }) => batch.bbl != null && batch.bbl > tank.capacityBbl + 1e-9;

// ---- The floor: what's in each tank today ------------------------------------------------------

export interface StagePrompt {
  kind: "transfer" | "package";
  label: string;
  /** 0 = due today. */
  overdueDays: number;
}

export interface TankNow {
  stayId: string;
  batchId: string;
  start: ISODate;
  /** The day it should come out. */
  dueOn: ISODate;
  /** Days in the tank so far (brew or transfer day is day 0). */
  day: number;
  /** Days it is meant to spend in this tank. */
  of: number;
  stage: Stage;
  prompt: StagePrompt | null;
}

export interface FloorTank {
  tank: PlanTank;
  now: TankNow | null;
  /** The next brew booked into this tank (planned or not yet in). */
  next: { stayId: string; batchId: string; start: ISODate; planned: boolean } | null;
}

/** One entry per active tank: fermenters, then brites, then other. */
export function tankFloor(tanks: PlanTank[], stays: PlanStay[], batches: PlanBatch[], today: ISODate): FloorTank[] {
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const current = currentStayIds(stays, batches);
  return tanks.filter((t) => t.active).sort(byTankOrder).map((tank) => {
    const mine = stays.filter((s) => s.tankId === tank.id);
    const cur = mine.find((s) => current.has(s.id));
    let now: TankNow | null = null;
    if (cur) {
      const b = batchById.get(cur.batchId)!;
      const stage = stageOf(tank.kind, b.status);
      const dueOn = cur.end ?? addDays(cur.start, daysFor(stage, b));
      const day = daysBetween(cur.start, today);
      const late = daysBetween(dueOn, today);
      const kind = stage === "ferment" ? "transfer" : "package";
      now = {
        stayId: cur.id,
        batchId: cur.batchId,
        start: cur.start,
        dueOn,
        day,
        of: Math.max(1, daysBetween(cur.start, dueOn)),
        stage,
        prompt: late >= 0 ? { kind, label: kind === "transfer" ? "Ready to transfer?" : "Ready to package?", overdueDays: late } : null,
      };
    }
    const upcoming = mine
      .filter((s) => s.id !== cur?.id && batchById.has(s.batchId) && isLive(batchById.get(s.batchId)!.status) && (s.planned || s.start >= today))
      .filter((s) => !current.has(s.id))
      .sort((a, b) => a.start.localeCompare(b.start));
    const n = upcoming[0];
    return { tank, now, next: n ? { stayId: n.id, batchId: n.batchId, start: n.start, planned: n.planned } : null };
  });
}

// ---- Occupancy over a range -------------------------------------------------------------------

export interface Bar extends Interval {
  clash: boolean;
  tooSmall: boolean;
}

export interface TankRow {
  tank: PlanTank;
  bars: Bar[];
}

/** Each active tank's stays that touch [from, to), with clashes and too-small tanks marked. */
export function occupancy(tanks: PlanTank[], stays: PlanStay[], batches: PlanBatch[], from: ISODate, to: ISODate, today: ISODate): TankRow[] {
  const iv = stayIntervals(stays, tanks, batches, today);
  const clashes = findClashes(iv);
  const clashing = new Set(clashes.flatMap((c) => [c.a, c.b]));
  const batchById = new Map(batches.map((b) => [b.id, b]));
  return tanks.filter((t) => t.active).sort(byTankOrder).map((tank) => ({
    tank,
    bars: iv
      .filter((i) => i.tankId === tank.id && overlaps(i, { start: from, end: to }))
      .map((i) => ({ ...i, clash: clashing.has(i.stayId), tooSmall: tooSmall(tank, batchById.get(i.batchId)!) })),
  }));
}

// ---- Where a new brew fits ----------------------------------------------------------------------

export interface Busy {
  tankId: string;
  start: ISODate;
  end: ISODate;
}

export interface PlanBrewInput {
  brewOn: ISODate;
  bbl: number;
  fermentDays: number;
  conditionDays: number;
  tanks: PlanTank[];
  /** What already holds each tank (stayIntervals of everything else). */
  busy: Busy[];
  /** Longest the fermenter stay may stretch while waiting for a brite. */
  maxWaitDays?: number;
  /** How far ahead to look for an earliest date when nothing fits. */
  searchDays?: number;
}

export interface TankSlot {
  tankId: string;
  tankName: string;
  start: ISODate;
  end: ISODate;
}

export type BrewProposal =
  | { ok: true; fermenter: TankSlot; brite: TankSlot | null; packageOn: ISODate; slipDays: number; notes: string[] }
  | { ok: false; reason: string; earliest: ISODate | null };

const freeIn = (busy: Busy[], tankId: string, start: ISODate, end: ISODate) => !busy.some((b) => b.tankId === tankId && overlaps(b, { start, end }));

function fitOn(i: PlanBrewInput, brewOn: ISODate, fermenters: PlanTank[], brites: PlanTank[]): Extract<BrewProposal, { ok: true }> | null {
  const fd = Math.max(1, i.fermentDays), cd = Math.max(0, i.conditionDays);
  const slot = (t: PlanTank, start: ISODate, end: ISODate): TankSlot => ({ tankId: t.id, tankName: t.name, start, end });
  // No brite tanks (or nothing to condition): it stays in the fermenter the whole time.
  if (!brites.length || cd === 0) {
    const end = addDays(brewOn, fd + cd);
    const f = fermenters.find((t) => freeIn(i.busy, t.id, brewOn, end));
    if (!f) return null;
    const notes = cd > 0 ? [`No brite tank, so it conditions in ${f.name}.`] : [];
    return { ok: true, fermenter: slot(f, brewOn, end), brite: null, packageOn: end, slipDays: 0, notes };
  }
  const maxWait = i.maxWaitDays ?? 14;
  for (let slip = 0; slip <= maxWait; slip++) {
    const transfer = addDays(brewOn, fd + slip);
    const out = addDays(transfer, cd);
    for (const f of fermenters) {
      if (!freeIn(i.busy, f.id, brewOn, transfer)) continue;
      const b = brites.find((t) => freeIn(i.busy, t.id, transfer, out));
      if (!b) continue;
      const notes = slip > 0 ? [`No brite tank is free on ${monthDay(addDays(brewOn, fd))}, so it waits in ${f.name} ${plural(slip, "extra day")} and moves to ${b.name} on ${monthDay(transfer)}.`] : [];
      return { ok: true, fermenter: slot(f, brewOn, transfer), brite: slot(b, transfer, out), packageOn: out, slipDays: slip, notes };
    }
  }
  return null;
}

/**
 * Where a brew on `brewOn` would go: the first free fermenter (by tank order)
 * for the fermenting days, then the first free brite for the conditioning
 * days. When no brite is free on transfer day it looks a day later, and so
 * on, which keeps the beer in the fermenter longer (said in `notes`). When
 * nothing fits it says why, and the earliest brew day that would.
 */
export function planBrew(i: PlanBrewInput): BrewProposal {
  const active = i.tanks.filter((t) => t.active).sort(byTankOrder);
  const allFermenters = active.filter((t) => t.kind === "FERMENTER");
  if (!allFermenters.length) return { ok: false, reason: "There are no fermenters set up yet. Add them on Brewery → Setup.", earliest: null };
  const fermenters = allFermenters.filter((t) => !tooSmall(t, { bbl: i.bbl }));
  if (!fermenters.length) {
    const biggest = Math.max(...allFermenters.map((t) => t.capacityBbl));
    return { ok: false, reason: `This brew is ${i.bbl} bbl and the biggest fermenter holds ${biggest} bbl.`, earliest: null };
  }
  const allBrites = active.filter((t) => t.kind === "BRITE");
  const brites = allBrites.filter((t) => !tooSmall(t, { bbl: i.bbl }));
  if (allBrites.length && !brites.length && i.conditionDays > 0) {
    const biggest = Math.max(...allBrites.map((t) => t.capacityBbl));
    return { ok: false, reason: `This brew is ${i.bbl} bbl and the biggest brite tank holds ${biggest} bbl.`, earliest: null };
  }
  const fit = fitOn(i, i.brewOn, fermenters, brites);
  if (fit) return fit;
  const search = i.searchDays ?? 120;
  let earliest: ISODate | null = null;
  for (let d = 1; d <= search && !earliest; d++) if (fitOn(i, addDays(i.brewOn, d), fermenters, brites)) earliest = addDays(i.brewOn, d);
  const fermenterFree = fermenters.some((f) => freeIn(i.busy, f.id, i.brewOn, addDays(i.brewOn, Math.max(1, i.fermentDays))));
  const reason = fermenterFree
    ? `Every brite tank is busy when this brew would be ready to transfer${earliest ? "" : ", for months"}.`
    : `Every fermenter big enough is busy then.`;
  return { ok: false, reason: earliest ? `${reason} The first day that works is ${monthDay(earliest)}.` : reason, earliest };
}

// ---- Suggested brews ----------------------------------------------------------------------------

export interface SuggestBeer {
  id: string;
  name: string;
  active: boolean;
  /** When the forecast says its full kegs run out; null = no forecast. */
  runOutOn: ISODate | null;
  /** From its recipe; null = use the setup defaults. */
  fermentDays: number | null;
  conditionDays: number | null;
}

export interface SuggestBatch {
  id: string;
  code: string;
  beerId: string | null;
  status: BrewStatus;
  plannedOn: ISODate | null;
}

export interface BrewSuggestion {
  beerId: string;
  name: string;
  runOutOn: ISODate;
  /** Ferment + condition days. */
  leadDays: number;
  /** The last brew day that still has a full keg ready before the last one runs out. */
  brewBy: ISODate;
  /** Negative = already late. */
  daysToBrewBy: number;
  alreadyOut: boolean;
  /** late: too late to avoid running dry · soon: within two weeks · later · planned: a brew is on the way. */
  state: "late" | "soon" | "later" | "planned";
  planned: { batchId: string; code: string; on: ISODate | null; inTanks: boolean } | null;
}

/** Days before the brew-by date that count as "soon". */
export const SUGGEST_SOON_DAYS = 14;

/**
 * For each beer we plan for that has a forecast: the latest day to brew so a
 * full keg is ready (fermented and conditioned) before the last one runs out.
 * A brew already planned or in the tanks for that beer is shown with it.
 * Unplanned first, by brew-by date.
 */
export function suggestBrews(i: { today: ISODate; beers: SuggestBeer[]; defaults: { fermentDays: number; conditionDays: number }; batches: SuggestBatch[] }): BrewSuggestion[] {
  const out: BrewSuggestion[] = [];
  for (const b of i.beers) {
    if (!plansFor(b) || !b.runOutOn) continue;
    const leadDays = (b.fermentDays ?? i.defaults.fermentDays) + (b.conditionDays ?? i.defaults.conditionDays);
    const brewBy = addDays(b.runOutOn, -leadDays);
    const daysToBrewBy = daysBetween(i.today, brewBy);
    const coming = i.batches
      .filter((x) => x.beerId === b.id && isLive(x.status))
      .sort((x, y) => Number(isInTank(y.status)) - Number(isInTank(x.status)) || (x.plannedOn ?? "").localeCompare(y.plannedOn ?? ""))[0];
    const planned = coming ? { batchId: coming.id, code: coming.code, on: coming.plannedOn, inTanks: isInTank(coming.status) } : null;
    const state: BrewSuggestion["state"] = planned ? "planned" : daysToBrewBy < 0 ? "late" : daysToBrewBy <= SUGGEST_SOON_DAYS ? "soon" : "later";
    out.push({ beerId: b.id, name: b.name, runOutOn: b.runOutOn, leadDays, brewBy, daysToBrewBy, alreadyOut: b.runOutOn <= i.today, state, planned });
  }
  return out.sort((a, b) => Number(!!a.planned) - Number(!!b.planned) || a.brewBy.localeCompare(b.brewBy));
}

// ---- What needs doing --------------------------------------------------------------------------

export interface TodoItem {
  key: string;
  kind: "transfer" | "package" | "clash" | "brew";
  title: string;
  detail: string;
  tone: "bad" | "warn" | "neutral";
  on: ISODate;
  tankId?: string;
  batchId?: string;
}

/** Days overdue before a transfer or packaging turns red. */
export const OVERDUE_RED_DAYS = 3;

/**
 * The floor's "Needs doing": transfers and packaging due, clashes (pass the
 * ones in the window you care about), and brews planned for today or
 * tomorrow (or planned for a day that has passed and not marked brewed).
 */
export function needsDoing(i: { floor: FloorTank[]; clashes: Clash[]; batches: PlanBatch[]; tanks: PlanTank[]; today: ISODate }): TodoItem[] {
  const batchById = new Map(i.batches.map((b) => [b.id, b]));
  const tankName = new Map(i.tanks.map((t) => [t.id, t.name]));
  const due: TodoItem[] = [];
  for (const f of i.floor) {
    const p = f.now?.prompt;
    if (!f.now || !p) continue;
    const b = batchById.get(f.now.batchId);
    const name = b?.name ?? b?.code ?? "the brew";
    due.push({
      key: `${p.kind}.${f.now.stayId}`,
      kind: p.kind,
      title: `${f.tank.name}: ${p.kind} ${name}`,
      detail: `${p.overdueDays === 0 ? "Due today" : `${plural(p.overdueDays, "day")} overdue`} · day ${f.now.day} of ${f.now.of}`,
      tone: p.overdueDays >= OVERDUE_RED_DAYS ? "bad" : "warn",
      on: f.now.dueOn,
      tankId: f.tank.id,
      batchId: f.now.batchId,
    });
  }
  due.sort((a, b) => a.on.localeCompare(b.on));
  const clashes: TodoItem[] = i.clashes.map((c) => ({
    key: `clash.${c.a}.${c.b}`,
    kind: "clash",
    title: `Two brews in ${tankName.get(c.tankId) ?? "one tank"} at once`,
    detail: `${monthDay(c.from)} to ${monthDay(addDays(c.to, -1))} · move one on the schedule`,
    tone: c.from <= addDays(i.today, 2) ? "bad" : "warn",
    on: c.from,
    tankId: c.tankId,
  }));
  const tomorrow = addDays(i.today, 1);
  const brews: TodoItem[] = i.batches
    .filter((b) => b.status === "PLANNED" && b.plannedOn && b.plannedOn <= tomorrow)
    .sort((a, b) => (a.plannedOn ?? "").localeCompare(b.plannedOn ?? ""))
    .map((b) => {
      const name = b.name ?? b.code;
      const when = b.plannedOn!;
      const late = when < i.today;
      return {
        key: `brew.${b.id}`,
        kind: "brew" as const,
        title: late ? `${name} was planned for ${monthDay(when)}` : `Brew ${name} ${when === i.today ? "today" : "tomorrow"}`,
        detail: late ? "Mark it brewed, or move it on the schedule" : `${b.code}${b.bbl ? ` · ${b.bbl} bbl` : ""}`,
        tone: late ? ("warn" as const) : ("neutral" as const),
        on: when,
        batchId: b.id,
      };
    });
  return [...due, ...clashes, ...brews];
}

// ---- Numbers ------------------------------------------------------------------------------------

/** Next batch code for the year of `on`: "26-001", "26-002", … (codes not in that shape are ignored). */
export function nextBatchCode(on: ISODate, codes: string[]): string {
  const yy = on.slice(2, 4);
  let max = 0;
  for (const c of codes) {
    const m = /^(\d{2})-(\d{1,4})$/.exec(c.trim());
    if (m && m[1] === yy) max = Math.max(max, Number(m[2]));
  }
  return `${yy}-${String(max + 1).padStart(3, "0")}`;
}

/** ABV % from original and final gravity (the usual 131.25 rule); null when unknown or nonsense. */
export function abv(og: number | null | undefined, fg: number | null | undefined): number | null {
  if (og == null || fg == null || !(og > 1) || !(fg > 0.98) || fg >= og) return null;
  return (og - fg) * 131.25;
}

/** US beer barrel = 31 gal = 248 pints. */
export const PINTS_PER_BBL = 248;

export function costPerPint(cost: number | null | undefined, bbl: number | null | undefined): number | null {
  if (cost == null || bbl == null || !(bbl > 0)) return null;
  return cost / (bbl * PINTS_PER_BBL);
}
