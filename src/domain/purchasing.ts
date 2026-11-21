/**
 * Small rules behind ordering, receiving and waste entry: steppers, typed
 * quantities, adding to a draft that already exists, short deliveries, the
 * recent-items list and the day waste is logged against.
 */

import { parseAmount } from "@/lib/amount";
import { todayIn, zonedMidnightUTC } from "./dates";

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Order quantities are stored with two decimals and up to eight digits before the point. */
const MAX_QTY = 99_999_999.99;

/** − / + on a quantity: one pack at a time, never below zero, part packs kept. */
export function stepQty(q: number, dir: 1 | -1, step = 1): number {
  return Math.max(0, round2((Number.isFinite(q) ? q : 0) + dir * step));
}

/** A typed quantity ("2", "1.5", "1 1/2", "½"). Blank is zero; null when it isn't a quantity. */
export function parseQty(raw: string): number | null {
  if (raw.trim() === "") return 0;
  const n = parseAmount(raw);
  if (n == null || n < 0 || n > MAX_QTY) return null;
  return round2(n);
}

export interface DraftLine {
  supplierProductId: string;
  qty: number;
  suggestedQty: number;
  unitPrice: number | null;
}

/**
 * Saving an order when a draft for the same supplier and delivery is already
 * there: add to that draft instead of making a second one. An item on both
 * takes the new quantity (the builder works out the whole need, so adding the
 * two would double it); new items are added; the draft's other lines stay.
 */
export function mergeIntoDraft(existing: (DraftLine & { id: string })[], incoming: DraftLine[]) {
  const byProduct = new Map(existing.map((l) => [l.supplierProductId, l]));
  const update: { id: string; qty: number; suggestedQty: number; unitPrice: number | null }[] = [];
  const create: DraftLine[] = [];
  for (const l of incoming) {
    if (!(l.qty > 0)) continue;
    const e = byProduct.get(l.supplierProductId);
    if (!e) { create.push(l); continue; }
    const unitPrice = l.unitPrice ?? e.unitPrice;
    if (e.qty === l.qty && e.suggestedQty === l.suggestedQty && e.unitPrice === unitPrice) continue;
    update.push({ id: e.id, qty: l.qty, suggestedQty: l.suggestedQty, unitPrice });
  }
  /** Lines of the draft left as they were. */
  return { update, create, kept: existing.length - update.length };
}

/** A received line against what was ordered: how many short or over (rounding dust ignored). */
export function receiptLine(ordered: number, received: number) {
  const d = round2(received - ordered);
  return { short: d < 0 ? -d : 0, over: d > 0 ? d : 0, changed: d !== 0 };
}

/** The last few items picked, newest first, no repeats. */
export function pushRecent(list: unknown, id: string, max = 6): string[] {
  const clean = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  return [id, ...clean.filter((x) => x !== id)].slice(0, max);
}

/**
 * When waste is logged against: now, or yesterday (the last minute of the
 * business day before, so stuff thrown out at close and logged next morning
 * lands on the right day, and before any count taken this morning).
 */
export function wasteStamp(when: "today" | "yesterday", now: Date, timeZone: string): Date {
  if (when === "today") return now;
  return new Date(zonedMidnightUTC(todayIn(timeZone, now), timeZone).getTime() - 60_000);
}
