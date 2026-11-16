/**
 * Upkeep: equipment and the jobs that come round every N days (draft lines,
 * hood cleaning, the fire system), plus the repair log. Pure: when a job is
 * next due, how urgent that is, and what repairs have cost. No I/O.
 */

import { addDays, daysBetween, ISODate } from "./dates";

export type DueState = "overdue" | "today" | "soon" | "ok" | "unknown";

/** "Soon" = due within this many days. */
export const SOON_DAYS = 7;

/** Next due date: last done + every N days. Null when it's never been logged. */
export const nextDue = (lastDoneOn: ISODate | null, everyDays: number): ISODate | null => (lastDoneOn ? addDays(lastDoneOn, Math.max(1, everyDays)) : null);

export function dueState(today: ISODate, due: ISODate | null): DueState {
  if (!due) return "unknown";
  if (due < today) return "overdue";
  if (due === today) return "today";
  return daysBetween(today, due) <= SOON_DAYS ? "soon" : "ok";
}

export const DUE_TONE: Record<DueState, "bad" | "warn" | "neutral" | "good"> = { overdue: "bad", today: "warn", soon: "neutral", ok: "good", unknown: "neutral" };

/** "3 days overdue", "Due today", "In 5 days", "Not logged yet". */
export function dueText(today: ISODate, due: ISODate | null): string {
  if (!due) return "Not logged yet";
  const d = daysBetween(today, due);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `In ${d} days`;
}

/** "Every 2 weeks", "Every 3 months", "Every year". */
export function everyText(days: number): string {
  if (days === 1) return "Every day";
  if (days === 7) return "Every week";
  if (days % 365 === 0) return days === 365 ? "Every year" : `Every ${days / 365} years`;
  if (days % 7 === 0 && days < 28) return `Every ${days / 7} weeks`;
  const months = Math.round(days / 30.4);
  if (months >= 1 && Math.abs(days - months * 30.4) <= 2) return months === 1 ? "Every month" : months === 12 ? "Every year" : `Every ${months} months`;
  if (days % 7 === 0) return `Every ${days / 7} weeks`;
  return `Every ${days} days`;
}

/**
 * Read an interval typed by hand: "14", "2 weeks", "quarterly", "6 months",
 * "yearly". Null when it doesn't make sense.
 */
export function parseEvery(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/^every\s+/, "");
  if (!s) return null;
  const named: Record<string, number> = { daily: 1, day: 1, weekly: 7, week: 7, fortnightly: 14, biweekly: 14, monthly: 30, month: 30, quarterly: 91, quarter: 91, "twice a year": 182, "semi-annually": 182, semiannually: 182, yearly: 365, annually: 365, year: 365 };
  if (named[s]) return named[s];
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(d|days?|w|wks?|weeks?|m|mos?|months?|y|yrs?|years?)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "d")[0];
  const days = Math.round(unit === "w" ? n * 7 : unit === "m" ? n * 30.4 : unit === "y" ? n * 365 : n);
  return days >= 1 && days <= 3650 ? days : null;
}

export interface TaskLike { id: string; lastDoneOn: ISODate | null; everyDays: number; active: boolean }

/** Active jobs with their due date and state, most urgent first (never-logged last). */
export function rankTasks<T extends TaskLike>(tasks: T[], today: ISODate): (T & { due: ISODate | null; state: DueState })[] {
  const order: Record<DueState, number> = { overdue: 0, today: 1, soon: 2, ok: 3, unknown: 4 };
  return tasks
    .filter((t) => t.active)
    .map((t) => {
      const due = nextDue(t.lastDoneOn, t.everyDays);
      return { ...t, due, state: dueState(today, due) };
    })
    .sort((a, b) => order[a.state] - order[b.state] || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}

export interface CostLog { date: ISODate; kind: string; cost: number | null; equipmentId: string | null }

/** What repairs and service visits cost since a date, total and per piece of equipment. */
export function spendSince(logs: CostLog[], since: ISODate): { total: number; byEquipment: Map<string, number> } {
  const byEquipment = new Map<string, number>();
  let total = 0;
  for (const l of logs) {
    if (l.date < since || l.cost == null || l.kind === "note") continue;
    total += l.cost;
    if (l.equipmentId) byEquipment.set(l.equipmentId, (byEquipment.get(l.equipmentId) ?? 0) + l.cost);
  }
  return { total, byEquipment };
}

/** Warranty: still covered, running out within 60 days, or over. */
export function warrantyState(today: ISODate, until: ISODate | null): "none" | "covered" | "ending" | "over" {
  if (!until) return "none";
  if (until < today) return "over";
  return daysBetween(today, until) <= 60 ? "ending" : "covered";
}

// ---- Presets: a brewery taproom with a kitchen ------------------------------------------

export interface PresetTask { title: string; everyDays: number; staffCanDo?: boolean; howTo?: string }
export interface PresetEquipment { name: string; area: string; tasks: PresetTask[] }

/**
 * Typical intervals, not legal advice: the Brewers Association draught quality
 * manual (lines every 2 weeks, acid every 3 months), NFPA 96 / 17A for the hood
 * and its fire system (twice a year for moderate volume), annual extinguisher
 * and backflow tests. Max confirms them on the page.
 */
export const UPKEEP_PRESETS: PresetEquipment[] = [
  {
    name: "Draft system",
    area: "Bar",
    tasks: [
      { title: "Clean draft lines (caustic)", everyDays: 14, staffCanDo: true, howTo: "Recirculate line cleaner at the right strength for 15 minutes, rinse with water until pH is neutral." },
      { title: "Take apart and clean faucets and couplers", everyDays: 14, staffCanDo: true },
      { title: "Acid clean draft lines", everyDays: 91, howTo: "Removes beer stone. Same day as a caustic clean, after it." },
      { title: "Check gas lines and regulators for leaks", everyDays: 30, staffCanDo: true, howTo: "Soapy water on every fitting with the gas on; bubbles = leak." },
    ],
  },
  {
    name: "Glycol chiller",
    area: "Bar",
    tasks: [
      { title: "Check glycol level and strength", everyDays: 30 },
      { title: "Clean the condenser coil", everyDays: 91 },
    ],
  },
  {
    name: "Walk-in cooler",
    area: "Kitchen",
    tasks: [
      { title: "Clean condenser coil and check door gaskets", everyDays: 91 },
      { title: "Refrigeration service visit", everyDays: 365 },
    ],
  },
  {
    name: "Ice machine",
    area: "Bar",
    tasks: [{ title: "Clean and sanitize, change the water filter", everyDays: 182 }],
  },
  {
    name: "Kitchen hood",
    area: "Kitchen",
    tasks: [
      { title: "Professional hood and duct cleaning", everyDays: 182 },
      { title: "Fire suppression system inspection", everyDays: 182 },
    ],
  },
  {
    name: "Fryer",
    area: "Kitchen",
    tasks: [{ title: "Boil out", everyDays: 14, staffCanDo: true }],
  },
  {
    name: "Dish machine",
    area: "Kitchen",
    tasks: [{ title: "Delime", everyDays: 30, staffCanDo: true }],
  },
  {
    name: "Grease trap",
    area: "Kitchen",
    tasks: [{ title: "Pump out", everyDays: 91 }],
  },
  {
    name: "Building",
    area: "Building",
    tasks: [
      { title: "Fire extinguishers inspected and tagged", everyDays: 365 },
      { title: "Backflow preventer test", everyDays: 365 },
      { title: "Pest control visit", everyDays: 30 },
    ],
  },
];
