/**
 * The keg fleet over time, worked out from the keg history alone: where the
 * kegs were each week, how many were filled each month and where that beer
 * went, how fast kegs turn, the fleet by status and size, and the two lists a
 * manager should look at (out too long, not seen lately). Pure: no I/O;
 * services/kegFleet.ts loads the events and kegs.
 *
 * Every function takes "real scans" only. The service leaves out undone
 * entries and the "Added" entry an import writes at import time.
 */

import { addDays, daysBetween, weekday, type ISODate } from "./dates";
import { KEG_SIZE_LIST, KEG_STATUSES, type KegStatus } from "./kegs";

export type Bucket = "full" | "out" | "dirty" | "clean";
export const BUCKETS: Bucket[] = ["full", "out", "dirty", "clean"];
export const BUCKET_LABEL: Record<Bucket, string> = { full: "Full", out: "On tap or out", dirty: "Dirty", clean: "Clean" };

const BUCKET: Record<KegStatus, Bucket> = { FILLED: "full", COLD: "full", ON_TAP: "out", OUT: "out", KICKED: "dirty", CLEANING: "dirty", EMPTY: "clean" };
export const bucketOf = (s: KegStatus): Bucket => BUCKET[s];

/** One real scan. `day` is the business date; `at` is an ISO instant used only to order scans. */
export interface FleetEvent {
  kegId: string;
  at: string;
  day: ISODate;
  action: string;
  toStatus: KegStatus | null;
  beerId: string | null;
  accountId: string | null;
}

export interface FleetKeg {
  id: string;
  code: string;
  sizeId: string;
  status: KegStatus;
  active: boolean;
  beer: string | null;
  account: string | null;
  /** The day the keg was added here, for kegs that have never been scanned. */
  createdDay: ISODate;
}

const byTime = (a: FleetEvent, b: FleetEvent) => a.at.localeCompare(b.at);

function perKeg(events: FleetEvent[]): Map<string, FleetEvent[]> {
  const m = new Map<string, FleetEvent[]>();
  for (const e of events) {
    const list = m.get(e.kegId);
    if (list) list.push(e);
    else m.set(e.kegId, [e]);
  }
  for (const list of m.values()) list.sort(byTime);
  return m;
}

// ---- Weeks and months ------------------------------------------------------------------------

/** The Mondays of every week that touches [from, to]. */
export function weekStarts(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let d = addDays(from, -((weekday(from) + 6) % 7));
  while (d <= to) {
    out.push(d);
    d = addDays(d, 7);
  }
  return out;
}

/** "YYYY-MM" for every month that touches [from, to]. */
export function monthsBetween(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// ---- Where the fleet was ----------------------------------------------------------------------

export interface WeekPoint { week: ISODate; full: number; out: number; dirty: number; clean: number }

/**
 * How many kegs sat in each bucket at the end of each week (its Sunday). A keg
 * counts from its first scan with a status; a retired keg stops counting after
 * the week of its last scan.
 */
export function weeklyFleet(events: FleetEvent[], kegs: Pick<FleetKeg, "id" | "active">[], weeks: ISODate[]): WeekPoint[] {
  const points: WeekPoint[] = weeks.map((week) => ({ week, full: 0, out: 0, dirty: 0, clean: 0 }));
  const active = new Map(kegs.map((k) => [k.id, k.active]));
  for (const [kegId, list] of perKeg(events)) {
    const lastDay = list[list.length - 1].day;
    const retired = active.get(kegId) === false;
    let i = 0;
    let status: KegStatus | null = null;
    for (const p of points) {
      const sunday = addDays(p.week, 6);
      while (i < list.length && list[i].day <= sunday) {
        if (list[i].toStatus) status = list[i].toStatus;
        i++;
      }
      if (retired && p.week > lastDay) break;
      if (status) p[bucketOf(status)]++;
    }
  }
  return points;
}

// ---- Cycles: a fill and what became of it ------------------------------------------------------

export type Went = "tapped" | "out" | "none" | "stock";

export interface Cycle {
  kegId: string;
  beerId: string | null;
  /** The day it was filled, or the day it was first seen full when the fill was never scanned. */
  start: ISODate;
  scannedFill: boolean;
  went: Went;
  /** The day it came back (kicked, returned or cleaned); null while it's still out there or was filled over. */
  end: ISODate | null;
  days: number | null;
}

const OPENS = new Set(["STORED", "TAPPED", "OUT"]);
const CLOSES = new Set(["KICKED", "RETURNED", "CLEANED", "EMPTIED"]);

/**
 * Each keg's history cut into cycles. A cycle opens at Filled, or at the first
 * Stored / Tapped / Out when the fill itself was never scanned, and closes when
 * the keg is kicked, comes back or is cleaned. Where it went is the first tap
 * or delivery in the cycle; a fill with neither is "stock" while it is the
 * keg's current, still-full fill, and "none" otherwise.
 */
export function cycles(events: FleetEvent[], kegs: Pick<FleetKeg, "id" | "status">[]): Cycle[] {
  const statusNow = new Map(kegs.map((k) => [k.id, k.status]));
  const out: Cycle[] = [];
  for (const [kegId, list] of perKeg(events)) {
    let open: (Cycle & { seen: boolean }) | null = null;
    const mine: (Cycle & { seen: boolean })[] = [];
    const start = (e: FleetEvent, scannedFill: boolean) => {
      open = { kegId, beerId: e.beerId, start: e.day, scannedFill, went: "none", end: null, days: null, seen: false };
      mine.push(open);
    };
    for (const e of list) {
      if (e.action === "FILLED") start(e, true);
      else if (!open && OPENS.has(e.action)) start(e, false);
      const cur = open as (Cycle & { seen: boolean }) | null;
      if (!cur) continue;
      cur.beerId ??= e.beerId;
      if (!cur.seen && (e.action === "TAPPED" || e.action === "OUT")) {
        cur.went = e.action === "TAPPED" ? "tapped" : "out";
        cur.seen = true;
      }
      if (CLOSES.has(e.action)) {
        cur.end = e.day;
        cur.days = daysBetween(cur.start, e.day);
        open = null;
      }
    }
    const last = mine[mine.length - 1];
    const now = statusNow.get(kegId);
    if (last && !last.seen && last.end === null && (now === "FILLED" || now === "COLD")) last.went = "stock";
    for (const { seen: _seen, ...c } of mine) out.push(c);
  }
  return out;
}

// ---- Fills by month ------------------------------------------------------------------------------

export interface MonthRow { month: string; kegs: number; gallons: number; tapped: number; out: number; none: number; stock: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Kegs and gallons filled each month, and where those fills went. Optionally one beer. */
export function fillsByMonth(cs: Cycle[], months: string[], gallonsOf: (kegId: string) => number, beerId?: string | null): MonthRow[] {
  const rows = new Map<string, MonthRow>(months.map((month) => [month, { month, kegs: 0, gallons: 0, tapped: 0, out: 0, none: 0, stock: 0 }]));
  for (const c of cs) {
    if (beerId && c.beerId !== beerId) continue;
    const r = rows.get(c.start.slice(0, 7));
    if (!r) continue;
    r.kegs++;
    r.gallons += gallonsOf(c.kegId);
    r[c.went]++;
  }
  return [...rows.values()].map((r) => ({ ...r, gallons: round2(r.gallons) }));
}

// ---- Fleet numbers --------------------------------------------------------------------------------

export interface FleetStats {
  inService: number;
  /** Fills in the 365 days up to today. */
  fills12: number;
  /** Fills a keg a year; null with no kegs in service. */
  turns: number | null;
  /** Middle number of days from a fill to the keg coming back; null until one has. */
  medianCycleDays: number | null;
  cyclesMeasured: number;
}

export function fleetStats(cs: Cycle[], kegs: Pick<FleetKeg, "active">[], today: ISODate): FleetStats {
  const since = addDays(today, -365);
  const recent = cs.filter((c) => c.start > since && c.start <= today);
  const closed = recent.map((c) => c.days).filter((d): d is number => d != null).sort((a, b) => a - b);
  const inService = kegs.filter((k) => k.active).length;
  const mid = closed.length >> 1;
  return {
    inService,
    fills12: recent.length,
    turns: inService ? round2(recent.length / inService) : null,
    medianCycleDays: closed.length ? (closed.length % 2 ? closed[mid] : Math.round((closed[mid - 1] + closed[mid]) / 2)) : null,
    cyclesMeasured: closed.length,
  };
}

// ---- Fleet by status and size ----------------------------------------------------------------------

export interface GridRow { status: KegStatus | "RETIRED"; total: number; bySize: Record<string, number> }

/** Every status against every size in use; retired kegs on their own row; `all` counts every keg. */
export function statusSizeGrid(kegs: Pick<FleetKeg, "status" | "sizeId" | "active">[]): { sizes: string[]; rows: GridRow[]; all: { total: number; bySize: Record<string, number> } } {
  const order = new Map(KEG_SIZE_LIST.map((s, i) => [s.id, i]));
  const sizes = [...new Set(kegs.map((k) => k.sizeId))].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
  const blank = () => Object.fromEntries(sizes.map((s) => [s, 0])) as Record<string, number>;
  const rows = new Map<GridRow["status"], GridRow>([...KEG_STATUSES, "RETIRED" as const].map((status) => [status, { status, total: 0, bySize: blank() }]));
  const all = { total: 0, bySize: blank() };
  for (const k of kegs) {
    const r = rows.get(k.active ? k.status : "RETIRED")!;
    r.total++;
    r.bySize[k.sizeId]++;
    all.total++;
    all.bySize[k.sizeId]++;
  }
  return { sizes, rows: [...rows.values()], all };
}

// ---- Needs a look ------------------------------------------------------------------------------------

export interface OutGroup {
  account: string;
  kegs: { id: string; code: string; sizeId: string; beer: string | null; days: number }[];
  longest: number;
}

/** Kegs out at an account for more than `overdueDays`, by account, the longest wait first. */
export function outTooLong(kegs: FleetKeg[], events: FleetEvent[], today: ISODate, overdueDays: number): OutGroup[] {
  const history = perKeg(events);
  const groups = new Map<string, OutGroup>();
  for (const k of kegs) {
    if (!k.active || k.status !== "OUT") continue;
    const list = history.get(k.id) ?? [];
    const sent = [...list].reverse().find((e) => e.action === "OUT") ?? list[list.length - 1];
    const days = daysBetween(sent?.day ?? k.createdDay, today);
    if (days <= overdueDays) continue;
    const account = k.account ?? "No account recorded";
    const g = groups.get(account) ?? { account, kegs: [], longest: 0 };
    g.kegs.push({ id: k.id, code: k.code, sizeId: k.sizeId, beer: k.beer, days });
    g.longest = Math.max(g.longest, days);
    groups.set(account, g);
  }
  for (const g of groups.values()) g.kegs.sort((a, b) => b.days - a.days);
  return [...groups.values()].sort((a, b) => b.longest - a.longest || a.account.localeCompare(b.account));
}

export interface IdleKeg { id: string; code: string; sizeId: string; status: KegStatus; beer: string | null; lastSeen: ISODate | null; days: number }

/**
 * Kegs in service, not out at an account, that nobody has scanned for more
 * than `idleDays`. A keg never scanned counts from the day it was added.
 */
export function notSeenLately(kegs: FleetKeg[], events: FleetEvent[], today: ISODate, idleDays: number): IdleKeg[] {
  const history = perKeg(events);
  const out: IdleKeg[] = [];
  for (const k of kegs) {
    if (!k.active || k.status === "OUT") continue;
    const list = history.get(k.id);
    const lastSeen = list ? list[list.length - 1].day : null;
    const days = daysBetween(lastSeen ?? k.createdDay, today);
    if (days > idleDays) out.push({ id: k.id, code: k.code, sizeId: k.sizeId, status: k.status, beer: k.beer, lastSeen, days });
  }
  return out.sort((a, b) => b.days - a.days || a.code.localeCompare(b.code));
}
