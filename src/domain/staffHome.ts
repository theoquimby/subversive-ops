/**
 * Staff home ("Today"): the small, pure bits behind the glanceable view —
 * the next-shift countdown, the greeting, which quick actions come first,
 * and how the to-do list is ordered. No I/O; see src/server/services/staffHome.ts.
 */

import { addDays, type ISODate } from "./dates";

export type CountdownState = "upcoming" | "soon" | "now" | "over";

export interface Countdown {
  state: CountdownState;
  /** Big, glanceable: "2h 15m", "45 min", "On now". */
  big: string;
  /** The line under it: "until your shift", "left on shift". */
  small: string;
}

const MIN = 60_000;

/** "2h 15m", "45 min", "3 days" — rounded so the number doesn't flicker. */
export function durationLabel(ms: number): string {
  const mins = Math.max(0, Math.ceil(ms / MIN));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** Where now sits against a shift: before (and how long), during (and how much left) or over. */
export function shiftCountdown(now: number, start: number, end: number): Countdown {
  if (now >= end) return { state: "over", big: "Done", small: "shift's over" };
  if (now >= start) return { state: "now", big: "On now", small: `${durationLabel(end - now)} left` };
  const until = start - now;
  return { state: until <= 90 * MIN ? "soon" : "upcoming", big: durationLabel(until), small: "until you start" };
}

/** "Today", "Tomorrow", or the weekday within the week ("Friday"), else null (caller shows the date). */
export function relativeDay(date: ISODate, today: ISODate): string | null {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date > today && date < addDays(today, 7)) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  }
  return null;
}

export function greeting(hour: number): string {
  if (hour < 5) return "Late one";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export type QuickAction = "scan" | "prep" | "waste" | "count" | "note" | "taps";

const KITCHEN = /cook|chef|prep|dish|kitchen|expo|line/i;
const BAR = /bar|tender|beer|cellar|brew/i;

/**
 * Quick actions, most likely first for this person: the kitchen gets prep and
 * waste up front, the bar gets the keg scanner and the tap list, the floor
 * gets the shift note. Always the same six, so muscle memory still works.
 */
export function quickActionOrder(positions: string[]): QuickAction[] {
  const kitchen = positions.some((p) => KITCHEN.test(p));
  const bar = positions.some((p) => BAR.test(p));
  if (kitchen && !bar) return ["prep", "waste", "count", "note", "scan", "taps"];
  if (bar && !kitchen) return ["scan", "taps", "count", "waste", "note", "prep"];
  if (bar && kitchen) return ["scan", "prep", "waste", "count", "note", "taps"];
  return ["note", "scan", "waste", "count", "prep", "taps"];
}

export type TodoKind = "sign" | "cert" | "training" | "swap" | "open";

export interface Todo {
  kind: TodoKind;
  title: string;
  detail: string;
  href: string;
  /** bad = overdue/expired, warn = due soon, neutral = an offer. */
  tone: "bad" | "warn" | "neutral";
}

const TONE_RANK = { bad: 0, warn: 1, neutral: 2 } as const;
const KIND_RANK: Record<TodoKind, number> = { cert: 0, sign: 1, training: 2, swap: 3, open: 4 };

/** Most urgent first; within a tone, what's required before what's optional. */
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

/** First name for the greeting ("Ava Abbott" → "Ava"). */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
