import "server-only";
import { addDays, businessDate, ISODate } from "@/domain/dates";
import { DateChunk, dateRuns, emptyPending, isStale, mergePending, monthsBefore, PendingWork, planChunks } from "@/domain/squareSync";
import { after } from "next/server";
import { db, num } from "../db";
import { env } from "../env";
import { friendlySquareError } from "../integrations/square-http";
import { fetchMerchant } from "../integrations/square-auth";
import { syncSquareTeam, syncSquareTimecards } from "./labor";
import { businessToday, syncCatalog, syncSales } from "./sales";
import { backfillGuests, computeGuestsQuietly, guestBackfill } from "./guests";
import { syncPaymentsQuietly } from "./square-money";
import { isSquareConnected, logSquareError, readSettingJSON, recordSquareSync, requireSquareClient, squareStreams, SquareStream, withSquareLock, writeSettingJSON } from "./square";

/**
 * Orchestrates Square pulls: the nightly job, near-live refresh on page
 * views, webhook-driven resyncs and the resumable first import.
 */

async function logged<T>(stream: SquareStream, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    await logSquareError(stream, friendlySquareError(e)).catch(() => undefined);
    throw e;
  }
}

// ---- Nightly ------------------------------------------------------------------------

/** Nightly job: catalog, the last 3 days of sales (late tabs, refunds) and labor for yesterday + today. */
export async function dailySync() {
  if (!(await isSquareConnected())) return { skipped: "Square isn't connected" };
  const today = businessToday();
  const catalog = await logged("catalog", syncCatalog);
  const sales = await logged("sales", () => syncSales(addDays(today, -3), addDays(today, 1)));
  // Card tips by person and card fees over the same days (tips added to a tab after close, and
  // fees Square reports a little after the payment, land here too).
  await syncPaymentsQuietly(addDays(today, -3), addDays(today, 1));
  const labor = await logged("labor", () => syncSquareTimecards(addDays(today, -1), addDays(today, 1)));
  await processPending().catch(() => undefined);
  // Carry on loading the history of card visits if it was started and isn't done, then count everything again.
  const guests = await guestBackfill();
  if (guests && !guests.finishedAt) await backfillGuests(60_000).catch(() => undefined);
  await computeGuestsQuietly();
  // Carry on a first import nobody finished (it normally runs from the Square page).
  const bf = await getBackfill();
  const backfill = bf && bf.phase !== "done" ? await backfillStep(150_000).catch((e) => ({ error: (e as Error).message })) : null;
  return { catalog, ...sales, timecards: labor.timecards, backfill: backfill && "state" in backfill ? backfill.state?.phase : backfill };
}

// ---- Near-live ------------------------------------------------------------------------

/** Sync today + yesterday (sales and labor) now, if nothing else is syncing. */
export async function refreshToday(force = false, maxAgeMinutes = 15) {
  if (!(await isSquareConnected())) return null;
  return withSquareLock(async () => {
    const streams = await squareStreams();
    if (!force && !isStale(streams.live?.at, new Date(), maxAgeMinutes)) return null;
    // Mark the attempt first so a failing Square isn't retried on every page view.
    await recordSquareSync("live", 0, "running");
    const today = businessToday();
    let sales: Awaited<ReturnType<typeof syncSales>>;
    let labor: Awaited<ReturnType<typeof syncSquareTimecards>>;
    try {
      sales = await logged("sales", () => syncSales(addDays(today, -1), addDays(today, 1)));
      labor = await logged("labor", () => syncSquareTimecards(addDays(today, -1), addDays(today, 1)));
      await syncPaymentsQuietly(addDays(today, -1), addDays(today, 1));
    } catch (e) {
      await recordSquareSync("live", 0, "failed — see Recent problems");
      throw e;
    }
    await recordSquareSync("live", sales.orders + labor.timecards, "today + yesterday");
    await drainPending();
    return { orders: sales.orders, timecards: labor.timecards };
  });
}

/**
 * Keep today's numbers fresh without slowing the page: when the last live
 * refresh is older than `maxAgeMinutes`, sync after the response is sent.
 */
export async function refreshIfStale(maxAgeMinutes = 15) {
  try {
    const streams = await squareStreams();
    if (!isStale(streams.live?.at, new Date(), maxAgeMinutes)) return;
  } catch {
    return;
  }
  after(() => refreshToday(false, maxAgeMinutes).then(() => undefined, () => undefined));
}

// ---- Webhook queue --------------------------------------------------------------------

const PENDING_KEY = "square.pending";

export async function queueSquareWork(add: Partial<PendingWork>) {
  const cur = (await readSettingJSON<PendingWork>(PENDING_KEY)) ?? emptyPending();
  await writeSettingJSON(PENDING_KEY, mergePending(cur, add));
}

export const businessDateOf = (iso: string) => businessDate(iso, env.BUSINESS_TIMEZONE);

/** Work through queued webhook resyncs until the queue is empty or the time budget is spent. Caller holds the lock. */
async function drainPending(budgetMs = 40_000) {
  const started = Date.now();
  let rounds = 0;
  while (Date.now() - started < budgetMs && rounds++ < 10) {
    const p = (await readSettingJSON<PendingWork>(PENDING_KEY)) ?? emptyPending();
    if (!p.sales.length && !p.labor.length && !p.catalog) return;
    await db.setting.deleteMany({ where: { key: PENDING_KEY } });
    try {
      if (p.catalog) await logged("catalog", syncCatalog);
      for (const r of dateRuns(p.sales)) {
        await logged("sales", () => syncSales(r.from, r.toExclusive));
        await syncPaymentsQuietly(r.from, r.toExclusive);
      }
      for (const r of dateRuns(p.labor)) await logged("labor", () => syncSquareTimecards(r.from, r.toExclusive));
    } catch (e) {
      // Put the work back so the next refresh or the nightly sync retries it.
      await queueSquareWork(p);
      throw e;
    }
  }
}

/**
 * Handle queued webhook work. A short wait first lets a burst of events for
 * the same order (created, updated, paid) collapse into one resync; if
 * another run holds the lock, it will pick the new work up itself.
 */
export async function processPending(debounceMs = 0) {
  if (debounceMs) await new Promise((r) => setTimeout(r, debounceMs));
  if (!(await isSquareConnected())) return;
  await withSquareLock(() => drainPending());
}

// ---- First import ---------------------------------------------------------------------

export interface BackfillState {
  /** 0 = all history, back to when the Square account was opened. */
  months: number;
  from: ISODate;
  toExclusive: ISODate;
  phase: "catalog" | "chunks" | "done";
  nextIndex: number;
  totalChunks: number;
  totals: { catalog: number; orders: number; orderLines: number; timecards: number; members: number };
  current: DateChunk | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
}

const BACKFILL_KEY = "square.backfill";

export const getBackfill = () => readSettingJSON<BackfillState>(BACKFILL_KEY);

/** `"all"` goes back to when the Square account was opened; after a finished import it only fetches what's older. */
export async function startBackfill(months: number | "all"): Promise<BackfillState> {
  const today = businessToday();
  let from: ISODate;
  let toExclusive = addDays(today, 1);
  if (months === "all") {
    const client = await requireSquareClient();
    const merchant = await fetchMerchant(client).catch(() => null);
    from = merchant?.createdAt ? businessDate(merchant.createdAt, env.BUSINESS_TIMEZONE) : monthsBefore(today, 120);
    const prev = await getBackfill();
    // Already imported a recent stretch: fetch only what's before it (the nightly sync keeps recent days fresh).
    if (prev?.phase === "done" && prev.from > from) toExclusive = prev.from;
  } else {
    from = monthsBefore(today, months);
  }
  if (from >= toExclusive) from = addDays(toExclusive, -7);
  const now = new Date().toISOString();
  const state: BackfillState = {
    months: months === "all" ? 0 : months,
    from,
    toExclusive,
    phase: "catalog",
    nextIndex: 0,
    totalChunks: planChunks(from, toExclusive).length,
    totals: { catalog: 0, orders: 0, orderLines: 0, timecards: 0, members: 0 },
    current: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    lastError: null,
  };
  await writeSettingJSON(BACKFILL_KEY, state);
  return state;
}

export async function clearBackfill() {
  await db.setting.deleteMany({ where: { key: BACKFILL_KEY } });
}

/**
 * One step of the first import: the catalog and team first, then 7-day
 * chunks (sales, then timecards), newest first, until `budgetMs` is spent.
 * Progress is saved after every chunk so the import can resume anywhere.
 */
export async function backfillStep(budgetMs = 25_000): Promise<{ state: BackfillState } | { busy: true } | { error: string; state: BackfillState | null }> {
  const started = Date.now();
  const res = await withSquareLock(async () => {
    let state = await getBackfill();
    if (!state) return { error: "Start the import first.", state: null };
    if (state.phase === "done") return { state };
    const client = await requireSquareClient();
    const save = async (patch: Partial<BackfillState>) => {
      state = { ...state!, ...patch, updatedAt: new Date().toISOString() };
      await writeSettingJSON(BACKFILL_KEY, state);
    };
    try {
      if (state.phase === "catalog") {
        const catalog = await logged("catalog", syncCatalog);
        const team = await logged("labor", () => syncSquareTeam(client));
        await save({ phase: "chunks", totals: { ...state.totals, catalog, members: team.members }, lastError: null });
      }
      const chunks = planChunks(state.from, state.toExclusive);
      while (state.nextIndex < chunks.length && Date.now() - started < budgetMs) {
        const chunk = chunks[state.nextIndex];
        await save({ current: chunk });
        const sales = await logged("sales", () => syncSales(chunk.from, chunk.toExclusive));
        // Card tips, card fees and fee refunds for the same week (fills history on "Import again").
        await syncPaymentsQuietly(chunk.from, chunk.toExclusive, client);
        const labor = await logged("labor", () => syncSquareTimecards(chunk.from, chunk.toExclusive, client));
        await save({
          nextIndex: state.nextIndex + 1,
          totals: { ...state.totals, orders: state.totals.orders + sales.orders, orderLines: state.totals.orderLines + sales.orderLines, timecards: state.totals.timecards + labor.timecards },
          lastError: null,
        });
      }
      if (state.nextIndex >= chunks.length) await save({ phase: "done", current: null, finishedAt: new Date().toISOString() });
      return { state };
    } catch (e) {
      const msg = friendlySquareError(e);
      await save({ lastError: msg });
      return { error: msg, state };
    }
    // The lock must outlive the whole step (budget plus the chunk in flight), or a page view could start a second sync alongside it.
  }, budgetMs + 120_000);
  return res ?? { busy: true };
}

// ---- Coverage ----------------------------------------------------------------------------

/** What history we hold: first/last sale date, days with sales, timecards. */
export async function dataCoverage() {
  const [range, days, cards, squareCards, orders] = await Promise.all([
    db.dailySale.aggregate({ _min: { date: true }, _max: { date: true } }),
    db.dailySale.groupBy({ by: ["date"] }).then((r) => r.length),
    db.timecard.count(),
    db.timecard.count({ where: { source: "SQUARE" } }),
    db.hourlySale.aggregate({ _sum: { orders: true, netSales: true } }),
  ]);
  return {
    firstSale: range._min.date?.toISOString().slice(0, 10) ?? null,
    lastSale: range._max.date?.toISOString().slice(0, 10) ?? null,
    salesDays: days,
    orders: orders._sum.orders ?? 0,
    netSales: num(orders._sum.netSales) ?? 0,
    timecards: cards,
    squareTimecards: squareCards,
  };
}

export interface SquareDataRow {
  id: "menu" | "modifiers" | "sales" | "orders" | "fees" | "tips" | "discounts" | "team" | "timecards";
  label: string;
  /** How much there is, in a few words ("142 items, 138 with a price"). Null = nothing yet. */
  value: string | null;
  /** What the app uses it for. */
  usedFor: string;
}

const monthYear = (d: ISODate) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const n0 = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n0(n)} ${n === 1 ? one : many}`;

/** Everything that has come in from Square, one line per kind of data, in plain English. */
export async function squareDataInventory(): Promise<SquareDataRow[]> {
  const [mappings, meta, cov, fees, tips, discounts, team, positions] = await Promise.all([
    db.squareMapping.groupBy({ by: ["squareType"], _count: { _all: true } }),
    readSettingJSON<Record<string, { price: number | null; deleted?: boolean }>>("square.catalog").catch(() => null),
    dataCoverage(),
    db.squareDayMoney.aggregate({ where: { cardFees: { not: null } }, _count: { _all: true }, _sum: { cardFees: true } }),
    db.squareTip.groupBy({ by: ["kind"], _sum: { amount: true } }),
    db.squareDiscount.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    db.employee.count({ where: { squareTeamMemberId: { not: null } } }),
    db.position.count(),
  ]);
  const count = (t: string) => mappings.find((m) => m.squareType === t)?._count._all ?? 0;
  const items = count("ITEM_VARIATION");
  const mods = count("MODIFIER");
  const priced = meta ? Object.values(meta).filter((m) => !m.deleted && m.price != null).length : 0;
  const card = num(tips.find((t) => t.kind === "CARD")?._sum.amount) ?? 0;
  const cash = num(tips.find((t) => t.kind === "CASH")?._sum.amount) ?? 0;
  const tipKinds = [card ? "card" : "", cash ? "declared cash" : ""].filter(Boolean).join(" and ");
  return [
    { id: "menu", label: "Menu items and prices", value: items ? `${plural(items, "item")}${priced ? `, ${n0(priced)} with a price` : ""}` : null, usedFor: "Linking to recipes, food cost and the website menu" },
    { id: "modifiers", label: "Modifiers and add-ons", value: mods ? plural(mods, "modifier") : null, usedFor: "Add-ons (extra cheese, sauces) count toward food cost and prep" },
    { id: "sales", label: "Sales by item, by day", value: cov.salesDays ? `${plural(cov.salesDays, "day")}${cov.firstSale ? ` since ${monthYear(cov.firstSale)}` : ""}` : null, usedFor: "Forecast, prep list, ordering and usage" },
    { id: "orders", label: "Orders and sales by hour", value: cov.orders ? `${plural(cov.orders, "order")}, ${usd(cov.netSales)} net` : null, usedFor: "Opening hours, staffing by hour and the P&L" },
    { id: "fees", label: "Card fees", value: fees._count._all ? `${plural(fees._count._all, "day")}, ${usd(num(fees._sum.cardFees) ?? 0)} in fees` : null, usedFor: "The P&L and month-end" },
    { id: "tips", label: "Tips", value: card + cash ? `${usd(card + cash)} (${tipKinds})` : null, usedFor: "The tip pool and payroll" },
    { id: "discounts", label: "Comps and discounts", value: discounts._count._all ? `${plural(discounts._count._all, "line")}, ${usd(num(discounts._sum.amount) ?? 0)}` : null, usedFor: "Comps by person and reason, and the P&L" },
    { id: "team", label: "Team, jobs and pay rates", value: team ? `${plural(team, "person", "people")}, ${plural(positions, "position")}` : null, usedFor: "Schedule, labor cost and who shares tips" },
    { id: "timecards", label: "Timecards and breaks", value: cov.squareTimecards ? plural(cov.squareTimecards, "timecard") : null, usedFor: "Labor cost, payroll, overtime and break rules" },
  ];
}
