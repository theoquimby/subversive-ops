/**
 * Opening hours: the regular week, plus simple seasonal hours (e.g. "Summer,
 * Jun 1 – Sep 7: open Tuesdays too"). Hours are whole hours, [open, close),
 * per weekday (0 = Sunday); a missing weekday is closed. Pure — the forecast,
 * the schedule and Insights read the result through getOpeningHours().
 */

import type { ISODate } from "./dates";

export type WeekHours = Record<number, [number, number]>;

export interface SeasonalHours {
  id: string;
  label: string;
  /** "MM-DD", inclusive. A season can wrap the new year (from "11-15" to "03-15"). */
  from: string;
  to: string;
  hours: WeekHours;
}

/** Monday first, the way a week reads on a schedule. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Subversive's taproom hours before anyone changed them: closed Tuesdays. */
export const DEFAULT_WEEK_HOURS: WeekHours = { 0: [12, 19], 1: [16, 20], 3: [16, 20], 4: [16, 20], 5: [16, 21], 6: [12, 21] };

/** 0 → "12am", 12 → "12pm", 16 → "4pm", 24 → "midnight". */
export function hourLabel(h: number): string {
  if (h === 24 || h === 0) return h === 24 ? "midnight" : "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/** "4–8pm", "12–9pm", "11am–2pm". */
export function rangeLabel([open, close]: [number, number]): string {
  const a = hourLabel(open);
  const b = hourLabel(close);
  const sameHalf = open >= 12 && close < 24;
  return `${sameHalf ? a.replace(/pm$/, "") : a}–${b}`;
}

/**
 * The week in one line, Monday first, days with the same hours run together:
 * "Mon 4–8pm · Tue closed · Wed–Thu 4–8pm · Fri 4–9pm · Sat 12–9pm · Sun 12–7pm".
 */
export function describeWeek(hours: WeekHours): string {
  const open = WEEK_ORDER.filter((d) => hours[d]);
  if (open.length === 0) return "Closed every day";
  const parts: string[] = [];
  let i = 0;
  while (i < WEEK_ORDER.length) {
    const d = WEEK_ORDER[i];
    const key = hours[d] ? hours[d].join("-") : "closed";
    let j = i;
    while (j + 1 < WEEK_ORDER.length && (hours[WEEK_ORDER[j + 1]] ? hours[WEEK_ORDER[j + 1]].join("-") : "closed") === key) j++;
    const days = i === j ? SHORT[d] : `${SHORT[d]}–${SHORT[WEEK_ORDER[j]]}`;
    parts.push(`${days} ${hours[d] ? rangeLabel(hours[d]) : "closed"}`);
    i = j + 1;
  }
  return parts.join(" · ");
}

/** Short form for an index line: "Open 6 days · closed Tue". */
export function summarizeWeek(hours: WeekHours): string {
  const closed = WEEK_ORDER.filter((d) => !hours[d]);
  const n = 7 - closed.length;
  if (n === 0) return "Closed every day";
  if (closed.length === 0) return "Open 7 days";
  return `Open ${n} day${n === 1 ? "" : "s"} · closed ${closed.map((d) => SHORT[d]).join(", ")}`;
}

/** A plain-English problem with a week of hours, or null when it's fine. */
export function weekProblem(hours: WeekHours): string | null {
  for (const [k, h] of Object.entries(hours)) {
    const d = Number(k);
    if (!Number.isInteger(d) || d < 0 || d > 6) return "Unknown day";
    if (!Array.isArray(h) || h.length !== 2 || !h.every((x) => Number.isInteger(x))) return `${DAY_NAMES[d]}: pick an opening and closing time`;
    const [open, close] = h;
    if (open < 0 || open > 23 || close < 1 || close > 24) return `${DAY_NAMES[d]}: hours must be within the day`;
    if (close <= open) return `${DAY_NAMES[d]} closes before it opens`;
  }
  return null;
}

/** Safe read of a stored week (bad data → null, so callers fall back to the default). */
export function parseWeek(raw: unknown): WeekHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: WeekHours = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v) || v.length !== 2) continue;
    out[Number(k)] = [Number(v[0]), Number(v[1])];
  }
  return weekProblem(out) ? null : out;
}

// ---- Seasons -----------------------------------------------------------------------

/** "06-01" is a real month-day (Feb 29 allowed). */
export function validMonthDay(md: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

/** "06-01" → "Jun 1". */
export const monthDayLabel = (md: string) => (validMonthDay(md) ? `${MONTHS[Number(md.slice(0, 2)) - 1]} ${Number(md.slice(3))}` : md);

/** Does the business date fall inside from..to (inclusive, wrapping the new year)? */
export function inSeason(date: ISODate, from: string, to: string): boolean {
  const md = date.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** The first season that covers the date, if any. */
export function seasonOn(date: ISODate, seasons: readonly SeasonalHours[]): SeasonalHours | null {
  return seasons.find((s) => validMonthDay(s.from) && validMonthDay(s.to) && inSeason(date, s.from, s.to)) ?? null;
}

/** The hours in force on a date: a season's when one covers it, otherwise the regular week. */
export function hoursOn(date: ISODate, regular: WeekHours, seasons: readonly SeasonalHours[]): WeekHours {
  return seasonOn(date, seasons)?.hours ?? regular;
}

export function seasonProblem(s: Pick<SeasonalHours, "label" | "from" | "to" | "hours">): string | null {
  if (!s.label.trim()) return "Give the season a name, like Summer";
  if (!validMonthDay(s.from)) return "Pick the day the season starts";
  if (!validMonthDay(s.to)) return "Pick the day the season ends";
  if (s.from === s.to) return "A season needs to last more than one day — use Events for a single day";
  return weekProblem(s.hours);
}

export function parseSeasons(raw: unknown): SeasonalHours[] {
  if (!Array.isArray(raw)) return [];
  const out: SeasonalHours[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const hours = parseWeek(o.hours);
    const s = { id: String(o.id ?? ""), label: String(o.label ?? ""), from: String(o.from ?? ""), to: String(o.to ?? ""), hours: hours ?? {} };
    if (s.id && hours && !seasonProblem(s)) out.push(s);
  }
  return out;
}
