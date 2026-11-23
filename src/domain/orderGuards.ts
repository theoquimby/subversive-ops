/**
 * Guard rails for placing an order, so anyone (staff included) can do it
 * safely: say why each line is suggested, and warn before sending an empty
 * order, a quantity far above the usual, or an order after the cutoff.
 * Warnings never block; they ask for a second look. Pure.
 */

import { WEEKDAYS, weekday, type ISODate } from "./dates";

/** More than this many times the usual quantity gets a warning. */
export const USUAL_FACTOR = 3;

/** The middle of recent ordered quantities (zeros ignored); null with no history. */
export function usualQty(history: readonly number[]): number | null {
  const xs = history.filter((x) => x > 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

export interface OrderWarning {
  kind: "empty" | "far-above" | "after-cutoff";
  text: string;
}

const n = (x: number) => String(Number(x.toFixed(2)));

export function orderWarnings(a: { lines: readonly { name: string; qty: number; usual: number | null; unit: string }[]; minsToCutoff: number | null }): OrderWarning[] {
  const out: OrderWarning[] = [];
  if (a.minsToCutoff != null && a.minsToCutoff <= 0) out.push({ kind: "after-cutoff", text: "The cutoff has passed. Call or text the supplier to check they can still take it." });
  const ordering = a.lines.filter((l) => l.qty > 0);
  if (ordering.length === 0) {
    out.push({ kind: "empty", text: "Nothing is on this order. Every quantity is zero." });
    return out;
  }
  for (const l of ordering) {
    if (l.usual != null && l.usual > 0 && l.qty > USUAL_FACTOR * l.usual) out.push({ kind: "far-above", text: `${l.name}: ${n(l.qty)} ${l.unit} is more than ${USUAL_FACTOR}× the usual ${n(l.usual)}. Double-check it.` });
  }
  return out;
}

/**
 * "On hand 3 case, 2.6 more needed through Fri": why a line is on the order, in the order's own unit.
 * `needBase` is the line's shortfall (what the period needs with its buffer, less what's left on
 * delivery day), the figure the order quantity is rounded up from, so the two never disagree.
 */
export function whyLine(a: { onHandBase: number; needBase: number; packQtyBase: number | null; unit: string; byDate: ISODate; known: boolean }): string {
  if (!a.known) return "Not counted yet, so on hand is unknown";
  if (!a.packQtyBase || a.packQtyBase <= 0) return "Pack size not set";
  const p = (x: number) => n(Math.max(0, x) / a.packQtyBase!);
  const day = WEEKDAYS[weekday(a.byDate)];
  return a.needBase > 0 ? `On hand ${p(a.onHandBase)} ${a.unit}, ${p(a.needBase)} more needed through ${day}` : `On hand ${p(a.onHandBase)} ${a.unit}, enough through ${day}`;
}
