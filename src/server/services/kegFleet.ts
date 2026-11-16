import "server-only";
import type { Prisma } from "@prisma/client";
import { businessDate, type ISODate } from "@/domain/dates";
import { cycles, fillsByMonth, fleetStats, monthsBetween, notSeenLately, outTooLong, statusSizeGrid, weeklyFleet, weekStarts, type FleetEvent, type FleetKeg, type FleetStats, type IdleKeg, type MonthRow, type OutGroup, type WeekPoint } from "@/domain/kegFleet";
import { kegSizeInfo, type KegStatus } from "@/domain/kegs";
import { db } from "../db";
import { env } from "../env";
import { kegConfig } from "./kegs";
import { businessToday } from "./sales";

/**
 * The fleet page: every number is worked out from the keg history on request
 * (domain/kegFleet). A few thousand events load in one query, so there is no
 * snapshot table to keep in step with undo.
 */

export type FleetRange = "12m" | "all";

/** Real scans only: not undone, and not the "Added" entry an import writes at import time. */
const REAL_SCAN: Prisma.KegEventWhereInput = { undoneAt: null, OR: [{ importKey: null }, { NOT: { importKey: { startsWith: "imp:created:" } } }] };

const day = (at: Date) => businessDate(at, env.BUSINESS_TIMEZONE);

async function fleetKegs(): Promise<FleetKeg[]> {
  const rows = await db.keg.findMany({ select: { id: true, code: true, sizeId: true, status: true, active: true, createdAt: true, beer: { select: { name: true } }, account: { select: { name: true } } } });
  return rows.map((k) => ({ id: k.id, code: k.code, sizeId: k.sizeId, status: k.status as KegStatus, active: k.active, beer: k.beer?.name ?? null, account: k.account?.name ?? null, createdDay: day(k.createdAt) }));
}

export async function fleetData(): Promise<{ events: FleetEvent[]; kegs: FleetKeg[]; today: ISODate; first: ISODate | null }> {
  const [rows, kegs] = await Promise.all([
    db.kegEvent.findMany({ where: REAL_SCAN, orderBy: { at: "asc" }, select: { kegId: true, at: true, action: true, toStatus: true, beerId: true, accountId: true } }),
    fleetKegs(),
  ]);
  const events: FleetEvent[] = rows.map((e) => ({ kegId: e.kegId, at: e.at.toISOString(), day: day(e.at), action: e.action, toStatus: e.toStatus as KegStatus | null, beerId: e.beerId, accountId: e.accountId }));
  return { events, kegs, today: businessToday(), first: events[0]?.day ?? null };
}

export interface FleetReport {
  range: FleetRange;
  today: ISODate;
  /** The first day there is any keg history; null with none. */
  first: ISODate | null;
  from: ISODate;
  stats: FleetStats;
  weeks: WeekPoint[];
  /** Fills per month over the range, for the picked beer if any. */
  months: MonthRow[];
  thisYear: MonthRow[];
  lastYear: MonthRow[];
  /** Fills in the range that were never scanned as filled (first seen already full). */
  unscannedFills: number;
  beers: { id: string; name: string; color: string }[];
  grid: ReturnType<typeof statusSizeGrid>;
  out: OutGroup[];
  idle: IdleKeg[];
  overdueDays: number;
  idleDays: number;
}

export async function fleetReport(range: FleetRange, beerId: string | null): Promise<FleetReport> {
  const [{ events, kegs, today, first }, cfg, beerRows] = await Promise.all([fleetData(), kegConfig(), db.beer.findMany({ select: { id: true, name: true, color: true }, orderBy: { name: "asc" } })]);
  // "12 months" is the current month and the eleven before it, so the monthly charts and the totals cover the same days.
  const m = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - 11;
  const yearAgo = `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
  const from = range === "all" && first ? first : first && first > yearAgo ? first : yearAgo;
  const cs = cycles(events, kegs);
  const gallons = new Map(kegs.map((k) => [k.id, kegSizeInfo(k.sizeId).gallons]));
  const gallonsOf = (id: string) => gallons.get(id) ?? 0;
  const year = Number(today.slice(0, 4));
  const yearMonths = (y: number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  const filled = new Set(cs.map((c) => c.beerId).filter(Boolean));
  const pick = beerId && filled.has(beerId) ? beerId : null;
  return {
    range,
    today,
    first,
    from,
    stats: fleetStats(cs, kegs, today),
    weeks: first ? weeklyFleet(events, kegs, weekStarts(from, today)) : [],
    months: fillsByMonth(cs, monthsBetween(from, today), gallonsOf, pick),
    thisYear: fillsByMonth(cs, yearMonths(year), gallonsOf, pick),
    lastYear: fillsByMonth(cs, yearMonths(year - 1), gallonsOf, pick),
    unscannedFills: cs.filter((c) => !c.scannedFill && c.start >= from && (!pick || c.beerId === pick)).length,
    beers: beerRows.filter((b) => filled.has(b.id)),
    grid: statusSizeGrid(kegs),
    out: outTooLong(kegs, events, today, cfg.overdueDays),
    idle: notSeenLately(kegs, events, today, cfg.idleDays),
    overdueDays: cfg.overdueDays,
    idleDays: cfg.idleDays,
  };
}

/**
 * Just the two lists, for the card on the main Kegs page. Reads one row per
 * keg (its latest scan, and its latest "sent out") instead of the whole history.
 */
export async function fleetNeedsLook(): Promise<{ out: OutGroup[]; idle: IdleKeg[]; overdueDays: number; idleDays: number }> {
  const [kegs, cfg, lastSeen, lastOut] = await Promise.all([
    fleetKegs(),
    kegConfig(),
    db.kegEvent.groupBy({ by: ["kegId"], where: REAL_SCAN, _max: { at: true } }),
    db.kegEvent.groupBy({ by: ["kegId"], where: { ...REAL_SCAN, action: "OUT", keg: { status: "OUT", active: true } }, _max: { at: true } }),
  ]);
  const scan = (kegId: string, at: Date, action: string): FleetEvent => ({ kegId, at: at.toISOString(), day: day(at), action, toStatus: null, beerId: null, accountId: null });
  const events = [...lastOut.filter((r) => r._max.at).map((r) => scan(r.kegId, r._max.at!, "OUT")), ...lastSeen.filter((r) => r._max.at).map((r) => scan(r.kegId, r._max.at!, "SEEN"))];
  const today = businessToday();
  return { out: outTooLong(kegs, events, today, cfg.overdueDays), idle: notSeenLately(kegs, events, today, cfg.idleDays), overdueDays: cfg.overdueDays, idleDays: cfg.idleDays };
}

export interface KegHome {
  /** Kegs in service by status. */
  byStatus: Record<KegStatus, number>;
  inService: number;
  stats: FleetStats;
  /** The last 12 weeks of where the fleet was; empty with no history. */
  weeks: WeekPoint[];
  out: OutGroup[];
  idle: IdleKeg[];
  overdueDays: number;
  idleDays: number;
}

/** What the Kegs home leads with for managers: the fleet now, its last 12 weeks, and the kegs that need a look. One read of the history. */
export async function kegHome(): Promise<KegHome> {
  const [{ events, kegs, today, first }, cfg] = await Promise.all([fleetData(), kegConfig()]);
  const byStatus: Record<KegStatus, number> = { EMPTY: 0, FILLED: 0, COLD: 0, ON_TAP: 0, KICKED: 0, OUT: 0, CLEANING: 0 };
  for (const k of kegs) if (k.active) byStatus[k.status]++;
  // Twelve whole weeks: this one and the eleven before it.
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 77);
  return {
    byStatus,
    inService: kegs.filter((k) => k.active).length,
    stats: fleetStats(cycles(events, kegs), kegs, today),
    weeks: first ? weeklyFleet(events, kegs, weekStarts(from.toISOString().slice(0, 10), today)) : [],
    out: outTooLong(kegs, events, today, cfg.overdueDays),
    idle: notSeenLately(kegs, events, today, cfg.idleDays),
    overdueDays: cfg.overdueDays,
    idleDays: cfg.idleDays,
  };
}

export interface BeerFills {
  /** Kegs and gallons filled each month, this calendar year and last. */
  thisYear: MonthRow[];
  lastYear: MonthRow[];
  /** The last fill on record; null when it has never been filled. */
  last: ISODate | null;
  first: ISODate | null;
  /** Every fill on record, and those in the last 365 days. */
  total: number;
  fills12: number;
  /** How its fills ended, all time. */
  went: Record<"tapped" | "out" | "none" | "stock", number>;
}

/** One beer's fills from the keg history: per month this year beside last, when it was last filled, and where its fills went. */
export async function beerFills(beerId: string): Promise<BeerFills> {
  const touched = await db.kegEvent.findMany({ where: { ...REAL_SCAN, beerId }, distinct: ["kegId"], select: { kegId: true } });
  const ids = touched.map((t) => t.kegId);
  const [rows, kegs] = ids.length
    ? await Promise.all([
        db.kegEvent.findMany({ where: { ...REAL_SCAN, kegId: { in: ids } }, orderBy: { at: "asc" }, select: { kegId: true, at: true, action: true, toStatus: true, beerId: true, accountId: true } }),
        db.keg.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, sizeId: true } }),
      ])
    : [[], []];
  const events: FleetEvent[] = rows.map((e) => ({ kegId: e.kegId, at: e.at.toISOString(), day: day(e.at), action: e.action, toStatus: e.toStatus as KegStatus | null, beerId: e.beerId, accountId: e.accountId }));
  const cs = cycles(events, kegs.map((k) => ({ id: k.id, status: k.status as KegStatus }))).filter((c) => c.beerId === beerId);
  const gallons = new Map(kegs.map((k) => [k.id, kegSizeInfo(k.sizeId).gallons]));
  const today = businessToday();
  const year = Number(today.slice(0, 4));
  const yearMonths = (y: number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  const starts = cs.map((c) => c.start).sort();
  const yearAgo = new Date(`${today}T00:00:00Z`);
  yearAgo.setUTCDate(yearAgo.getUTCDate() - 365);
  const went = { tapped: 0, out: 0, none: 0, stock: 0 };
  for (const c of cs) went[c.went]++;
  return {
    thisYear: fillsByMonth(cs, yearMonths(year), (id) => gallons.get(id) ?? 0),
    lastYear: fillsByMonth(cs, yearMonths(year - 1), (id) => gallons.get(id) ?? 0),
    last: starts[starts.length - 1] ?? null,
    first: starts[0] ?? null,
    total: cs.length,
    fills12: starts.filter((d) => d > yearAgo.toISOString().slice(0, 10) && d <= today).length,
    went,
  };
}

/** The day of every fill on record, per beer (for suggesting each beer's standing). */
export async function fillDaysByBeer(): Promise<Map<string, ISODate[]>> {
  const { events, kegs } = await fleetData();
  const out = new Map<string, ISODate[]>();
  for (const c of cycles(events, kegs)) {
    if (!c.beerId) continue;
    const list = out.get(c.beerId);
    if (list) list.push(c.start);
    else out.set(c.beerId, [c.start]);
  }
  return out;
}

export interface KegLife {
  /** Every fill the history knows about, newest first, with the beer's name. */
  cycles: { start: ISODate; beer: string | null; scannedFill: boolean; went: "tapped" | "out" | "none" | "stock"; end: ISODate | null; days: number | null }[];
  fills: number;
  /** Middle number of days from a fill to coming back, over fills that did; null until one has. */
  medianDays: number | null;
  firstScan: ISODate | null;
  scans: number;
}

/** One keg's working life from its own scans: how often it's been filled, how long a fill lasts, and where each went. */
export async function kegLife(kegId: string): Promise<KegLife> {
  const [rows, keg, beers] = await Promise.all([
    db.kegEvent.findMany({ where: { ...REAL_SCAN, kegId }, orderBy: { at: "asc" }, select: { kegId: true, at: true, action: true, toStatus: true, beerId: true, accountId: true } }),
    db.keg.findUnique({ where: { id: kegId }, select: { id: true, status: true } }),
    db.beer.findMany({ select: { id: true, name: true } }),
  ]);
  const events: FleetEvent[] = rows.map((e) => ({ kegId: e.kegId, at: e.at.toISOString(), day: day(e.at), action: e.action, toStatus: e.toStatus as KegStatus | null, beerId: e.beerId, accountId: e.accountId }));
  const name = new Map(beers.map((b) => [b.id, b.name]));
  const cs = cycles(events, keg ? [{ id: keg.id, status: keg.status as KegStatus }] : []);
  const done = cs.map((c) => c.days).filter((d): d is number => d != null).sort((a, b) => a - b);
  const mid = done.length >> 1;
  return {
    cycles: cs.map((c) => ({ start: c.start, beer: c.beerId ? name.get(c.beerId) ?? null : null, scannedFill: c.scannedFill, went: c.went, end: c.end, days: c.days })).reverse(),
    fills: cs.length,
    medianDays: done.length ? (done.length % 2 ? done[mid] : Math.round((done[mid - 1] + done[mid]) / 2)) : null,
    firstScan: events[0]?.day ?? null,
    scans: events.length,
  };
}
