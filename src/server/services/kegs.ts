import "server-only";
import { Prisma, type KegStatus as DbStatus } from "@prisma/client";
import { forecastBeer, monthProfile, planBeer, runOutFinding, seasonalIndex, weeklyTotals, type BeerForecast, type BeerPlan, type RunOutFinding } from "@/domain/beerDemand";
import { addDays, businessDate, type ISODate } from "@/domain/dates";
import { applyKegAction, isFull, kegOz, legacyCandidates, newKegCode, normalizeCode, parseScan, placeLabel, UNDO_SERVER_SECONDS, type ActionInput, type KegActionId, type KegState, type KegStatus } from "@/domain/kegs";
import { calibrateYield, dollarsPerOz, ozBetween, ozByBeerDay, shareFromHours, splitItemName, tapEstimate, unmatchedDraftNames, type BeerMatcher, type TapEstimate } from "@/domain/kegPours";
import { localMinutes } from "@/domain/timecards";
import { db } from "../db";
import { env } from "../env";
import { storageAreas } from "./inventory";
import { businessToday } from "./sales";

/**
 * Kegs: lookups for a scan, the one-tap actions (with undo), what's on tap
 * and how much is left, the walk-in board, and demand per beer. Pure logic
 * lives in domain/kegs, kegPours and beerDemand; this composes it with the
 * database.
 */

const tz = () => env.BUSINESS_TIMEZONE;

// ---- Settings -------------------------------------------------------------------------------

export interface KegConfig {
  /** How many tap lines the bar has. */
  tapLines: number;
  /** Where kegs on tap live (and where a kicked keg sits until it's moved). */
  tapArea: string;
  /** The usual cold storage, offered first for "Into the walk-in". */
  coldArea: string;
  /** Pour sizes by Square variation name (lowercase) → fl oz; 0 = not from a keg. */
  pours: Record<string, number>;
  /** Days from "fill it" to a cold keg ready to pour, for run-out alerts. */
  fillDays: number;
}

const CONFIG_KEY = "kegs.config";
const DEFAULT_CONFIG: KegConfig = { tapLines: 12, tapArea: "Bar", coldArea: "Walk-in", pours: {}, fillDays: 7 };

export async function kegConfig(): Promise<KegConfig> {
  const row = await db.setting.findUnique({ where: { key: CONFIG_KEY } });
  try {
    const v = row ? (JSON.parse(row.value) as Partial<KegConfig>) : {};
    return {
      tapLines: Number.isInteger(v.tapLines) && v.tapLines! > 0 && v.tapLines! <= 60 ? v.tapLines! : DEFAULT_CONFIG.tapLines,
      tapArea: typeof v.tapArea === "string" && v.tapArea.trim() ? v.tapArea : DEFAULT_CONFIG.tapArea,
      coldArea: typeof v.coldArea === "string" && v.coldArea.trim() ? v.coldArea : DEFAULT_CONFIG.coldArea,
      pours: v.pours && typeof v.pours === "object" ? Object.fromEntries(Object.entries(v.pours).filter(([, n]) => typeof n === "number" && n >= 0 && n <= 200)) : {},
      fillDays: Number.isFinite(v.fillDays) && v.fillDays! > 0 && v.fillDays! < 90 ? v.fillDays! : DEFAULT_CONFIG.fillDays,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveKegConfig(patch: Partial<KegConfig>) {
  const value = JSON.stringify({ ...(await kegConfig()), ...patch });
  await db.setting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value }, update: { value } });
}

/** Storage areas for kegs: the Count areas plus any area a keg or spot uses, cold storage first. */
export async function kegAreas(): Promise<string[]> {
  const [areas, cfg, used, spots] = await Promise.all([
    storageAreas(),
    kegConfig(),
    db.keg.findMany({ where: { area: { not: null } }, distinct: ["area"], select: { area: true } }),
    db.kegSpot.findMany({ distinct: ["area"], select: { area: true } }),
  ]);
  const all = [...areas, ...used.map((u) => u.area!), ...spots.map((s) => s.area), cfg.tapArea, cfg.coldArea];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of all) if (a && !seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); out.push(a); }
  const rank = (a: string) => (a.toLowerCase() === cfg.coldArea.toLowerCase() ? -1 : /keg|walk.?in|cooler|cold/i.test(a) ? 0 : a === cfg.tapArea ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

// ---- Codes ------------------------------------------------------------------------------------

/** N new unique codes. */
export async function freshCodes(n: number): Promise<string[]> {
  const out = new Set<string>();
  while (out.size < n) {
    const batch = Array.from({ length: Math.max(8, (n - out.size) * 2) }, () => newKegCode());
    const taken = new Set((await db.keg.findMany({ where: { code: { in: batch } }, select: { code: true } })).map((k) => k.code));
    for (const c of batch) if (!taken.has(c) && out.size < n) out.add(c);
  }
  return [...out];
}

/** The keg a scan or typed code points at: our code, then an old sticker's code. */
export async function findKegByScan(text: string): Promise<{ id: string; code: string } | null> {
  const p = parseScan(text);
  if (!p) return null;
  const ours = p.code ? await db.keg.findUnique({ where: { code: p.code }, select: { id: true, code: true } }) : null;
  if (ours) return ours;
  const cands = legacyCandidates(text);
  const legacy = await db.keg.findFirst({ where: { OR: cands.map((c) => ({ legacyCode: { equals: c, mode: "insensitive" as const } })) }, select: { id: true, code: true } });
  if (legacy) return legacy;
  // Imported codes are stored as printed; compare normalized as a last resort.
  const norm = normalizeCode(text);
  if (!norm) return null;
  const rows = await db.$queryRaw<{ id: string; code: string }[]>`SELECT id, code FROM "Keg" WHERE regexp_replace(upper(coalesce("legacyCode", '')), '[^A-Z0-9]', '', 'g') = ${norm} LIMIT 1`;
  return rows[0] ?? null;
}

// ---- Sales → ounces ------------------------------------------------------------------------------

export async function beerMatchers(): Promise<(BeerMatcher & { color: string; minFull: number; house: boolean; active: boolean })[]> {
  return db.beer.findMany({ select: { id: true, name: true, squareNames: true, color: true, minFull: true, house: true, active: true }, orderBy: { name: "asc" } });
}

/** Fl oz per Square id from linked pour recipes (draft beer costing), when the recipe says so. */
async function recipeOzBySquareId(): Promise<Record<string, number>> {
  const maps = await db.squareMapping.findMany({ where: { recipeId: { not: null } }, select: { squareId: true, recipe: { select: { category: true, lines: { select: { qty: true, unit: true, ingredient: { select: { category: true } } } } } } } });
  const out: Record<string, number> = {};
  for (const m of maps) {
    const oz = (m.recipe?.lines ?? []).filter((l) => /^(fl ?oz|oz)$/i.test(l.unit.trim()) && (l.ingredient?.category === "Beer" || m.recipe?.category === "Beer")).reduce((s, l) => s + l.qty.toNumber(), 0);
    if (oz > 0) out[m.squareId] = oz;
  }
  return out;
}

/** Square lines whose name could be a beer pour, from a date (inclusive). */
async function draftSaleRows(from: ISODate, beers: BeerMatcher[]) {
  // Only names that match a beer: find the distinct names once, then pull their rows.
  const names = await db.$queryRaw<{ squareId: string; name: string }[]>`SELECT DISTINCT "squareId", name FROM "DailySale" WHERE date >= ${new Date(`${from}T00:00:00Z`)}::date`;
  const keep = names.filter((n) => {
    const { base } = splitItemName(n.name);
    const k = base.toLowerCase().replace(/[*™®]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    return beers.some((b) => [b.name, ...b.squareNames].some((s) => s.toLowerCase().replace(/[*™®]/g, "").replace(/[^a-z0-9]+/g, " ").trim() === k));
  });
  if (!keep.length) return [];
  const ids = [...new Set(keep.map((k) => k.squareId))];
  const rows = await db.dailySale.findMany({ where: { squareId: { in: ids }, date: { gte: new Date(`${from}T00:00:00Z`) } }, select: { date: true, squareId: true, name: true, qty: true, netSales: true } });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), squareId: r.squareId, name: r.name, qty: r.qty.toNumber(), netSales: r.netSales.toNumber() }));
}

/** Daily oz per beer since `from`, plus $ per oz over the same rows. */
export async function beerOz(from: ISODate) {
  const [beers, cfg, recipeOz] = await Promise.all([beerMatchers(), kegConfig(), recipeOzBySquareId()]);
  const rows = await draftSaleRows(from, beers);
  const oz = ozByBeerDay(rows, beers, { overrides: cfg.pours, recipeOz });
  const recent = addDays(businessToday(), -120);
  const perOz = dollarsPerOz(rows.filter((r) => r.date >= recent), beers, { overrides: cfg.pours, recipeOz });
  return { beers, oz, perOz };
}

/** Store sales by hour for these dates (for the share of a day after a keg was tapped). */
async function hourlyProfiles(dates: ISODate[]): Promise<Map<ISODate, number[]>> {
  if (!dates.length) return new Map();
  const rows = await db.hourlySale.findMany({ where: { date: { in: dates.map((d) => new Date(`${d}T00:00:00Z`)) } }, select: { date: true, hour: true, netSales: true } });
  const out = new Map<ISODate, number[]>();
  for (const r of rows) {
    const d = r.date.toISOString().slice(0, 10);
    const arr = out.get(d) ?? Array.from({ length: 24 }, () => 0);
    if (r.hour >= 0 && r.hour < 24) arr[r.hour] += r.netSales.toNumber();
    out.set(d, arr);
  }
  return out;
}

const dayHour = (t: Date) => ({ date: businessDate(t, tz()), hour: Math.floor(localMinutes(t, tz()) / 60) });

// ---- Yield --------------------------------------------------------------------------------------

export interface YieldInfo {
  yield: number;
  samples: number;
  pintsPerHalf: number;
  measured: boolean;
  /** Recent kicks with what Square says was poured. */
  kicks: { kegCode: string; beer: string; sizeId: string; tappedAt: Date; kickedAt: Date; soldOz: number; kegOz: number }[];
}

/** Real yield from kegs kicked in the last year (Square oz ÷ keg oz). */
export async function yieldInfo(): Promise<YieldInfo> {
  const since = addDays(businessToday(), -365);
  const fills = await db.kegFill.findMany({
    where: { kickedAt: { not: null, gte: new Date(`${since}T00:00:00Z`) }, tappedAt: { not: null }, beerId: { not: null } },
    include: { keg: { select: { code: true, sizeId: true } }, beer: { select: { name: true } } },
    orderBy: { kickedAt: "desc" },
    take: 60,
  });
  if (!fills.length) return { ...calibrateYield([]), kicks: [] };
  const from = fills.reduce((m, f) => (dayHour(f.tappedAt!).date < m ? dayHour(f.tappedAt!).date : m), businessToday());
  const [{ oz }, overlapping] = await Promise.all([
    beerOz(from),
    db.kegFill.findMany({ where: { tappedAt: { not: null }, beerId: { in: [...new Set(fills.map((f) => f.beerId!))] }, OR: [{ kickedAt: null }, { kickedAt: { gte: new Date(`${from}T00:00:00Z`) } }] }, select: { id: true, beerId: true, tappedAt: true, kickedAt: true } }),
  ]);
  const dates = new Set<ISODate>();
  for (const f of fills) { dates.add(dayHour(f.tappedAt!).date); dates.add(dayHour(f.kickedAt!).date); }
  const hours = await hourlyProfiles([...dates]);
  const share = (d: ISODate, a: number, b: number) => shareFromHours(hours.get(d), a, b);
  const kicks = fills.map((f) => {
    const sold = ozBetween(oz.get(f.beerId!), dayHour(f.tappedAt!), dayHour(f.kickedAt!), share);
    // Two kegs of the same beer on at once share the pours.
    const others = overlapping.filter((o) => o.id !== f.id && o.beerId === f.beerId && o.tappedAt! < f.kickedAt! && (o.kickedAt ?? new Date()) > f.tappedAt!).length;
    return { kegCode: f.keg.code, beer: f.beer?.name ?? "", sizeId: f.keg.sizeId, tappedAt: f.tappedAt!, kickedAt: f.kickedAt!, soldOz: sold / (1 + others), kegOz: kegOz(f.keg.sizeId) };
  });
  return { ...calibrateYield(kicks), kicks };
}

// ---- Taps ---------------------------------------------------------------------------------------

export interface TapRow {
  line: number;
  keg: { id: string; code: string; sizeId: string; beer: string | null; beerId: string | null; color: string; tappedAt: Date | null } | null;
  estimate: (TapEstimate & { soldOz: number }) | null;
  /** Kegs of the same beer ready behind it. */
  backups: number;
}

/** Every tap line with what's on it, since when, and how much is left. */
export async function tapBoard(): Promise<{ taps: TapRow[]; yield: YieldInfo; config: KegConfig }> {
  const [cfg, onTap, yi] = await Promise.all([
    kegConfig(),
    db.keg.findMany({ where: { status: "ON_TAP", active: true }, include: { beer: { select: { name: true, color: true } }, fill: true }, orderBy: { tapLine: "asc" } }),
    yieldInfo(),
  ]);
  const today = businessToday();
  const earliest = onTap.reduce((m, k) => {
    const t = k.fill?.tappedAt ?? k.statusAt;
    const d = dayHour(t).date;
    return d < m ? d : m;
  }, addDays(today, -28));
  const [{ oz }, full] = await Promise.all([
    beerOz(earliest < addDays(today, -28) ? earliest : addDays(today, -28)),
    db.keg.groupBy({ by: ["beerId"], where: { active: true, status: { in: ["FILLED", "COLD"] }, beerId: { not: null } }, _count: { _all: true } }),
  ]);
  const hours = await hourlyProfiles(onTap.map((k) => dayHour(k.fill?.tappedAt ?? k.statusAt).date));
  const share = (d: ISODate, a: number, b: number) => shareFromHours(hours.get(d), a, b);
  const fullBy = new Map(full.map((f) => [f.beerId, f._count._all]));
  const perBeerOnTap = new Map<string, number>();
  for (const k of onTap) if (k.beerId) perBeerOnTap.set(k.beerId, (perBeerOnTap.get(k.beerId) ?? 0) + 1);

  const pace = (beerId: string) => {
    const days = oz.get(beerId);
    if (!days) return null;
    let s = 0;
    for (let i = 1; i <= 28; i++) s += days.get(addDays(today, -i)) ?? 0;
    return s > 0 ? s / 28 : null;
  };

  const byLine = new Map(onTap.filter((k) => k.tapLine).map((k) => [k.tapLine!, k]));
  const lines = Math.max(cfg.tapLines, ...onTap.map((k) => k.tapLine ?? 0));
  const taps: TapRow[] = [];
  for (let line = 1; line <= lines; line++) {
    const k = byLine.get(line);
    if (!k) { taps.push({ line, keg: null, estimate: null, backups: 0 }); continue; }
    const tappedAt = k.fill?.tappedAt ?? k.statusAt;
    const share1 = k.beerId ? perBeerOnTap.get(k.beerId) ?? 1 : 1;
    const sold = k.beerId ? ozBetween(oz.get(k.beerId), dayHour(tappedAt), null, share) / share1 : 0;
    const p = k.beerId ? pace(k.beerId) : null;
    taps.push({
      line,
      keg: { id: k.id, code: k.code, sizeId: k.sizeId, beer: k.beer?.name ?? null, beerId: k.beerId, color: k.beer?.color ?? "grey", tappedAt },
      estimate: { ...tapEstimate(kegOz(k.sizeId), yi.yield, sold, p ? p / share1 : null), soldOz: sold },
      backups: k.beerId ? fullBy.get(k.beerId) ?? 0 : 0,
    });
  }
  // Kegs on tap with no line number go at the end.
  for (const k of onTap.filter((x) => !x.tapLine)) taps.push({ line: 0, keg: { id: k.id, code: k.code, sizeId: k.sizeId, beer: k.beer?.name ?? null, beerId: k.beerId, color: k.beer?.color ?? "grey", tappedAt: k.fill?.tappedAt ?? k.statusAt }, estimate: null, backups: 0 });
  return { taps, yield: yi, config: cfg };
}

// ---- Stock and the walk-in ------------------------------------------------------------------------

export interface BoardKeg {
  id: string;
  code: string;
  sizeId: string;
  status: KegStatus;
  beer: string | null;
  beerId: string | null;
  color: string;
  area: string | null;
  spotId: string | null;
  spotNote: string | null;
  filledOn: string | null;
  bestBy: string | null;
  since: Date;
}

export async function coolerBoard() {
  const [areas, spots, kegs, beers] = await Promise.all([
    kegAreas(),
    db.kegSpot.findMany({ orderBy: [{ area: "asc" }, { sort: "asc" }, { name: "asc" }] }),
    db.keg.findMany({ where: { active: true, status: { notIn: ["OUT", "ON_TAP"] } }, include: { beer: { select: { name: true, color: true } }, fill: { select: { filledOn: true, bestBy: true } } }, orderBy: [{ statusAt: "asc" }] }),
    beerMatchers(),
  ]);
  const rows: BoardKeg[] = kegs.map((k) => ({
    id: k.id, code: k.code, sizeId: k.sizeId, status: k.status as KegStatus, beer: k.beer?.name ?? null, beerId: k.beerId, color: k.beer?.color ?? "grey",
    area: k.area, spotId: k.spotId, spotNote: k.spotNote, filledOn: k.fill?.filledOn?.toISOString().slice(0, 10) ?? null, bestBy: k.fill?.bestBy?.toISOString().slice(0, 10) ?? null, since: k.statusAt,
  }));
  // Areas that hold kegs or spots, cold storage first; others stay pickable for moves.
  const used = new Set([...rows.map((r) => r.area).filter(Boolean), ...spots.map((s) => s.area)] as string[]);
  return { areas, boardAreas: areas.filter((a) => used.has(a)), spots: spots.map((s) => ({ id: s.id, area: s.area, name: s.name, sort: s.sort })), kegs: rows, beers: beers.filter((b) => b.active) };
}

/** Full kegs, on tap, out and empties per beer, plus empties waiting overall. */
export async function stockSummary() {
  const rows = await db.keg.groupBy({ by: ["beerId", "status"], where: { active: true }, _count: { _all: true } });
  const beers = await beerMatchers();
  const name = new Map(beers.map((b) => [b.id, b]));
  const per = new Map<string, { beerId: string; name: string; color: string; minFull: number; full: number; onTap: number; out: number }>();
  let empties = 0, toClean = 0, kicked = 0, total = 0;
  for (const r of rows) {
    total += r._count._all;
    if (r.status === "EMPTY") empties += r._count._all;
    if (r.status === "CLEANING") toClean += r._count._all;
    if (r.status === "KICKED") kicked += r._count._all;
    if (!r.beerId) continue;
    const b = name.get(r.beerId);
    const cur = per.get(r.beerId) ?? { beerId: r.beerId, name: b?.name ?? "Unknown beer", color: b?.color ?? "grey", minFull: b?.minFull ?? 1, full: 0, onTap: 0, out: 0 };
    if (isFull(r.status as KegStatus)) cur.full += r._count._all;
    if (r.status === "ON_TAP") cur.onTap += r._count._all;
    if (r.status === "OUT") cur.out += r._count._all;
    per.set(r.beerId, cur);
  }
  return { beers: [...per.values()].sort((a, b) => a.name.localeCompare(b.name)), empties, toClean, kicked, total };
}

/** The next keg of a beer to put on: cold before merely filled, oldest fill first. */
export async function nextKegOf(beerId: string, excludeId?: string) {
  const kegs = await db.keg.findMany({
    where: { beerId, active: true, status: { in: ["COLD", "FILLED"] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    include: { spot: { select: { name: true } }, fill: { select: { filledOn: true } } },
  });
  kegs.sort((a, b) => (a.status === b.status ? 0 : a.status === "COLD" ? -1 : 1) || (a.fill?.filledOn?.getTime() ?? a.statusAt.getTime()) - (b.fill?.filledOn?.getTime() ?? b.statusAt.getTime()));
  return kegs.map((k) => ({ id: k.id, code: k.code, sizeId: k.sizeId, status: k.status as KegStatus, place: placeLabel({ area: k.area, spot: k.spot?.name, spotNote: k.spotNote }), filledOn: k.fill?.filledOn?.toISOString().slice(0, 10) ?? null }));
}

// ---- One keg ----------------------------------------------------------------------------------------

export async function kegCard(id: string) {
  const k = await db.keg.findUnique({
    where: { id },
    include: {
      beer: { select: { id: true, name: true, color: true } },
      spot: { select: { name: true } },
      account: { select: { name: true } },
      fill: { include: { batch: { select: { code: true } } } },
      events: { orderBy: { at: "desc" }, take: 25, include: { account: { select: { name: true } } } },
    },
  });
  if (!k) return null;
  // On tap: how much is left, from the same estimate as the taps list.
  const estimate = k.status === "ON_TAP" ? ((await tapBoard().catch(() => null))?.taps.find((t) => t.keg?.id === k.id)?.estimate ?? null) : null;
  return {
    estimate,
    id: k.id, code: k.code, legacyCode: k.legacyCode, label: k.label, sizeId: k.sizeId, owner: k.owner, notes: k.notes, active: k.active,
    status: k.status as KegStatus, statusAt: k.statusAt, beer: k.beer, area: k.area, spotId: k.spotId, spot: k.spot?.name ?? null, spotNote: k.spotNote, tapLine: k.tapLine, account: k.account?.name ?? null, accountId: k.accountId,
    fill: k.fill ? { filledOn: k.fill.filledOn?.toISOString().slice(0, 10) ?? null, bestBy: k.fill.bestBy?.toISOString().slice(0, 10) ?? null, batch: k.fill.batch?.code ?? k.fill.batchCode, tappedAt: k.fill.tappedAt } : null,
    place: placeLabel({ area: k.area, spot: k.spot?.name, spotNote: k.spotNote, tapLine: k.tapLine, account: k.account?.name, status: k.status as KegStatus }),
    events: k.events.map((e) => ({ id: e.id, at: e.at, action: e.action, userName: e.userName, fromPlace: e.fromPlace, toPlace: e.toPlace, tapLine: e.tapLine, account: e.account?.name ?? null, note: e.note, undone: !!e.undoneAt, toStatus: e.toStatus as KegStatus | null })),
  };
}
export type KegCard = NonNullable<Awaited<ReturnType<typeof kegCard>>>;

// ---- Actions ------------------------------------------------------------------------------------------

export interface DoActionInput extends Omit<ActionInput, "tapArea"> {
  kegId: string;
  /** Phone-made id; a retry with the same id is applied once. */
  clientId?: string | null;
  groupId?: string | null;
  batchCode?: string | null;
  filledOn?: ISODate | null;
  bestBy?: ISODate | null;
  note?: string | null;
  /** When it happened, if queued offline (ms since epoch). Capped to now. */
  at?: number | null;
}

export type DoActionResult = { ok: true; eventId: string; groupId: string | null; status: KegStatus; kicked?: { beerId: string | null; backups: number } } | { error: string };

interface Before {
  keg: KegState & { fillId: string | null; statusAt: string };
  fill: { id: string; tappedAt: string | null; tapLine: number | null; kickedAt: string | null } | null;
  createdFillId: string | null;
}

const stateOf = (k: { status: DbStatus; beerId: string | null; area: string | null; spotId: string | null; spotNote: string | null; tapLine: number | null; accountId: string | null }): KegState => ({ status: k.status as KegStatus, beerId: k.beerId, area: k.area, spotId: k.spotId, spotNote: k.spotNote, tapLine: k.tapLine, accountId: k.accountId });

/** Apply one action to one keg: update it, its fill, and append the event. */
export async function doKegAction(user: { userId: string; name: string }, input: DoActionInput): Promise<DoActionResult> {
  if (input.clientId) {
    const seen = await db.kegEvent.findUnique({ where: { clientId: input.clientId }, include: { keg: { select: { status: true } } } });
    if (seen) return { ok: true, eventId: seen.id, groupId: seen.groupId, status: seen.keg.status as KegStatus };
  }
  const cfg = await kegConfig();
  const at = input.at && input.at < Date.now() && input.at > Date.now() - 7 * 86_400_000 ? new Date(input.at) : new Date();
  try {
    return await db.$transaction(async (tx) => {
      const k = await tx.keg.findUnique({ where: { id: input.kegId }, include: { spot: { select: { name: true } }, account: { select: { name: true } }, fill: true } });
      if (!k) return { error: "That keg isn't in the app." };
      if (!k.active) return { error: "This keg is retired. A manager can bring it back." };
      const cur = stateOf(k);
      if (input.action === "TAP" && input.tapLine) {
        const busy = await tx.keg.findFirst({ where: { status: "ON_TAP", tapLine: input.tapLine, id: { not: k.id } }, include: { beer: { select: { name: true } } } });
        if (busy) return { error: `Tap ${input.tapLine} still has ${busy.beer?.name ?? "a keg"} on it. Kick that one first.` };
      }
      if (input.spotId) {
        const spot = await tx.kegSpot.findUnique({ where: { id: input.spotId } });
        if (!spot) return { error: "That spot was removed. Pick another." };
        if (input.area && spot.area !== input.area) return { error: "That spot is in a different area." };
      }
      const r = applyKegAction(cur, { ...input, tapArea: cfg.tapArea });
      if ("error" in r) return r;

      const before: Before = {
        keg: { ...cur, fillId: k.fillId, statusAt: k.statusAt.toISOString() },
        fill: k.fill ? { id: k.fill.id, tappedAt: k.fill.tappedAt?.toISOString() ?? null, tapLine: k.fill.tapLine, kickedAt: k.fill.kickedAt?.toISOString() ?? null } : null,
        createdFillId: null,
      };
      let fillId = k.fillId;
      if (r.fill === "start") {
        let batchId: string | null = null;
        if (input.batchCode?.trim()) {
          const b = await tx.kegBatch.upsert({ where: { code: input.batchCode.trim() }, create: { code: input.batchCode.trim(), beerId: r.next.beerId }, update: {} });
          batchId = b.id;
        }
        const f = await tx.kegFill.create({
          data: { kegId: k.id, beerId: r.next.beerId, batchId, batchCode: input.batchCode?.trim() || null, filledOn: new Date(`${input.filledOn ?? businessDate(at, tz())}T00:00:00Z`), bestBy: input.bestBy ? new Date(`${input.bestBy}T00:00:00Z`) : null },
        });
        fillId = f.id;
        before.createdFillId = f.id;
      } else if (r.fill === "tap") {
        if (!k.fillId) {
          const f = await tx.kegFill.create({ data: { kegId: k.id, beerId: k.beerId, tappedAt: at, tapLine: r.next.tapLine } });
          fillId = f.id;
          before.createdFillId = f.id;
        } else await tx.kegFill.update({ where: { id: k.fillId }, data: { tappedAt: at, tapLine: r.next.tapLine, kickedAt: null } });
      } else if (r.fill === "kick" && k.fillId) {
        await tx.kegFill.update({ where: { id: k.fillId }, data: { kickedAt: at } });
        fillId = null;
      } else if (r.fill === "untap" && k.fillId) {
        // Off tap but not empty: it isn't a kick, so the tap time no longer counts toward yield.
        await tx.kegFill.update({ where: { id: k.fillId }, data: { tappedAt: null, tapLine: null } });
      } else if (r.fill === "end") {
        fillId = r.next.status === "OUT" ? k.fillId : null;
      }
      if (r.next.status === "EMPTY" || r.next.status === "CLEANING") fillId = null;

      const [toSpot, toAccount] = await Promise.all([
        r.next.spotId ? tx.kegSpot.findUnique({ where: { id: r.next.spotId }, select: { name: true } }) : null,
        r.next.accountId ? tx.kegAccount.findUnique({ where: { id: r.next.accountId }, select: { name: true } }) : null,
      ]);
      await tx.keg.update({
        where: { id: k.id },
        data: { status: r.next.status, statusAt: at, beerId: r.next.beerId, area: r.next.area, spotId: r.next.spotId, spotNote: r.next.spotNote, tapLine: r.next.tapLine, accountId: r.next.accountId, fillId },
      });
      const ev = await tx.kegEvent.create({
        data: {
          kegId: k.id, at, userId: user.userId, userName: user.name, action: r.event,
          fromStatus: k.status, toStatus: r.next.status,
          fromPlace: placeLabel({ area: k.area, spot: k.spot?.name, spotNote: k.spotNote, tapLine: k.tapLine, account: k.account?.name, status: k.status as KegStatus }),
          toPlace: placeLabel({ area: r.next.area, spot: toSpot?.name, spotNote: r.next.spotNote, tapLine: r.next.tapLine, account: toAccount?.name, status: r.next.status }),
          beerId: r.next.beerId ?? k.beerId, fillId: fillId ?? k.fillId, tapLine: r.next.tapLine ?? k.tapLine, accountId: r.next.accountId ?? (input.action === "RETURN" ? k.accountId : null),
          note: input.note?.trim() || null, before: before as unknown as Prisma.InputJsonValue, groupId: input.groupId ?? null, clientId: input.clientId ?? null,
        },
      });
      let kicked: { beerId: string | null; backups: number } | undefined;
      if (r.event === "KICKED") {
        const backups = k.beerId ? await tx.keg.count({ where: { beerId: k.beerId, active: true, status: { in: ["COLD", "FILLED"] } } }) : 0;
        kicked = { beerId: k.beerId, backups };
      }
      return { ok: true as const, eventId: ev.id, groupId: ev.groupId, status: r.next.status, kicked };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && input.clientId) {
      const seen = await db.kegEvent.findUnique({ where: { clientId: input.clientId }, include: { keg: { select: { status: true } } } });
      if (seen) return { ok: true, eventId: seen.id, groupId: seen.groupId, status: seen.keg.status as KegStatus };
    }
    throw e;
  }
}

/**
 * Undo events (one, or every event in a group, newest first) — only while
 * each is still the keg's latest event and within a couple of minutes.
 * Managers can undo older ones from the history.
 */
export async function undoKegEvents(user: { userId: string; role: "MANAGER" | "STAFF" }, ref: { eventId?: string; groupId?: string }): Promise<{ ok: true; undone: number } | { error: string }> {
  const events = await db.kegEvent.findMany({ where: { ...(ref.groupId ? { groupId: ref.groupId } : { id: ref.eventId ?? "-" }), undoneAt: null }, orderBy: { at: "desc" } });
  if (!events.length) return { error: "Nothing to undo." };
  for (const e of events) {
    if (user.role !== "MANAGER" && (e.userId !== user.userId || Date.now() - e.createdAt.getTime() > UNDO_SERVER_SECONDS * 1000)) return { error: "Too late to undo that one. Ask a manager." };
  }
  return db.$transaction(async (tx) => {
    let n = 0;
    for (const e of events) {
      const latest = await tx.kegEvent.findFirst({ where: { kegId: e.kegId, undoneAt: null }, orderBy: [{ at: "desc" }, { id: "desc" }] });
      if (latest && latest.id !== e.id) return { error: "Something else happened to this keg since. Fix it with a new scan instead." };
      const b = e.before as unknown as Before | null;
      if (!b?.keg) return { error: "This one can't be undone." };
      if (b.fill) await tx.kegFill.update({ where: { id: b.fill.id }, data: { tappedAt: b.fill.tappedAt ? new Date(b.fill.tappedAt) : null, tapLine: b.fill.tapLine, kickedAt: b.fill.kickedAt ? new Date(b.fill.kickedAt) : null } });
      await tx.keg.update({
        where: { id: e.kegId },
        data: { status: b.keg.status, statusAt: new Date(b.keg.statusAt), beerId: b.keg.beerId, area: b.keg.area, spotId: b.keg.spotId, spotNote: b.keg.spotNote, tapLine: b.keg.tapLine, accountId: b.keg.accountId, fillId: b.keg.fillId },
      });
      if (b.createdFillId) await tx.kegFill.delete({ where: { id: b.createdFillId } }).catch(() => undefined);
      await tx.kegEvent.update({ where: { id: e.id }, data: { undoneAt: new Date() } });
      n++;
    }
    return { ok: true as const, undone: n };
  });
}

// ---- Demand ------------------------------------------------------------------------------------------

export interface BeerDemandRow {
  beerId: string;
  name: string;
  color: string;
  forecast: BeerForecast;
  plan: BeerPlan;
  weekly: { week: ISODate; pints: number }[];
  months: (number | null)[];
  full: number;
  onTap: number;
  kegOz: number;
  sizeId: string;
  perOz: number | null;
  firstSale: ISODate | null;
}

/** Pints per beer, the next 4 weeks and kegs needed vs on hand. Uses all history (seasons). */
export async function beerDemand(): Promise<{ rows: BeerDemandRow[]; seasonal: boolean; yield: YieldInfo; from: ISODate | null; unmatched: { base: string; qty: number }[] }> {
  const today = businessToday();
  const first = await db.dailySale.findFirst({ orderBy: { date: "asc" }, select: { date: true } });
  const from = first ? first.date.toISOString().slice(0, 10) : addDays(today, -56);
  const [{ beers, oz, perOz }, { taps, yield: yi }, stock, kegSizes, recentNames] = await Promise.all([
    beerOz(from),
    tapBoard(),
    db.keg.findMany({ where: { active: true, status: { in: ["COLD", "FILLED"] }, beerId: { not: null } }, select: { beerId: true, sizeId: true } }),
    db.keg.groupBy({ by: ["beerId", "sizeId"], where: { beerId: { not: null } }, _count: { _all: true } }),
    db.$queryRaw<{ name: string; qty: number }[]>`SELECT name, SUM(qty)::float AS qty FROM "DailySale" WHERE date >= ${new Date(`${addDays(today, -90)}T00:00:00Z`)}::date GROUP BY name`,
  ]);
  const total = new Map<ISODate, number>();
  for (const days of oz.values()) for (const [d, v] of days) total.set(d, (total.get(d) ?? 0) + v);
  const season = seasonalIndex(total);
  const rows: BeerDemandRow[] = [];
  for (const b of beers.filter((x) => x.active)) {
    const daily = oz.get(b.id) ?? new Map<ISODate, number>();
    const f = forecastBeer(daily, today, season, 4);
    const full = stock.filter((s) => s.beerId === b.id);
    const sizes = kegSizes.filter((s) => s.beerId === b.id).sort((x, y) => y._count._all - x._count._all);
    const usual = sizes[0]?.sizeId ?? "half";
    const onTapOz = taps.filter((t) => t.keg?.beerId === b.id).reduce((s, t) => s + (t.estimate?.ozLeft ?? 0), 0);
    const plan = planBeer(b.name, f, { fullKegOz: full.map((s) => kegOz(s.sizeId)), onTapOz }, kegOz(usual), yi.yield, today);
    const weekly = [...weeklyTotals(daily).entries()].sort(([a], [z]) => a.localeCompare(z)).slice(-53).map(([week, v]) => ({ week, pints: v / 16 }));
    const sold = [...daily.keys()].sort();
    rows.push({ beerId: b.id, name: b.name, color: b.color, forecast: f, plan, weekly, months: monthProfile(daily), full: full.length, onTap: taps.filter((t) => t.keg?.beerId === b.id).length, kegOz: kegOz(usual), sizeId: usual, perOz: perOz.get(b.id) ?? null, firstSale: sold[0] ?? null });
  }
  const rank = { bad: 0, warn: 1, good: 2 };
  rows.sort((a, z) => rank[a.plan.tone] - rank[z.plan.tone] || (a.plan.runOutDays ?? 999) - (z.plan.runOutDays ?? 999) || z.forecast.ozPerDay - a.forecast.ozPerDay);
  return { rows, seasonal: !!season, yield: yi, from: first ? from : null, unmatched: unmatchedDraftNames(recentNames, beers).slice(0, 12) };
}

/** Run-out findings for the Insights feed. Never throws (the tables may not exist on an older database). */
let findingsCache: { at: number; key: string; items: RunOutFinding[] } | null = null;

export async function kegFindings(): Promise<RunOutFinding[]> {
  try {
    // Cheap fingerprint of keg state: recompute when a keg changes, else at most every 10 minutes.
    const last = await db.kegEvent.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!last) return [];
    if (findingsCache && findingsCache.key === last.id && Date.now() - findingsCache.at < 600_000) return findingsCache.items;
    if ((await db.keg.count({ where: { status: "ON_TAP" } })) === 0) return [];
    const [{ rows }, cfg] = await Promise.all([beerDemand(), kegConfig()]);
    const items = rows
      .filter((r) => r.onTap > 0)
      .map((r) => runOutFinding({ beerId: r.beerId, name: r.name, plan: r.plan, forecast: r.forecast, fullKegs: r.full, dollarsPerOz: r.perOz, fillDays: cfg.fillDays }))
      .filter((x): x is RunOutFinding => !!x);
    findingsCache = { at: Date.now(), key: last.id, items };
    return items;
  } catch (e) {
    console.error("keg findings skipped", (e as Error).message);
    return [];
  }
}

export const KEG_ACTIONS: KegActionId[] = ["KICK", "TAP", "MOVE", "STORE", "UNTAP", "OUT", "RETURN", "CLEANED", "FILL", "EMPTY"];


// ---- Cost per pint from the beer's recipe ------------------------------------------------------------

/**
 * Cost per pint and per keg for beers linked to a PREP recipe (the brewer's
 * batch, yield in bbl or hl): batch cost ÷ batch volume, then ÷ yield for
 * foam and line loss. Beers without a recipe are left out.
 */
export async function beerCosts(): Promise<Map<string, { perPint: number; perHalf: number; incomplete: boolean; recipe: string }>> {
  const beers = await db.beer.findMany({ where: { recipeId: { not: null } }, select: { id: true, recipeId: true } });
  const out = new Map<string, { perPint: number; perHalf: number; incomplete: boolean; recipe: string }>();
  if (!beers.length) return out;
  const { loadCostingSnapshot, buildContext, safeCost } = await import("./costing");
  const { toBase } = await import("@/domain/units");
  const [snap, yi] = await Promise.all([loadCostingSnapshot(), yieldInfo()]);
  const ctx = buildContext(snap, businessToday());
  for (const b of beers) {
    const r = snap.recipes.find((x) => x.id === b.recipeId);
    if (!r) continue;
    const c = safeCost(ctx, r.id);
    if ("error" in c) continue;
    let ml: number;
    try {
      ml = toBase(r.yieldQty.toNumber(), r.yieldUnit, "ml");
    } catch {
      continue;
    }
    if (!(ml > 0)) continue;
    const perMl = c.totalCost / ml / yi.yield;
    out.set(b.id, { perPint: perMl * 16 * 29.5735295625, perHalf: perMl * kegOz("half") * 29.5735295625 * yi.yield, incomplete: c.incomplete, recipe: r.name });
  }
  return out;
}

// ---- What the scan panel needs -----------------------------------------------------------------------

export async function panelContext() {
  const [cfg, areas, spots, accounts, beers, onTap] = await Promise.all([
    kegConfig(),
    kegAreas(),
    db.kegSpot.findMany({ orderBy: [{ area: "asc" }, { sort: "asc" }, { name: "asc" }], select: { id: true, area: true, name: true } }),
    db.kegAccount.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.beer.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    db.keg.findMany({ where: { status: "ON_TAP", tapLine: { not: null } }, select: { id: true, tapLine: true, beer: { select: { name: true } } } }),
  ]);
  return {
    tapLines: cfg.tapLines,
    tapArea: cfg.tapArea,
    coldArea: cfg.coldArea,
    areas,
    spots,
    accounts,
    beers,
    busy: onTap.map((k) => ({ line: k.tapLine!, kegId: k.id, beer: k.beer?.name ?? null })),
  };
}
export type PanelContext = Awaited<ReturnType<typeof panelContext>>;
