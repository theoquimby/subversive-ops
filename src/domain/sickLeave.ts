/**
 * New York paid sick leave (Labor Law §196-b), simplified:
 *
 *  - Accrues 1 hour per `sickHoursWorkedPerHour` (30) hours worked.
 *  - Accrual and use are capped at `sickAnnualCapHours` per calendar year
 *    (40h for 5–99 employees; 56h for 100+).
 *  - Used by approved time-off requests of type SICK.
 *
 * Balances are worked out per calendar year from timecards; unused hours
 * carrying over into the next year are not tracked yet. Pure.
 */

import { addDays, daysBetween, ISODate } from "./dates";
import type { LaborRules } from "./labor";

export interface SickBalance {
  workedHours: number;
  accrued: number;
  used: number;
  /** What they can still take this year. */
  available: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hours accrued from hours worked this year, capped. */
export function sickAccrued(workedHours: number, rules: Pick<LaborRules, "sickHoursWorkedPerHour" | "sickAnnualCapHours">): number {
  const per = rules.sickHoursWorkedPerHour > 0 ? rules.sickHoursWorkedPerHour : 30;
  return Math.min(rules.sickAnnualCapHours, Math.floor((Math.max(0, workedHours) / per) * 100) / 100);
}

export function sickBalance(workedHours: number, usedHours: number, rules: Pick<LaborRules, "sickHoursWorkedPerHour" | "sickAnnualCapHours">): SickBalance {
  const accrued = sickAccrued(workedHours, rules);
  const used = r2(Math.max(0, usedHours));
  return { workedHours: r2(workedHours), accrued, used, available: r2(Math.max(0, Math.min(accrued - used, rules.sickAnnualCapHours - used))) };
}

export interface LeaveRequest {
  startDate: ISODate;
  endDate: ISODate;
  /** Explicit paid hours, or null to use scheduled hours. */
  hours: number | null;
}

/**
 * Paid hours of a leave request: the hours given, else the requester's
 * scheduled hours on those days (`scheduled(date)`), else 0.
 */
export function leaveHours(r: LeaveRequest, scheduled: (date: ISODate) => number): number {
  if (r.hours != null) return r2(r.hours);
  let h = 0;
  for (let d = r.startDate; d <= r.endDate; d = addDays(d, 1)) h += scheduled(d);
  return r2(h);
}

/** The part of a request's hours that falls in [from, to], prorated by days. */
export function leaveHoursIn(r: { startDate: ISODate; endDate: ISODate; hours: number }, from: ISODate, to: ISODate): number {
  const s = r.startDate > from ? r.startDate : from;
  const e = r.endDate < to ? r.endDate : to;
  if (e < s) return 0;
  const total = daysBetween(r.startDate, r.endDate) + 1;
  return r2((r.hours * (daysBetween(s, e) + 1)) / total);
}
