/**
 * Calendar-date helpers. Business dates are plain "YYYY-MM-DD" strings so
 * there's never any timezone drift between the browser, server and database.
 */

export type ISODate = string; // YYYY-MM-DD

export const toISODate = (d: Date): ISODate => d.toISOString().slice(0, 10);

export const parseISODate = (s: ISODate): Date => new Date(`${s}T00:00:00.000Z`);

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISODate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export const weekday = (date: ISODate): number => parseISODate(date).getUTCDay();

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/** Inclusive start, exclusive end. */
export function dateRange(from: ISODate, toExclusive: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's date in the business's timezone. */
export function todayIn(timeZone: string, now = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Next date on/after `from` whose weekday is in `days` (0=Sun). */
export function nextWeekdayOnOrAfter(from: ISODate, days: readonly number[]): ISODate | null {
  if (days.length === 0) return null;
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (days.includes(weekday(d))) return d;
  }
  return null;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** UTC instant at which local midnight of `date` occurs in `timeZone`. */
export function zonedMidnightUTC(date: ISODate, timeZone: string): Date {
  // Guess UTC midnight, then correct by the zone's offset at that instant (twice, for DST edges).
  let t = parseISODate(date).getTime();
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const offset = asUTC - t;
    t = parseISODate(date).getTime() - offset;
  }
  return new Date(t);
}

/** Local business date of an instant. */
export const businessDate = (instant: Date | string, timeZone: string): ISODate => todayIn(timeZone, new Date(instant));
