/**
 * How often to count an item, worked out from its count history: something
 * that's been the same on every count can come off the sheet ("only when it
 * changes"), and something worth very little on the shelf only needs a
 * monthly count. Only suggests — a manager confirms. Pure.
 */

import { daysBetween, type ISODate } from "./dates";

export const COUNT_EVERY_RULES = {
  /** Counts looked at (newest first). */
  lookbackDays: 180,
  /** Counts needed before suggesting anything. */
  minCounts: 4,
  /** "Same every time" needs this long a stretch, so two counts a day apart don't decide it. */
  minSpanDays: 21,
  /** Worth less than this on the shelf (at the last count) → monthly. */
  lowValue: 15,
} as const;

export interface CountHistoryPoint {
  date: ISODate;
  qty: number;
}

export type CountEverySuggestion = { every: "changes"; why: string } | { every: "monthly"; why: string };

export function suggestCountEvery(history: readonly CountHistoryPoint[], valuePerBase: number | null, today: ISODate): CountEverySuggestion | null {
  const recent = history.filter((h) => daysBetween(h.date, today) <= COUNT_EVERY_RULES.lookbackDays).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (recent.length < COUNT_EVERY_RULES.minCounts) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const same = recent.every((h) => Math.abs(h.qty - first.qty) < 1e-6);
  if (same && daysBetween(first.date, last.date) >= COUNT_EVERY_RULES.minSpanDays) {
    return { every: "changes", why: `The same on the last ${recent.length} counts` };
  }
  if (valuePerBase != null && valuePerBase > 0 && last.qty > 0) {
    const value = last.qty * valuePerBase;
    if (value < COUNT_EVERY_RULES.lowValue) return { every: "monthly", why: `Worth about $${Math.max(1, Math.round(value))} on the shelf` };
  }
  return null;
}
