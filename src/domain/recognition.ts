/**
 * Recognition: shout-outs tied to the house values, milestones worked out
 * from data we already have (start date, timecards vs the schedule, training)
 * and an optional points balance. Pure; see services/recognition.ts.
 */

import { addDays, daysBetween, type ISODate } from "./dates";

export interface RecognitionConfig {
  values: string[];
  /** Staff can thank each other (managers can hide one). */
  peerShoutouts: boolean;
  /** Shout-outs carry points that can be swapped for rewards. */
  pointsEnabled: boolean;
  /** Points a manager's shout-out adds (peers add half, rounded down, at least 1). */
  managerPoints: number;
}

export const DEFAULT_RECOGNITION: RecognitionConfig = {
  values: ["Guests first", "Got your back", "Craft & care", "Own it"],
  peerShoutouts: true,
  pointsEnabled: false,
  managerPoints: 10,
};

export function parseRecognition(raw: string | null | undefined): RecognitionConfig {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<RecognitionConfig>) : {};
    const values = Array.isArray(v.values) ? v.values.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 8) : DEFAULT_RECOGNITION.values;
    return {
      values: values.length ? values : DEFAULT_RECOGNITION.values,
      peerShoutouts: typeof v.peerShoutouts === "boolean" ? v.peerShoutouts : DEFAULT_RECOGNITION.peerShoutouts,
      pointsEnabled: typeof v.pointsEnabled === "boolean" ? v.pointsEnabled : DEFAULT_RECOGNITION.pointsEnabled,
      managerPoints: Number.isInteger(v.managerPoints) && v.managerPoints! >= 0 && v.managerPoints! <= 1000 ? v.managerPoints! : DEFAULT_RECOGNITION.managerPoints,
    };
  } catch {
    return { ...DEFAULT_RECOGNITION, values: [...DEFAULT_RECOGNITION.values] };
  }
}

/** Points a shout-out adds: none when points are off; peers give half a manager's. */
export function shoutoutPoints(cfg: RecognitionConfig, fromManager: boolean): number {
  if (!cfg.pointsEnabled) return 0;
  return fromManager ? cfg.managerPoints : Math.max(1, Math.floor(cfg.managerPoints / 2));
}

/** Earned minus spent (pending redemptions hold their points so they can't be spent twice). */
export function pointsBalance(earned: { points: number; hidden?: boolean }[], redemptions: { points: number; status: string }[]): number {
  const got = earned.filter((e) => !e.hidden).reduce((a, e) => a + e.points, 0);
  const spent = redemptions.filter((r) => r.status !== "DENIED").reduce((a, r) => a + r.points, 0);
  return got - spent;
}

// ---- Milestones -------------------------------------------------------------------

export type MilestoneKind = "anniversary" | "first-month" | "perfect-attendance" | "training";

export interface Milestone {
  employeeId: string;
  name: string;
  kind: MilestoneKind;
  title: string;
  /** The day it happened (or happens, for an anniversary this week). */
  date: ISODate;
}

export interface MilestonePerson {
  id: string;
  name: string;
  /** Start date (or the day they were added). */
  start: ISODate;
}

/** Work anniversaries and "one month in" landing in [from, to]. */
export function dateMilestones(people: MilestonePerson[], from: ISODate, to: ISODate): Milestone[] {
  const out: Milestone[] = [];
  for (const p of people) {
    const month = addMonthsClamped(p.start, 1);
    if (month >= from && month <= to) out.push({ employeeId: p.id, name: p.name, kind: "first-month", title: `${first(p.name)}'s first month`, date: month });
    const startYear = Number(p.start.slice(0, 4));
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const years = y - startYear;
      if (years < 1) continue;
      const d = `${y}${p.start.slice(4)}`;
      const day = p.start.slice(5) === "02-29" && !isLeap(y) ? `${y}-02-28` : d;
      if (day >= from && day <= to) out.push({ employeeId: p.id, name: p.name, kind: "anniversary", title: `${first(p.name)}: ${years} year${years === 1 ? "" : "s"} with us`, date: day });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface AttendanceShift {
  employeeId: string;
  date: ISODate;
  /** Epoch ms. */
  start: number;
}

export interface AttendanceCard {
  employeeId: string;
  clockIn: number;
}

/**
 * Perfect attendance over a window: at least `minShifts` scheduled shifts, and
 * every one has a clock-in no later than `graceMin` after its start (and no
 * earlier than 3 hours before it, so a different shift doesn't count).
 */
export function perfectAttendance(shifts: AttendanceShift[], cards: AttendanceCard[], opts: { graceMin?: number; minShifts?: number } = {}): Set<string> {
  const grace = (opts.graceMin ?? 7) * 60_000;
  const min = opts.minShifts ?? 8;
  const byEmp = new Map<string, AttendanceShift[]>();
  for (const s of shifts) byEmp.set(s.employeeId, [...(byEmp.get(s.employeeId) ?? []), s]);
  const cardsBy = new Map<string, number[]>();
  for (const c of cards) cardsBy.set(c.employeeId, [...(cardsBy.get(c.employeeId) ?? []), c.clockIn]);
  const out = new Set<string>();
  for (const [id, list] of byEmp) {
    if (list.length < min) continue;
    const ins = cardsBy.get(id) ?? [];
    if (list.every((s) => ins.some((t) => t <= s.start + grace && t >= s.start - 3 * 3_600_000))) out.add(id);
  }
  return out;
}

/** A plain line for each training checklist someone finished in [from, to]. */
export function trainingMilestones(done: { employeeId: string; name: string; module: string; date: ISODate }[], from: ISODate, to: ISODate): Milestone[] {
  return done.filter((d) => d.date >= from && d.date <= to).map((d) => ({ employeeId: d.employeeId, name: d.name, kind: "training" as const, title: `${first(d.name)} finished ${d.module}`, date: d.date }));
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function addMonthsClamped(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** How long someone has been here, in words ("3 weeks", "1 year"). */
export function tenure(start: ISODate, today: ISODate): string {
  const days = daysBetween(start, today);
  if (days < 14) return `${Math.max(0, days)} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  if (days < 365) return `${Math.floor(days / 30.44)} months`;
  const y = Math.floor(days / 365.25);
  return `${y} year${y === 1 ? "" : "s"}`;
}

export { addDays };
