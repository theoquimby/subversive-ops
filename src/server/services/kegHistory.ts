import "server-only";
import type { Prisma } from "@prisma/client";
import { addDays, zonedMidnightUTC } from "@/domain/dates";
import { toCsv } from "@/domain/dataTable";
import { ACTION_DONE, displayCode, normalizeCode, placeLabel } from "@/domain/kegs";
import { decodeCursor, HISTORY_CSV_MAX, HISTORY_PAGE, NO_BEER, pageOf, searchTokens, WHO_IMPORTED, WHO_NOBODY, whoKey, whoLabel, type HistoryParams } from "@/domain/kegHistory";
import { businessDateTime, businessTimeZone } from "@/lib/format";
import { db } from "../db";
import { findKegByScan } from "./kegs";

/**
 * Keg history, every entry ever, paged on the server: the newest page that
 * matches the address, older pages by cursor, facet counts for the filters,
 * and the whole filtered range as a CSV. Parsing the address is in
 * domain/kegHistory.
 */

export interface HistoryRow {
  id: string;
  /** ISO instant. */
  at: string;
  /** "Nov 13, 3:05pm" in the business timezone. */
  when: string;
  kegCode: string;
  kegDisplay: string;
  action: string;
  actionLabel: string;
  beerId: string | null;
  beer: string | null;
  color: string | null;
  accountId: string | null;
  account: string | null;
  note: string | null;
  /** "Walk-in → Tap 3", or one place. Null when it says nothing. */
  place: string | null;
  who: string;
  whoKey: string;
  undone: boolean;
}

export interface HistoryOptions {
  actions: { value: string; label: string }[];
  beers: { value: string; label: string }[];
  who: { value: string; label: string }[];
  accounts: { value: string; label: string }[];
}

export interface HistoryPage {
  rows: HistoryRow[];
  /** Cursor for "Load older"; null when these are the oldest. */
  next: string | null;
  /** Entries that match, across every page. */
  total: number;
  /** Facet counts given the other filters: filter id → value → entries. */
  counts: Record<string, Record<string, number>>;
  options: HistoryOptions;
  /** The keg the search named, when it named one. */
  keg: { id: string; code: string } | null;
}

const NO_SPOT = placeLabel({ area: null });
/** "Somewhere — no spot yet" is the app's words for an unknown place; in a dense table it's just noise. */
const place = (p: string | null) => (!p || p === NO_SPOT ? null : p);
/** The import writes "Imported (old code <long id>)"; the id is on the keg's own page. */
const note = (n: string | null) => (n && /^Imported \(old code /.test(n) ? "Brought in from the old keg app" : n);

type Facet = "action" | "beer" | "who" | "account";

/** The search: one keg if it names one, else every word somewhere in the entry. */
async function searchWhere(q: string): Promise<{ where: Prisma.KegEventWhereInput; keg: { id: string; code: string } | null }> {
  if (!q) return { where: {}, keg: null };
  const keg = await findKegByScan(q);
  if (keg) return { where: { kegId: keg.id }, keg };
  const tokens = searchTokens(q);
  const beers = await db.beer.findMany({ where: { OR: tokens.map((t) => ({ name: { contains: t, mode: "insensitive" as const } })) }, select: { id: true, name: true } });
  const and: Prisma.KegEventWhereInput[] = tokens.map((t) => {
    const code = normalizeCode(t);
    const beerIds = beers.filter((b) => b.name.toLowerCase().includes(t.toLowerCase())).map((b) => b.id);
    return {
      OR: [
        ...(code ? [{ keg: { code: { contains: code } } }] : []),
        { keg: { legacyCode: { contains: t, mode: "insensitive" } } },
        { keg: { label: { contains: t, mode: "insensitive" } } },
        { userName: { contains: t, mode: "insensitive" } },
        { note: { contains: t, mode: "insensitive" } },
        { account: { name: { contains: t, mode: "insensitive" } } },
        { fromPlace: { contains: t, mode: "insensitive" } },
        { toPlace: { contains: t, mode: "insensitive" } },
        ...(beerIds.length ? [{ beerId: { in: beerIds } }] : []),
      ],
    };
  });
  return { where: { AND: and }, keg: null };
}

function whoWhere(keys: string[]): Prisma.KegEventWhereInput {
  const names = keys.filter((k) => k !== WHO_IMPORTED && k !== WHO_NOBODY);
  return {
    OR: [
      ...(names.length ? [{ userName: { in: names } }] : []),
      ...(keys.includes(WHO_IMPORTED) ? [{ userName: null, importKey: { not: null } }] : []),
      ...(keys.includes(WHO_NOBODY) ? [{ userName: null, importKey: null }] : []),
    ],
  };
}

/** Every condition but `skip` (facet counts leave their own facet out). */
function buildWhere(p: HistoryParams, search: Prisma.KegEventWhereInput, skip?: Facet): Prisma.KegEventWhereInput {
  const tz = businessTimeZone();
  const and: Prisma.KegEventWhereInput[] = [search];
  if (p.keg) and.push({ kegId: p.keg });
  if (p.from || p.to) and.push({ at: { ...(p.from ? { gte: zonedMidnightUTC(p.from, tz) } : {}), ...(p.to ? { lt: zonedMidnightUTC(addDays(p.to, 1), tz) } : {}) } });
  if (skip !== "action" && p.actions.length) and.push({ action: { in: p.actions } });
  if (skip !== "beer" && p.beers.length) {
    const ids = p.beers.filter((b) => b !== NO_BEER);
    and.push({ OR: [...(ids.length ? [{ beerId: { in: ids } }] : []), ...(p.beers.includes(NO_BEER) ? [{ beerId: null }] : [])] });
  }
  if (skip !== "account" && p.accounts.length) and.push({ accountId: { in: p.accounts } });
  if (skip !== "who" && p.who.length) and.push(whoWhere(p.who));
  return { AND: and };
}

const INCLUDE = { keg: { select: { code: true } }, account: { select: { name: true } } } satisfies Prisma.KegEventInclude;
type DbEvent = Prisma.KegEventGetPayload<{ include: typeof INCLUDE }>;
type BeerInfo = { name: string; color: string };

function toRow(e: DbEvent, beers: Map<string, BeerInfo>, tz: string): HistoryRow {
  const b = e.beerId ? beers.get(e.beerId) : undefined;
  const from = place(e.fromPlace), to = place(e.toPlace);
  const key = whoKey(e);
  return {
    id: e.id,
    at: e.at.toISOString(),
    when: businessDateTime(e.at, tz),
    kegCode: e.keg.code,
    kegDisplay: displayCode(e.keg.code),
    action: e.action,
    actionLabel: ACTION_DONE[e.action] ?? e.action,
    beerId: e.beerId,
    beer: b?.name ?? null,
    color: b?.color ?? null,
    accountId: e.accountId,
    account: e.account?.name ?? null,
    note: note(e.note),
    place: from && to && from !== to ? `${from} → ${to}` : to ?? from ?? null,
    who: whoLabel(key),
    whoKey: key,
    undone: !!e.undoneAt,
  };
}

const beerMap = async () => new Map((await db.beer.findMany({ select: { id: true, name: true, color: true } })).map((b) => [b.id, { name: b.name, color: b.color }]));

/** Entries older than the cursor (newest first, ties by id). */
function olderThan(cursor: string | null): Prisma.KegEventWhereInput {
  const c = decodeCursor(cursor);
  if (!c) return {};
  const at = new Date(c.at);
  return { OR: [{ at: { lt: at } }, { at, id: { lt: c.id } }] };
}

const ORDER = [{ at: "desc" }, { id: "desc" }] satisfies Prisma.KegEventOrderByWithRelationInput[];

/** The newest page that matches, with counts and the filter options. */
export async function historyPage(p: HistoryParams): Promise<HistoryPage> {
  const tz = businessTimeZone();
  const { where: search, keg } = await searchWhere(p.q);
  const where = buildWhere(p, search);
  const [fetched, total, byAction, byBeer, byAccount, byWho, imported, nobody, beers, accounts] = await Promise.all([
    db.kegEvent.findMany({ where, orderBy: ORDER, take: HISTORY_PAGE + 1, include: INCLUDE }),
    db.kegEvent.count({ where }),
    db.kegEvent.groupBy({ by: ["action"], where: buildWhere(p, search, "action"), _count: { _all: true } }),
    db.kegEvent.groupBy({ by: ["beerId"], where: buildWhere(p, search, "beer"), _count: { _all: true } }),
    db.kegEvent.groupBy({ by: ["accountId"], where: buildWhere(p, search, "account"), _count: { _all: true } }),
    db.kegEvent.groupBy({ by: ["userName"], where: { AND: [buildWhere(p, search, "who"), { userName: { not: null } }] }, _count: { _all: true } }),
    db.kegEvent.count({ where: { AND: [buildWhere(p, search, "who"), { userName: null, importKey: { not: null } }] } }),
    db.kegEvent.count({ where: { AND: [buildWhere(p, search, "who"), { userName: null, importKey: null }] } }),
    beerMap(),
    db.kegAccount.findMany({ select: { id: true, name: true } }),
  ]);
  const page = pageOf(fetched, HISTORY_PAGE);

  const counts: HistoryPage["counts"] = { action: {}, beer: {}, account: {}, who: {} };
  for (const g of byAction) counts.action[g.action] = g._count._all;
  for (const g of byBeer) counts.beer[g.beerId ?? NO_BEER] = g._count._all;
  for (const g of byAccount) if (g.accountId) counts.account[g.accountId] = g._count._all;
  for (const g of byWho) if (g.userName?.trim()) counts.who[g.userName.trim()] = (counts.who[g.userName.trim()] ?? 0) + g._count._all;
  if (imported) counts.who[WHO_IMPORTED] = imported;
  if (nobody) counts.who[WHO_NOBODY] = nobody;

  // Options: every value with entries under the other filters, plus anything already picked.
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const opts = (values: Iterable<string>, label: (v: string) => string | undefined) =>
    [...new Set(values)].map((value) => ({ value, label: label(value) ?? value })).sort((a, b) => a.label.localeCompare(b.label));
  const options: HistoryOptions = {
    actions: opts([...Object.keys(counts.action), ...p.actions], (a) => ACTION_DONE[a]),
    beers: opts([...Object.keys(counts.beer), ...p.beers], (b) => (b === NO_BEER ? "No beer" : beers.get(b)?.name)),
    who: opts([...Object.keys(counts.who), ...p.who], whoLabel),
    accounts: opts([...Object.keys(counts.account), ...p.accounts], (a) => accountName.get(a)),
  };

  return { rows: page.rows.map((e) => toRow(e, beers, tz)), next: page.next, total, counts, options, keg };
}

/** The page after `cursor`, under the same filters. */
export async function historyOlder(p: HistoryParams, cursor: string): Promise<{ rows: HistoryRow[]; next: string | null }> {
  const tz = businessTimeZone();
  const { where: search } = await searchWhere(p.q);
  const [fetched, beers] = await Promise.all([
    db.kegEvent.findMany({ where: { AND: [buildWhere(p, search), olderThan(cursor)] }, orderBy: ORDER, take: HISTORY_PAGE + 1, include: INCLUDE }),
    beerMap(),
  ]);
  const page = pageOf(fetched, HISTORY_PAGE);
  return { rows: page.rows.map((e) => toRow(e, beers, tz)), next: page.next };
}

/** Every entry that matches (up to HISTORY_CSV_MAX), newest first, as CSV. */
export async function historyCsv(p: HistoryParams): Promise<{ csv: string; count: number; capped: boolean }> {
  const tz = businessTimeZone();
  const { where: search } = await searchWhere(p.q);
  const [fetched, beers] = await Promise.all([
    db.kegEvent.findMany({ where: buildWhere(p, search), orderBy: ORDER, take: HISTORY_CSV_MAX + 1, include: INCLUDE }),
    beerMap(),
  ]);
  const rows = fetched.slice(0, HISTORY_CSV_MAX).map((e) => toRow(e, beers, tz));
  const csv = toCsv(rows, [
    { header: "When", value: (r) => r.when },
    { header: "At (UTC)", value: (r) => r.at },
    { header: "Keg", value: (r) => r.kegDisplay },
    { header: "What", value: (r) => r.actionLabel },
    { header: "Beer", value: (r) => r.beer },
    { header: "Account", value: (r) => r.account },
    { header: "Where", value: (r) => r.place },
    { header: "Who", value: (r) => r.who },
    { header: "Note", value: (r) => r.note },
    { header: "Undone", value: (r) => (r.undone ? "yes" : "") },
  ]);
  return { csv, count: rows.length, capped: fetched.length > HISTORY_CSV_MAX };
}
