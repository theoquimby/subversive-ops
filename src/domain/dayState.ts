/**
 * Is a day's money in? A day with no sales is not a closed day. It's closed
 * only when the place was shut (a closure on the calendar, or a weekday the
 * opening hours skip), or when Square has synced past it and found nothing.
 * Otherwise its sales simply haven't arrived yet, and every figure built on it
 * (a change, a profit, a "Closed" label) waits. Pure: the server builds the
 * context (src/server/services/dayState.ts).
 */

import { addDays, businessDate, type ISODate } from "./dates";

export type DayState = "in" | "closed" | "notIn" | "today" | "future";

export interface DayStateContext {
  today: ISODate;
  /** The last business day Square has fully synced; null when it never has. */
  syncedThrough: ISODate | null;
  /** Does the place open on this date (the opening hours in force)? Missing: assume it does. */
  isOpenDay?: (date: ISODate) => boolean;
  /** Days marked closed on the calendar. */
  closures?: readonly ISODate[] | ReadonlySet<ISODate>;
}

/** The word to print in place of a number, for the states that aren't plain numbers. */
export const DAY_STATE_WORD: Record<DayState, string> = { in: "", closed: "Closed", notIn: "Not in yet", today: "Today so far", future: "Ahead" };

export function dayState(d: { date: ISODate; sales: number }, ctx: DayStateContext): DayState {
  if (d.date > ctx.today) return "future";
  if (d.date === ctx.today) return "today";
  if (Math.abs(d.sales) >= 0.005) return "in";
  const closures = ctx.closures;
  if (closures && (closures instanceof Set ? closures.has(d.date) : (closures as readonly ISODate[]).includes(d.date))) return "closed";
  if (ctx.isOpenDay && !ctx.isOpenDay(d.date)) return "closed";
  if (ctx.syncedThrough && d.date <= ctx.syncedThrough) return "closed";
  return "notIn";
}

/**
 * The last business day whose sales are complete, from the last Square sync.
 * A sync that ran before ~3am hasn't seen the end of the night before, so that
 * day is left out. Never later than yesterday.
 */
export function syncedThroughDate(today: ISODate, lastSync: Date | string | null, timeZone: string): ISODate | null {
  if (!lastSync) return null;
  const synced = businessDate(new Date(new Date(lastSync).getTime() - 3 * 3_600_000), timeZone);
  const through = addDays(synced, -1);
  const yesterday = addDays(today, -1);
  return through < yesterday ? through : yesterday;
}

/** The change from `base` to `value`, only when both days are in (and the base isn't zero). */
export function changeIfIn(value: number, state: DayState, base: number, baseState: DayState): number | null {
  if (state !== "in" || baseState !== "in" || Math.abs(base) < 0.005) return null;
  return value / base - 1;
}

export function countStates(states: readonly DayState[]): Record<DayState, number> {
  const out: Record<DayState, number> = { in: 0, closed: 0, notIn: 0, today: 0, future: 0 };
  for (const s of states) out[s]++;
  return out;
}
