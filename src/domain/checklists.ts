/**
 * Shift checklists: opening, mid and closing routines that someone ticks off
 * on a phone and signs. Pure: which day a run belongs to, which lists and
 * items apply on a date, a run's state, and the history grid. No I/O.
 */

import { addDays, ISODate, weekday } from "./dates";

export type ChecklistShift = "open" | "mid" | "close";
export const SHIFTS: { value: ChecklistShift; label: string }[] = [
  { value: "open", label: "Opening" },
  { value: "mid", label: "Mid-shift" },
  { value: "close", label: "Closing" },
];
export const shiftLabel = (s: string) => SHIFTS.find((x) => x.value === s)?.label ?? "Closing";
export const asShift = (s: string): ChecklistShift => (s === "open" || s === "mid" ? s : "close");

/** A close finished before this hour (business time) still belongs to the day before. */
export const LATE_CLOSE_HOUR = 5;

/**
 * The business date a list being worked on right now covers. Closing after
 * midnight counts for the night it closes, so a 1am tick lands on yesterday.
 */
export function runDateFor(shift: string, today: ISODate, hour: number): ISODate {
  return asShift(shift) === "close" && hour < LATE_CLOSE_HOUR ? addDays(today, -1) : today;
}

/** Empty weekdays = every day. */
export const runsOn = (weekdays: readonly number[], date: ISODate) => weekdays.length === 0 || weekdays.includes(weekday(date));

export interface ItemLike { id: string; weekdays: number[]; active: boolean }

/** The items that apply on a date (active ones whose weekdays include it). */
export const itemsOn = <T extends ItemLike>(items: T[], date: ISODate): T[] => items.filter((i) => i.active && runsOn(i.weekdays, date));

export type RunState = "not-started" | "in-progress" | "ready" | "signed-off";

export function runState(done: number, total: number, signedOff: boolean): RunState {
  if (signedOff) return "signed-off";
  if (total > 0 && done >= total) return "ready";
  return done > 0 ? "in-progress" : "not-started";
}

export const RUN_LABEL: Record<RunState, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  "not-started": { label: "Not started", tone: "neutral" },
  "in-progress": { label: "In progress", tone: "warn" },
  ready: { label: "Ready to sign", tone: "warn" },
  "signed-off": { label: "Signed off", tone: "good" },
};

/** One cell of the history grid: how a list went on one day. */
export type DayMark = "signed" | "done" | "partial" | "missed" | "off";

export function dayMark(applies: boolean, done: number, total: number, signedOff: boolean): DayMark {
  if (!applies) return "off";
  if (signedOff) return "signed";
  if (total > 0 && done >= total) return "done";
  return done > 0 ? "partial" : "missed";
}

/**
 * Share of lists that were finished (every item ticked, signed or not) over
 * the days they applied. Null when nothing applied.
 */
export function completionRate(marks: DayMark[]): number | null {
  const counted = marks.filter((m) => m !== "off");
  if (!counted.length) return null;
  return counted.filter((m) => m === "signed" || m === "done").length / counted.length;
}

/** Which lists come first right now: the shift you're in, then the next, then the rest. */
export function shiftOrder(hour: number): ChecklistShift[] {
  if (hour < LATE_CLOSE_HOUR) return ["close", "open", "mid"];
  if (hour < 14) return ["open", "mid", "close"];
  if (hour < 18) return ["mid", "close", "open"];
  return ["close", "mid", "open"];
}

export interface LastNight {
  templateId: string;
  name: string;
  done: number;
  total: number;
  signedOff: boolean;
}

/**
 * Closing lists from last night that weren't finished — what the Overview and
 * the brief flag in the morning. A list nobody touched counts too: on a night
 * the place was open, an empty close is the one you most want to know about.
 */
export function unfinishedCloses(rows: LastNight[]): LastNight[] {
  return rows.filter((r) => r.total > 0 && !r.signedOff && r.done < r.total);
}

// ---- Presets: a starting point for a brewery taproom with a kitchen ---------------------

export interface PresetItem { title: string; detail?: string; href?: string; weekdays?: number[] }
export interface PresetList { name: string; shift: ChecklistShift; items: PresetItem[] }

export const CHECKLIST_PRESETS: PresetList[] = [
  {
    name: "Opening — bar",
    shift: "open",
    items: [
      { title: "Lights, music and heat or AC on" },
      { title: "Check CO2 and gas blend tanks, regulators at the set pressure", detail: "Swap a tank under 300 psi before service." },
      { title: "Pull a sample from every tap and taste it", detail: "Foamy, flat or off? Tell a manager before you pour it for a guest." },
      { title: "Tap list matches what's pouring", href: "/kegs/taps" },
      { title: "Glassware, ice, napkins and garnishes stocked" },
      { title: "Count the drawer's starting bank" },
      { title: "Bar top, rails and tables wiped and sanitized" },
      { title: "Bathrooms checked: paper, soap, clean" },
      { title: "Read last night's shift note", href: "/notes" },
    ],
  },
  {
    name: "Opening — kitchen",
    shift: "open",
    items: [
      { title: "Hood fans on, equipment on and heating" },
      { title: "Check today's prep list", href: "/prep" },
      { title: "Sanitizer buckets set up at every station" },
      { title: "Fryer oil checked, topped up or changed" },
      { title: "Line stocked from the walk-in" },
      { title: "Deliveries checked in and put away" },
    ],
  },
  {
    name: "Closing — bar",
    shift: "close",
    items: [
      { title: "Kegs that kicked tonight scanned as kicked", href: "/kegs/scan" },
      { title: "Faucets, drip trays and the rinser cleaned" },
      { title: "Glass washer drained and cleaned" },
      { title: "Bar mats and floor drains washed" },
      { title: "Close out Square and count the drawer" },
      { title: "Log anything poured out or comped", href: "/waste" },
      { title: "Write the shift note: 86'd, comps, issues", href: "/notes" },
      { title: "Doors locked, lights off, alarm set" },
    ],
  },
  {
    name: "Closing — kitchen",
    shift: "close",
    items: [
      { title: "Everything wrapped, labeled and dated" },
      { title: "Log tonight's waste", href: "/waste" },
      { title: "Fryer oil filtered" },
      { title: "Flat-top, grill and range cleaned" },
      { title: "Hood filters cleaned", detail: "Through the dish machine or soaked.", weekdays: [0, 3] },
      { title: "Floors swept and mopped, mats out" },
      { title: "Walk-in door shut tight, gaskets clean" },
      { title: "Equipment off except the walk-in and lowboys" },
    ],
  },
];

// ---- Who's on: the people a list falls to ------------------------------------------------

export interface CrewShift { name: string; positionId: string; start: Date; end: Date }

/** Shifts starting (or ending) within this long of the first start (last end) count as opening (closing). */
const EDGE_MS = 90 * 60_000;

/**
 * The people on a day's schedule a list falls to: the openers (earliest
 * starts), the closers (latest ends) or everyone in between, limited to the
 * list's positions when it has any. Unassigned shifts are left out upstream.
 */
export function crewFor(shifts: CrewShift[], shift: string, positionIds: string[]): string[] {
  const mine = positionIds.length ? shifts.filter((s) => positionIds.includes(s.positionId)) : shifts;
  if (!mine.length) return [];
  const first = Math.min(...mine.map((s) => s.start.getTime()));
  const last = Math.max(...mine.map((s) => s.end.getTime()));
  const isOpen = (s: CrewShift) => s.start.getTime() - first <= EDGE_MS;
  const isClose = (s: CrewShift) => last - s.end.getTime() <= EDGE_MS;
  const pick = asShift(shift) === "open" ? mine.filter(isOpen) : asShift(shift) === "close" ? mine.filter(isClose) : mine.filter((s) => !isOpen(s) && !isClose(s));
  return [...new Set(pick.sort((a, b) => a.start.getTime() - b.start.getTime()).map((s) => s.name))];
}

// ---- Weekdays typed by hand ----------------------------------------------------------------

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sun, Wed" → [0, 3]; "weekends" → [0, 6]; blank / "every day" → []. Null when it can't read it. */
export function parseWeekdays(raw: string): number[] | null {
  const s = raw.trim().toLowerCase();
  if (!s || /^(every ?day|daily|all|any)$/.test(s)) return [];
  if (/^weekends?$/.test(s)) return [0, 6];
  if (/^weekdays?$/.test(s)) return [1, 2, 3, 4, 5];
  const out = new Set<number>();
  for (const part of s.split(/[\s,/&+]+|\band\b/).filter(Boolean)) {
    const i = DAY_NAMES.findIndex((d) => part.startsWith(d) || (part.length >= 2 && d.startsWith(part) && part !== "s" && part !== "t"));
    if (i < 0) return null;
    out.add(i);
  }
  const days = [...out].sort((a, b) => a - b);
  return days.length === 7 ? [] : days;
}

/** [0, 3] → "Sun, Wed"; [] → "" (every day). */
export const weekdaysText = (days: readonly number[]) => (days.length === 0 || days.length === 7 ? "" : [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(", "));

/** In-app pages a step can link to — only ones staff can open. */
export const LINKABLE_PAGES: { href: string; label: string }[] = [
  { href: "/kegs/scan", label: "Scan a keg" },
  { href: "/kegs/taps", label: "Tap list" },
  { href: "/kegs/cooler", label: "Walk-in kegs" },
  { href: "/notes", label: "Shift notes" },
  { href: "/prep", label: "Prep list" },
  { href: "/waste", label: "Log waste" },
  { href: "/count", label: "Counts" },
];
