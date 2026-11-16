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
