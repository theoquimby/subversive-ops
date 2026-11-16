import "server-only";
import type { Prisma } from "@prisma/client";
import type { AttentionItem } from "@/domain/attention";
import { breweryAttentionItems, CLASH_WINDOW_DAYS } from "@/domain/breweryAttention";
import { addDays, type ISODate } from "@/domain/dates";
import { displayCode, kegSizeInfo, placeLabel, STATUS_META, type KegStatus } from "@/domain/kegs";
import {
  abv,
  costPerPint,
  findClashes,
  needsDoing,
  occupancy,
  stayIntervals,
  suggestBrews,
  tankFloor,
  type BrewStatus,
  type BrewSuggestion,
  type Clash,
  type FloorTank,
  type PlanBatch,
  type PlanStay,
  type PlanTank,
  type TankKind,
  type TankRow,
  type TodoItem,
} from "@/domain/tankPlan";
import { db, num } from "../db";
import { beerDemand } from "./kegs";
import { businessToday } from "./sales";

/**
 * The brewery's tanks and brews, read side: the floor (what's in each tank
 * today), the tank schedule, brews and one brew, suggested brews from keg
 * demand, and the Overview items. Writes are in breweryWrite.ts.
 */

export const DEFAULT_FERMENT_KEY = "brewery.defaultFermentDays";
export const DEFAULT_CONDITION_KEY = "brewery.defaultConditionDays";

export const iso = (d: Date | null | undefined): ISODate | null => (d ? d.toISOString().slice(0, 10) : null);
export const asDate = (s: ISODate) => new Date(`${s}T00:00:00Z`);

/** Days a beer usually ferments and conditions when its recipe doesn't say (14 and 7 until set). */
export async function breweryDefaults(): Promise<{ fermentDays: number; conditionDays: number }> {
  const rows = await db.setting.findMany({ where: { key: { in: [DEFAULT_FERMENT_KEY, DEFAULT_CONDITION_KEY] } } });
  const get = (k: string, d: number) => {
    const n = Number(rows.find((r) => r.key === k)?.value);
    return Number.isInteger(n) && n >= 0 && n <= 365 ? n : d;
  };
  return { fermentDays: get(DEFAULT_FERMENT_KEY, 14), conditionDays: get(DEFAULT_CONDITION_KEY, 7) };
}

// ---- Shapes the pages use ---------------------------------------------------------------------------

export interface TankView extends PlanTank {
  notes: string | null;
}

export interface BatchView {
  id: string;
  code: string;
  /** Beer name, else recipe name, else the code. */
  name: string;
  beerId: string | null;
  /** Beer board colour id (BEER_COLORS). */
  color: string | null;
  recipeId: string | null;
  recipeName: string | null;
  status: BrewStatus;
  bbl: number | null;
  og: number | null;
  fg: number | null;
  abv: number | null;
  cost: number | null;
  costPerPint: number | null;
  plannedOn: ISODate | null;
  brewedOn: ISODate | null;
  packagedOn: ISODate | null;
  fermentDays: number;
  conditionDays: number;
  kegBatchCode: string | null;
}

export interface RecipeOption {
  id: string;
  name: string;
  beerId: string | null;
  batchBbl: number;
  fermentDays: number;
  conditionDays: number;
}

export interface BeerOption {
  id: string;
  name: string;
  color: string;
}

const batchInclude = {
  beer: { select: { id: true, name: true, color: true } },
  recipe: { select: { id: true, name: true, fermentDays: true, conditionDays: true } },
  kegBatch: { select: { code: true } },
} as const;

type BatchRow = Awaited<ReturnType<typeof loadBatches>>[number];

function loadBatches(where: Prisma.BrewBatchWhereInput) {
  return db.brewBatch.findMany({ where, include: batchInclude, orderBy: [{ createdAt: "asc" }] });
}

export function toBatchView(b: BatchRow, defaults: { fermentDays: number; conditionDays: number }): BatchView {
  const og = num(b.og), fg = num(b.fg), bbl = num(b.bbl), cost = num(b.cost);
  return {
    id: b.id,
    code: b.code,
    name: b.beer?.name ?? b.recipe?.name ?? b.code,
    beerId: b.beerId,
    color: b.beer?.color ?? null,
    recipeId: b.recipeId,
    recipeName: b.recipe?.name ?? null,
    status: b.status,
    bbl,
    og,
    fg,
    abv: abv(og, fg),
    cost,
    costPerPint: costPerPint(cost, bbl),
    plannedOn: iso(b.plannedOn),
    brewedOn: iso(b.brewedOn),
    packagedOn: iso(b.packagedOn),
    fermentDays: b.recipe?.fermentDays ?? defaults.fermentDays,
    conditionDays: b.recipe?.conditionDays ?? defaults.conditionDays,
    kegBatchCode: b.kegBatch?.code ?? null,
  };
}

const toPlanBatch = (b: BatchView): PlanBatch => ({ id: b.id, code: b.code, name: b.name, status: b.status, bbl: b.bbl, fermentDays: b.fermentDays, conditionDays: b.conditionDays, plannedOn: b.plannedOn });

export async function loadTanks(): Promise<TankView[]> {
  const rows = await db.tank.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] });
  return rows.map((t) => ({ id: t.id, name: t.name, kind: t.kind as TankKind, capacityBbl: num(t.capacityBbl) ?? 0, sort: t.sort, active: t.active, notes: t.notes }));
}

/**
 * Everything the plan needs: every tank, every brew that is planned or in a
 * tank plus the ones whose stays touch the last `historyDays`, and their stays.
 */
export async function loadPlan(today: ISODate, historyDays = 120) {
  const since = asDate(addDays(today, -historyDays));
  const [tanks, defaults, rows] = await Promise.all([
    loadTanks(),
    breweryDefaults(),
    loadBatches({ OR: [{ status: { in: ["PLANNED", "FERMENTING", "CONDITIONING"] } }, { stays: { some: { OR: [{ end: null }, { end: { gte: since } }] } } }] }),
  ]);
  const stayRows = await db.tankStay.findMany({ where: { batchId: { in: rows.map((r) => r.id) } }, orderBy: { start: "asc" } });
  const batches = rows.map((b) => toBatchView(b, defaults));
  const stays: PlanStay[] = stayRows.map((s) => ({ id: s.id, tankId: s.tankId, batchId: s.batchId, start: iso(s.start)!, end: iso(s.end), planned: s.planned }));
  return { tanks, defaults, batches, planBatches: batches.map(toPlanBatch), stays };
}

export async function brewOptions(): Promise<{ recipes: RecipeOption[]; beers: BeerOption[] }> {
  const [recipes, beers] = await Promise.all([
    db.brewRecipe.findMany({ where: { status: { not: "archived" } }, orderBy: { name: "asc" }, select: { id: true, name: true, beerId: true, batchBbl: true, fermentDays: true, conditionDays: true } }),
    db.beer.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
  ]);
  return { recipes: recipes.map((r) => ({ ...r, batchBbl: num(r.batchBbl) ?? 7 })), beers };
}

// ---- The floor --------------------------------------------------------------------------------------

export interface BriteChoice {
  id: string;
  name: string;
  kind: TankKind;
  capacityBbl: number;
  /** Nothing in it now. */
  freeNow: boolean;
  /** Next booking by another brew, if any. */
  bookedFrom: ISODate | null;
}

export interface FloorView {
  today: ISODate;
  tanks: (FloorTank & { tank: TankView })[];
  batches: Record<string, BatchView>;
  todos: TodoItem[];
  /** Where a brew can be transferred to (brite and other tanks). */
  transferTo: BriteChoice[];
  /** Brite tanks pencilled in for each brew (batchId → tankId). */
  plannedBrite: Record<string, string>;
  recipes: RecipeOption[];
  beers: BeerOption[];
  defaults: { fermentDays: number; conditionDays: number };
  stats: { fermenting: number; conditioning: number; plannedNext14: number; bblInTanks: number };
}

export async function tanksFloor(): Promise<FloorView> {
  const today = businessToday();
  const [{ tanks, defaults, batches, planBatches, stays }, opts] = await Promise.all([loadPlan(today), brewOptions()]);
  const floor = tankFloor(tanks, stays, planBatches, today) as (FloorTank & { tank: TankView })[];
  const iv = stayIntervals(stays, tanks, planBatches, today);
  const clashes = findClashes(iv, { from: today, to: addDays(today, CLASH_WINDOW_DAYS) });
  const todos = needsDoing({ floor, clashes, batches: planBatches, tanks, today });
  const transferTo: BriteChoice[] = tanks
    .filter((t) => t.active && t.kind !== "FERMENTER")
    .sort((a, b) => (a.kind === b.kind ? a.sort - b.sort : a.kind === "BRITE" ? -1 : 1))
    .map((t) => {
      const mine = iv.filter((i) => i.tankId === t.id);
      const next = mine.filter((i) => i.start > today && !i.current).sort((a, b) => a.start.localeCompare(b.start))[0];
      return { id: t.id, name: t.name, kind: t.kind, capacityBbl: t.capacityBbl, freeNow: !mine.some((i) => i.current || (i.start <= today && i.end > today && !i.planned)), bookedFrom: next?.start ?? null };
    });
  const plannedBrite: Record<string, string> = {};
  const kindOf = new Map(tanks.map((t) => [t.id, t.kind]));
  for (const s of stays) if (s.planned && kindOf.get(s.tankId) !== "FERMENTER" && !plannedBrite[s.batchId]) plannedBrite[s.batchId] = s.tankId;
  const inTank = batches.filter((b) => b.status === "FERMENTING" || b.status === "CONDITIONING");
  return {
    today,
    tanks: floor,
    batches: Object.fromEntries(batches.map((b) => [b.id, b])),
    todos,
    transferTo,
    plannedBrite,
    ...opts,
    defaults,
    stats: {
      fermenting: batches.filter((b) => b.status === "FERMENTING").length,
      conditioning: batches.filter((b) => b.status === "CONDITIONING").length,
      plannedNext14: batches.filter((b) => b.status === "PLANNED" && b.plannedOn && b.plannedOn >= today && b.plannedOn < addDays(today, 14)).length,
      bblInTanks: inTank.reduce((s, b) => s + (b.bbl ?? 0), 0),
    },
  };
}

// ---- Suggested brews ---------------------------------------------------------------------------------

/** Run-out dates are worked out from all sales history: kept for 10 minutes. */
let runOutCache: { at: number; today: ISODate; rows: { beerId: string; runOutOn: ISODate | null }[] } | null = null;

async function runOutDates(today: ISODate) {
  if (runOutCache && runOutCache.today === today && Date.now() - runOutCache.at < 600_000) return runOutCache.rows;
  const { rows } = await beerDemand();
  const out = rows.map((r) => ({ beerId: r.beerId, runOutOn: r.plan.runOutDays != null ? addDays(today, Math.floor(r.plan.runOutDays)) : null }));
  runOutCache = { at: Date.now(), today, rows: out };
  return out;
}

/** Suggested brews from keg demand, with brews already planned or in tanks for each beer. */
export async function brewSuggestions(today: ISODate = businessToday()): Promise<BrewSuggestion[]> {
  const [runOut, beers, recipes, live, defaults] = await Promise.all([
    runOutDates(today),
    db.beer.findMany({ select: { id: true, name: true, active: true, core: true } }),
    db.brewRecipe.findMany({ where: { status: "live", beerId: { not: null } }, orderBy: { updatedAt: "desc" }, select: { beerId: true, fermentDays: true, conditionDays: true } }),
    db.brewBatch.findMany({ where: { status: { in: ["PLANNED", "FERMENTING", "CONDITIONING"] } }, select: { id: true, code: true, beerId: true, status: true, plannedOn: true } }),
    breweryDefaults(),
  ]);
  const runOutOf = new Map(runOut.map((r) => [r.beerId, r.runOutOn]));
  return suggestBrews({
    today,
    defaults,
    beers: beers.map((b) => {
      const r = recipes.find((x) => x.beerId === b.id);
      return { id: b.id, name: b.name, active: b.active, core: b.core, runOutOn: runOutOf.get(b.id) ?? null, fermentDays: r?.fermentDays ?? null, conditionDays: r?.conditionDays ?? null };
    }),
    batches: live.map((b) => ({ ...b, plannedOn: iso(b.plannedOn) })),
  });
}

// ---- The schedule -----------------------------------------------------------------------------------

export interface ScheduleView {
  today: ISODate;
  from: ISODate;
  to: ISODate;
  rows: (TankRow & { tank: TankView })[];
  batches: Record<string, BatchView>;
  clashes: Clash[];
  /** Upcoming planned brews, soonest first. */
  planned: BatchView[];
  /** Brews by month for the year (this January through the last month with a brew). */
  months: { month: string; brews: BatchView[] }[];
  suggestions: BrewSuggestion[];
  /** The stays behind each planned brew (for its fermenter and brite). */
  plannedStays: Record<string, { tankId: string; tankName: string; start: ISODate; end: ISODate | null }[]>;
  tanks: TankView[];
  recipes: RecipeOption[];
  beers: BeerOption[];
  defaults: { fermentDays: number; conditionDays: number };
}

export async function scheduleView(weeks = 12): Promise<ScheduleView> {
  const today = businessToday();
  // Start on this week's Monday so the columns are whole weeks.
  const wd = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = addDays(today, -wd);
  const to = addDays(from, weeks * 7);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const [{ tanks, defaults, batches, planBatches, stays }, opts, suggestions, yearRows] = await Promise.all([
    loadPlan(today),
    brewOptions(),
    brewSuggestions(today).catch((e) => {
      console.error("brewery: suggestions failed", (e as Error).message);
      return [] as BrewSuggestion[];
    }),
    loadBatches({ OR: [{ brewedOn: { gte: asDate(yearStart) } }, { plannedOn: { gte: asDate(yearStart) } }] }),
  ]);
  const rows = occupancy(tanks, stays, planBatches, from, to, today) as (TankRow & { tank: TankView })[];
  const clashes = findClashes(stayIntervals(stays, tanks, planBatches, today), { from: today, to });
  const planned = batches.filter((b) => b.status === "PLANNED").sort((a, b) => (a.plannedOn ?? "9").localeCompare(b.plannedOn ?? "9"));
  const tankName = new Map(tanks.map((t) => [t.id, t.name]));
  const plannedStays: ScheduleView["plannedStays"] = {};
  for (const s of stays) {
    if (!s.planned) continue;
    (plannedStays[s.batchId] ??= []).push({ tankId: s.tankId, tankName: tankName.get(s.tankId) ?? "?", start: s.start, end: s.end });
  }
  const year = new Map<string, BatchView>();
  for (const b of [...yearRows.map((r) => toBatchView(r, defaults)), ...batches]) year.set(b.id, b);
  const when = (b: BatchView) => b.brewedOn ?? b.plannedOn;
  const dated = [...year.values()].filter((b) => when(b) && when(b)! >= yearStart && b.status !== "DUMPED").sort((a, b) => when(a)!.localeCompare(when(b)!));
  const lastMonth = dated.length ? when(dated[dated.length - 1])!.slice(0, 7) : "";
  const end = lastMonth > `${today.slice(0, 4)}-12` ? lastMonth : `${today.slice(0, 4)}-12`;
  const months: ScheduleView["months"] = [];
  for (let m = yearStart.slice(0, 7); m <= end; m = nextMonth(m)) months.push({ month: m, brews: dated.filter((b) => when(b)!.startsWith(m)) });
  return { today, from, to, rows, batches: Object.fromEntries(batches.map((b) => [b.id, b])), clashes, planned, months, suggestions, plannedStays, tanks, ...opts, defaults };
}

const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

// ---- Brews ------------------------------------------------------------------------------------------

export async function batchList(): Promise<BatchView[]> {
  const [defaults, rows] = await Promise.all([breweryDefaults(), loadBatches({})]);
  const order: Record<BrewStatus, number> = { FERMENTING: 0, CONDITIONING: 0, PLANNED: 1, PACKAGED: 2, DUMPED: 3 };
  const when = (b: BatchView) => b.brewedOn ?? b.plannedOn ?? "";
  return rows.map((r) => toBatchView(r, defaults)).sort((a, b) => order[a.status] - order[b.status] || when(b).localeCompare(when(a)) || b.code.localeCompare(a.code));
}

export interface GravityReading {
  on: ISODate;
  sg: number;
  kind: "og" | "fg" | "reading";
  note: string | null;
}

export interface BatchDetail {
  today: ISODate;
  batch: BatchView & { notes: string | null; dumped: { on: ISODate; reason: string } | null; createdAt: string };
  stays: { id: string; tankId: string; tankName: string; kind: TankKind; start: ISODate; end: ISODate | null; planned: boolean; days: number | null; current: boolean }[];
  readings: GravityReading[];
  kegBatch: {
    id: string;
    code: string;
    packagedOn: ISODate | null;
    filled: number;
    bySize: { label: string; n: number }[];
    /** Kegs still holding this batch, by where they are. */
    now: { label: string; n: number }[];
    kegs: { code: string; display: string; size: string; filledOn: ISODate | null; status: string | null; place: string | null; holding: boolean }[];
  } | null;
  tanks: TankView[];
  recipes: RecipeOption[];
  beers: BeerOption[];
}

/** Gravity readings and dump details kept in BrewBatch.extra. */
export function readExtra(extra: unknown): { readings: GravityReading[]; dumped: { on: ISODate; reason: string } | null } {
  const e = (extra && typeof extra === "object" ? extra : {}) as { readings?: unknown; dumped?: unknown };
  const readings = Array.isArray(e.readings)
    ? e.readings.filter((r): r is GravityReading => !!r && typeof r === "object" && typeof (r as GravityReading).sg === "number" && typeof (r as GravityReading).on === "string")
    : [];
  const d = e.dumped as { on?: unknown; reason?: unknown } | undefined;
  return { readings: readings.sort((a, b) => a.on.localeCompare(b.on)), dumped: d && typeof d.on === "string" ? { on: d.on, reason: String(d.reason ?? "") } : null };
}

export async function batchDetail(id: string): Promise<BatchDetail | null> {
  const today = businessToday();
  const [defaults, row, tanks, opts] = await Promise.all([
    breweryDefaults(),
    db.brewBatch.findUnique({ where: { id }, include: { ...batchInclude, stays: { include: { tank: true }, orderBy: { start: "asc" } } } }),
    loadTanks(),
    brewOptions(),
  ]);
  if (!row) return null;
  const view = toBatchView(row, defaults);
  const { readings, dumped } = readExtra(row.extra);
  const lastActual = [...row.stays].filter((s) => !s.planned).pop();
  const stays = row.stays.map((s) => {
    const start = iso(s.start)!, end = iso(s.end);
    const current = (row.status === "FERMENTING" || row.status === "CONDITIONING") && s.id === lastActual?.id;
    return { id: s.id, tankId: s.tankId, tankName: s.tank.name, kind: s.tank.kind as TankKind, start, end, planned: s.planned, current, days: end ? Math.round((asDate(end).getTime() - asDate(start).getTime()) / 86_400_000) : current ? Math.round((asDate(today).getTime() - asDate(start).getTime()) / 86_400_000) : null };
  });
  let kegBatch: BatchDetail["kegBatch"] = null;
  if (row.kegBatchId) {
    const kb = await db.kegBatch.findUnique({
      where: { id: row.kegBatchId },
      include: { fills: { orderBy: { filledOn: "asc" }, include: { keg: { include: { spot: { select: { name: true } }, account: { select: { name: true } } } }, current: { select: { id: true } } } } },
    });
    if (kb) {
      const kegs = kb.fills.map((f) => {
        const holding = !!f.current;
        const k = f.keg;
        const status = k.status as KegStatus;
        return {
          code: k.code,
          display: displayCode(k.code),
          size: kegSizeInfo(k.sizeId).short,
          filledOn: iso(f.filledOn),
          status: holding ? STATUS_META[status].short : null,
          place: holding ? placeLabel({ area: k.area, spot: k.spot?.name, spotNote: k.spotNote, tapLine: k.tapLine, account: k.account?.name, status }) : null,
          holding,
        };
      });
      const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].map(([label, n]) => ({ label, n }));
      kegBatch = {
        id: kb.id,
        code: kb.code,
        packagedOn: iso(kb.packagedOn),
        filled: kegs.length,
        bySize: count(kegs.map((k) => k.size)),
        now: count(kegs.filter((k) => k.holding).map((k) => k.status!)),
        kegs,
      };
    }
  }
  return {
    today,
    batch: { ...view, notes: row.notes, dumped, createdAt: row.createdAt.toISOString() },
    stays,
    readings,
    kegBatch,
    tanks,
    ...opts,
  };
}

// ---- Overview ---------------------------------------------------------------------------------------

/** Brewery items for "Needs you" (and the morning brief). Empty until there are tanks. */
export async function breweryNeedsYou(today: ISODate = businessToday()): Promise<AttentionItem[]> {
  if ((await db.tank.count({ where: { active: true } })) === 0) return [];
  const { tanks, planBatches, stays } = await loadPlan(today, 30);
  const floor = tankFloor(tanks, stays, planBatches, today);
  const clashes = findClashes(stayIntervals(stays, tanks, planBatches, today), { from: today, to: addDays(today, CLASH_WINDOW_DAYS) });
  const todos = needsDoing({ floor, clashes, batches: planBatches, tanks, today });
  const suggestions = await brewSuggestions(today).catch((e) => {
    console.error("brewery: suggestions failed", (e as Error).message);
    return [] as BrewSuggestion[];
  });
  return breweryAttentionItems({ today, todos, suggestions });
}
