/**
 * The Ordering page as a board: what each supplier's order looks like right
 * now, what needs doing today (deadlines, drafts, trucks, check-ins), and how
 * suppliers sort and group by their next deadline. Pure: no DB, no React.
 */

import { addDays, type ISODate } from "./dates";
import { deadlineFor, type CutoffRule } from "./ordering";

export type PoStatus = "DRAFT" | "SENT" | "RECEIVED";

export interface BoardOrder {
  id: string;
  supplierId: string;
  status: PoStatus;
  deliveryDate: ISODate;
  total: number | null;
  lines: number;
}

export interface NextDeadline {
  deliveryDate: ISODate;
  cutoffDate: ISODate;
  cutoffTime: string; // "HH:MM"
}

// ---- Supplier status ----------------------------------------------------------------

/**
 * none: nothing on order for the next delivery. draft: saved, not sent. sent: on its way.
 * received: the next delivery's order is already checked in.
 */
export type SupplierStateKind = "none" | "draft" | "sent" | "received";

export interface SupplierState {
  kind: SupplierStateKind;
  order: BoardOrder | null;
  /** The order is for the next delivery (not another date). */
  forNext: boolean;
}

/**
 * Where a supplier's ordering stands. The order for the next delivery wins; otherwise any
 * open draft, then anything sent and still to come. Received orders for other dates and
 * past drafts don't count — the next delivery still needs an order.
 */
export function supplierState(nextDelivery: ISODate | null, orders: readonly BoardOrder[], today: ISODate): SupplierState {
  const KIND: Record<PoStatus, SupplierStateKind> = { DRAFT: "draft", SENT: "sent", RECEIVED: "received" };
  if (nextDelivery) {
    const forNext = orders.filter((o) => o.deliveryDate === nextDelivery);
    // Several for the same day (a top-up): the least finished one is what needs you.
    const rank: Record<PoStatus, number> = { DRAFT: 0, SENT: 1, RECEIVED: 2 };
    const o = [...forNext].sort((a, b) => rank[a.status] - rank[b.status])[0];
    if (o) return { kind: KIND[o.status], order: o, forNext: true };
  }
  const upcoming = (s: PoStatus) => orders.filter((o) => o.status === s && o.deliveryDate >= today).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))[0];
  const draft = upcoming("DRAFT");
  if (draft) return { kind: "draft", order: draft, forNext: false };
  const sent = upcoming("SENT");
  if (sent) return { kind: "sent", order: sent, forNext: false };
  return { kind: "none", order: null, forNext: false };
}

/** Nothing ordered yet and a deadline is coming up. */
export const needsOrder = (s: SupplierState, next: NextDeadline | null) => s.kind === "none" && next != null;

// ---- Deadlines ------------------------------------------------------------------------

export type DeadlineBucket = "today" | "tomorrow" | "week" | "later" | "none";

export const DEADLINE_BUCKETS: { value: DeadlineBucket; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "week", label: "This week" },
  { value: "later", label: "Later" },
  { value: "none", label: "No deadline" },
];

/** Today / tomorrow / within 7 days / later, by the deadline's business date. */
export function deadlineBucket(cutoffDate: ISODate | null | undefined, today: ISODate): DeadlineBucket {
  if (!cutoffDate) return "none";
  if (cutoffDate <= today) return "today";
  if (cutoffDate === addDays(today, 1)) return "tomorrow";
  if (cutoffDate < addDays(today, 7)) return "week";
  return "later";
}

/** Sort key for "soonest deadline first": comparable string, null when there's none (sorts last). */
export const deadlineKey = (n: NextDeadline | null | undefined) => (n ? `${n.cutoffDate}T${n.cutoffTime}` : null);

/** Soonest deadline first, then name; suppliers with no deadline last. */
export function compareByDeadline<T extends { name: string; next: NextDeadline | null }>(a: T, b: T): number {
  const ka = deadlineKey(a.next);
  const kb = deadlineKey(b.next);
  if (ka !== kb) {
    if (ka == null) return 1;
    if (kb == null) return -1;
    return ka < kb ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

/** "45m", "5h 20m", "2d 4h"; "passed" once it's gone. */
export function countdownLabel(msLeft: number): string {
  if (msLeft <= 0) return "passed";
  const mins = Math.floor(msLeft / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** How loud a countdown should be: under 6 hours is urgent, under a day a heads-up. */
export function countdownTone(msLeft: number): "bad" | "warn" | "neutral" {
  if (msLeft <= 6 * 3600_000) return "bad";
  if (msLeft <= 24 * 3600_000) return "warn";
  return "neutral";
}

/** "2pm", "5:30pm". */
export function clock(t: string): string {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday-first order of weekdays (0 = Sunday). */
export const mondayFirst = (days: readonly number[]) => [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));

/** "Fri ← Wed 5pm · Tue ← Mon 2pm" */
export function deadlineSummary(deliveryDays: readonly number[], rule: CutoffRule): string {
  return mondayFirst(deliveryDays)
    .map((wd) => {
      const d = deadlineFor(rule, wd);
      return `${WD[wd]} ← ${WD[(wd - d.daysBefore + 70) % 7]} ${clock(d.time)}`;
    })
    .join(" · ");
}

/** The deadline for this delivery is a guess from the lead time (none set for its weekday). */
export function isGuessed(rule: CutoffRule, deliveryDate: ISODate | null | undefined): boolean {
  if (!deliveryDate) return false;
  const wd = new Date(`${deliveryDate}T12:00:00Z`).getUTCDay();
  return !rule.perDay?.[wd];
}

// ---- Today ------------------------------------------------------------------------------

export type TodayKind = "deadline" | "draft" | "checkin" | "arriving";

export interface TodayItem {
  key: string;
  kind: TodayKind;
  supplierId: string;
  supplierName: string;
  deliveryDate: ISODate;
  orderId?: string;
  total?: number | null;
  lines?: number;
  /** The supplier's next deadline, when this item is about it. */
  deadline?: NextDeadline;
  hoursToCutoff?: number | null;
  /** Check-ins: the truck was due before today. */
  late?: boolean;
}

export interface TodaySupplier {
  id: string;
  name: string;
  next: NextDeadline | null;
  hoursToCutoff: number | null;
  state: SupplierState;
}

/**
 * What needs doing now, most urgent first:
 *  1. deadlines in the next `windowHours` (48) with nothing ordered yet,
 *  2. drafts waiting to be sent (for deliveries today or later),
 *  3. sent orders due today or earlier (check them in; up to `checkinDays` back),
 *  4. sent orders arriving tomorrow.
 */
export function todayItems(args: { today: ISODate; suppliers: readonly TodaySupplier[]; orders: readonly (BoardOrder & { supplierName: string })[]; windowHours?: number; checkinDays?: number }): TodayItem[] {
  const { today, suppliers } = args;
  const windowHours = args.windowHours ?? 48;
  const since = addDays(today, -(args.checkinDays ?? 14));
  const tomorrow = addDays(today, 1);
  const bySupplier = new Map(suppliers.map((s) => [s.id, s]));
  const out: TodayItem[] = [];

  const deadlines = suppliers
    .filter((s) => s.next && s.hoursToCutoff != null && s.hoursToCutoff > 0 && s.hoursToCutoff <= windowHours && s.state.kind === "none")
    .sort((a, b) => (a.hoursToCutoff ?? 0) - (b.hoursToCutoff ?? 0) || a.name.localeCompare(b.name));
  for (const s of deadlines) out.push({ key: `deadline:${s.id}`, kind: "deadline", supplierId: s.id, supplierName: s.name, deliveryDate: s.next!.deliveryDate, deadline: s.next!, hoursToCutoff: s.hoursToCutoff });

  // Drafts: the ones with a deadline attached first (soonest), then by delivery date.
  const drafts = args.orders
    .filter((o) => o.status === "DRAFT" && o.deliveryDate >= today)
    .map((o) => {
      const s = bySupplier.get(o.supplierId);
      const mine = s?.next && s.next.deliveryDate === o.deliveryDate ? s : null;
      return { o, deadline: mine?.next ?? undefined, hours: mine?.hoursToCutoff ?? null };
    })
    .sort((a, b) => (a.hours ?? Infinity) - (b.hours ?? Infinity) || a.o.deliveryDate.localeCompare(b.o.deliveryDate) || a.o.supplierName.localeCompare(b.o.supplierName));
  for (const { o, deadline, hours } of drafts) out.push({ key: `draft:${o.id}`, kind: "draft", supplierId: o.supplierId, supplierName: o.supplierName, deliveryDate: o.deliveryDate, orderId: o.id, total: o.total, lines: o.lines, deadline, hoursToCutoff: hours });

  const sent = args.orders.filter((o) => o.status === "SENT");
  const checkins = sent.filter((o) => o.deliveryDate <= today && o.deliveryDate >= since).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.supplierName.localeCompare(b.supplierName));
  for (const o of checkins) out.push({ key: `checkin:${o.id}`, kind: "checkin", supplierId: o.supplierId, supplierName: o.supplierName, deliveryDate: o.deliveryDate, orderId: o.id, total: o.total, lines: o.lines, late: o.deliveryDate < today });

  const arriving = sent.filter((o) => o.deliveryDate === tomorrow).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  for (const o of arriving) out.push({ key: `arriving:${o.id}`, kind: "arriving", supplierId: o.supplierId, supplierName: o.supplierName, deliveryDate: o.deliveryDate, orderId: o.id, total: o.total, lines: o.lines });

  return out;
}

/** Counts for the strip's headline: "2 deadlines · 1 draft to send · 1 to check in". */
export function todayCounts(items: readonly TodayItem[]): Record<TodayKind, number> {
  const c: Record<TodayKind, number> = { deadline: 0, draft: 0, checkin: 0, arriving: 0 };
  for (const i of items) c[i.kind]++;
  return c;
}

/**
 * The strip's first view: a few of each kind (so a busy morning of deadlines doesn't
 * push the drafts and check-ins out of sight), in the original order. The rest sit
 * behind "Show more".
 */
export function capPerKind<T extends { kind: TodayKind }>(items: readonly T[], caps: Partial<Record<TodayKind, number>> = { deadline: 4, draft: 3, checkin: 3, arriving: 2 }): T[] {
  const used: Partial<Record<TodayKind, number>> = {};
  return items.filter((i) => {
    const n = (used[i.kind] ?? 0) + 1;
    used[i.kind] = n;
    return n <= (caps[i.kind] ?? Infinity);
  });
}
