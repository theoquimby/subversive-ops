/**
 * Money Square keeps that the P&L didn't: card processing fees (from
 * payments and refunds) and comps & discounts (from orders). Pure: the
 * shapes follow Square's objects, dates are business dates worked out by the
 * caller, amounts are cents until the very end.
 *
 * Fees — Payment.processing_fee and PaymentRefund.processing_fee are lists of
 * ProcessingFee { effective_at, type: INITIAL | ADJUSTMENT, amount_money }.
 * Square's reference: "Positive values represent funds being assessed, while
 * negative values represent funds being returned" (its examples: +34 on a
 * payment, −34 on the refund of it). One Square guide instead says payment
 * fees are "always negative or zero", so the sign is read from the data: if
 * the payments' INITIAL fees are negative, every sign is flipped.
 *
 * Discounts — Order.discounts[] (OrderLineItemDiscount: uid, name, type,
 * percentage, amount_money, scope) and each line's applied_discounts[]
 * (discount_uid, applied_money). Returns carry return_discounts[] and
 * return_line_items[].applied_discounts[] the same way. The Orders API has no
 * void or comp field: a comp is a discount, and voided lines never reach a
 * completed order.
 */

import type { ISODate } from "./dates";
import { lineNetCents, type SquareLine, type SquareMoney } from "./squareOrders";

// ---- Card fees ---------------------------------------------------------------------------

export interface SquareProcessingFee {
  effective_at?: string;
  type?: string;
  amount_money?: SquareMoney;
}

export interface FeePayment {
  id: string;
  createdAt: string;
  status: string;
  /** CARD, CASH, EXTERNAL, WALLET… */
  sourceType: string | null;
  /** total_money in cents (amount + tip). */
  totalCents: number;
  fees: SquareProcessingFee[];
}

export interface FeeRefund {
  id: string;
  createdAt: string;
  status: string;
  fees: SquareProcessingFee[];
}

export interface FeeDay {
  date: ISODate;
  /** Fees charged on payments taken this day (positive = cost), in dollars. */
  cardFees: number;
  /** Fees Square gave back on refunds made this day (positive = money back), in dollars. */
  feesReturned: number;
  /** Payments that carried a fee. */
  feePayments: number;
  /** Completed non-cash payments with no fee reported yet (Square adds it a little later). */
  feePending: number;
  /** Total of the payments that carried a fee (card volume incl. tips), in dollars. */
  feeVolume: number;
}

const amt = (f: SquareProcessingFee) => f.amount_money?.amount ?? 0;
const NO_FEE_SOURCES = new Set(["CASH", "EXTERNAL"]);
const DEAD = new Set(["CANCELED", "FAILED", "REJECTED"]);

/**
 * +1 when payment fees come positive (Square's reference), −1 when they come
 * negative (the other convention). Decided by the INITIAL fees on payments.
 */
export function feeSign(payments: FeePayment[]): 1 | -1 {
  let pos = 0;
  let neg = 0;
  for (const p of payments) {
    for (const f of p.fees) {
      if (f.type && f.type !== "INITIAL") continue;
      if (amt(f) > 0) pos++;
      else if (amt(f) < 0) neg++;
    }
  }
  return neg > pos ? -1 : 1;
}

/** A payment's fee in cents as a cost (INITIAL plus any ADJUSTMENT). */
export const paymentFeeCents = (p: FeePayment, sign: 1 | -1 = 1) => sign * p.fees.reduce((s, f) => s + amt(f), 0);

/** Fees a refund gave back in cents (positive = returned to the seller). */
export const refundFeeReturnedCents = (r: FeeRefund, sign: 1 | -1 = 1) => -sign * r.fees.reduce((s, f) => s + amt(f), 0);

/**
 * Card fees per business day for `dates`: payments by the day they were taken,
 * refunds by the day they were made. Every date gets a row (zero on a cash
 * day), so a synced day can be told from one that never was. Payments or
 * refunds outside `dates` are left out (a payment right on the window's end).
 */
export function feeDays(payments: FeePayment[], refunds: FeeRefund[], dates: ISODate[], dateOf: (iso: string) => ISODate): FeeDay[] {
  const sign = feeSign(payments);
  const by = new Map<ISODate, { fees: number; back: number; n: number; pending: number; volume: number }>(dates.map((d) => [d, { fees: 0, back: 0, n: 0, pending: 0, volume: 0 }]));
  const seen = new Set<string>();
  for (const p of payments) {
    if (seen.has(p.id) || DEAD.has(p.status)) continue;
    seen.add(p.id);
    const day = by.get(dateOf(p.createdAt));
    if (!day) continue;
    if (p.fees.length) {
      day.fees += paymentFeeCents(p, sign);
      day.n++;
      day.volume += p.totalCents;
    } else if (p.status === "COMPLETED" && p.totalCents > 0 && !NO_FEE_SOURCES.has(p.sourceType ?? "")) {
      day.pending++;
    }
  }
  const seenR = new Set<string>();
  for (const r of refunds) {
    if (seenR.has(r.id) || DEAD.has(r.status) || !r.fees.length) continue;
    seenR.add(r.id);
    const day = by.get(dateOf(r.createdAt));
    if (day) day.back += refundFeeReturnedCents(r, sign);
  }
  return dates.map((date) => {
    const d = by.get(date)!;
    return { date, cardFees: d.fees / 100, feesReturned: d.back / 100, feePayments: d.n, feePending: d.pending, feeVolume: d.volume / 100 };
  });
}

/** Net card fees: charged minus given back. */
export const netFees = (d: { cardFees: number; feesReturned: number }) => d.cardFees - d.feesReturned;

// ---- Comps & discounts from orders ------------------------------------------------------------

export interface SquareDiscountDef {
  uid?: string;
  name?: string;
  type?: string;
  percentage?: string;
  scope?: string;
}

export interface SquareAppliedDiscount {
  discount_uid?: string;
  applied_money?: SquareMoney;
}

export type DiscountLineInput = SquareLine & { applied_discounts?: SquareAppliedDiscount[] };

export interface DiscountOrder {
  id: string;
  discounts?: SquareDiscountDef[];
  line_items?: DiscountLineInput[];
  returns?: { return_discounts?: SquareDiscountDef[]; return_line_items?: DiscountLineInput[] }[];
}

export interface DiscountLine {
  orderId: string;
  /** The discount's name as rung in Square ("Comp", "Staff meal", "Happy hour"…). */
  name: string;
  /** Square catalog id of the line (variation), "" for a custom amount. */
  squareId: string;
  itemName: string;
  /** Cents taken off; negative when a discounted item is returned. */
  cents: number;
  /** Units on the line (negative for returns). */
  qty: number;
  /** The line ended at $0 or less: given away whole. */
  full: boolean;
  /** "100" for a 100% discount, when Square says. */
  percentage: string | null;
}

export const UNNAMED_DISCOUNT = "Unnamed discount";
const cents = (m?: SquareMoney | null) => m?.amount ?? 0;
const itemLabel = (li: SquareLine) => [li.name || "Custom amount", li.variation_name && li.variation_name !== "Regular" ? li.variation_name : null].filter(Boolean).join(" · ");

/**
 * Every discount on every line of one order (and of its returns, negative),
 * one row per line × discount. A line whose `total_discount_money` is more
 * than its applied discounts add up to keeps the rest as an unnamed discount,
 * so the rows always add up to what Square took off. Gift card lines are
 * left out, as they are from sales.
 */
export function orderDiscountLines(order: DiscountOrder): DiscountLine[] {
  const out: DiscountLine[] = [];
  const add = (lines: DiscountLineInput[] | undefined, defs: SquareDiscountDef[] | undefined, sign: 1 | -1) => {
    const byUid = new Map((defs ?? []).filter((d) => d.uid).map((d) => [d.uid!, d]));
    for (const li of lines ?? []) {
      if (li.item_type === "GIFT_CARD") continue;
      const total = cents(li.total_discount_money);
      const applied = (li.applied_discounts ?? []).filter((a) => cents(a.applied_money) !== 0);
      if (total === 0 && applied.length === 0) continue;
      const qty = sign * (Number(li.quantity) || 0);
      const gross = cents(li.gross_sales_money ?? li.gross_return_money);
      const full = gross > 0 && lineNetCents(li) <= 0;
      const base = { orderId: order.id, squareId: li.catalog_object_id ?? "", itemName: itemLabel(li), qty, full };
      let sum = 0;
      for (const a of applied) {
        const d = a.discount_uid ? byUid.get(a.discount_uid) : undefined;
        const c = cents(a.applied_money);
        sum += c;
        out.push({ ...base, name: d?.name?.trim() || UNNAMED_DISCOUNT, cents: sign * c, percentage: d?.percentage ?? null });
      }
      if (total - sum > 0) out.push({ ...base, name: UNNAMED_DISCOUNT, cents: sign * (total - sum), percentage: null });
    }
  };
  add(order.line_items, order.discounts, 1);
  for (const r of order.returns ?? []) add(r.return_line_items, r.return_discounts, -1);
  return out;
}

// ---- What a discount is ---------------------------------------------------------------------

export type DiscountClass = "comp" | "waste" | "staff" | "promo";

export const DISCOUNT_CLASSES: { value: DiscountClass; label: string; hint: string }[] = [
  { value: "comp", label: "Comp", hint: "Given away to a guest: on the house, a manager comp, a sorry-for-the-wait." },
  { value: "waste", label: "Waste", hint: "Spills, remakes, wrong orders: made and not sold." },
  { value: "staff", label: "Staff meal", hint: "Staff food and shift drinks." },
  { value: "promo", label: "Promo", hint: "Discounts to sell more: happy hour, loyalty, coupons, industry night." },
];

export const discountClassLabel = (c: DiscountClass) => DISCOUNT_CLASSES.find((x) => x.value === c)?.label ?? c;

/** Lower-case, single-spaced: the key a discount name is mapped by. */
export const discountKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

const RULES: [RegExp, DiscountClass][] = [
  [/\b(spill|spilled|remake|re-make|waste|wasted|burn[t]?|dropped|wrong (order|item)|mistake|kitchen error|86)\b/, "waste"],
  [/\b(staff|employee|crew|shift (meal|drink|beer)|family meal|team meal|emp)\b/, "staff"],
  [/\b(comp|comped|comps|on the house|oth|manager|mgr|house|courtesy|guest recovery|sorry)\b/, "comp"],
];

/**
 * What a discount name counts as. A name set in Settings wins; otherwise the
 * name's words decide (spill/remake → waste, staff/employee → staff meal,
 * comp/manager/on the house → comp), then a 100% discount or a line given
 * away whole counts as a comp, and anything else is a promo.
 */
export function classifyDiscount(name: string, opts: { full?: boolean; percentage?: string | null } = {}, mapping: Record<string, DiscountClass> = {}): DiscountClass {
  const key = discountKey(name);
  const set = mapping[key];
  if (set && DISCOUNT_CLASSES.some((c) => c.value === set)) return set;
  for (const [re, cls] of RULES) if (re.test(key)) return cls;
  if (Number(opts.percentage) >= 100 || opts.full) return "comp";
  return "promo";
}

/** The class a name gets with no setting (for the "default" note in Settings). */
export const defaultDiscountClass = (name: string, opts: { full?: boolean; percentage?: string | null } = {}) => classifyDiscount(name, opts, {});

/** Keep only valid entries of a stored mapping. */
export function parseDiscountMapping(raw: unknown): Record<string, DiscountClass> {
  const out: Record<string, DiscountClass> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && DISCOUNT_CLASSES.some((c) => c.value === v)) out[discountKey(k)] = v as DiscountClass;
  }
  return out;
}

// ---- Rolling up stored rows -----------------------------------------------------------------

export interface StoredDiscount {
  date: ISODate;
  name: string;
  squareId: string;
  itemName: string;
  teamMemberId: string;
  /** Dollars (negative for returns). */
  amount: number;
  qty: number;
  full: boolean;
  percentage: string | null;
}

export interface DiscountGroup {
  key: string;
  label: string;
  amount: number;
  /** Units discounted (returns subtract). */
  qty: number;
  /** Lines (returns subtract). */
  lines: number;
}

export interface DiscountSummary {
  total: number;
  byClass: Record<DiscountClass, number>;
  byReason: (DiscountGroup & { cls: DiscountClass })[];
  byItem: (DiscountGroup & { squareId: string })[];
  /** By the team member who took the payment ("" = not known). */
  byStaff: DiscountGroup[];
  byDay: Map<ISODate, { total: number; byClass: Record<DiscountClass, number> }>;
}

export const emptyByClass = (): Record<DiscountClass, number> => ({ comp: 0, waste: 0, staff: 0, promo: 0 });

/**
 * Comps & discounts for a period: totals by class and by day, and the
 * biggest reasons, items and people, largest first. Rows for `ignored`
 * Square items (merch, gift cards…) are left out, as they are from net sales.
 */
export function summarizeDiscounts(rows: StoredDiscount[], mapping: Record<string, DiscountClass>, opts: { ignored?: Set<string>; staffName?: (id: string) => string } = {}): DiscountSummary {
  const byClass = emptyByClass();
  const byDay = new Map<ISODate, { total: number; byClass: Record<DiscountClass, number> }>();
  const reason = new Map<string, DiscountGroup & { cls: DiscountClass }>();
  const item = new Map<string, DiscountGroup & { squareId: string }>();
  const staff = new Map<string, DiscountGroup>();
  let total = 0;
  const bump = <G extends DiscountGroup>(m: Map<string, G>, key: string, make: () => G, r: StoredDiscount) => {
    const g = m.get(key) ?? make();
    g.amount += r.amount;
    g.qty += r.qty;
    g.lines += r.amount < 0 ? -1 : 1;
    m.set(key, g);
  };
  for (const r of rows) {
    if (r.squareId && opts.ignored?.has(r.squareId)) continue;
    const cls = classifyDiscount(r.name, r, mapping);
    total += r.amount;
    byClass[cls] += r.amount;
    const d = byDay.get(r.date) ?? { total: 0, byClass: emptyByClass() };
    d.total += r.amount;
    d.byClass[cls] += r.amount;
    byDay.set(r.date, d);
    const rk = discountKey(r.name);
    bump(reason, rk, () => ({ key: rk, label: r.name, cls, amount: 0, qty: 0, lines: 0 }), r);
    const ik = r.squareId || `name:${r.itemName}`;
    bump(item, ik, () => ({ key: ik, label: r.itemName, squareId: r.squareId, amount: 0, qty: 0, lines: 0 }), r);
    bump(staff, r.teamMemberId, () => ({ key: r.teamMemberId, label: r.teamMemberId ? (opts.staffName?.(r.teamMemberId) ?? "Unknown") : "Not recorded", amount: 0, qty: 0, lines: 0 }), r);
  }
  const big = <G extends DiscountGroup>(m: Map<string, G>) => [...m.values()].filter((g) => Math.abs(g.amount) >= 0.005).sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  return { total, byClass, byReason: big(reason), byItem: big(item), byStaff: big(staff), byDay };
}

/** The part of comps & discounts that is given away (comps, waste, staff meals), not promos. */
export const givenAway = (byClass: Record<DiscountClass, number>) => byClass.comp + byClass.waste + byClass.staff;
