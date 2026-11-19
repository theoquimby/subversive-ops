import "server-only";
import { addDays, businessDate, dateRange, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import { GUEST_RULES, guestDays, guestStory, guestSummary, QUIET_DAYS, type GuestAgg, type GuestPayment, type GuestStory, type GuestSummary } from "@/domain/guests";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { friendlySquareError, type SquareClient } from "../integrations/square-http";
import { listPayments } from "../integrations/square-payments";
import { firstSaleDate } from "./forecastScore";
import { businessToday } from "./sales";
import { isSquareConnected, readSettingJSON, requireSquareClient, writeSettingJSON } from "./square";

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
}

/** Count everything again from the visits on file and keep the result (the page reads the kept copy). */
export async function computeGuests(): Promise<StoredGuests> {
  const today = businessToday();
  const year = addDays(today, -365);
  const priorTo = addDays(today, -QUIET_DAYS);
  const priorFrom = addDays(priorTo, -365);
  const [guests, days, weekly] = await Promise.all([
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
  ]);
  const stored: StoredGuests = {
    rules: GUEST_RULES,
    computedOn: today,
    summary: guestSummary({ guests, days: days.map((d) => ({ payments: d.payments, identified: d.identified, amount: d.amount.toNumber(), identifiedAmount: d.identifiedAmount.toNumber() })), today }),
    weekly: weekly.map((w) => ({ week: w.week, guests: w.guests, newGuests: w.newGuests, sales: Math.round(w.sales), returningSales: Math.round(w.returningSales) })),
  };
  await writeSettingJSON(SUMMARY_KEY, stored);
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
  backfill: GuestBackfill | null;
  /** The first day with sales: how far back the history could go. */
  firstSale: ISODate | null;
}

export async function guestView(): Promise<GuestView> {
  const [connected, daysOnFile, kept, backfill, firstSale] = await Promise.all([isSquareConnected(), db.guestDay.count({ where: { payments: { gt: 0 } } }), readSettingJSON<StoredGuests>(SUMMARY_KEY), guestBackfill(), firstSaleDate()]);
  // Counted nightly; count now if there are visits but no kept copy, or it's from another day.
  const stored = daysOnFile > 0 && (kept?.computedOn !== businessToday() || kept.rules !== GUEST_RULES) ? await computeGuests() : kept;
  const summary = daysOnFile > 0 ? (stored?.summary ?? null) : null;
  return { connected, daysOnFile, summary, story: summary ? guestStory(summary) : null, weekly: summary ? (stored?.weekly ?? []) : [], backfill, firstSale };
}

/** Days on file, for a progress line: the earliest day loaded. */
export async function earliestGuestDay(): Promise<ISODate | null> {
  const r = await db.guestDay.findFirst({ where: { payments: { gt: 0 } }, orderBy: { date: "asc" }, select: { date: true } });
  return r ? toISODate(r.date) : null;
}
