/**
 * Typing and copying shifts: typed start and end times ("4p", "close",
 * "1a" after an evening start), copying one week onto another without
 * doubling it, and the times a person usually works. Pure, no I/O.
 *
 * Times are minutes after local midnight; past midnight keeps counting
 * (1500 = 1:00 am the next day), as in ./schedule.
 */

import { addDays, ISODate } from "./dates";
import { parseClock } from "./timecards";

const DAY = 24 * 60;
const MAX_SHIFT = 16 * 60;

/**
 * A typed shift time in minutes. "open" and "close" use the day's hours.
 * With `after` (the start, when reading an end), an end that would come
 * before the start is read forward: a bare "10" becomes 10pm, and "1a" or
 * "midnight" run into the next day, as long as the shift stays under 16
 * hours. Returns null when it isn't a time.
 */
export function parseShiftTime(raw: string, opts: { openMin?: number | null; closeMin?: number | null; after?: number } = {}): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (["close", "closing", "cl"].includes(s)) return opts.closeMin ?? null;
  if (["open", "opening", "op"].includes(s)) return opts.openMin ?? null;
  const v = parseClock(s);
  if (v == null) return null;
  const after = opts.after;
  if (after == null || v > after) return v;
  const marked = /[ap]/.test(s.replace(/midnight|noon/, ""));
  const tries = [...(!marked && v < 12 * 60 ? [v + 12 * 60] : []), v + DAY];
  return tries.find((t) => t > after && t - after <= MAX_SHIFT) ?? v;
}

interface ShiftKey {
  employeeId: string | null;
  positionId: string;
  date: ISODate;
  startMin: number;
}

const keyOf = (s: ShiftKey) => `${s.employeeId ?? `open:${s.positionId}`}|${s.date}|${s.startMin}`;

/**
 * Which shifts to create when copying `source` forward by `days`. A shift
 * already in the target (same person, day and start; for open shifts, same
 * position) is skipped, one for one, so running the copy twice adds nothing.
 */
export function planWeekCopy<T extends ShiftKey>(source: T[], existing: ShiftKey[], days: number): { create: T[]; skipped: number } {
  const have = new Map<string, number>();
  for (const e of existing) have.set(keyOf(e), (have.get(keyOf(e)) ?? 0) + 1);
  const create: T[] = [];
  let skipped = 0;
  for (const s of source) {
    const moved = { ...s, date: addDays(s.date, days) };
    const k = keyOf(moved);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      skipped++;
    } else create.push(moved);
  }
  return { create, skipped };
}

export interface ShiftDefaults {
  positionId: string;
  startMin: number;
  endMin: number;
  breakMinutes: number;
}

/** Each person's latest shift: what a new shift for them starts from. */
export function lastShiftDefaults(shifts: (ShiftKey & { endMin: number; breakMinutes: number })[]): Record<string, ShiftDefaults> {
  const best = new Map<string, ShiftKey & { endMin: number; breakMinutes: number }>();
  for (const s of shifts) {
    if (!s.employeeId) continue;
    const b = best.get(s.employeeId);
    if (!b || s.date > b.date || (s.date === b.date && s.startMin > b.startMin)) best.set(s.employeeId, s);
  }
  return Object.fromEntries([...best].map(([id, s]) => [id, { positionId: s.positionId, startMin: s.startMin, endMin: s.endMin, breakMinutes: s.breakMinutes }]));
}
