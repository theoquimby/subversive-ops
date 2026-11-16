import "server-only";
import { Prisma } from "@prisma/client";
import type { AttentionItem } from "@/domain/attention";
import type { ISODate } from "@/domain/dates";
import {
  availability,
  isRealDate,
  lineCollides,
  lineProblem,
  lineProgress,
  matchKeg,
  MAX_LINES,
  MAX_QUANTITY,
  mergeLines,
  orderAttentionItems,
  orderMatches,
  orderProgress,
  orderShortfalls,
  progressLabel,
  stockWarning,
  TRANSITS,
  validateOrder,
  validQuantity,
  type AvailabilityRow,
  type KegOrderStatus,
  type OrderDraft,
  type OrderLine,
  type OrderProgress,
  type ScannedKeg,
} from "@/domain/kegOrders";
import { kegSizeInfo, KEG_SIZE_LIST, type KegStatus } from "@/domain/kegs";
import { db } from "../db";
import { doKegAction, findKegByScan, undoKegEvents } from "./kegs";
import { businessToday } from "./sales";

/**
 * Wholesale keg orders: the lists and pages, making and editing an order, and
 * filling one by scanning kegs out to its account. The rules (progress,
 * availability, which line a keg goes on) are in domain/kegOrders; sending a
 * keg out and undoing it are the keg service's own OUT action and undo.
 */

type User = { userId: string; name: string; role: "MANAGER" | "STAFF" };

const iso = (d: Date | null): ISODate | null => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: ISODate | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
const known = (e: unknown, code: string) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;
const closedText = (status: string) => (status === "FULFILLED" ? "This order is already fulfilled." : status === "CANCELLED" ? "This order was cancelled." : "This order can't be changed.");
const GONE = "That order isn't in the app any more.";
const LINE_GONE = "That line was removed from the order.";

const LINES = {
  orderBy: [{ sort: "asc" }, { id: "asc" }],
  include: { beer: { select: { name: true, color: true } }, _count: { select: { kegs: true } } },
} satisfies Prisma.KegOrder$linesArgs;

const WITH_LINES = { account: { select: { id: true, name: true } }, lines: LINES } satisfies Prisma.KegOrderInclude;

type DbLine = Prisma.KegOrderLineGetPayload<typeof LINES>;
type DbOrder = Prisma.KegOrderGetPayload<{ include: typeof WITH_LINES }>;

export interface OrderLineView extends OrderLine {
  beer: string;
  color: string;
}

const lineView = (l: DbLine): OrderLineView => ({ id: l.id, beerId: l.beerId, sizeId: l.sizeId, quantity: l.quantity, unscanned: l.unscanned, scanned: l._count.kegs, sort: l.sort, beer: l.beer.name, color: l.beer.color });

// ---- Availability --------------------------------------------------------------------------------

export type AvailabilityView = AvailabilityRow & { color: string };

/** Full kegs per beer and size against what open orders still need. */
export async function kegAvailability(): Promise<AvailabilityView[]> {
  const [kegs, orders, beers] = await Promise.all([
    db.keg.findMany({ where: { active: true, status: { in: ["FILLED", "COLD"] }, beerId: { not: null } }, select: { beerId: true, sizeId: true, status: true, active: true } }),
    db.kegOrder.findMany({ where: { status: "OPEN" }, select: { status: true, lines: { select: { beerId: true, sizeId: true, quantity: true, unscanned: true, _count: { select: { kegs: true } } } } } }),
    db.beer.findMany({ select: { id: true, name: true, color: true } }),
  ]);
  const beer = new Map(beers.map((b) => [b.id, b]));
  return availability(
    kegs.map((k) => ({ ...k, status: k.status as KegStatus })),
    orders.map((o) => ({ status: o.status, lines: o.lines.map((l) => ({ beerId: l.beerId, sizeId: l.sizeId, quantity: l.quantity, unscanned: l.unscanned, scanned: l._count.kegs })) })),
    (id) => beer.get(id)?.name,
  ).map((r) => ({ ...r, color: beer.get(r.beerId)?.color ?? "grey" }));
}

// ---- Lists ---------------------------------------------------------------------------------------

export interface OrderRow {
  id: string;
  number: number;
  accountId: string;
  account: string;
  transit: string;
  dueOn: ISODate | null;
  status: KegOrderStatus;
  createdAt: Date;
  /** When it was fulfilled or cancelled. */
  closedAt: Date | null;
  progress: OrderProgress;
  lines: { beer: string; color: string; sizeId: string; quantity: number }[];
  /** Kegs this order still needs that aren't full yet (open orders only). */
  short: number;
}

function orderRow(o: DbOrder, stock: AvailabilityRow[] | null): OrderRow {
  const lines = o.lines.map(lineView);
  return {
    id: o.id,
    number: o.number,
    accountId: o.accountId,
    account: o.account.name,
    transit: o.transit,
    dueOn: iso(o.dueOn),
    status: o.status,
    createdAt: o.createdAt,
    closedAt: o.fulfilledAt ?? o.cancelledAt,
    progress: orderProgress(lines),
    lines: lines.map((l) => ({ beer: l.beer, color: l.color, sizeId: l.sizeId, quantity: l.quantity })),
    short: stock && o.status === "OPEN" ? orderShortfalls(lines, stock).reduce((s, x) => s + x.short, 0) : 0,
  };
}

/** Soonest date first, orders with no date last, then the oldest order. */
const byDue = (a: OrderRow, b: OrderRow) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.number - b.number;
const byClosed = (a: OrderRow, b: OrderRow) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0) || b.number - a.number;

export interface OrdersList {
  today: ISODate;
  /** Open orders, the soonest first. */
  open: OrderRow[];
  /** Fulfilled and cancelled orders, the latest first (capped). */
  closed: OrderRow[];
  /** Open orders before the search was applied. */
  openTotal: number;
  availability: AvailabilityView[];
}

const RECENT = 20;

/** The orders page. `q` narrows both lists by account, order number or beer. */
export async function ordersList(q?: string): Promise<OrdersList> {
  const search = (q ?? "").trim();
  const [open, closed, stock] = await Promise.all([
    db.kegOrder.findMany({ where: { status: "OPEN" }, include: WITH_LINES }),
    // A search looks further back than the page shows by default.
    db.kegOrder.findMany({ where: { status: { not: "OPEN" } }, include: WITH_LINES, orderBy: { number: "desc" }, take: search ? 500 : 80 }),
    kegAvailability(),
  ]);
  const hit = (r: OrderRow) => orderMatches(search, { number: r.number, account: r.account, beers: r.lines.map((l) => l.beer) });
  return {
    today: businessToday(),
    open: open.map((o) => orderRow(o, stock)).filter(hit).sort(byDue),
    closed: closed.map((o) => orderRow(o, null)).filter(hit).sort(byClosed).slice(0, search ? 40 : RECENT),
    openTotal: open.length,
    availability: stock,
  };
}

/** An account's open orders and its last few finished ones. */
export async function accountOrders(accountId: string): Promise<{ today: ISODate; open: OrderRow[]; closed: OrderRow[] }> {
  const [open, closed] = await Promise.all([
    db.kegOrder.findMany({ where: { accountId, status: "OPEN" }, include: WITH_LINES }),
    db.kegOrder.findMany({ where: { accountId, status: "FULFILLED" }, include: WITH_LINES, orderBy: { fulfilledAt: "desc" }, take: 5 }),
  ]);
  return { today: businessToday(), open: open.map((o) => orderRow(o, null)).sort(byDue), closed: closed.map((o) => orderRow(o, null)) };
}

/** Open orders for the Kegs page, where staff start scanning one. */
export async function openOrders(): Promise<{ today: ISODate; rows: OrderRow[] }> {
  const open = await db.kegOrder.findMany({ where: { status: "OPEN" }, include: WITH_LINES, take: 200 });
  return { today: businessToday(), rows: open.map((o) => orderRow(o, null)).sort(byDue) };
}

/** Orders due today or overdue, as one "Needs you" item. */
export async function kegOrdersNeedYou(today: ISODate = businessToday()): Promise<AttentionItem[]> {
  const due = await db.kegOrder.findMany({ where: { status: "OPEN", dueOn: { lte: day(today)! } }, select: { status: true, dueOn: true, transit: true, account: { select: { name: true } } } });
  return orderAttentionItems(today, due.map((o) => ({ status: o.status, dueOn: iso(o.dueOn), transit: o.transit, account: o.account.name })));
}

// ---- One order -----------------------------------------------------------------------------------

export interface OrderDetail {
  id: string;
  number: number;
  status: KegOrderStatus;
  transit: string;
  dueOn: ISODate | null;
  today: ISODate;
  account: { id: string; name: string };
  createdAt: Date;
  createdByName: string | null;
  fulfilledAt: Date | null;
  fulfilledByName: string | null;
  cancelledAt: Date | null;
  cancelledByName: string | null;
  /** Each line with the full kegs there are for it and how many it is short. */
  lines: (OrderLineView & { full: number; short: number })[];
  progress: OrderProgress;
  /** One line when the order needs more kegs than are full; null otherwise. */
  warning: string | null;
  kegs: { id: string; kegId: string; code: string; beer: string; color: string; sizeId: string; at: Date; userName: string | null }[];
  notes: { id: string; at: Date; userName: string | null; text: string }[];
}

/** Everything on one order's page; null when there is no such order. */
export async function orderPage(id: string): Promise<OrderDetail | null> {
  const o = await db.kegOrder.findUnique({
    where: { id },
    include: { ...WITH_LINES, kegs: { orderBy: { at: "desc" }, include: { keg: { select: { code: true } } } }, notes: { orderBy: { at: "desc" } } },
  });
  if (!o) return null;
  const lines = o.lines.map(lineView);
  const open = o.status === "OPEN";
  const short = open ? orderShortfalls(lines, await kegAvailability()) : [];
  const withStock = lines.map((l) => ({ ...l, full: short.find((s) => s.lineId === l.id)?.full ?? 0, short: short.find((s) => s.lineId === l.id)?.short ?? 0 }));
  const lineOf = new Map(lines.map((l) => [l.id, l]));
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    transit: o.transit,
    dueOn: iso(o.dueOn),
    today: businessToday(),
    account: o.account,
    createdAt: o.createdAt,
    createdByName: o.createdByName,
    fulfilledAt: o.fulfilledAt,
    fulfilledByName: o.fulfilledByName,
    cancelledAt: o.cancelledAt,
    cancelledByName: o.cancelledByName,
    lines: withStock,
    progress: orderProgress(lines),
    warning: stockWarning(withStock),
    // The beer and size are the line's: the keg itself may have been refilled with something else since.
    kegs: o.kegs.map((k) => ({ id: k.id, kegId: k.kegId, code: k.keg.code, beer: lineOf.get(k.lineId)?.beer ?? "", color: lineOf.get(k.lineId)?.color ?? "grey", sizeId: lineOf.get(k.lineId)?.sizeId ?? "half", at: k.at, userName: k.userName })),
    notes: o.notes.map((n) => ({ id: n.id, at: n.at, userName: n.userName, text: n.text })),
  };
}

/** Accounts and beers for the order form (plus any already on the order, even if no longer used). */
export async function orderFormContext(keep: { accountId?: string | null; beerIds?: string[] } = {}) {
  const [accounts, beers] = await Promise.all([
    db.kegAccount.findMany({ where: { OR: [{ active: true }, ...(keep.accountId ? [{ id: keep.accountId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Active beers, core first; a retired beer only when it's already on the order.
    db.beer.findMany({ where: { OR: [{ active: true }, ...(keep.beerIds?.length ? [{ id: { in: keep.beerIds } }] : [])] }, orderBy: [{ core: "desc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
  ]);
  return { accounts, beers };
}
export type OrderFormContext = Awaited<ReturnType<typeof orderFormContext>>;

// ---- Making and editing --------------------------------------------------------------------------

export async function createOrder(user: User, draft: OrderDraft): Promise<{ ok: true; id: string; number: number } | { error: string }> {
  const v = validateOrder({ ...draft, lines: mergeLines(draft.lines ?? []) });
  if ("error" in v) return v;
  const d = v.order;
  const [account, beers] = await Promise.all([
    db.kegAccount.findUnique({ where: { id: d.accountId }, select: { id: true } }),
    db.beer.findMany({ where: { id: { in: d.lines.map((l) => l.beerId) } }, select: { id: true } }),
  ]);
  if (!account) return { error: "That account was removed. Pick another." };
  if (beers.length !== new Set(d.lines.map((l) => l.beerId)).size) return { error: "One of those beers was removed. Pick it again." };
  const o = await db.kegOrder.create({
    data: {
      accountId: d.accountId,
      transit: d.transit,
      dueOn: day(d.dueOn),
      createdById: user.userId,
      createdByName: user.name,
      lines: { create: d.lines.map((l, i) => ({ beerId: l.beerId, sizeId: l.sizeId, quantity: l.quantity, sort: i })) },
    },
    select: { id: true, number: true },
  });
  return { ok: true, ...o };
}

/** Why an order that didn't update couldn't be: it's gone, or no longer open. */
async function whyNot(orderId: string): Promise<{ error: string }> {
  const o = await db.kegOrder.findUnique({ where: { id: orderId }, select: { status: true } });
  return { error: o ? closedText(o.status) : GONE };
}

/** Delivery or pickup, the date, or the account of an open order. */
export async function setOrderField(orderId: string, field: "transit" | "dueOn" | "accountId", raw: string): Promise<{ error?: string }> {
  const value = String(raw ?? "").trim();
  let data: Prisma.KegOrderUncheckedUpdateManyInput;
  if (field === "transit") {
    if (!TRANSITS.some((t) => t.value === value)) return { error: "Pick delivery or pickup." };
    data = { transit: value };
  } else if (field === "dueOn") {
    if (value && !isRealDate(value)) return { error: "That date doesn't look right." };
    data = { dueOn: day(value || null) };
  } else {
    if (!value) return { error: "Pick the account." };
    const [account, sent] = await Promise.all([
      db.kegAccount.findUnique({ where: { id: value }, select: { id: true } }),
      db.kegOrder.findUnique({ where: { id: orderId }, select: { accountId: true, _count: { select: { kegs: true } }, lines: { select: { unscanned: true } } } }),
    ]);
    if (!account) return { error: "That account was removed. Pick another." };
    if (!sent) return { error: GONE };
    if (sent.accountId !== value && (sent._count.kegs > 0 || sent.lines.some((l) => l.unscanned > 0))) return { error: "Kegs on this order have already gone to this account. Cancel the order and make a new one instead." };
    data = { accountId: value };
  }
  const r = await db.kegOrder.updateMany({ where: { id: orderId, status: "OPEN" }, data });
  return r.count ? {} : whyNot(orderId);
}

async function openOrderLines(orderId: string): Promise<{ lines: OrderLineView[] } | { error: string }> {
  const o = await db.kegOrder.findUnique({ where: { id: orderId }, select: { status: true, lines: LINES } });
  if (!o) return { error: GONE };
  if (o.status !== "OPEN") return { error: closedText(o.status) };
  return { lines: o.lines.map(lineView) };
}

/** Add a line to an open order. The same beer and size as an existing line is added to that line. */
export async function addOrderLine(orderId: string, line: { beerId: string; sizeId: string; quantity: number }): Promise<{ error?: string }> {
  const problem = lineProblem(line);
  if (problem) return { error: `${problem[0].toUpperCase()}${problem.slice(1)}` };
  const o = await openOrderLines(orderId);
  if ("error" in o) return o;
  const same = o.lines.find((l) => l.beerId === line.beerId && l.sizeId === line.sizeId);
  if (same) {
    if (same.quantity + line.quantity > MAX_QUANTITY) return { error: `A line takes up to ${MAX_QUANTITY} kegs.` };
    const r = await db.kegOrderLine.updateMany({ where: { id: same.id, order: { status: "OPEN" } }, data: { quantity: { increment: line.quantity } } });
    return r.count ? {} : whyNot(orderId);
  }
  if (o.lines.length >= MAX_LINES) return { error: `An order takes up to ${MAX_LINES} lines.` };
  if (!(await db.beer.findUnique({ where: { id: line.beerId }, select: { id: true } }))) return { error: "That beer was removed. Pick another." };
  await db.kegOrderLine.create({ data: { orderId, beerId: line.beerId, sizeId: line.sizeId, quantity: line.quantity, sort: Math.max(-1, ...o.lines.map((l) => l.sort)) + 1 } });
  return {};
}

async function openLine(lineId: string): Promise<{ orderId: string; line: OrderLineView; lines: OrderLineView[] } | { error: string }> {
  const l = await db.kegOrderLine.findUnique({ where: { id: lineId }, select: { orderId: true } });
  if (!l) return { error: LINE_GONE };
  const o = await openOrderLines(l.orderId);
  if ("error" in o) return o;
  const line = o.lines.find((x) => x.id === lineId);
  return line ? { orderId: l.orderId, line, lines: o.lines } : { error: LINE_GONE };
}

/** Change a line of an open order. Once kegs have gone out on it, only the quantity can change. */
export async function setOrderLineField(lineId: string, field: "beerId" | "sizeId" | "quantity", raw: string): Promise<{ error?: string }> {
  const value = String(raw ?? "").trim();
  const o = await openLine(lineId);
  if ("error" in o) return o;
  let data: Prisma.KegOrderLineUncheckedUpdateManyInput;
  if (field === "quantity") {
    const n = Number(value);
    if (!value || !validQuantity(n)) return { error: `A whole number, 1 to ${MAX_QUANTITY}` };
    data = { quantity: n };
  } else {
    if (lineProgress(o.line).sent > 0) return { error: `Kegs have already gone out on this line, so its ${field === "beerId" ? "beer" : "size"} can't change. Change how many, or add a line.` };
    if (field === "sizeId" && !KEG_SIZE_LIST.some((s) => s.id === value)) return { error: "Pick a keg size." };
    if (field === "beerId" && !(value && (await db.beer.findUnique({ where: { id: value }, select: { id: true } })))) return { error: "Pick the beer." };
    const next = { id: lineId, beerId: o.line.beerId, sizeId: o.line.sizeId, [field]: value };
    if (lineCollides(o.lines, next)) return { error: "This order already has a line for that beer and size. Change how many on that line instead." };
    data = { [field]: value };
  }
  const r = await db.kegOrderLine.updateMany({ where: { id: lineId, order: { status: "OPEN" } }, data });
  return r.count ? {} : whyNot(o.orderId);
}

/** Take a line off an open order. Not once kegs have gone out on it, and not the last line. */
export async function removeOrderLine(lineId: string): Promise<{ error?: string }> {
  const o = await openLine(lineId);
  if ("error" in o) return o;
  if (lineProgress(o.line).sent > 0) return { error: "Kegs have already gone out on this line. Lower how many instead." };
  if (o.lines.length <= 1) return { error: "An order needs at least one line. Cancel the order instead." };
  // Only if still open and still untouched: a keg scanned in the meantime keeps its line.
  const r = await db.kegOrderLine.deleteMany({ where: { id: lineId, unscanned: 0, kegs: { none: {} }, order: { status: "OPEN" } } });
  return r.count ? {} : { error: "That line just changed. Check it and try again." };
}

/**
 * Mark kegs on a line as delivered without scanning (stickers that can't be
 * read). `count` is the line's new total of such kegs. No keg is changed; a
 * note on the order records who did it.
 */
export async function setLineUnscanned(user: User, lineId: string, count: number): Promise<{ error?: string }> {
  if (!Number.isInteger(count) || count < 0 || count > MAX_QUANTITY) return { error: "A whole number, 0 or more" };
  const o = await openLine(lineId);
  if ("error" in o) return o;
  if (count === o.line.unscanned) return {};
  const room = Math.max(0, o.line.quantity - o.line.scanned);
  if (count > room) return { error: room === 0 ? "Every keg on this line was scanned." : `At most ${room}: the line wants ${o.line.quantity} and ${o.line.scanned} ${o.line.scanned === 1 ? "was" : "were"} scanned.` };
  const r = await db.kegOrderLine.updateMany({ where: { id: lineId, order: { status: "OPEN" } }, data: { unscanned: count } });
  if (!r.count) return whyNot(o.orderId);
  const what = `${o.line.beer} ${kegSizeInfo(o.line.sizeId).short}`;
  await db.kegOrderNote.create({ data: { orderId: o.orderId, userId: user.userId, userName: user.name, text: count === 0 ? `No ${what} marked as delivered without scanning any more (was ${o.line.unscanned}).` : `Marked ${count} × ${what} as delivered without scanning.` } });
  return {};
}

/** A note on an order, open or not. */
export async function addOrderNote(user: User, orderId: string, text: string): Promise<{ error?: string }> {
  const t = String(text ?? "").trim().slice(0, 1000);
  if (!t) return { error: "Write the note first." };
  try {
    await db.kegOrderNote.create({ data: { orderId, userId: user.userId, userName: user.name, text: t } });
  } catch (e) {
    if (known(e, "P2003")) return { error: GONE };
    throw e;
  }
  return {};
}

// ---- Finishing -----------------------------------------------------------------------------------

/**
 * Mark an order fulfilled. Anyone can once every line is complete; `short`
 * (managers only) fulfils it with what has gone out so far.
 */
export async function fulfilOrder(user: User, orderId: string, opts: { short?: boolean } = {}): Promise<{ ok: true } | { error: string }> {
  const o = await openOrderLines(orderId);
  if ("error" in o) return o;
  const p = orderProgress(o.lines);
  if (!p.complete) {
    if (!o.lines.length) return { error: "This order has no lines. Cancel it instead." };
    if (!opts.short) return { error: `This order still needs ${p.remaining} keg${p.remaining === 1 ? "" : "s"}.` };
    if (user.role !== "MANAGER") return { error: "Only a manager can fulfil an order that isn't complete." };
    if (p.sent === 0) return { error: "Nothing has gone out on this order. Cancel it instead." };
  }
  const r = await db.kegOrder.updateMany({ where: { id: orderId, status: "OPEN" }, data: { status: "FULFILLED", fulfilledAt: new Date(), fulfilledByName: user.name } });
  if (!r.count) return whyNot(orderId);
  if (!p.complete) await db.kegOrderNote.create({ data: { orderId, userId: user.userId, userName: user.name, text: `Fulfilled short, with ${progressLabel(p)}.` } });
  return { ok: true };
}

/** Cancel an open order. Kegs already sent out on it stay out. */
export async function cancelOrder(user: User, orderId: string): Promise<{ ok: true } | { error: string }> {
  const r = await db.kegOrder.updateMany({ where: { id: orderId, status: "OPEN" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByName: user.name } });
  return r.count ? { ok: true } : whyNot(orderId);
}

// ---- Filling an order by scanning ------------------------------------------------------------------

export interface ScanLine {
  id: string;
  beer: string;
  color: string;
  sizeId: string;
  quantity: number;
  sent: number;
  remaining: number;
}

/** What the scanning screen shows about the order, fresh after every scan. */
export interface OrderScanState {
  status: KegOrderStatus;
  lines: ScanLine[];
  progress: OrderProgress;
}

export interface OrderScanPage extends OrderScanState {
  id: string;
  number: number;
  account: string;
  transit: string;
  dueOn: ISODate | null;
  today: ISODate;
  notes: { id: string; at: Date; userName: string | null; text: string }[];
}

const scanState = (status: KegOrderStatus, lines: OrderLineView[]): OrderScanState => ({
  status,
  lines: lines.map((l) => {
    const p = lineProgress(l);
    return { id: l.id, beer: l.beer, color: l.color, sizeId: l.sizeId, quantity: l.quantity, sent: p.sent, remaining: p.remaining };
  }),
  progress: orderProgress(lines),
});

async function loadScanState(orderId: string): Promise<OrderScanState | null> {
  const o = await db.kegOrder.findUnique({ where: { id: orderId }, select: { status: true, lines: LINES } });
  return o ? scanState(o.status, o.lines.map(lineView)) : null;
}

/** The scanning screen for one order; null when there is no such order. */
export async function orderScanPage(id: string): Promise<OrderScanPage | null> {
  const o = await db.kegOrder.findUnique({ where: { id }, include: { ...WITH_LINES, notes: { orderBy: { at: "desc" }, take: 20 } } });
  if (!o) return null;
  return {
    ...scanState(o.status, o.lines.map(lineView)),
    id: o.id,
    number: o.number,
    account: o.account.name,
    transit: o.transit,
    dueOn: iso(o.dueOn),
    today: businessToday(),
    notes: o.notes.map((n) => ({ id: n.id, at: n.at, userName: n.userName, text: n.text })),
  };
}

export type OrderScanResult =
  | { ok: true; kegId: string; code: string; beerId: string | null; beer: string; sizeId: string; state: OrderScanState }
  | { error: string; code?: string; unknown?: boolean; state?: OrderScanState };

/**
 * One scan for an order: find the keg, check it against the order's lines,
 * send it out to the order's account (the keg service's OUT action) and record
 * it on its line. Anything that doesn't fit gives one reason and changes
 * nothing. `clientId` is made on the phone, so a scan sent again after no
 * signal is applied once.
 */
export async function scanForOrder(user: User, input: { orderId: string; text: string; clientId: string }): Promise<OrderScanResult> {
  const hit = await findKegByScan(input.text);
  if (!hit) return { error: "This sticker isn't in the app yet.", unknown: true };
  const order = await db.kegOrder.findUnique({ where: { id: input.orderId }, select: { status: true, accountId: true, lines: LINES, kegs: { select: { kegId: true, eventId: true, lineId: true } } } });
  if (!order) return { error: GONE, code: hit.code };
  const lines = order.lines.map(lineView);
  const state = scanState(order.status, lines);
  const done = (lineId: string, fresh: OrderScanState): OrderScanResult => {
    const l = lines.find((x) => x.id === lineId);
    return { ok: true, kegId: hit.id, code: hit.code, beerId: l?.beerId ?? null, beer: l?.beer ?? "", sizeId: l?.sizeId ?? "half", state: fresh };
  };

  // Already on this order: the same scan sent again counts as done, anything else is a double scan.
  const mine = order.kegs.find((k) => k.kegId === hit.id);
  if (mine) {
    const ev = mine.eventId ? await db.kegEvent.findUnique({ where: { id: mine.eventId }, select: { clientId: true } }) : null;
    if (ev?.clientId && ev.clientId === input.clientId) return done(mine.lineId, state);
    return { error: "Already on this order.", code: hit.code, state };
  }
  const [keg, prior] = await Promise.all([
    db.keg.findUnique({ where: { id: hit.id }, select: { id: true, active: true, status: true, beerId: true, sizeId: true, beer: { select: { name: true } }, account: { select: { name: true } } } }),
    db.kegEvent.findUnique({ where: { clientId: input.clientId }, select: { id: true, kegId: true, action: true, accountId: true, undoneAt: true, fromStatus: true } }),
  ]);
  if (!keg) return { error: "That keg was removed.", code: hit.code, state };
  // This scan was sent before and got as far as sending the keg out, but not onto the order:
  // carry on from there, checking the keg as it was before it left.
  const resumed = !!prior && prior.kegId === keg.id && prior.action === "OUT" && prior.accountId === order.accountId && !prior.undoneAt;
  if (prior && !resumed) return { error: "That scan didn't go through. Scan the keg again.", code: hit.code, state };
  /** Put the keg back where it was when it turns out it can't go on the order after all. */
  const stepBack = async (eventId: string) => {
    const r = await undoKegEvents({ userId: user.userId, role: user.role }, { eventId }).catch(() => null);
    return !!r && "ok" in r;
  };
  if (order.status !== "OPEN") {
    if (resumed) await stepBack(prior!.id);
    return { error: closedText(order.status), code: hit.code, state };
  }
  const scanned: ScannedKeg = { id: keg.id, active: keg.active, status: (resumed ? prior!.fromStatus ?? "COLD" : keg.status) as KegStatus, beerId: keg.beerId, beer: keg.beer?.name ?? null, sizeId: keg.sizeId, account: keg.account?.name ?? null };
  const m = matchKeg(scanned, lines, order.kegs.map((k) => k.kegId));
  if ("error" in m) {
    if (resumed) await stepBack(prior!.id);
    return { error: m.error, code: hit.code, state };
  }

  const out = await doKegAction({ userId: user.userId, name: user.name }, { kegId: keg.id, action: "OUT", accountId: order.accountId, clientId: input.clientId });
  if ("error" in out) return { error: out.error, code: hit.code, state };
  try {
    const row = await db.kegOrderKeg.create({ data: { orderId: input.orderId, lineId: m.lineId, kegId: keg.id, eventId: out.eventId, userName: user.name }, select: { id: true } });
    // Two phones can scan the last keg a line needs at the same moment. The later one steps back.
    const line = await db.kegOrderLine.findUnique({ where: { id: m.lineId }, select: { quantity: true, unscanned: true, kegs: { orderBy: [{ at: "asc" }, { id: "asc" }], select: { id: true } } } });
    const room = line ? Math.max(0, line.quantity - line.unscanned) : 0;
    if (line && line.kegs.length > room && line.kegs.findIndex((k) => k.id === row.id) >= room && (await stepBack(out.eventId))) {
      await db.kegOrderKeg.deleteMany({ where: { id: row.id } });
      return { error: `This order already has all its ${keg.beer?.name ?? "kegs of that beer"}.`, code: hit.code, state: (await loadScanState(input.orderId)) ?? state };
    }
  } catch (e) {
    if (known(e, "P2002")) {
      // Another request put this keg on the order first. If it was this same scan, it's done; either way nothing is undone.
      const row = await db.kegOrderKeg.findUnique({ where: { orderId_kegId: { orderId: input.orderId, kegId: keg.id } }, select: { eventId: true, lineId: true } });
      const fresh = (await loadScanState(input.orderId)) ?? state;
      if (row && row.eventId === out.eventId) return done(row.lineId, fresh);
      return { error: "Already on this order.", code: hit.code, state: fresh };
    }
    if (known(e, "P2003")) {
      // The line (or the order) was removed while this keg was being scanned: put the keg back as it was.
      const back = await stepBack(out.eventId);
      const fresh = (await loadScanState(input.orderId)) ?? undefined;
      return { error: back ? "That line was just taken off the order. Nothing was changed." : "That line was just taken off the order, but the keg is marked out. Open the keg and undo it.", code: hit.code, state: fresh };
    }
    throw e;
  }
  return done(m.lineId, (await loadScanState(input.orderId)) ?? state);
}

/**
 * Undo a keg scanned onto an open order: the keg goes back to where it was
 * (the keg service's undo) and comes off the order. If the keg can no longer
 * be put back, says why and leaves the order as it is.
 */
export async function undoOrderScan(user: User, input: { orderId: string; kegId: string }): Promise<{ ok: true; state: OrderScanState } | { error: string }> {
  const row = await db.kegOrderKeg.findUnique({ where: { orderId_kegId: { orderId: input.orderId, kegId: input.kegId } }, select: { id: true, eventId: true, order: { select: { status: true } } } });
  if (!row) return { error: "That keg isn't on this order." };
  if (row.order.status !== "OPEN") return { error: closedText(row.order.status) };
  // An event that was already undone (from the keg's own card) has nothing left to put back.
  const ev = row.eventId ? await db.kegEvent.findUnique({ where: { id: row.eventId }, select: { undoneAt: true } }) : null;
  if (ev && !ev.undoneAt) {
    const r = await undoKegEvents({ userId: user.userId, role: user.role }, { eventId: row.eventId! });
    if ("error" in r) return r;
  }
  await db.kegOrderKeg.deleteMany({ where: { id: row.id } });
  const state = await loadScanState(input.orderId);
  return state ? { ok: true, state } : { error: GONE };
}

/**
 * After keg events are undone somewhere else (a keg's card, the history):
 * take those kegs off any open order they were scanned onto, since they are
 * no longer out on it. Finished orders keep their record.
 */
export async function forgetUndoneOrderKegs(ref: { eventId?: string; groupId?: string }): Promise<void> {
  if (!ref.groupId && !ref.eventId) return;
  const undone = await db.kegEvent.findMany({ where: { ...(ref.groupId ? { groupId: ref.groupId } : { id: ref.eventId }), undoneAt: { not: null } }, select: { id: true } });
  const ids = undone.map((e) => e.id);
  if (!ids.length) return;
  await db.kegOrderKeg.deleteMany({ where: { eventId: { in: ids }, order: { status: "OPEN" } } });
}
