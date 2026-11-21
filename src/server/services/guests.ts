import "server-only";
import { addDays, businessDate, dateRange, daysBetween, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import { cardsToPlace, guestPlaces, PLACES_READY_KEY, placeFor, placesReady, type CardPayment, type GuestPlaces, type PlaceRow, type PlaceSource } from "@/domain/places";
import { GUEST_RULES, guestDays, guestItems, guestOrders, guestRhythm, guestStory, guestSummary, LOCAL_MONTHS, QUIET_DAYS, VISITOR_MAX_DAYS, VISITOR_SPAN_DAYS, type GuestAgg, type GuestOrders, type GuestRhythm, type OrderRow, type RhythmKind, type RhythmRow, type GuestPayment, type GuestStory, type GuestSummary } from "@/domain/guests";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { profilePlaces } from "../integrations/square-customers";
import { friendlySquareError, SquareError, type SquareClient } from "../integrations/square-http";
import { placeInfo } from "../geo";
import { location } from "./forecasting";
import { listOrders } from "../integrations/square";
import { listPayments } from "../integrations/square-payments";
import { firstSaleDate } from "./forecastScore";
import { businessToday, ignoredSquareIds, squareCatalogMeta } from "./sales";
import { isSquareConnected, readSettingJSON, requireSquareClient, withSquareLock, writeSettingJSON } from "./square";

/**
 * Who comes back, from Square card payments. Each card on each business day is
 * kept as a one-way scramble of Square's own marker (see square-payments.ts):
 * no name, card number or contact detail. The nightly payments pass keeps the
 * recent days fresh; the history is loaded once, a week at a time, newest first.
 */

const D = (n: number) => new Prisma.Decimal(n.toFixed(2));
const tz = () => env.BUSINESS_TIMEZONE;

/** Replace what's on file for these business days with what these payments say. */
export async function storeGuestVisits(payments: readonly GuestPayment[], dates: readonly ISODate[]) {
  if (!dates.length) return { visits: 0 };
  const { visits, days } = guestDays(payments, dates, (iso) => businessDate(iso, tz()));
  const inDates = { in: dates.map(parseISODate) };
  const now = new Date();
  await db.$transaction([
    db.guestVisit.deleteMany({ where: { date: inDates } }),
    db.guestVisit.createMany({ data: visits.map((v) => ({ date: parseISODate(v.date), guest: v.guest, payments: v.payments, amount: D(v.amount) })) }),
    db.guestDay.deleteMany({ where: { date: inDates } }),
    db.guestDay.createMany({ data: days.map((d) => ({ date: parseISODate(d.date), payments: d.payments, identified: d.identified, amount: D(d.amount), identifiedAmount: D(d.identifiedAmount), syncedAt: now })) }),
  ]);
  return { visits: visits.length };
}

// ---- Loading the history ------------------------------------------------------------------

const BACKFILL_KEY = "guests.backfill";

export interface GuestBackfill {
  /** The first day to reach (the first day with sales), and the day loading has got back to (everything from here on is loaded). */
  from: ISODate;
  next: ISODate;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
}

export const guestBackfill = () => readSettingJSON<GuestBackfill>(BACKFILL_KEY);

/**
 * Load card visits for past weeks, newest first, until `budgetMs` is spent or
 * the first day with sales is reached. Safe to call again and again: it picks
 * up where it stopped. Never throws.
 */
export async function backfillGuests(budgetMs = 35_000, client?: SquareClient): Promise<{ state: GuestBackfill | null; error?: string }> {
  const started = Date.now();
  let state = await guestBackfill();
  try {
    if (!(await isSquareConnected())) return { state, error: "Square isn't connected." };
    const today = businessToday();
    if (!state) {
      const first = await firstSaleDate();
      if (!first) return { state: null, error: "There are no sales on file yet." };
      state = { from: first, next: addDays(today, 1), startedAt: new Date().toISOString(), finishedAt: null, lastError: null };
      await writeSettingJSON(BACKFILL_KEY, state);
    }
    if (state.finishedAt) return { state };
    const c = client ?? (await requireSquareClient());
    while (state.next > state.from && Date.now() - started < budgetMs) {
      const weekBefore: ISODate = addDays(state.next, -7);
      const chunkFrom: ISODate = weekBefore > state.from ? weekBefore : state.from;
      const payments = await listPayments(c, zonedMidnightUTC(chunkFrom, tz()).toISOString(), zonedMidnightUTC(state.next, tz()).toISOString());
      await storeGuestVisits(payments, dateRange(chunkFrom, state.next));
      state = { ...state, next: chunkFrom, lastError: null };
      await writeSettingJSON(BACKFILL_KEY, state);
    }
    if (state.next <= state.from) {
      state = { ...state, finishedAt: new Date().toISOString() };
      await writeSettingJSON(BACKFILL_KEY, state);
    }
    return { state };
  } catch (e) {
    const error = friendlySquareError(e);
    if (state) await writeSettingJSON(BACKFILL_KEY, { ...state, lastError: error }).catch(() => undefined);
    return { state, error };
  }
}

// ---- What each card ordered ------------------------------------------------------------------

/** Item detail is kept for about two years: enough for a full year of comparison, without growing forever. */
const ITEM_DAYS = 730;
const ITEM_KEEP_DAYS = 800;
const ITEMS_BACKFILL_KEY = "guests.itemsBackfill";

export const guestItemsBackfill = () => readSettingJSON<GuestBackfill>(ITEMS_BACKFILL_KEY);

/** Replace what's on file for these business days with what these orders and payments say. */
async function syncGuestItems(from: ISODate, toExclusive: ISODate, client: SquareClient) {
  const start = zonedMidnightUTC(from, tz()).toISOString();
  const end = zonedMidnightUTC(toExclusive, tz()).toISOString();
  const [{ units }, payments] = await Promise.all([listOrders(client, start, end), listPayments(client, start, end)]);
  const dates = dateRange(from, toExclusive);
  const rows = guestItems(units, payments, dates, (iso) => businessDate(iso, tz()));
  await db.$transaction([
    db.guestItem.deleteMany({ where: { date: { in: dates.map(parseISODate) } } }),
    db.guestItem.createMany({ data: rows.map((r) => ({ date: parseISODate(r.date), guest: r.guest, squareId: r.squareId, name: r.name.slice(0, 200), qty: new Prisma.Decimal(r.qty.toFixed(3)), amount: D(r.amount) })) }),
  ]);
  return rows.length;
}

/** The nightly touch-up for recent days, and the oldest detail dropped. A failure is logged, not thrown. */
export async function syncGuestItemsQuietly(from: ISODate, toExclusive: ISODate) {
  try {
    const client = await requireSquareClient();
    const rows = await syncGuestItems(from, toExclusive, client);
    await db.guestItem.deleteMany({ where: { date: { lt: parseISODate(addDays(businessToday(), -ITEM_KEEP_DAYS)) } } });
    return rows;
  } catch (e) {
    console.error("guest items failed", friendlySquareError(e));
    return null;
  }
}

/** Load what each card ordered for the last two years, a week at a time, newest first. Same shape as `backfillGuests`. */
export async function backfillGuestItems(budgetMs = 35_000): Promise<{ state: GuestBackfill | null; error?: string }> {
  const started = Date.now();
  let state = await guestItemsBackfill();
  try {
    if (!(await isSquareConnected())) return { state, error: "Square isn't connected." };
    const today = businessToday();
    if (!state) {
      const first = await firstSaleDate();
      if (!first) return { state: null, error: "There are no sales on file yet." };
      const twoYears = addDays(today, -ITEM_DAYS);
      state = { from: first > twoYears ? first : twoYears, next: addDays(today, 1), startedAt: new Date().toISOString(), finishedAt: null, lastError: null };
      await writeSettingJSON(ITEMS_BACKFILL_KEY, state);
    }
    if (state.finishedAt) return { state };
    const client = await requireSquareClient();
    while (state.next > state.from && Date.now() - started < budgetMs) {
      const weekBefore: ISODate = addDays(state.next, -7);
      const chunkFrom: ISODate = weekBefore > state.from ? weekBefore : state.from;
      await syncGuestItems(chunkFrom, state.next, client);
      state = { ...state, next: chunkFrom, lastError: null };
      await writeSettingJSON(ITEMS_BACKFILL_KEY, state);
    }
    if (state.next <= state.from) {
      state = { ...state, finishedAt: new Date().toISOString() };
      await writeSettingJSON(ITEMS_BACKFILL_KEY, state);
    }
    return { state };
  } catch (e) {
    const error = friendlySquareError(e);
    if (state) await writeSettingJSON(ITEMS_BACKFILL_KEY, { ...state, lastError: error }).catch(() => undefined);
    return { state, error };
  }
}

// ---- Where they come from ------------------------------------------------------------------------
// The postal code on the Square profile behind a card's payments (or on a typed-in card), kept against
// the same scrambled card mark. Needs the Customers permission; until Square gives it, nothing is kept.

const PLACES_BACKFILL_KEY = "guests.placesBackfill";
/** Places are looked up for the last year of payments: the Customers page talks about the last 12 months. */
const PLACE_DAYS = 365;
const UPSERT_CHUNK = 400;
const DENIED_PAUSE_MS = 6 * 3_600_000;

export interface PlacesBackfill extends GuestBackfill {
  /** When Square last said no: the connection hasn't been given the Customers permission yet. */
  deniedAt: string | null;
}

export const placesBackfill = () => readSettingJSON<PlacesBackfill>(PLACES_BACKFILL_KEY);

/** Square's answer when the connection lacks the Customers permission. */
export const isPermissionDenied = (e: unknown) => e instanceof SquareError && (e.status === 403 || e.code === "INSUFFICIENT_SCOPES");

/**
 * Look up and keep where the cards in these payments come from, for any card
 * not placed yet (or asked a while ago, with nothing found). Only the postal
 * code and where it came from are kept. Throws Square's 403 when the
 * permission is missing.
 */
export async function storeGuestPlaces(payments: readonly CardPayment[], client: SquareClient): Promise<number> {
  const keys = [...new Set(payments.flatMap((p) => (p.cardKey ? [p.cardKey] : [])))];
  if (!keys.length) return 0;
  const today = businessToday();
  const rows = await db.guestPlace.findMany({ where: { guest: { in: keys } } });
  const known = new Map(rows.map((r) => [r.guest, { postal: r.postal, source: r.source as PlaceSource, checkedOn: toISODate(r.checkedOn) }]));
  const want = cardsToPlace(payments, known, today, daysBetween);
  if (!want.size) return 0;
  const ids = [...new Set([...want.values()].flatMap((w) => w.customerIds))];
  const profiles = ids.length ? await profilePlaces(client, ids) : new Map();
  const checkedOn = parseISODate(today);
  const fresh: { guest: string; postal: string | null; source: PlaceSource; checkedOn: Date }[] = [];
  const again: typeof fresh = [];
  for (const [guest, w] of want) (known.has(guest) ? again : fresh).push({ guest, ...placeFor(w, profiles), checkedOn });
  if (fresh.length) await db.guestPlace.createMany({ data: fresh, skipDuplicates: true });
  for (let i = 0; i < again.length; i += UPSERT_CHUNK) {
    await db.$transaction(again.slice(i, i + UPSERT_CHUNK).map(({ guest, ...d }) => db.guestPlace.update({ where: { guest }, data: d })));
  }
  return want.size;
}

/** The nightly touch-up, from the payments the nightly pass already read. Quiet: a missing permission is expected. */
export async function storeGuestPlacesQuietly(payments: readonly CardPayment[], client: SquareClient) {
  try {
    // Square said no lately: don't ask again on every 15-minute top-up (the nightly catch-up asks each night).
    const state = await placesBackfill();
    if (state?.deniedAt && Date.now() - Date.parse(state.deniedAt) < DENIED_PAUSE_MS) return null;
    return await storeGuestPlaces(payments, client);
  } catch (e) {
    if (!isPermissionDenied(e)) console.error("guest places failed", friendlySquareError(e));
    return null;
  }
}

/**
 * Work back through the last year of payments, a week at a time, newest first,
 * placing every card. Picks up where it stopped. When Square says the
 * permission is missing it records that and stops; the next call tries again,
 * so once someone reconnects Square it carries on by itself. Never throws.
 */
export async function backfillGuestPlaces(budgetMs = 35_000): Promise<{ state: PlacesBackfill | null; denied?: boolean; error?: string }> {
  // One at a time: two people with the page open, or the nightly run, mustn't work over the same weeks.
  const r = await withSquareLock(() => placesStretch(budgetMs), budgetMs + 30_000, "guests.places.lock");
  return r ?? { state: await placesBackfill() };
}

async function placesStretch(budgetMs: number): Promise<{ state: PlacesBackfill | null; denied?: boolean; error?: string }> {
  const started = Date.now();
  let state = await placesBackfill();
  try {
    if (!(await isSquareConnected())) return { state, error: "Square isn't connected." };
    const today = businessToday();
    if (!state) {
      const first = await firstSaleDate();
      if (!first) return { state: null, error: "There are no sales on file yet." };
      const yearAgo = addDays(today, -PLACE_DAYS);
      state = { from: first > yearAgo ? first : yearAgo, next: addDays(today, 1), startedAt: new Date().toISOString(), finishedAt: null, lastError: null, deniedAt: null };
      await writeSettingJSON(PLACES_BACKFILL_KEY, state);
    }
    if (state.finishedAt) return { state };
    const c = await requireSquareClient();
    while (state.next > state.from && Date.now() - started < budgetMs) {
      const weekBefore: ISODate = addDays(state.next, -7);
      const chunkFrom: ISODate = weekBefore > state.from ? weekBefore : state.from;
      const payments = await listPayments(c, zonedMidnightUTC(chunkFrom, tz()).toISOString(), zonedMidnightUTC(state.next, tz()).toISOString());
      await storeGuestPlaces(payments.filter((p) => p.status === "COMPLETED"), c);
      state = { ...state, next: chunkFrom, lastError: null, deniedAt: null };
      await writeSettingJSON(PLACES_BACKFILL_KEY, state);
    }
    if (state.next <= state.from) {
      state = { ...state, finishedAt: new Date().toISOString() };
      await writeSettingJSON(PLACES_BACKFILL_KEY, state);
    }
    return { state };
  } catch (e) {
    if (isPermissionDenied(e)) {
      if (state) {
        state = { ...state, deniedAt: new Date().toISOString(), lastError: null };
        await writeSettingJSON(PLACES_BACKFILL_KEY, state).catch(() => undefined);
      }
      return { state, denied: true };
    }
    const error = friendlySquareError(e);
    if (state) await writeSettingJSON(PLACES_BACKFILL_KEY, { ...state, lastError: error }).catch(() => undefined);
    return { state, error };
  }
}

/** Count the last 12 months' cards by postal code and kind, and lay them out by town and distance. */
async function countPlaces(year: ISODate, today: ISODate): Promise<GuestPlaces | null> {
  if ((await db.guestPlace.count()) === 0) return null;
  const [rows, [tot], home] = await Promise.all([
    db.$queryRaw<PlaceRow[]>`
      WITH g AS (
        SELECT "guest", MIN("date") AS first, MAX("date") AS last, COUNT(*) AS days, COUNT(DISTINCT date_trunc('month', "date")) AS months,
               COALESCE(SUM("amount") FILTER (WHERE "date" >= ${year}::date AND "date" < ${today}::date), 0) AS amount365
        FROM "GuestVisit" GROUP BY "guest"
        HAVING MAX("date") >= ${year}::date),
      k AS (
        SELECT "guest", amount365, CASE WHEN months >= ${LOCAL_MONTHS} THEN 'local'
                             WHEN days <= ${VISITOR_MAX_DAYS} AND (last - first) <= ${VISITOR_SPAN_DAYS} THEN 'visitor'
                             ELSE 'occasional' END AS kind
        FROM g)
      SELECT p."postal" AS "postal", k.kind AS "kind", COUNT(*)::int AS "people", COALESCE(SUM(k.amount365), 0)::float8 AS "sales"
      FROM "GuestPlace" p JOIN k USING ("guest")
      WHERE p."postal" IS NOT NULL
      GROUP BY 1, 2`,
    db.$queryRaw<{ guests: number; checked: number }[]>`
      WITH g AS (SELECT "guest" FROM "GuestVisit" GROUP BY "guest" HAVING MAX("date") >= ${year}::date)
      SELECT COUNT(*)::int AS "guests", COUNT(p."guest")::int AS "checked"
      FROM g LEFT JOIN "GuestPlace" p USING ("guest")`,
    location(),
  ]);
  return guestPlaces(rows, tot ?? { guests: 0, checked: 0 }, placeInfo, home);
}

// ---- The picture ----------------------------------------------------------------------------

const SUMMARY_KEY = "guests.summary";
const WEEKS = 26;

export interface GuestWeek {
  week: ISODate;
  /** Cards seen that week, and how many had never been seen before. */
  guests: number;
  newGuests: number;
  sales: number;
  /** Paid by cards that had been in before that week. */
  returningSales: number;
}

interface StoredGuests {
  rules: number;
  computedOn: ISODate;
  summary: GuestSummary;
  weekly: GuestWeek[];
  rhythm: GuestRhythm;
  orders: GuestOrders | null;
  /** Where cards come from; null until any card has been placed. */
  places: GuestPlaces | null;
}

/** Count everything again from the visits on file and keep the result (the page reads the kept copy). */
export async function computeGuests(): Promise<StoredGuests> {
  const today = businessToday();
  const year = addDays(today, -365);
  const priorTo = addDays(today, -QUIET_DAYS);
  const priorFrom = addDays(priorTo, -365);
  const [guests, days, weekly, rhythmRows, openDays, itemRows, meta, ignored] = await Promise.all([
    db.$queryRaw<GuestAgg[]>`
      SELECT MIN("date")::text AS "first",
             (ARRAY_AGG("date" ORDER BY "date"))[2]::text AS "second",
             MAX("date")::text AS "last",
             COUNT(*)::int AS "days",
             COUNT(DISTINCT date_trunc('month', "date"))::int AS "months",
             SUM("amount")::float8 AS "amount",
             (COUNT(*) FILTER (WHERE "date" >= ${year}::date))::int AS "days365",
             COALESCE(SUM("amount") FILTER (WHERE "date" >= ${year}::date), 0)::float8 AS "amount365",
             (COUNT(*) FILTER (WHERE "date" >= ${priorFrom}::date AND "date" < ${priorTo}::date))::int AS "daysPrior",
             COALESCE(SUM("amount") FILTER (WHERE "date" >= ${priorFrom}::date AND "date" < ${priorTo}::date), 0)::float8 AS "amountPrior"
      FROM "GuestVisit"
      GROUP BY "guest"`,
    db.guestDay.findMany({ where: { date: { gte: parseISODate(year), lt: parseISODate(today) } }, select: { payments: true, identified: true, amount: true, identifiedAmount: true } }),
    db.$queryRaw<{ week: string; guests: number; newGuests: number; sales: number; returningSales: number }[]>`
      WITH f AS (SELECT "guest", MIN("date") AS first FROM "GuestVisit" GROUP BY "guest")
      SELECT date_trunc('week', v."date")::date::text AS "week",
             COUNT(DISTINCT v."guest")::int AS "guests",
             (COUNT(DISTINCT v."guest") FILTER (WHERE f.first >= date_trunc('week', v."date")))::int AS "newGuests",
             SUM(v."amount")::float8 AS "sales",
             COALESCE(SUM(v."amount") FILTER (WHERE f.first < date_trunc('week', v."date")), 0)::float8 AS "returningSales"
      FROM "GuestVisit" v JOIN f USING ("guest")
      WHERE v."date" >= ${addDays(today, -7 * WEEKS)}::date AND v."date" < ${today}::date
      GROUP BY 1 ORDER BY 1`,
    // The last 12 months of visits by weekday, month and kind of card (the same reading of timing as `kindOf`,
    // except that a brand-new card is counted by what it has done so far).
    db.$queryRaw<RhythmRow[]>`
      WITH g AS (
        SELECT "guest", MIN("date") AS first, MAX("date") AS last, COUNT(*) AS days, COUNT(DISTINCT date_trunc('month', "date")) AS months
        FROM "GuestVisit" GROUP BY "guest"),
      k AS (
        SELECT "guest", CASE WHEN months >= ${LOCAL_MONTHS} THEN 'local'
                             WHEN days <= ${VISITOR_MAX_DAYS} AND (last - first) <= ${VISITOR_SPAN_DAYS} THEN 'visitor'
                             ELSE 'occasional' END AS kind
        FROM g)
      SELECT EXTRACT(DOW FROM v."date")::int AS "wd", EXTRACT(MONTH FROM v."date")::int AS "month", k.kind AS "kind",
             COUNT(*)::int AS "visits", SUM(v."amount")::float8 AS "sales"
      FROM "GuestVisit" v JOIN k USING ("guest")
      WHERE v."date" >= ${year}::date AND v."date" < ${today}::date
      GROUP BY 1, 2, 3`,
    db.$queryRaw<{ wd: number; month: number; days: number }[]>`
      SELECT EXTRACT(DOW FROM "date")::int AS "wd", EXTRACT(MONTH FROM "date")::int AS "month", COUNT(*)::int AS "days"
      FROM "GuestDay"
      WHERE "identified" > 0 AND "date" >= ${year}::date AND "date" < ${today}::date
      GROUP BY 1, 2`,
    // What each kind of card bought over the same 12 months, item by item.
    db.$queryRaw<{ squareId: string; name: string; kind: RhythmKind; qty: number; sales: number }[]>`
      WITH g AS (
        SELECT "guest", MIN("date") AS first, MAX("date") AS last, COUNT(*) AS days, COUNT(DISTINCT date_trunc('month', "date")) AS months
        FROM "GuestVisit" GROUP BY "guest"),
      k AS (
        SELECT "guest", CASE WHEN months >= ${LOCAL_MONTHS} THEN 'local'
                             WHEN days <= ${VISITOR_MAX_DAYS} AND (last - first) <= ${VISITOR_SPAN_DAYS} THEN 'visitor'
                             ELSE 'occasional' END AS kind
        FROM g)
      SELECT i."squareId" AS "squareId", MAX(i."name") AS "name", k.kind AS "kind", SUM(i."qty")::float8 AS "qty", SUM(i."amount")::float8 AS "sales"
      FROM "GuestItem" i JOIN k USING ("guest")
      WHERE i."date" >= ${year}::date AND i."date" < ${today}::date
      GROUP BY 1, 3`,
    squareCatalogMeta(),
    ignoredSquareIds(),
  ]);
  const places = await countPlaces(year, today);
  const skip = new Set(ignored);
  const orderRows: OrderRow[] = itemRows.filter((r) => !skip.has(r.squareId)).map((r) => ({ ...r, name: meta[r.squareId]?.baseName || r.name, category: meta[r.squareId]?.category ?? null }));
  const stored: StoredGuests = {
    rules: GUEST_RULES,
    computedOn: today,
    summary: guestSummary({ guests, days: days.map((d) => ({ payments: d.payments, identified: d.identified, amount: d.amount.toNumber(), identifiedAmount: d.identifiedAmount.toNumber() })), today }),
    weekly: weekly.map((w) => ({ week: w.week, guests: w.guests, newGuests: w.newGuests, sales: Math.round(w.sales), returningSales: Math.round(w.returningSales) })),
    rhythm: guestRhythm(rhythmRows, openDays),
    orders: guestOrders(orderRows, rhythmRows),
    places,
  };
  await writeSettingJSON(SUMMARY_KEY, stored);
  // The first time there's enough for the map, note the day: that's when its What's new card appears.
  if (placesReady(places) && !(await db.setting.findUnique({ where: { key: PLACES_READY_KEY } }))) {
    await db.setting.create({ data: { key: PLACES_READY_KEY, value: today } }).catch(() => undefined);
  }
  return stored;
}

/** Same, but a failure is logged instead of thrown: the nightly sync must not stop for it. */
export async function computeGuestsQuietly() {
  try {
    return await computeGuests();
  } catch (e) {
    console.error("guest summary failed", e);
    return null;
  }
}

export interface GuestView {
  connected: boolean;
  /** Days with card visits on file. */
  daysOnFile: number;
  summary: GuestSummary | null;
  story: GuestStory | null;
  weekly: GuestWeek[];
  /** A typical open day by weekday and by month: who came. */
  rhythm: GuestRhythm | null;
  /** What locals and visitors order; null until item detail is loaded. */
  orders: GuestOrders | null;
  backfill: GuestBackfill | null;
  /** The loading of what each card ordered (the last two years). */
  itemsBackfill: GuestBackfill | null;
  /** The first day with sales: how far back the history could go. */
  firstSale: ISODate | null;
  /** Where cards come from (null until any is placed), how the year's look-up is going, and where the taproom is. */
  places: GuestPlaces | null;
  placesBackfill: PlacesBackfill | null;
  home: { lat: number; lon: number; label: string };
}

export async function guestView(): Promise<GuestView> {
  const [connected, daysOnFile, kept, backfill, itemsBackfill, firstSale, placesState, home] = await Promise.all([isSquareConnected(), db.guestDay.count({ where: { payments: { gt: 0 } } }), readSettingJSON<StoredGuests>(SUMMARY_KEY), guestBackfill(), guestItemsBackfill(), firstSaleDate(), placesBackfill(), location()]);
  // Counted nightly; count now if there are visits but no kept copy, or it's from another day.
  const stored = daysOnFile > 0 && (kept?.computedOn !== businessToday() || kept.rules !== GUEST_RULES) ? await computeGuests() : kept;
  const summary = daysOnFile > 0 ? (stored?.summary ?? null) : null;
  const rhythm = summary ? (stored?.rhythm ?? null) : null;
  const orders = summary ? (stored?.orders ?? null) : null;
  const places = summary ? (stored?.places ?? null) : null;
  return { connected, daysOnFile, summary, story: summary ? guestStory(summary, rhythm, orders) : null, weekly: summary ? (stored?.weekly ?? []) : [], rhythm, orders, backfill, itemsBackfill, firstSale, places, placesBackfill: placesState, home };
}

/** Days on file, for a progress line: the earliest day loaded. */
export async function earliestGuestDay(): Promise<ISODate | null> {
  const r = await db.guestDay.findFirst({ where: { payments: { gt: 0 } }, orderBy: { date: "asc" }, select: { date: true } });
  return r ? toISODate(r.date) : null;
}
