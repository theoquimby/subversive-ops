import "server-only";
import type { ISODate } from "@/domain/dates";
import {
  accountNumbers,
  accountRows,
  accountsSnapshot,
  deliveriesByMonth,
  deliveryHistory,
  kegsOut,
  movements,
  presetRange,
  stays,
  staysAt,
  takenByBeer,
  twelveMonthsFrom,
  volumeReport,
  type AccountKeg,
  type AccountNumbers,
  type AccountRow,
  type BeerTake,
  type BeerVolume,
  type DeliveryMonth,
  type HistoryRow,
  type OutKeg,
  type RangePreset,
  type Snapshot,
  type VolumeLine,
} from "@/domain/kegAccounts";
import { monthsBetween } from "@/domain/kegFleet";
import { kegSizeInfo } from "@/domain/kegs";
import { db } from "../db";
import { fleetData } from "./kegFleet";
import { kegConfig } from "./kegs";

/**
 * Account pages and keg reports. Like the fleet page, every number is worked
 * out from the keg history on request (domain/kegAccounts): the same events and
 * kegs fleetData() loads, plus each keg's account and beer ids.
 */

export const NO_ACCOUNT = "No account recorded";

async function load() {
  const [{ events, kegs: fleet, today, first }, ids, accounts, beers, cfg] = await Promise.all([
    fleetData(),
    db.keg.findMany({ select: { id: true, accountId: true, beerId: true } }),
    db.kegAccount.findMany({ orderBy: { name: "asc" } }),
    db.beer.findMany({ select: { id: true, name: true, color: true } }),
    kegConfig(),
  ]);
  const extra = new Map(ids.map((k) => [k.id, k]));
  const kegs: AccountKeg[] = fleet.map((k) => ({ ...k, accountId: extra.get(k.id)?.accountId ?? null, beerId: extra.get(k.id)?.beerId ?? null }));
  const gallons = new Map(kegs.map((k) => [k.id, kegSizeInfo(k.sizeId).gallons]));
  return {
    events,
    kegs,
    today,
    first,
    accounts,
    overdueDays: cfg.overdueDays,
    gallonsOf: (kegId: string) => gallons.get(kegId) ?? 0,
    kegOf: new Map(kegs.map((k) => [k.id, k])),
    beerOf: new Map(beers.map((b) => [b.id, b])),
    accountName: new Map(accounts.map((a) => [a.id, a.name])),
  };
}

// ---- The accounts list -------------------------------------------------------------------------

export interface AccountsList {
  today: ISODate;
  overdueDays: number;
  rows: AccountRow[];
  /** Kegs out right now, at an account or not. */
  kegsOut: number;
  /** Of those, kegs out for more than `overdueDays`. */
  kegsOverdue: number;
  /** Kegs marked out with no account recorded; they are on no row. */
  noAccount: number;
  /** Deliveries to any account on the list in the last 12 months. */
  deliveries12: number;
}

export async function accountsList(): Promise<AccountsList> {
  const d = await load();
  const out = kegsOut(d.kegs, d.events, d.today);
  const rows = accountRows(d.accounts, stays(d.events), out, d.today, d.overdueDays);
  return {
    today: d.today,
    overdueDays: d.overdueDays,
    rows,
    kegsOut: out.length,
    kegsOverdue: out.filter((k) => k.days > d.overdueDays).length,
    noAccount: out.filter((k) => !k.accountId || !d.accountName.has(k.accountId)).length,
    deliveries12: rows.reduce((sum, r) => sum + r.deliveries12, 0),
  };
}

// ---- One account ---------------------------------------------------------------------------------

export type AccountRange = "12m" | "all";

export interface AccountDetail {
  id: string;
  name: string;
  kind: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
}

export interface AccountPage {
  account: AccountDetail;
  range: AccountRange;
  today: ISODate;
  /** The first day the chart and "What they take" cover. */
  from: ISODate;
  /** The first day of the last 12 months, which the headline numbers cover whatever the range. */
  yearFrom: ISODate;
  overdueDays: number;
  numbers: AccountNumbers;
  /** Kegs here right now, the longest wait first. */
  here: OutKeg[];
  months: DeliveryMonth[];
  beers: (BeerTake & { name: string | null; color: string | null })[];
  /** The latest deliveries, capped; `total` is every delivery on record. */
  history: { rows: (HistoryRow & { code: string | null; sizeId: string | null; beer: string | null })[]; total: number };
}

/** Everything on one account's page; null when there is no such account. */
export async function accountPage(id: string, range: AccountRange): Promise<AccountPage | null> {
  const d = await load();
  const a = d.accounts.find((x) => x.id === id);
  if (!a) return null;
  const mine = staysAt(stays(d.events), id);
  const here = kegsOut(d.kegs, d.events, d.today).filter((k) => k.accountId === id);
  const yearFrom = twelveMonthsFrom(d.today);
  const from = range === "all" && mine.length && mine[0].out < yearFrom ? mine[0].out : yearFrom;
  const history = deliveryHistory(mine, new Set(here.map((k) => k.id)), d.today);
  return {
    account: { id: a.id, name: a.name, kind: a.kind, contact: a.contact, email: a.email, phone: a.phone, address: a.address, notes: a.notes, active: a.active },
    range,
    today: d.today,
    from,
    yearFrom,
    overdueDays: d.overdueDays,
    numbers: accountNumbers(mine, here, d.gallonsOf, d.today),
    here,
    months: deliveriesByMonth(mine, monthsBetween(from, d.today), d.gallonsOf),
    beers: takenByBeer(mine, d.gallonsOf, range === "all" ? undefined : yearFrom).map((b) => ({ ...b, name: b.beerId ? d.beerOf.get(b.beerId)?.name ?? null : null, color: b.beerId ? d.beerOf.get(b.beerId)?.color ?? null : null })),
    history: {
      total: history.total,
      rows: history.rows.map((r) => ({ ...r, code: d.kegOf.get(r.kegId)?.code ?? null, sizeId: d.kegOf.get(r.kegId)?.sizeId ?? null, beer: r.beerId ? d.beerOf.get(r.beerId)?.name ?? null : null })),
    },
  };
}

// ---- Reports ---------------------------------------------------------------------------------------

export interface KegReports {
  today: ISODate;
  /** The first day there is any keg history; null with none. */
  first: ISODate | null;
  overdueDays: number;
  volume: {
    preset: RangePreset;
    from: ISODate;
    to: ISODate;
    tapped: VolumeLine;
    out: VolumeLine;
    none: VolumeLine;
    total: VolumeLine;
    /** `name` is null when no beer was recorded. */
    byBeer: (BeerVolume & { name: string | null; color: string | null })[];
    /** Deliveries only. `name` is null for deliveries with no account recorded. */
    byAccount: ({ accountId: string | null; name: string | null } & VolumeLine)[];
  };
  /** Kegs at accounts right now. */
  snapshot: Snapshot;
  /** The number of days the snapshot's "out longer than" column uses. */
  days: number;
}

/** Both reports. `days` null means the "out too long" number from Setup. */
export async function kegReports(preset: RangePreset, days: number | null): Promise<KegReports> {
  const d = await load();
  const { from, to } = presetRange(preset, d.today, d.first);
  const v = volumeReport(movements(d.events, d.kegs), from, to, d.gallonsOf);
  const over = days ?? d.overdueDays;
  return {
    today: d.today,
    first: d.first,
    overdueDays: d.overdueDays,
    volume: {
      preset,
      from,
      to,
      tapped: v.tapped,
      out: v.out,
      none: v.none,
      total: v.total,
      byBeer: v.byBeer.map((b) => ({ ...b, name: b.beerId ? d.beerOf.get(b.beerId)?.name ?? null : null, color: b.beerId ? d.beerOf.get(b.beerId)?.color ?? null : null })),
      byAccount: v.byAccount.map((a) => ({ ...a, name: a.accountId ? d.accountName.get(a.accountId) ?? null : null })),
    },
    snapshot: accountsSnapshot(kegsOut(d.kegs, d.events, d.today), over, (id) => (id ? d.accountName.get(id) ?? NO_ACCOUNT : NO_ACCOUNT)),
    days: over,
  };
}
