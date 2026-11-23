/**
 * The coming week against a usual one, said plainly for the top of the Sales
 * page: busier, quieter or about the same, why, and what to do about it. And
 * the shade each calendar day takes against a usual day of its weekday.
 * Pure: plain data in, plain words out.
 */

import { weekday, type ISODate } from "./dates";

export interface OutlookDay {
  date: ISODate;
  /** What the forecast says (0 when closed). */
  forecast: number;
  /** A usual day of this weekday, before holidays, events, weather and your changes. */
  usual: number;
  closed: boolean;
  /** What makes the day different, in a few words ("Thanksgiving", "Bus tour"); null on an ordinary day. */
  why: string | null;
}

export interface WeekOutlook {
  total: number;
  usual: number;
  /** Total ÷ usual − 1; null with no usual week to compare with. */
  change: number | null;
  direction: "busier" | "quieter" | "usual" | null;
  headline: string;
  line: string;
  action: string;
  busiest: OutlookDay | null;
}

/** Within this of a usual week reads as a usual week. */
export const USUAL_BAND = 0.08;
/** A day this far off its usual, with a reason, gets named. */
const DAY_SWING = 0.15;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;
const dollars = (n: number) => `$${(Math.round(n / 10) * 10).toLocaleString("en-US")}`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const dayName = (d: ISODate) => DAY_NAMES[weekday(d)];

export function weekOutlook(days: readonly OutlookDay[]): WeekOutlook {
  const total = days.reduce((s, d) => s + (d.closed ? 0 : d.forecast), 0);
  const usual = days.reduce((s, d) => s + d.usual, 0);
  const change = usual > 0 ? total / usual - 1 : null;
  const direction = change == null ? null : change >= USUAL_BAND ? "busier" : change <= -USUAL_BAND ? "quieter" : "usual";
  const open = days.filter((d) => !d.closed && d.forecast > 0);
  const busiest = open.length ? open.reduce((a, b) => (b.forecast > a.forecast ? b : a)) : null;

  // The days that make the difference: closed when usually open, or well off their usual, for a reason.
  const notes: string[] = [];
  for (const d of days) {
    if (!d.why) continue;
    if (d.closed && d.usual > 0) notes.push(`closed ${dayName(d.date)} for ${d.why}`);
    else if (d.usual > 0 && Math.abs(d.forecast / d.usual - 1) >= DAY_SWING) {
      const m = pct(d.forecast / d.usual - 1);
      notes.push(d.forecast > d.usual ? `${d.why} lifts ${dayName(d.date)} by about ${m}` : `${d.why} takes about ${m} off ${dayName(d.date)}`);
    }
  }
  const why = notes.length ? ` ${capital(list(notes.slice(0, 3)))}.` : "";

  const headline =
    direction === "busier"
      ? `The coming week looks ${pct(change!)} busier than usual`
      : direction === "quieter"
        ? `The coming week looks ${pct(change!)} quieter than usual`
        : direction === "usual"
          ? "The coming week looks like a usual one"
          : "Here's how the coming week looks";
  const line = `About ${dollars(total)} forecast over the next ${days.length} days${usual > 0 ? `, against ${dollars(usual)} in a usual week` : ""}.${why}`;
  const peak = busiest ? `${dayName(busiest.date)} is the big day at about ${dollars(busiest.forecast)}` : null;
  const action =
    direction === "busier"
      ? `Order and staff up for it${peak ? `: ${peak}` : ""}.`
      : direction === "quieter"
        ? `Trim orders and hours to match${peak ? `; ${peak}` : ""}.`
        : `Order and staff as usual${peak ? `; ${peak}` : ""}.`;
  return { total, usual, change, direction, headline, line, action, busiest };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- Calendar shading -------------------------------------------------------------------------

/**
 * Five steps against a usual day of that weekday, lightest the quietest: under
 * 80%, under 95%, about usual (to 110%), up to 130%, and beyond. Null when
 * there's no usual day to compare with or nothing to shade (closed).
 */
export const TINT_STEPS = [0.8, 0.95, 1.1, 1.3] as const;
export const TINT_LABELS = ["Well under a usual day", "A little under", "About usual", "Busier", "Much busier"] as const;

export function tintStep(value: number | null, usual: number | null): 0 | 1 | 2 | 3 | 4 | null {
  if (value == null || usual == null || usual <= 0 || value <= 0) return null;
  const r = value / usual;
  const i = TINT_STEPS.findIndex((t) => r < t);
  return (i === -1 ? 4 : i) as 0 | 1 | 2 | 3 | 4;
}

/** A usual day per weekday (0 = Sunday), from the days that have one. */
export function usualByWeekday(days: readonly { date: ISODate; usual: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const d of days) if (d.usual > 0 && !out.has(weekday(d.date))) out.set(weekday(d.date), d.usual);
  return out;
}
