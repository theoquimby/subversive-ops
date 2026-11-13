/**
 * Scheduling helpers: workweeks, local wall-clock times, availability, the
 * staffing requirement for a day and a cost/coverage summary of a schedule.
 *
 * Times inside a day are "minutes after local midnight" (960 = 4:00 pm). A
 * shift that runs past midnight keeps counting (1500 = 1:00 am next day).
 */

import { addDays, dateRange, ISODate, parseISODate, toISODate, weekday } from "./dates";
import { LaborRules, payForWeek, PositionRule, ruleOn, staffingCurve } from "./labor";

// ---- Weeks ----------------------------------------------------------------------

/** Monday of the workweek containing `date` (weeks run Mon–Sun). */
export function weekStartOf(date: ISODate): ISODate {
  const wd = weekday(date); // 0 = Sun
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export const weekDates = (monday: ISODate): ISODate[] => dateRange(monday, addDays(monday, 7));

/** Every date from `start` to `end`, both inclusive. */
export const inclusiveDates = (start: ISODate, end: ISODate): ISODate[] => (end < start ? [] : dateRange(start, addDays(end, 1)));

// ---- Wall-clock times ---------------------------------------------------------------

/** "16:30" → 990. Returns null for anything that isn't a valid HH:MM (24:00 allowed). */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** 990 → "4:30 pm"; 1500 → "1:00 am". */
export function formatMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Compact chip label: 960 → "4p", 990 → "4:30p", 720 → "12p". */
export function shortTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

export const shiftLabel = (startMin: number, endMin: number) => `${shortTime(startMin)}–${shortTime(endMin)}`;

/** Options for a time picker, every `step` minutes from `from` to `to` inclusive. */
export function timeOptions(from = 5 * 60, to = 26 * 60, step = 15): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = from; m <= to; m += step) out.push({ value: String(m), label: `${formatMinutes(m)}${m >= 1440 ? " (next day)" : ""}` });
  return out;
}

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function zoneParts(instant: Date, timeZone: string) {
  let f = partsFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsFmt.set(timeZone, f);
  }
  const parts = f.formatToParts(instant);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** The instant at which local wall-clock `minutes` after midnight of `date` occurs in `timeZone`. */
export function zonedInstant(date: ISODate, minutes: number, timeZone: string): Date {
  const wall = parseISODate(date).getTime() + minutes * 60_000;
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(new Date(t), timeZone);
    const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    t = wall - (asUTC - t);
  }
  return new Date(t);
}

/** Local date and minutes-after-midnight of an instant. */
export function localParts(instant: Date, timeZone: string): { date: ISODate; minutes: number } {
  const p = zoneParts(instant, timeZone);
  return { date: toISODate(new Date(Date.UTC(p.y, p.mo - 1, p.d))), minutes: p.h * 60 + p.mi };
}

// ---- Availability ---------------------------------------------------------------------

export type Availability = Record<number, [number, number][]>; // weekday → [startHour, endHour) windows

/**
 * Employee.availability JSON ({ "5": [["16:00","22:00"]] }) → hour windows.
 * Returns undefined when nothing is set (= always available). A day that is
 * missing from a non-empty object means unavailable that day.
 */
export function parseAvailability(json: unknown): Availability | undefined {
  if (!json || typeof json !== "object" || Array.isArray(json)) return undefined;
  const out: Availability = {};
  let any = false;
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    const wd = Number(k);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6 || !Array.isArray(v)) continue;
    const windows: [number, number][] = [];
    for (const w of v) {
      if (!Array.isArray(w) || w.length !== 2) continue;
      const s = parseHHMM(String(w[0]));
      let e = parseHHMM(String(w[1]));
      if (s == null || e == null) continue;
      if (e <= s) e += 1440; // runs past midnight
      windows.push([s / 60, e / 60]);
    }
    any = true;
    out[wd] = windows;
  }
  return any ? out : undefined;
}

/** Limit windows so they end by `latestHour` (used for minors). Undefined availability becomes all-day up to the limit. */
export function clipAvailability(a: Availability | undefined, latestHour: number): Availability {
  const out: Availability = {};
  for (let wd = 0; wd < 7; wd++) {
    const windows = a ? a[wd] ?? [] : [[0, 24] as [number, number]];
    out[wd] = windows.map(([s, e]) => [s, Math.min(e, latestHour)] as [number, number]).filter(([s, e]) => e > s);
  }
  return out;
}

/** Human summary of a weekday's windows: "4p–10p", "Off", "Any time". */
export function availabilityLabel(a: Availability | undefined, wd: number): string {
  if (!a) return "Any time";
  const w = a[wd] ?? [];
  if (w.length === 0) return "Off";
  return w.map(([s, e]) => shiftLabel(Math.round(s * 60), Math.round(e * 60))).join(", ");
}

// ---- Staffing requirement ------------------------------------------------------------

/**
 * Slider position (0 = lean, 100 = generous) → staffingCurve intensity
 * (> 1 runs leaner). 50 is the configured staffing ratio.
 */
export const intensityFromSlider = (v: number) => Number((1.3 - (0.6 * Math.max(0, Math.min(100, v))) / 100).toFixed(3));

/** Inverse of intensityFromSlider (rounded to a whole slider step). */
export const sliderFromIntensity = (i: number) => Math.max(0, Math.min(100, Math.round(((1.3 - i) / 0.6) * 100)));

/**
 * The most generous slider position (0–100) whose plan stays at or under the
 * labor % target. `laborPctAt(slider)` builds the plan and returns its labor %
 * (null when there are no sales). Labor % falls as the slider moves lean, so
 * this is a binary search. Returns `{ slider: 0, reachable: false }` when even
 * the leanest plan is over target.
 */
export function fitSliderToTarget(laborPctAt: (slider: number) => number | null, target: number): { slider: number; reachable: boolean } {
  const ok = (v: number) => {
    const p = laborPctAt(v);
    return p == null || p <= target + 1e-9;
  };
  if (!ok(0)) return { slider: 0, reachable: false };
  if (ok(100)) return { slider: 100, reachable: true };
  let lo = 0; // ok
  let hi = 100; // not ok
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return { slider: lo, reachable: true };
}

/** Hours the building needs staff: an hour before opening to set up, an hour after closing to close down. */
export function staffedHours(open: [number, number] | undefined, padHours = 1): boolean[] {
  return Array.from({ length: 24 }, (_, h) => !!open && h >= Math.max(0, open[0] - padHours) && h < Math.min(24, open[1] + padHours));
}

/**
 * Hourly sales for a day. If there is no hourly history yet (all zeros) but a
 * daily forecast exists, spread it across opening hours, weighted towards the
 * evening peak, so the curve still reflects how busy the day is.
 */
export function hourlySalesOrFallback(hours: number[], dailyTotal: number, open: [number, number] | undefined): number[] {
  const sum = hours.reduce((a, b) => a + b, 0);
  if (sum > 0 || !open || dailyTotal <= 0) return hours.slice(0, 24);
  const [o, c] = open;
  const peak = Math.max(o, c - 3);
  const weights = Array.from({ length: 24 }, (_, h) => (h >= o && h < c ? 1 / (1 + Math.abs(h + 0.5 - (peak + 0.5)) * 0.35) : 0));
  const wsum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (wsum ? (w / wsum) * dailyTotal : 0));
}

/** People needed per hour for each position on one day. */
export function dayRequirement(hourlySales: number[], positions: PositionRule[], open: [number, number] | undefined, intensity = 1): Map<string, number[]> {
  const openHours = staffedHours(open);
  return new Map(positions.map((p) => [p.id, staffingCurve(hourlySales, p, openHours, intensity)]));
}

export const curveHours = (curve: number[]) => curve.reduce((a, b) => a + b, 0);

/** People on shift for each hour of a day (a shift counts for every hour it touches). */
export function coverage(shifts: { startMin: number; endMin: number }[]): number[] {
  const out = new Array(24).fill(0);
  for (const s of shifts) for (let h = 0; h < 24; h++) if (s.startMin < (h + 1) * 60 && s.endMin > h * 60) out[h]++;
  return out;
}

export interface Conflict {
  shiftId: string;
  employeeId: string;
  level: "block" | "warn";
  rule: string;
  message: string;
}

/** Shifts on approved time off (block) or outside someone's availability (warn). */
export function availabilityConflicts(
  shifts: { id: string; employeeId: string | null; date: ISODate; startMin: number; endMin: number }[],
  people: Map<string, { name: string; availability?: Availability; timeOff: Set<ISODate> }>,
): Conflict[] {
  const out: Conflict[] = [];
  for (const s of shifts) {
    if (!s.employeeId) continue;
    const p = people.get(s.employeeId);
    if (!p) continue;
    if (p.timeOff.has(s.date)) {
      out.push({ shiftId: s.id, employeeId: s.employeeId, level: "block", rule: "time-off", message: `${p.name} has approved time off` });
      continue;
    }
    if (p.availability) {
      const w = p.availability[weekday(s.date)] ?? [];
      if (!w.some(([a, b]) => a * 60 <= s.startMin && b * 60 >= s.endMin)) {
        out.push({ shiftId: s.id, employeeId: s.employeeId, level: "warn", rule: "availability", message: `Outside ${p.name}'s availability (${availabilityLabel(p.availability, weekday(s.date))})` });
      }
    }
  }
  return out;
}

// ---- Summary ----------------------------------------------------------------------

export interface ScheduledShift {
  employeeId: string | null;
  positionId: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  breakMinutes: number;
  rate: number | null;
}

export const shiftPaidHours = (s: { startMin: number; endMin: number; breakMinutes: number }) => Math.max(0, (s.endMin - s.startMin - s.breakMinutes) / 60);

export interface DaySummary {
  date: ISODate;
  sales: number;
  hours: number;
  requiredHours: number;
  cost: number;
  laborPct: number | null;
}

export interface ScheduleSummary {
  days: DaySummary[];
  hours: number;
  requiredHours: number;
  wages: number;
  cost: number;
  sales: number;
  laborPct: number | null;
  overtimeHours: number;
  /** Paid-but-unworked hours from short shifts topped up to the call-in minimum. */
  callInHours: number;
  openShifts: number;
  openHours: number;
  missingRates: number;
}

/**
 * Hours, labor cost (wages incl. overtime, spread-of-hours and call-in pay for
 * short shifts, plus employer burden) and labor % for a week of shifts. Open
 * shifts count toward hours and are costed at the position's rate if one is
 * given, but not toward OT.
 */
export function summarizeSchedule(
  shifts: ScheduledShift[],
  dates: ISODate[],
  forecast: Map<ISODate, number>,
  required: Map<ISODate, number>,
  rules: LaborRules,
): ScheduleSummary {
  const at = (s: ScheduledShift, m: number) => new Date(parseISODate(s.date).getTime() + m * 60_000);
  const assigned = shifts.filter((s) => s.employeeId);
  const pay = payForWeek(
    assigned.map((s) => ({ employeeId: s.employeeId!, start: at(s, s.startMin), end: at(s, s.endMin), breakMinutes: s.breakMinutes, rate: s.rate })),
    rules,
    toISODate,
    { callIn: true },
  );
  const open = shifts.filter((s) => !s.employeeId);
  const callIn = ruleOn(rules, "call-in");
  const openCallIn = (s: ScheduledShift) => {
    const h = shiftPaidHours(s);
    return callIn && h > 0 && h < rules.callInMinHours ? rules.callInMinHours - h : 0;
  };
  const openWages = open.reduce((a, s) => a + shiftPaidHours(s) * (s.rate ?? 0) + openCallIn(s) * rules.minimumWage, 0);
  const wages = pay.reduce((a, p) => a + p.wages, 0) + openWages;
  const base = shifts.reduce((a, s) => a + shiftPaidHours(s) * (s.rate ?? 0), 0);
  const scale = base > 0 ? wages / base : 1; // spreads OT/spread premiums across days pro rata
  const burden = 1 + rules.employerBurdenPct;
  const days: DaySummary[] = dates.map((date) => {
    const list = shifts.filter((s) => s.date === date);
    const hours = list.reduce((a, s) => a + shiftPaidHours(s), 0);
    const cost = list.reduce((a, s) => a + shiftPaidHours(s) * (s.rate ?? 0), 0) * scale * burden;
    const sales = forecast.get(date) ?? 0;
    return { date, sales, hours, requiredHours: required.get(date) ?? 0, cost, laborPct: sales > 0 ? cost / sales : null };
  });
  const sales = days.reduce((a, d) => a + d.sales, 0);
  const cost = wages * burden;
  return {
    days,
    hours: days.reduce((a, d) => a + d.hours, 0),
    requiredHours: days.reduce((a, d) => a + d.requiredHours, 0),
    wages,
    cost,
    sales,
    laborPct: sales > 0 ? cost / sales : null,
    overtimeHours: pay.reduce((a, p) => a + p.overtimeHours, 0),
    callInHours: pay.reduce((a, p) => a + p.callInHours, 0) + open.reduce((a, s) => a + openCallIn(s), 0),
    openShifts: open.length,
    openHours: open.reduce((a, s) => a + shiftPaidHours(s), 0),
    missingRates: shifts.filter((s) => s.employeeId && s.rate == null).length,
  };
}

/**
 * Split blocks longer than `maxHours` into back-to-back shifts (a handover in
 * the middle) so nobody is planned for an 11-hour day; each piece stays ≥ `minHours`.
 */
export function splitLongBlocks<T extends { startHour: number; endHour: number }>(blocks: T[], maxHours = 8, minHours = 4): T[] {
  const out: T[] = [];
  for (const b of blocks) {
    const len = b.endHour - b.startHour;
    const parts = len > maxHours ? Math.min(Math.ceil(len / maxHours), Math.floor(len / minHours)) : 1;
    if (parts <= 1) {
      out.push(b);
      continue;
    }
    let s = b.startHour;
    for (let i = 0; i < parts; i++) {
      const e = i === parts - 1 ? b.endHour : s + Math.round((b.endHour - s) / (parts - i));
      out.push({ ...b, startHour: s, endHour: e });
      s = e;
    }
  }
  return out;
}

// ---- Hourly staffing vs demand ------------------------------------------------------

export interface HourDemand {
  hour: number;
  need: number;
  have: number;
}

/**
 * People needed vs scheduled for each hour of one day, summed over positions,
 * trimmed to the hours where anything happens.
 */
export function staffVsDemand(need: number[][], shifts: { startMin: number; endMin: number }[]): HourDemand[] {
  const totalNeed = new Array(24).fill(0);
  for (const curve of need) curve.forEach((n, h) => (totalNeed[h] += n));
  const have = coverage(shifts);
  const rows = totalNeed.map((n, h) => ({ hour: h, need: n, have: have[h] }));
  const first = rows.findIndex((r) => r.need > 0 || r.have > 0);
  if (first < 0) return [];
  let last = rows.length - 1;
  while (last > first && rows[last].need === 0 && rows[last].have === 0) last--;
  return rows.slice(first, last + 1);
}

// ---- Time-off coverage ------------------------------------------------------------

export interface DayCoverage {
  date: ISODate;
  /** Other people with approved time off that day. */
  off: string[];
  /** Other people asking for that day off (pending). */
  asking: string[];
  scheduledHours: number;
  neededHours: number;
  /** Paid hours of the requester's own shifts that day (lost if opened up). */
  theirHours: number;
}

/**
 * "Short" when scheduled hours minus what the requester would drop fall under
 * 90% of what's needed. A day with nothing scheduled yet isn't short: it
 * hasn't been built.
 */
export const coverageShort = (d: DayCoverage) => d.scheduledHours > 0 && d.neededHours > 0 && d.scheduledHours - d.theirHours < d.neededHours * 0.9;
