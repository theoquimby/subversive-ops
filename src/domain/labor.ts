/**
 * Labor: pay calculation, compliance checks, schedule generation, tip pooling.
 *
 * Rules are data (LaborRules), pre-filled for New York and editable by the
 * operator. The app enforces whatever is configured; it does not certify that
 * the configuration matches current law.
 */

export interface LaborRules {
  weeklyOvertimeHours: number; // NY / FLSA: 40
  overtimeMultiplier: number; // 1.5
  minimumWage: number; // NY outside NYC/LI/Westchester
  spreadOfHours: number; // NY: workday spanning > 10h earns 1 extra hour at minimum wage
  callInMinHours: number; // NY call-in pay: min 4h (or the scheduled shift if shorter)
  minRestHours: number; // soft: flag "clopens"
  maxShiftHours: number; // soft
  minorMaxDailyHours: number; // NY minors 16–17 on non-school days: 8
  minorLatestHour: number; // NY minors 16–17 before a school day: 22 (10pm)
  employerBurdenPct: number; // payroll taxes etc., applied on top of wages for labor cost
}

export const NY_DEFAULT_RULES: LaborRules = {
  weeklyOvertimeHours: 40,
  overtimeMultiplier: 1.5,
  minimumWage: 16.0,
  spreadOfHours: 10,
  callInMinHours: 4,
  minRestHours: 10,
  maxShiftHours: 12,
  minorMaxDailyHours: 8,
  minorLatestHour: 22,
  employerBurdenPct: 0.12,
};

const H = 3_600_000;

export interface WorkBlock {
  employeeId: string;
  start: Date;
  end: Date;
  breakMinutes: number;
  rate: number | null;
}

export const paidHours = (b: { start: Date; end: Date; breakMinutes: number }) =>
  Math.max(0, (b.end.getTime() - b.start.getTime()) / H - b.breakMinutes / 60);

export interface PayLine {
  employeeId: string;
  regularHours: number;
  overtimeHours: number;
  spreadHours: number;
  wages: number;
  missingRate: boolean;
}

/**
 * Wages for one workweek of blocks (timecards or planned shifts).
 * Overtime is assigned to the hours past the weekly threshold in time order.
 */
export function payForWeek(blocks: WorkBlock[], rules: LaborRules, dayKey: (d: Date) => string): PayLine[] {
  const byEmp = new Map<string, WorkBlock[]>();
  for (const b of blocks) byEmp.set(b.employeeId, [...(byEmp.get(b.employeeId) ?? []), b]);
  const out: PayLine[] = [];
  for (const [employeeId, list] of byEmp) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
    let worked = 0;
    let regular = 0;
    let overtime = 0;
    let wages = 0;
    let missingRate = false;
    for (const b of list) {
      const h = paidHours(b);
      const rate = b.rate ?? 0;
      if (b.rate == null) missingRate = true;
      const reg = Math.max(0, Math.min(h, rules.weeklyOvertimeHours - worked));
      const ot = h - reg;
      worked += h;
      regular += reg;
      overtime += ot;
      wages += reg * rate + ot * rate * rules.overtimeMultiplier;
    }
    // Spread of hours: per calendar day, first start → last end.
    let spread = 0;
    const days = new Map<string, { first: number; last: number }>();
    for (const b of list) {
      const k = dayKey(b.start);
      const d = days.get(k) ?? { first: b.start.getTime(), last: b.end.getTime() };
      d.first = Math.min(d.first, b.start.getTime());
      d.last = Math.max(d.last, b.end.getTime());
      days.set(k, d);
    }
    for (const d of days.values()) if ((d.last - d.first) / H > rules.spreadOfHours) spread += 1;
    wages += spread * rules.minimumWage;
    out.push({ employeeId, regularHours: regular, overtimeHours: overtime, spreadHours: spread, wages, missingRate });
  }
  return out;
}

// ---- Compliance ----------------------------------------------------------------

export interface ShiftLike {
  id: string;
  employeeId: string | null;
  start: Date;
  end: Date;
  breakMinutes: number;
}

export interface EmployeeLike {
  id: string;
  name: string;
  isMinor: boolean;
  maxHoursWeek: number | null;
}

export interface Violation {
  shiftId: string;
  employeeId: string | null;
  level: "block" | "warn";
  rule: string;
  message: string;
}

export function checkCompliance(shifts: ShiftLike[], employees: EmployeeLike[], rules: LaborRules, localHour: (d: Date) => number): Violation[] {
  const v: Violation[] = [];
  const emp = new Map(employees.map((e) => [e.id, e]));
  const byEmp = new Map<string, ShiftLike[]>();
  for (const s of shifts) {
    if (s.end <= s.start) v.push({ shiftId: s.id, employeeId: s.employeeId, level: "block", rule: "times", message: "Shift ends before it starts" });
    const len = paidHours(s);
    if (len > 0 && len < rules.callInMinHours) v.push({ shiftId: s.id, employeeId: s.employeeId, level: "warn", rule: "call-in", message: `Under ${rules.callInMinHours}h — NY call-in pay may apply` });
    if (len > rules.maxShiftHours) v.push({ shiftId: s.id, employeeId: s.employeeId, level: "warn", rule: "long-shift", message: `Longer than ${rules.maxShiftHours}h` });
    if (s.employeeId) byEmp.set(s.employeeId, [...(byEmp.get(s.employeeId) ?? []), s]);
  }
  for (const [employeeId, list] of byEmp) {
    const e = emp.get(employeeId);
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
    let weekHours = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      weekHours += paidHours(s);
      const prev = list[i - 1];
      if (prev) {
        if (s.start < prev.end) v.push({ shiftId: s.id, employeeId, level: "block", rule: "overlap", message: `${e?.name ?? "Employee"} is double-booked` });
        else if ((s.start.getTime() - prev.end.getTime()) / H < rules.minRestHours) v.push({ shiftId: s.id, employeeId, level: "warn", rule: "rest", message: `Less than ${rules.minRestHours}h since last shift` });
      }
      if (e?.isMinor) {
        if (paidHours(s) > rules.minorMaxDailyHours) v.push({ shiftId: s.id, employeeId, level: "block", rule: "minor-hours", message: `Minor scheduled over ${rules.minorMaxDailyHours}h` });
        const endHour = localHour(s.end) + (s.end.getMinutes() > 0 ? s.end.getMinutes() / 60 : 0);
        if (endHour > rules.minorLatestHour || localHour(s.end) < 5) v.push({ shiftId: s.id, employeeId, level: "warn", rule: "minor-late", message: `Minor working past ${rules.minorLatestHour}:00 — check if it's a school night` });
      }
    }
    if (weekHours > rules.weeklyOvertimeHours) v.push({ shiftId: list[list.length - 1].id, employeeId, level: "warn", rule: "overtime", message: `${e?.name ?? "Employee"}: ${weekHours.toFixed(1)}h this week — overtime` });
    if (e?.maxHoursWeek && weekHours > e.maxHoursWeek) v.push({ shiftId: list[list.length - 1].id, employeeId, level: "warn", rule: "max-hours", message: `${e.name} is over their ${e.maxHoursWeek}h preference` });
  }
  return v;
}

// ---- Staffing & schedule generation --------------------------------------------

export interface PositionRule {
  id: string;
  name: string;
  salesPerHour: number | null; // one person per $X of forecast sales per hour
  minStaff: number;
  maxStaff: number;
}

/** People needed for each hour, from forecast sales per hour. `intensity` > 1 runs leaner. */
export function staffingCurve(hourlySales: number[], rule: PositionRule, openHours: boolean[], intensity = 1): number[] {
  return hourlySales.map((sales, h) => {
    if (!openHours[h]) return 0;
    const need = rule.salesPerHour && rule.salesPerHour > 0 ? Math.ceil(sales / (rule.salesPerHour * intensity) - 0.15) : 0;
    return Math.max(rule.minStaff, Math.min(rule.maxStaff, need));
  });
}

/**
 * Turn an hourly requirement curve into shift blocks: each "layer" of the
 * curve (1st person, 2nd person…) becomes contiguous blocks, stretched to the
 * minimum shift length so nobody is scheduled for a 2-hour call-in.
 */
export function curveToBlocks(curve: number[], minHours: number): { startHour: number; endHour: number }[] {
  const blocks: { startHour: number; endHour: number }[] = [];
  const max = Math.max(0, ...curve);
  const firstOpen = curve.findIndex((n) => n > 0);
  const lastOpen = curve.length - 1 - [...curve].reverse().findIndex((n) => n > 0);
  for (let level = 1; level <= max; level++) {
    let h = 0;
    while (h < curve.length) {
      if (curve[h] >= level) {
        let e = h;
        while (e < curve.length && curve[e] >= level) e++;
        let start = h;
        let end = e;
        // Stretch short blocks to the minimum, preferring to extend later, within open hours.
        while (end - start < minHours && (end <= lastOpen || start > firstOpen)) {
          if (end <= lastOpen) end++;
          else start--;
        }
        blocks.push({ startHour: start, endHour: end });
        h = e;
      } else h++;
    }
  }
  return blocks;
}

export interface Candidate {
  id: string;
  name: string;
  rate: number | null;
  positionIds: string[];
  isMinor: boolean;
  maxHoursWeek: number | null;
  /** weekday → [startHour, endHour) windows; undefined = no availability set (treated as always available) */
  availability?: Record<number, [number, number][]>;
}

export interface PlannedShift {
  positionId: string;
  employeeId: string | null;
  day: string; // YYYY-MM-DD
  startHour: number;
  endHour: number;
}

/**
 * Assign people to blocks: must hold the position, be available, not on time
 * off, not already working then, and under their weekly hours; prefer whoever
 * has the fewest hours so far (spreads shifts fairly), then the lower rate.
 * Unfillable blocks are kept with employeeId null ("open shift").
 */
export function assignShifts(
  blocks: { positionId: string; day: string; weekday: number; startHour: number; endHour: number }[],
  people: Candidate[],
  timeOff: { employeeId: string; day: string }[],
  existingHours: Map<string, number> = new Map(),
): PlannedShift[] {
  const hours = new Map(existingHours);
  const busy = new Map<string, { day: string; s: number; e: number }[]>();
  const off = new Set(timeOff.map((t) => `${t.employeeId}|${t.day}`));
  const out: PlannedShift[] = [];
  const sorted = [...blocks].sort((a, b) => a.day.localeCompare(b.day) || b.endHour - b.startHour - (a.endHour - a.startHour));
  for (const b of sorted) {
    const len = b.endHour - b.startHour;
    const fits = people.filter((p) => {
      if (!p.positionIds.includes(b.positionId)) return false;
      if (off.has(`${p.id}|${b.day}`)) return false;
      if (p.maxHoursWeek && (hours.get(p.id) ?? 0) + len > p.maxHoursWeek) return false;
      if ((busy.get(p.id) ?? []).some((x) => x.day === b.day && x.s < b.endHour && b.startHour < x.e)) return false;
      if (p.isMinor && len > 8) return false;
      if (p.availability) {
        const windows = p.availability[b.weekday] ?? [];
        if (!windows.some(([s, e]) => s <= b.startHour && e >= b.endHour)) return false;
      }
      return true;
    });
    fits.sort((x, y) => (hours.get(x.id) ?? 0) - (hours.get(y.id) ?? 0) || (x.rate ?? 99) - (y.rate ?? 99) || x.name.localeCompare(y.name));
    const pick = fits[0];
    if (pick) {
      hours.set(pick.id, (hours.get(pick.id) ?? 0) + len);
      busy.set(pick.id, [...(busy.get(pick.id) ?? []), { day: b.day, s: b.startHour, e: b.endHour }]);
    }
    out.push({ positionId: b.positionId, employeeId: pick?.id ?? null, day: b.day, startHour: b.startHour, endHour: b.endHour });
  }
  return out;
}

// ---- Tips --------------------------------------------------------------------

export interface TipShare {
  employeeId: string;
  hours: number;
  points: number; // position tip points
}

/** Split a pool by hours (method HOURS) or hours × position points (POINTS). Cents always add up. */
export function allocateTips(total: number, shares: TipShare[], method: "HOURS" | "POINTS") {
  const weights = shares.map((s) => (method === "HOURS" ? s.hours : s.hours * s.points));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return shares.map((s) => ({ ...s, weightedPoints: 0, amount: 0 }));
  const cents = Math.round(total * 100);
  const raw = weights.map((w) => (w / sum) * cents);
  const floored = raw.map(Math.floor);
  let left = cents - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (left <= 0) break;
    floored[o.i]++;
    left--;
  }
  return shares.map((s, i) => ({ ...s, weightedPoints: weights[i], amount: floored[i] / 100 }));
}
