/**
 * Kegs and the accounts they go out to, worked out from the keg history alone:
 * each delivery and how long the keg stayed, what an account takes, the kegs
 * sitting at accounts right now, and volume by where the beer went. Pure: no
 * I/O; services/kegAccounts.ts loads the events, kegs and accounts.
 *
 * Like domain/kegFleet.ts, every function takes "real scans" only: no undone
 * entries, and not the "Added" entry an import writes at import time. So every
 * number here is what was scanned, which is less than what was sold wherever a
 * keg went out the door without a scan.
 */

import { addDays, daysBetween, type ISODate } from "./dates";
import { cycles, type FleetEvent, type FleetKeg } from "./kegFleet";
import { KEG_SIZE_LIST } from "./kegs";

export const GALLONS_PER_BARREL = 31;
export const barrels = (gallons: number) => gallons / GALLONS_PER_BARREL;

/** A keg as the fleet page loads it, plus the two ids that view leaves out. */
export interface AccountKeg extends FleetKeg {
  accountId: string | null;
  beerId: string | null;
}

export interface AccountInfo {
  id: string;
  name: string;
  kind: string;
  active: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
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

/** The middle of a list of whole numbers; two middles are averaged and rounded. Null when empty. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * The first day of "the last 12 months": this month and the eleven before it,
 * the same window the fleet page uses, so a monthly chart and the totals beside
 * it cover the same days.
 */
export function twelveMonthsFrom(today: ISODate): ISODate {
  const m = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - 11;
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
}

// ---- Stays: one for each delivery ----------------------------------------------------------------

export interface Stay {
  kegId: string;
  /** The account on the delivery scan; null when it was sent out with none, or the account was since deleted. */
  accountId: string | null;
  beerId: string | null;
  /** The day it was delivered. */
  out: ISODate;
  /** The instant of the delivery scan, only to keep deliveries in order. */
  at: string;
  /** The day the stay ended; null while nothing since says it has. */
  back: ISODate | null;
  /**
   * "back": the keg was next scanned at the brewery. "resent": there was no
   * return scan, and it was next seen going out on another delivery.
   */
  ended: "back" | "resent" | null;
  /** Days from delivery to `back`. For "resent" that is only the longest it can have been. */
  days: number | null;
}

/** Scans that can only happen with the keg back at the brewery. */
const BACK = new Set(["RETURNED", "KICKED", "CLEANED", "EMPTIED", "FILLED"]);
/** Scans after which the keg no longer holds the beer it was filled with. */
const DRAINED = new Set(["RETURNED", "KICKED", "CLEANED", "EMPTIED"]);

/**
 * Every delivery (an "Out" scan) and how it ended. A stay ends at the keg's
 * next return, kick, clean, empty or fill scan, or at its next delivery when
 * the return was never scanned. A second "Out" scan to the same account on the
 * same day is the same delivery, scanned twice. Oldest first.
 */
export function stays(events: FleetEvent[]): Stay[] {
  const all: Stay[] = [];
  for (const [kegId, list] of perKeg(events)) {
    let open: Stay | null = null;
    let beer: string | null = null;
    const close = (day: ISODate, ended: "back" | "resent") => {
      if (!open) return;
      open.back = day;
      open.ended = ended;
      open.days = daysBetween(open.out, day);
      open = null;
    };
    for (const e of list) {
      if (e.action === "FILLED") {
        close(e.day, "back");
        beer = e.beerId;
      } else if (BACK.has(e.action)) {
        close(e.day, "back");
        beer = null;
      } else if (e.action === "OUT") {
        const cur = open as Stay | null;
        if (cur && cur.accountId === e.accountId && cur.out === e.day) continue;
        close(e.day, "resent");
        open = { kegId, accountId: e.accountId, beerId: e.beerId ?? beer, out: e.day, at: e.at, back: null, ended: null, days: null };
        all.push(open);
      } else if (e.beerId && !beer) {
        beer = e.beerId;
      }
    }
  }
  return all.sort((a, b) => a.at.localeCompare(b.at) || a.kegId.localeCompare(b.kegId));
}

export const staysAt = (all: Stay[], accountId: string): Stay[] => all.filter((s) => s.accountId === accountId);

// ---- Kegs out right now ---------------------------------------------------------------------------

export interface OutKeg {
  id: string;
  code: string;
  sizeId: string;
  beer: string | null;
  beerId: string | null;
  accountId: string | null;
  /** The day it went out. */
  since: ISODate;
  days: number;
}

/**
 * Kegs in service whose status is "out", the longest wait first. Days count
 * from the keg's latest delivery scan, the same rule as "Out too long" on the
 * fleet page (kegFleet.outTooLong), so the two pages agree; a keg with no
 * delivery scan counts from its last scan, or from the day it was added.
 */
export function kegsOut(kegs: AccountKeg[], events: FleetEvent[], today: ISODate): OutKeg[] {
  const history = perKeg(events);
  const list: OutKeg[] = [];
  for (const k of kegs) {
    if (!k.active || k.status !== "OUT") continue;
    const scans = history.get(k.id) ?? [];
    const sent = [...scans].reverse().find((e) => e.action === "OUT") ?? scans[scans.length - 1];
    const since = sent?.day ?? k.createdDay;
    list.push({ id: k.id, code: k.code, sizeId: k.sizeId, beer: k.beer, beerId: k.beerId, accountId: k.accountId, since, days: daysBetween(since, today) });
  }
  return list.sort((a, b) => b.days - a.days || a.code.localeCompare(b.code));
}

// ---- The accounts list ----------------------------------------------------------------------------

export interface AccountRow extends AccountInfo {
  /** Kegs there right now. */
  kegsOut: number;
  /** The longest any keg there now has been out; null with none there. */
  longestDays: number | null;
  /** A keg there has been out for more than the "out too long" number of days. */
  overdue: boolean;
  /** Deliveries in the last 12 months (see twelveMonthsFrom). */
  deliveries12: number;
  lastDelivery: ISODate | null;
  /** Every delivery on record. */
  deliveries: number;
}

/** One row for each account, the most kegs out first, then by name. */
export function accountRows(accounts: AccountInfo[], all: Stay[], out: OutKeg[], today: ISODate, overdueDays: number): AccountRow[] {
  const since = twelveMonthsFrom(today);
  const rows = new Map<string, AccountRow>(accounts.map((a) => [a.id, { id: a.id, name: a.name, kind: a.kind, active: a.active, kegsOut: 0, longestDays: null, overdue: false, deliveries12: 0, lastDelivery: null, deliveries: 0 }]));
  for (const k of out) {
    const r = k.accountId ? rows.get(k.accountId) : undefined;
    if (!r) continue;
    r.kegsOut++;
    r.longestDays = Math.max(r.longestDays ?? 0, k.days);
    r.overdue = r.longestDays > overdueDays;
  }
  for (const s of all) {
    const r = s.accountId ? rows.get(s.accountId) : undefined;
    if (!r) continue;
    r.deliveries++;
    if (s.out >= since && s.out <= today) r.deliveries12++;
    if (!r.lastDelivery || s.out > r.lastDelivery) r.lastDelivery = s.out;
  }
  return [...rows.values()].sort((a, b) => b.kegsOut - a.kegsOut || a.name.localeCompare(b.name));
}

// ---- One account ------------------------------------------------------------------------------------

export interface AccountNumbers {
  kegsOut: number;
  /** Deliveries, and the gallons in them, in the last 12 months (see twelveMonthsFrom). */
  deliveries12: number;
  gallons12: number;
  /** The middle number of days a keg stayed before it was scanned back; null until one has been. */
  medianDays: number | null;
  /** How many scanned returns `medianDays` is the middle of. */
  returns: number;
}

/** The headline numbers for one account, from its own stays and the kegs there now. */
export function accountNumbers(mine: Stay[], here: OutKeg[], gallonsOf: (kegId: string) => number, today: ISODate): AccountNumbers {
  const since = twelveMonthsFrom(today);
  const recent = mine.filter((s) => s.out >= since && s.out <= today);
  const kept = mine.filter((s) => s.ended === "back" && s.days != null).map((s) => s.days!);
  return {
    kegsOut: here.length,
    deliveries12: recent.length,
    gallons12: round2(recent.reduce((sum, s) => sum + gallonsOf(s.kegId), 0)),
    medianDays: median(kept),
    returns: kept.length,
  };
}

export interface DeliveryMonth { month: string; kegs: number; gallons: number }

/** Kegs and gallons delivered in each of `months` ("YYYY-MM"), counted in the month they went out. */
export function deliveriesByMonth(mine: Stay[], months: string[], gallonsOf: (kegId: string) => number): DeliveryMonth[] {
  const rows = new Map<string, DeliveryMonth>(months.map((month) => [month, { month, kegs: 0, gallons: 0 }]));
  for (const s of mine) {
    const r = rows.get(s.out.slice(0, 7));
    if (!r) continue;
    r.kegs++;
    r.gallons += gallonsOf(s.kegId);
  }
  return [...rows.values()].map((r) => ({ ...r, gallons: round2(r.gallons) }));
}

export interface BeerTake {
  /** Null when the delivery scan and the fill before it recorded no beer. */
  beerId: string | null;
  deliveries: number;
  gallons: number;
  last: ISODate;
}

/** Deliveries by beer, the most delivered first. `from` leaves out deliveries before that day. */
export function takenByBeer(mine: Stay[], gallonsOf: (kegId: string) => number, from?: ISODate): BeerTake[] {
  const rows = new Map<string | null, BeerTake>();
  for (const s of mine) {
    if (from && s.out < from) continue;
    const r = rows.get(s.beerId) ?? { beerId: s.beerId, deliveries: 0, gallons: 0, last: s.out };
    r.deliveries++;
    r.gallons += gallonsOf(s.kegId);
    if (s.out > r.last) r.last = s.out;
    rows.set(s.beerId, r);
  }
  return [...rows.values()].map((r) => ({ ...r, gallons: round2(r.gallons) })).sort((a, b) => b.deliveries - a.deliveries || b.gallons - a.gallons || (a.beerId ?? "").localeCompare(b.beerId ?? ""));
}

export interface HistoryRow extends Stay {
  /**
   * "back": scanned back on `back`. "there": still at the account today.
   * "resent": no return scan; it went out again on `back`. "unknown": no
   * return scan and the keg is not there now (retired, or scanned somewhere
   * else without being marked back).
   */
  state: "back" | "there" | "resent" | "unknown";
  /** Days kept: to the return scan, or to today while it is still there. Null when the return was never scanned. */
  daysKept: number | null;
}

/**
 * One account's deliveries, the most recent first, at most `limit` of them;
 * `total` is how many there are in all. `here` is the ids of the kegs at the
 * account right now.
 */
export function deliveryHistory(mine: Stay[], here: ReadonlySet<string>, today: ISODate, limit = 200): { rows: HistoryRow[]; total: number } {
  const recent = [...mine].sort((a, b) => b.at.localeCompare(a.at) || a.kegId.localeCompare(b.kegId)).slice(0, limit);
  const rows = recent.map((s): HistoryRow => {
    if (s.ended === "back") return { ...s, state: "back", daysKept: s.days };
    if (s.ended === "resent") return { ...s, state: "resent", daysKept: null };
    return here.has(s.kegId) ? { ...s, state: "there", daysKept: daysBetween(s.out, today) } : { ...s, state: "unknown", daysKept: null };
  });
  return { rows, total: mine.length };
}

// ---- Report dates -----------------------------------------------------------------------------------

export type RangePreset = "this-month" | "last-month" | "this-quarter" | "last-quarter" | "this-year" | "last-year" | "all";

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-quarter", label: "This quarter" },
  { id: "last-quarter", label: "Last quarter" },
  { id: "this-year", label: "This year" },
  { id: "last-year", label: "Last year" },
  { id: "all", label: "All time" },
];

export const isRangePreset = (v: unknown): v is RangePreset => RANGE_PRESETS.some((p) => p.id === v);

/**
 * The first and last day of a preset, both included. A period still running
 * ends today. "All time" starts at `first`, the first day with any keg history.
 */
export function presetRange(preset: RangePreset, today: ISODate, first: ISODate | null): { from: ISODate; to: ISODate } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  /** The first day of the month `n` months from January of this year (n may be negative). */
  const start = (n: number): ISODate => {
    const k = y * 12 + n;
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`;
  };
  const q = m - (m % 3);
  switch (preset) {
    case "this-month": return { from: start(m), to: today };
    case "last-month": return { from: start(m - 1), to: addDays(start(m), -1) };
    case "this-quarter": return { from: start(q), to: today };
    case "last-quarter": return { from: start(q - 3), to: addDays(start(q), -1) };
    case "this-year": return { from: start(0), to: today };
    case "last-year": return { from: start(-12), to: addDays(start(0), -1) };
    case "all": return { from: first && first < today ? first : today, to: today };
  }
}

// ---- Volume by where the beer went --------------------------------------------------------------------

/** "none": filled, then back dirty with no tap or delivery scan in between. */
export type MoveKind = "tapped" | "out" | "none";

/** One keg of beer leaving stock, as far as the scans can tell. */
export interface Movement {
  kind: MoveKind;
  /** Tapped: the day of the fill's first tap. Out: the day of the delivery. None: the day of the fill, the only day on record. */
  day: ISODate;
  kegId: string;
  beerId: string | null;
  /** Set for deliveries only. */
  accountId: string | null;
}

/**
 * Every keg of beer the history shows leaving stock, in day order.
 *  - Tapped: the first tap of each fill. Going back on after a spell off tap is not a second keg.
 *  - Out: each delivery, exactly the ones stays() finds, so this agrees with the account pages.
 *  - None: fills that came back with no tap or delivery scan, exactly the "No scan" fills on
 *    the fleet page (kegFleet.cycles), dated by the fill.
 * A fill that was tapped and also sent out counts once under each.
 */
export function movements(events: FleetEvent[], kegs: Pick<FleetKeg, "id" | "status">[]): Movement[] {
  const moves: Movement[] = [];
  for (const [kegId, list] of perKeg(events)) {
    let tapped = false;
    let beer: string | null = null;
    for (const e of list) {
      if (e.action === "FILLED") {
        tapped = false;
        beer = e.beerId;
      } else if (DRAINED.has(e.action)) {
        tapped = false;
        beer = null;
      } else if (e.action === "TAPPED") {
        if (!tapped) moves.push({ kind: "tapped", day: e.day, kegId, beerId: e.beerId ?? beer, accountId: null });
        tapped = true;
        beer ??= e.beerId;
      } else if (e.beerId && !beer) {
        beer = e.beerId;
      }
    }
  }
  for (const s of stays(events)) moves.push({ kind: "out", day: s.out, kegId: s.kegId, beerId: s.beerId, accountId: s.accountId });
  for (const c of cycles(events, kegs)) if (c.went === "none") moves.push({ kind: "none", day: c.start, kegId: c.kegId, beerId: c.beerId, accountId: null });
  return moves.sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind) || a.kegId.localeCompare(b.kegId));
}

export interface VolumeLine { kegs: number; gallons: number }

export interface BeerVolume {
  beerId: string | null;
  tapped: VolumeLine;
  out: VolumeLine;
  none: VolumeLine;
  total: VolumeLine;
}

export interface VolumeReport {
  tapped: VolumeLine;
  out: VolumeLine;
  none: VolumeLine;
  total: VolumeLine;
  /** The most gallons first. */
  byBeer: BeerVolume[];
  /** Deliveries only, the most gallons first. A null account is deliveries scanned out with no account. */
  byAccount: ({ accountId: string | null } & VolumeLine)[];
}

/** Kegs and gallons moved from `from` to `to`, both days included, in total, by beer and by account. */
export function volumeReport(moves: Movement[], from: ISODate, to: ISODate, gallonsOf: (kegId: string) => number): VolumeReport {
  const line = (): VolumeLine => ({ kegs: 0, gallons: 0 });
  const add = (l: VolumeLine, g: number) => {
    l.kegs++;
    l.gallons += g;
  };
  const tidy = (l: VolumeLine): VolumeLine => ({ kegs: l.kegs, gallons: round2(l.gallons) });
  const totals = { tapped: line(), out: line(), none: line(), total: line() };
  const beers = new Map<string | null, BeerVolume>();
  const accounts = new Map<string | null, { accountId: string | null } & VolumeLine>();
  for (const m of moves) {
    if (m.day < from || m.day > to) continue;
    const g = gallonsOf(m.kegId);
    add(totals[m.kind], g);
    add(totals.total, g);
    const b = beers.get(m.beerId) ?? { beerId: m.beerId, tapped: line(), out: line(), none: line(), total: line() };
    add(b[m.kind], g);
    add(b.total, g);
    beers.set(m.beerId, b);
    if (m.kind === "out") {
      const a = accounts.get(m.accountId) ?? { accountId: m.accountId, ...line() };
      add(a, g);
      accounts.set(m.accountId, a);
    }
  }
  const byGallons = (a: VolumeLine, b: VolumeLine) => b.gallons - a.gallons || b.kegs - a.kegs;
  return {
    tapped: tidy(totals.tapped),
    out: tidy(totals.out),
    none: tidy(totals.none),
    total: tidy(totals.total),
    byBeer: [...beers.values()]
      .map((b) => ({ beerId: b.beerId, tapped: tidy(b.tapped), out: tidy(b.out), none: tidy(b.none), total: tidy(b.total) }))
      .sort((a, b) => byGallons(a.total, b.total) || (a.beerId ?? "").localeCompare(b.beerId ?? "")),
    byAccount: [...accounts.values()].map((a) => ({ accountId: a.accountId, ...tidy(a) })).sort((a, b) => byGallons(a, b) || (a.accountId ?? "").localeCompare(b.accountId ?? "")),
  };
}

// ---- Kegs at accounts -----------------------------------------------------------------------------------

export interface SnapshotRow {
  /** Null gathers kegs marked out with no account recorded. */
  accountId: string | null;
  name: string;
  total: number;
  /** Kegs out for more than the chosen number of days. */
  over: number;
  longest: number;
  bySize: Record<string, number>;
}

export interface Snapshot {
  /** The sizes out there, in the usual size order. */
  sizes: string[];
  rows: SnapshotRow[];
  all: { total: number; over: number; bySize: Record<string, number> };
}

/**
 * Every account with kegs out right now: how many, how many have been out for
 * more than `overDays`, and a count for each size. The most kegs first, then by
 * name, with "no account" last among equals.
 */
export function accountsSnapshot(out: OutKeg[], overDays: number, nameOf: (accountId: string | null) => string): Snapshot {
  const order = new Map(KEG_SIZE_LIST.map((s, i) => [s.id, i]));
  const sizes = [...new Set(out.map((k) => k.sizeId))].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
  const blank = () => Object.fromEntries(sizes.map((s) => [s, 0])) as Record<string, number>;
  const rows = new Map<string | null, SnapshotRow>();
  const all = { total: 0, over: 0, bySize: blank() };
  for (const k of out) {
    const r = rows.get(k.accountId) ?? { accountId: k.accountId, name: nameOf(k.accountId), total: 0, over: 0, longest: 0, bySize: blank() };
    const over = k.days > overDays ? 1 : 0;
    r.total++;
    r.over += over;
    r.longest = Math.max(r.longest, k.days);
    r.bySize[k.sizeId]++;
    all.total++;
    all.over += over;
    all.bySize[k.sizeId]++;
    rows.set(k.accountId, r);
  }
  return {
    sizes,
    rows: [...rows.values()].sort((a, b) => b.total - a.total || Number(a.accountId === null) - Number(b.accountId === null) || a.name.localeCompare(b.name)),
    all,
  };
}
