/**
 * Timecard helpers: wall-clock times in the business timezone, typed time
 * entry ("4p", "16:30"), availability windows, and spreading labor cost
 * across the hours of a day. Pure — no I/O.
 */

import { ISODate, parseISODate } from "./dates";

const MIN = 60_000;
const HOUR = 3_600_000;

// ---- Wall-clock time ↔ instants ---------------------------------------------

function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant;
}

/** The instant at which the wall clock in `timeZone` reads `date` + `minutes` past midnight. */
export function zonedTime(date: ISODate, minutes: number, timeZone: string): Date {
  const wall = parseISODate(date).getTime() + minutes * MIN;
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - offsetAt(t, timeZone);
  return new Date(t);
}

/** Minutes past local midnight for an instant (0–1439). */
export function localMinutes(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return get("hour") * 60 + get("minute");
}

// ---- Typed clock times --------------------------------------------------------

/**
 * Parse a typed time into minutes past midnight: "16:30", "1630", "4:30pm",
 * "4p", "noon". A bare hour from 1 to 6 means afternoon (nobody here starts at
 * 5am; "5" means 5pm). Returns null if it isn't a time.
 */
export function parseClock(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
  if (!s) return null;
  if (s === "noon") return 12 * 60;
  if (s === "midnight") return 24 * 60;
  const m = /^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  const ap = m[3]?.[0];
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "p" && h !== 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
  } else if (!m[2] && h >= 1 && h <= 6) {
    h += 12;
  }
  if (h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export const formatClock = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** "4:30 PM"-style label for display. */
export function clockLabel(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

// ---- Availability --------------------------------------------------------------

/** weekday ("0"=Sun … "6"=Sat) → windows [["16:00","22:00"]]. Missing day = unavailable. */
export type Availability = Record<string, [string, string][]>;

/**
 * Parse one day's availability as typed: "4p-10p, 11-2", "all day", or empty
 * for unavailable. Windows are merged and sorted. Returns { error } if a part
 * can't be read.
 */
export function parseWindows(raw: string): [string, string][] | { error: string } {
  const s = raw.trim().toLowerCase();
  if (!s || s === "-" || s === "off" || s === "no" || s === "none") return [];
  if (["all day", "allday", "any", "anytime", "open"].includes(s)) return [["00:00", "24:00"]];
  const out: [number, number][] = [];
  for (const part of s.split(/[,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const [a, b, ...rest] = part.split(/\s*(?:-|–|to)\s*/);
    if (!a || !b || rest.length) return { error: `"${part}" — use a range like 4p-10p` };
    let start = parseClock(a);
    let end = parseClock(b);
    if (start == null || end == null) return { error: `"${part}" isn't a time range` };
    // "11-2": a bare morning start followed by an afternoon end.
    if (end <= start && !/[ap]/.test(b) && end + 12 * 60 > start && end + 12 * 60 <= 24 * 60) end += 12 * 60;
    // "6-10am": the bare "6" was read as 6pm; it must be morning.
    if (end <= start && start >= 12 * 60 && !/[ap]/.test(a) && start - 12 * 60 < end) start -= 12 * 60;
    if (end <= start) return { error: `"${part}" ends before it starts` };
    out.push([start, end]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const w of out) {
    const last = merged.at(-1);
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged.map(([a, b]) => [formatClock(a), b === 24 * 60 ? "24:00" : formatClock(b)]);
}

export function formatWindows(windows: [string, string][] | undefined): string {
  if (!windows || windows.length === 0) return "";
  if (windows.length === 1 && windows[0][0] === "00:00" && windows[0][1] === "24:00") return "All day";
  const t = (hhmm: string) => (hhmm === "24:00" ? "midnight" : clockLabel(toMinutes(hhmm)));
  return windows.map(([a, b]) => `${t(a)}–${t(b)}`).join(", ");
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

// ---- Labor cost ----------------------------------------------------------------

export interface CostBlock {
  start: Date;
  /** null = still clocked in; treated as ending at `now`. */
  end: Date | null;
  breakMinutes: number;
  rate: number | null;
}

/** Paid hours of a block, counting an open block up to `now`. Breaks never push it below zero. */
export function blockHours(b: CostBlock, now: Date): number {
  const end = b.end ?? (now > b.start ? now : b.start);
  const span = (end.getTime() - b.start.getTime()) / HOUR;
  // An open shift's break may not have been taken yet; only subtract what fits.
  return Math.max(0, span - Math.min(b.breakMinutes / 60, b.end ? Infinity : span / 2));
}

/** Labor cost of a block: paid hours × rate × (1 + employer burden). Missing rate costs 0. */
export const blockCost = (b: CostBlock, burdenPct: number, now: Date) => blockHours(b, now) * (b.rate ?? 0) * (1 + burdenPct);

/**
 * Hours and cost per hour-slot of a day, starting at `dayStart` (local
 * midnight). Breaks are spread evenly over the block, so an hour that is
 * half-covered by a 6h shift with a 30-min break counts 0.5 × (5.5 / 6) hours.
 */
export function laborByHour(blocks: CostBlock[], dayStart: Date, burdenPct: number, now: Date, slots = 24) {
  const hours = new Array<number>(slots).fill(0);
  const cost = new Array<number>(slots).fill(0);
  const t0 = dayStart.getTime();
  for (const b of blocks) {
    const end = b.end ?? (now > b.start ? now : b.start);
    const span = end.getTime() - b.start.getTime();
    if (span <= 0) continue;
    const paidFraction = blockHours(b, now) / (span / HOUR);
    for (let h = 0; h < slots; h++) {
      const s = Math.max(b.start.getTime(), t0 + h * HOUR);
      const e = Math.min(end.getTime(), t0 + (h + 1) * HOUR);
      if (e <= s) continue;
      const paid = ((e - s) / HOUR) * paidFraction;
      hours[h] += paid;
      cost[h] += paid * (b.rate ?? 0) * (1 + burdenPct);
    }
  }
  return { hours, cost };
}
