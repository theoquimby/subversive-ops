/**
 * Wholesale keg orders: how far along an order is, how many full kegs are
 * free, spoken for or still to be filled, which line a scanned keg belongs to
 * (or why it can't go on the order), when an order is due, what a valid order
 * looks like, and the one line the Overview says about orders. Pure: no I/O.
 * services/kegOrders.ts loads the orders and kegs and writes the results.
 */

import type { AttentionItem } from "./attention";
import { daysBetween, type ISODate } from "./dates";
import { isFull, KEG_SIZE_LIST, kegSizeInfo, type KegStatus } from "./kegs";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (n: number) => plural(n, "day");
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const bySort = <T extends { sort: number }>(lines: readonly T[]) => lines.map((l, i) => ({ l, i })).sort((a, b) => a.l.sort - b.l.sort || a.i - b.i).map((x) => x.l);

// ---- Orders ------------------------------------------------------------------------------------

export type KegOrderStatus = "OPEN" | "FULFILLED" | "CANCELLED";
export type Transit = "DELIVERY" | "PICKUP";

export const TRANSITS: { value: Transit; label: string }[] = [
  { value: "DELIVERY", label: "Delivery" },
  { value: "PICKUP", label: "Pickup" },
];
/** "Delivery" or "Pickup"; anything unknown reads as a delivery. */
export const transitLabel = (t: string) => TRANSITS.find((x) => x.value === t)?.label ?? "Delivery";

export const ORDERS_HREF = "/kegs/orders";
export const MAX_LINES = 40;
export const MAX_QUANTITY = 200;

/** One line of an order, with how many kegs have been scanned out against it. */
export interface OrderLine {
  id: string;
  beerId: string;
  sizeId: string;
  /** Kegs the account asked for. */
  quantity: number;
  /** Kegs marked delivered without a scan. */
  unscanned: number;
  /** Kegs scanned out against this line. */
  scanned: number;
  sort: number;
}

type LineCounts = Pick<OrderLine, "quantity" | "unscanned" | "scanned">;
type LineWant = Pick<OrderLine, "beerId" | "sizeId"> & LineCounts;

const pairKey = (beerId: string, sizeId: string) => `${beerId}|${sizeId}`;

// ---- Progress ----------------------------------------------------------------------------------

export interface LineProgress {
  /** Scanned kegs plus kegs delivered without a scan. */
  sent: number;
  /** Kegs the line still needs; never below zero. */
  remaining: number;
  complete: boolean;
}

export function lineProgress(l: LineCounts): LineProgress {
  const sent = count(l.scanned) + count(l.unscanned);
  const remaining = Math.max(0, count(l.quantity) - sent);
  return { sent, remaining, complete: remaining === 0 };
}

export interface OrderProgress {
  quantity: number;
  sent: number;
  remaining: number;
  /** Every line has all its kegs, and there is at least one line. */
  complete: boolean;
}

export function orderProgress(lines: readonly LineCounts[]): OrderProgress {
  let quantity = 0, sent = 0, remaining = 0;
  for (const l of lines) {
    const p = lineProgress(l);
    quantity += count(l.quantity);
    sent += p.sent;
    remaining += p.remaining;
  }
  return { quantity, sent, remaining, complete: lines.length > 0 && remaining === 0 };
}

/** "2 of 5 kegs" */
export const progressLabel = (p: Pick<OrderProgress, "sent" | "quantity">) => `${p.sent} of ${plural(p.quantity, "keg")}`;

// ---- Availability ------------------------------------------------------------------------------

export interface StockKeg {
  beerId: string | null;
  sizeId: string;
  status: KegStatus;
  active: boolean;
}

export interface AvailabilityRow {
  beerId: string;
  beer: string;
  sizeId: string;
  /** Active kegs of this beer and size that are filled or in cold storage. */
  full: number;
  /** Kegs open orders still need. */
  wanted: number;
  /** Full kegs open orders will take. */
  reserved: number;
  /** Full kegs no open order needs. */
  available: number;
  /** Kegs open orders need that aren't full yet. */
  preordered: number;
}

const sizeRank = (id: string) => {
  const i = KEG_SIZE_LIST.findIndex((s) => s.id === id);
  return i < 0 ? KEG_SIZE_LIST.length : i;
};

/**
 * Full kegs per beer and size against what open orders still need. A row for
 * every pair with a full keg or a keg wanted, by beer name then size.
 */
export function availability(kegs: readonly StockKeg[], orders: readonly { status: KegOrderStatus; lines: readonly LineWant[] }[], beerName: (beerId: string) => string | null | undefined): AvailabilityRow[] {
  const rows = new Map<string, { beerId: string; sizeId: string; full: number; wanted: number }>();
  const row = (beerId: string, sizeId: string) => {
    const k = pairKey(beerId, sizeId);
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { beerId, sizeId, full: 0, wanted: 0 }));
    return r;
  };
  for (const k of kegs) if (k.active && k.beerId && isFull(k.status)) row(k.beerId, k.sizeId).full++;
  for (const o of orders) {
    if (o.status !== "OPEN") continue;
    for (const l of o.lines) {
      const need = lineProgress(l).remaining;
      if (need > 0) row(l.beerId, l.sizeId).wanted += need;
    }
  }
  return [...rows.values()]
    .filter((r) => r.full > 0 || r.wanted > 0)
    .map((r) => {
      const reserved = Math.min(r.full, r.wanted);
      return { beerId: r.beerId, beer: beerName(r.beerId) ?? "Unknown beer", sizeId: r.sizeId, full: r.full, wanted: r.wanted, reserved, available: r.full - reserved, preordered: Math.max(0, r.wanted - r.full) };
    })
    .sort((a, b) => a.beer.localeCompare(b.beer, "en", { sensitivity: "base" }) || sizeRank(a.sizeId) - sizeRank(b.sizeId) || a.beerId.localeCompare(b.beerId));
}

export interface LineShortfall {
  lineId: string;
  /** Full kegs on hand for this line (after the lines before it took theirs). */
  full: number;
  /** Kegs the line still needs that aren't full yet. */
  short: number;
}

/** For each line of one order, in line order: the full kegs there are for it, and how many it is short. */
export function orderShortfalls(lines: readonly OrderLine[], rows: readonly Pick<AvailabilityRow, "beerId" | "sizeId" | "full">[]): LineShortfall[] {
  const left = new Map(rows.map((r) => [pairKey(r.beerId, r.sizeId), r.full]));
  return bySort(lines).map((l) => {
    const k = pairKey(l.beerId, l.sizeId);
    const full = left.get(k) ?? 0;
    const need = lineProgress(l).remaining;
    left.set(k, full - Math.min(full, need));
    return { lineId: l.id, full, short: Math.max(0, need - full) };
  });
}

/** "Not enough full kegs yet: 2 × Subversive IPA 1/2 bbl still need filling."; null when nothing is short. */
export function stockWarning(items: readonly { beer: string; sizeId: string; short: number }[]): string | null {
  const short = items.filter((i) => i.short > 0);
  if (!short.length) return null;
  const parts = short.map((i) => `${i.short} × ${i.beer} ${kegSizeInfo(i.sizeId).short}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const total = short.reduce((s, i) => s + i.short, 0);
  return `Not enough full kegs yet: ${list} still ${total === 1 ? "needs" : "need"} filling.`;
}

// ---- Matching a scanned keg --------------------------------------------------------------------

export interface ScannedKeg {
  id: string;
  active: boolean;
  status: KegStatus;
  beerId: string | null;
  /** The beer's name, for the reason. */
  beer: string | null;
  sizeId: string;
  /** The account it is out at, when it is out. */
  account: string | null;
}

export type MatchReason = "retired" | "on-order" | "not-full" | "wrong-beer" | "wrong-size" | "complete";
export type KegMatch = { lineId: string } | { reason: MatchReason; error: string };

const NOT_FULL: Record<Exclude<KegStatus, "FILLED" | "COLD" | "OUT">, string> = {
  EMPTY: "This keg is empty.",
  ON_TAP: "This keg is on tap.",
  KICKED: "This keg is kicked.",
  CLEANING: "This keg is waiting to be cleaned.",
};

/**
 * The line a scanned keg goes on: the first line (by `sort`) with its beer and
 * size that still needs kegs. Otherwise one plain reason, checked in this
 * order: retired, already on this order, not full, a beer the order doesn't
 * have, the wrong size, or every line for it complete.
 */
export function matchKeg(keg: ScannedKeg, lines: readonly OrderLine[], onOrder: Iterable<string>): KegMatch {
  if (!keg.active) return { reason: "retired", error: "This keg is retired. A manager can bring it back." };
  for (const id of onOrder) if (id === keg.id) return { reason: "on-order", error: "Already on this order." };
  if (!isFull(keg.status)) {
    const error = keg.status === "OUT" ? `This keg is already out at ${keg.account?.trim() || "an account"}.` : NOT_FULL[keg.status as keyof typeof NOT_FULL];
    return { reason: "not-full", error };
  }
  if (!keg.beerId) return { reason: "wrong-beer", error: "The app doesn't know what's in this keg, so it can't go on an order." };
  const beer = keg.beer?.trim() || "that beer";
  const sameBeer = bySort(lines).filter((l) => l.beerId === keg.beerId);
  if (!sameBeer.length) return { reason: "wrong-beer", error: `This order has no ${beer}.` };
  const sizes = [...new Set(sameBeer.map((l) => l.sizeId))];
  const sameSize = sameBeer.filter((l) => l.sizeId === keg.sizeId);
  if (!sameSize.length) return { reason: "wrong-size", error: `This order wants ${beer} in ${sizes.map((s) => kegSizeInfo(s).short).join(" or ")}, and this keg is ${kegSizeInfo(keg.sizeId).short}.` };
  const open = sameSize.find((l) => lineProgress(l).remaining > 0);
  if (!open) return { reason: "complete", error: `This order already has all its ${beer}${sizes.length > 1 ? ` in ${kegSizeInfo(keg.sizeId).short}` : ""}.` };
  return { lineId: open.id };
}

// ---- Due ---------------------------------------------------------------------------------------

export type DueKind = "overdue" | "today" | "none";
export interface Due {
  kind: DueKind;
  tone: "bad" | "warn" | "neutral";
  /** Days past the date; 0 unless overdue. */
  daysLate: number;
}

/** Before today is overdue, today is today, later or no date is nothing to flag. */
export function dueTone(dueOn: ISODate | null | undefined, today: ISODate): Due {
  if (dueOn && dueOn < today) return { kind: "overdue", tone: "bad", daysLate: daysBetween(dueOn, today) };
  if (dueOn && dueOn === today) return { kind: "today", tone: "warn", daysLate: 0 };
  return { kind: "none", tone: "neutral", daysLate: 0 };
}

// ---- Validation --------------------------------------------------------------------------------

export interface DraftLine {
  beerId: string;
  sizeId: string;
  quantity: number;
}

export interface OrderDraft {
  accountId: string;
  transit: string;
  dueOn: string | null;
  lines: DraftLine[];
}

export interface CleanOrder {
  accountId: string;
  transit: Transit;
  dueOn: ISODate | null;
  lines: DraftLine[];
}

/** A real calendar date written YYYY-MM-DD. */
export const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const knownSize = (id: string) => KEG_SIZE_LIST.some((s) => s.id === id);
export const validQuantity = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY;

/** What's wrong with one line, or null. */
export function lineProblem(l: DraftLine): string | null {
  if (!String(l.beerId ?? "").trim()) return "pick the beer.";
  if (!knownSize(l.sizeId)) return "pick a keg size.";
  if (!validQuantity(l.quantity)) return `how many kegs, from 1 to ${MAX_QUANTITY}.`;
  return null;
}

/** Whether a line with this beer and size would double another line (not counting itself). */
export function lineCollides(lines: readonly Pick<OrderLine, "id" | "beerId" | "sizeId">[], candidate: { id?: string; beerId: string; sizeId: string }): boolean {
  return lines.some((l) => l.id !== candidate.id && l.beerId === candidate.beerId && l.sizeId === candidate.sizeId);
}

/** Lines with the same beer and size become one, quantities added, in the first one's place. Unfinished lines are left alone. */
export function mergeLines<T extends DraftLine>(lines: readonly T[]): T[] {
  const out: T[] = [];
  const at = new Map<string, number>();
  for (const l of lines) {
    const k = l.beerId && l.sizeId ? pairKey(l.beerId, l.sizeId) : null;
    const i = k ? at.get(k) : undefined;
    if (i === undefined) {
      if (k) at.set(k, out.length);
      out.push({ ...l });
    } else out[i] = { ...out[i], quantity: out[i].quantity + l.quantity };
  }
  return out;
}

/** A new or edited order: an account, delivery or pickup, a real date or none, and 1 to 40 lines with no doubles. */
export function validateOrder(d: OrderDraft): { order: CleanOrder } | { error: string } {
  const accountId = String(d.accountId ?? "").trim();
  if (!accountId) return { error: "Pick the account." };
  const transit = TRANSITS.find((t) => t.value === d.transit)?.value;
  if (!transit) return { error: "Pick delivery or pickup." };
  const dueOn = String(d.dueOn ?? "").trim() || null;
  if (dueOn && !isRealDate(dueOn)) return { error: "That date doesn't look right." };
  const lines = Array.isArray(d.lines) ? d.lines : [];
  if (!lines.length) return { error: "Add at least one line: a beer, a size and how many." };
  if (lines.length > MAX_LINES) return { error: `An order takes up to ${MAX_LINES} lines. Split this one in two.` };
  const seen = new Set<string>();
  const clean: DraftLine[] = [];
  for (const [i, l] of lines.entries()) {
    const problem = lineProblem(l);
    if (problem) return { error: `Line ${i + 1}: ${problem}` };
    const k = pairKey(l.beerId, l.sizeId);
    if (seen.has(k)) return { error: "Two lines have the same beer and size. Put them on one line." };
    seen.add(k);
    clean.push({ beerId: l.beerId, sizeId: l.sizeId, quantity: l.quantity });
  }
  return { order: { accountId, transit, dueOn, lines: clean } };
}

// ---- Search ------------------------------------------------------------------------------------

/** Whether an order fits a search: its number ("42" or "#42"), or part of the account's or a beer's name. Blank fits everything. */
export function orderMatches(q: string, o: { number: number; account: string; beers: readonly string[] }): boolean {
  const s = String(q ?? "").trim().toLowerCase();
  if (!s) return true;
  if (/^#?\d+$/.test(s) && String(o.number) === s.replace("#", "")) return true;
  return [o.account, ...o.beers].some((x) => x.toLowerCase().includes(s));
}

// ---- Overview: needs you -----------------------------------------------------------------------

export interface DueOrder {
  status: KegOrderStatus;
  dueOn: ISODate | null;
  transit: string;
  account: string;
}

/** "The Anchor", "The Anchor and Fred's Tavern", "A, B and 2 more". */
function nameList(names: string[]): string {
  const n = [...new Set(names)];
  if (n.length <= 1) return n[0] ?? "";
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} and ${n[2]}`;
  return `${n[0]}, ${n[1]} and ${n.length - 2} more`;
}

/** "2 keg orders to deliver today", "1 keg order for pickup today", or "due today" for a mix. */
export function dueTodayLine(orders: readonly Pick<DueOrder, "transit">[]): string {
  const pickups = orders.filter((o) => o.transit === "PICKUP").length;
  const what = pickups === 0 ? "to deliver today" : pickups === orders.length ? "for pickup today" : "due today";
  return `${plural(orders.length, "keg order")} ${what}`;
}

/** "1 keg order is overdue" */
export const overdueLine = (n: number) => `${plural(n, "keg order")} ${n === 1 ? "is" : "are"} overdue`;

/**
 * One "Needs you" item when open orders are due today or overdue; none
 * otherwise. Overdue leads, with what's due today in the detail.
 */
export function orderAttentionItems(today: ISODate, orders: readonly DueOrder[]): AttentionItem[] {
  const open = orders.filter((o) => o.status === "OPEN" && o.dueOn);
  const late = open.filter((o) => dueTone(o.dueOn, today).kind === "overdue").sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
  const now = open.filter((o) => dueTone(o.dueOn, today).kind === "today");
  if (!late.length && !now.length) return [];
  const item = (title: string, detail: string, urgency: number): AttentionItem => ({ key: "kegs.orders", title, detail, href: ORDERS_HREF, tone: "warn", urgency });
  if (!late.length) return [item(dueTodayLine(now), `For ${nameList(now.map((o) => o.account))}`, 56)];
  const oldest = late[0];
  const wait = days(dueTone(oldest.dueOn, today).daysLate);
  const detail = now.length ? `Plus ${dueTodayLine(now)}` : late.length === 1 ? `${oldest.account} · ${wait} late` : `Oldest: ${oldest.account}, ${wait} late`;
  return [item(overdueLine(late.length), detail, 62)];
}
