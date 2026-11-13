/**
 * When to raise a manager alert — pure rules so they can be tested without a DB.
 * Services keep the "already sent" state in the Setting table and call these.
 */

import { addDays, ISODate } from "./dates";

// ---- Invoices ------------------------------------------------------------------------

export const INVOICE_ISSUE_STATUSES = ["PRICE_ISSUE", "QTY_ISSUE", "PRICE_AND_QTY"] as const;
export const isInvoiceIssue = (status: string) => (INVOICE_ISSUE_STATUSES as readonly string[]).includes(status);

/**
 * Alert when an invoice lands in an issue status we haven't already alerted for.
 * `lastAlerted` is the status of the last alert for this invoice (or null), so a
 * PRICE_ISSUE → QTY_ISSUE change alerts again but re-saving a line doesn't.
 */
export function invoiceAlertDue(lastAlerted: string | null, status: string): boolean {
  return isInvoiceIssue(status) && status !== lastAlerted;
}

// ---- Price spikes --------------------------------------------------------------------

export const DEFAULT_SPIKE_THRESHOLD = 0.08;

/** A threshold stored as a fraction ("0.08"); anything odd falls back to the default. */
export function parseSpikeThreshold(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) && n > 0 && n < 5 ? n : DEFAULT_SPIKE_THRESHOLD;
}

export interface PriceMoveLike {
  productId: string;
  changePct: number;
  date: ISODate;
}

export const spikeKey = (m: { productId: string; date: ISODate }) => `${m.productId}@${m.date}`;

/** Increases at or over the threshold that haven't been sent yet (one alert per product per price date). */
export function newSpikes<T extends PriceMoveLike>(moves: readonly T[], threshold: number, alreadySent: ReadonlySet<string>): T[] {
  return moves.filter((m) => m.changePct >= threshold - 1e-9 && !alreadySent.has(spikeKey(m)));
}

/** Parse the sent-keys list and drop entries older than `keepDays` so the Setting stays small. */
export function parseSentKeys(raw: string | null | undefined, today: ISODate, keepDays = 90): string[] {
  let v: unknown = [];
  try {
    v = raw ? JSON.parse(raw) : [];
  } catch {
    v = [];
  }
  const cutoff = addDays(today, -keepDays);
  return (Array.isArray(v) ? v : []).filter((k): k is string => typeof k === "string" && /@\d{4}-\d{2}-\d{2}$/.test(k) && k.slice(-10) >= cutoff);
}

// ---- Reviews ---------------------------------------------------------------------------

/** A review bad enough to tell a manager about straight away. */
export const isBadReview = (rating: number) => rating > 0 && rating <= 2;

export interface RatingTrend {
  /** Average stars over the window, or null with no reviews. */
  avg: number | null;
  count: number;
  /** Average over the window before it, for the trend arrow. */
  prevAvg: number | null;
  /** avg − prevAvg, or null when either side is empty. */
  delta: number | null;
}

/** Rating over the last `days` days (ending today) vs the `days` before. */
export function ratingTrend(reviews: readonly { rating: number; date: ISODate }[], today: ISODate, days = 30): RatingTrend {
  const start = addDays(today, -(days - 1));
  const prevStart = addDays(start, -days);
  const cur = reviews.filter((r) => r.date >= start && r.date <= today);
  const prev = reviews.filter((r) => r.date >= prevStart && r.date < start);
  const avg = (list: typeof cur) => (list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : null);
  const a = avg(cur);
  const p = avg(prev);
  return { avg: a, count: cur.length, prevAvg: p, delta: a != null && p != null ? a - p : null };
}
