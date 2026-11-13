/**
 * Payroll: pay periods, the pre-export exceptions list, tips from finalized
 * tip pools, one-off adjustments and the payroll-ready rows/CSV. Pure.
 *
 * Running payroll (tax filing, direct deposit) is out of scope; this produces
 * the approved file a payroll provider imports.
 */

import { addDays, daysBetween, ISODate } from "./dates";
import { LaborRules, paidHours, ruleOn } from "./labor";

// ---- Pay periods ----------------------------------------------------------------

export interface PeriodRange {
  start: ISODate;
  /** Inclusive. */
  end: ISODate;
}

const mondayOf = (date: ISODate): ISODate => {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, wd === 0 ? -6 : 1 - wd);
};

/** The pay period containing `date`: Mon–Sun, or two weeks counted from the anchor Monday. */
export function payPeriodFor(date: ISODate, rules: Pick<LaborRules, "payPeriod" | "payPeriodAnchor">): PeriodRange {
  const monday = mondayOf(date);
  if (rules.payPeriod !== "BIWEEKLY") return { start: monday, end: addDays(monday, 6) };
  const anchor = mondayOf(rules.payPeriodAnchor || monday);
  const weeks = Math.round(daysBetween(anchor, monday) / 7);
  const offset = ((weeks % 2) + 2) % 2;
  const start = addDays(monday, -7 * offset);
  return { start, end: addDays(start, 13) };
}

/** Mondays of the workweeks in a period (overtime is always per workweek). */
export function periodWeeks(p: PeriodRange): ISODate[] {
  const out: ISODate[] = [];
  for (let d = mondayOf(p.start); d <= p.end; d = addDays(d, 7)) out.push(d);
  return out;
}

export const periodDays = (p: PeriodRange) => daysBetween(p.start, p.end) + 1;

function overlapDays(a: PeriodRange, b: PeriodRange): number {
  const s = a.start > b.start ? a.start : b.start;
  const e = a.end < b.end ? a.end : b.end;
  return e < s ? 0 : daysBetween(s, e) + 1;
}

// ---- Tips ------------------------------------------------------------------------

export interface FinalizedTipPeriod extends PeriodRange {
  allocations: { employeeId: string; amount: number }[];
}

/**
 * Tips owed in a pay period from finalized tip pools. A pool that only partly
 * overlaps is prorated by days. `uncovered` lists the pay-period days no
 * finalized pool covers (so the export can say tips are incomplete).
 */
export function tipsForPeriod(pools: FinalizedTipPeriod[], period: PeriodRange): { byEmployee: Map<string, number>; uncovered: ISODate[]; prorated: boolean } {
  const byEmployee = new Map<string, number>();
  const covered = new Set<ISODate>();
  let prorated = false;
  for (const pool of pools) {
    const days = overlapDays(pool, period);
    if (days <= 0) continue;
    const total = daysBetween(pool.start, pool.end) + 1;
    if (days < total) prorated = true;
    for (let d = pool.start; d <= pool.end; d = addDays(d, 1)) if (d >= period.start && d <= period.end) covered.add(d);
    for (const a of pool.allocations) {
      const share = Math.round(a.amount * (days / total) * 100) / 100;
      byEmployee.set(a.employeeId, Math.round(((byEmployee.get(a.employeeId) ?? 0) + share) * 100) / 100);
    }
  }
  const uncovered: ISODate[] = [];
  for (let d = period.start; d <= period.end; d = addDays(d, 1)) if (!covered.has(d)) uncovered.push(d);
  return { byEmployee, uncovered, prorated };
}

// ---- Exceptions -------------------------------------------------------------------

export type ExceptionLevel = "block" | "warn" | "info";

export type ExceptionKind =
  | "missing-clock-out"
  | "missing-rate"
  | "below-min-wage"
  | "no-show"
  | "call-in"
  | "long-punch"
  | "meal-break"
  | "missing-square-id"
  | "tips-missing"
  | "unscheduled"
  | "overtime"
  | "spread";

export interface PayrollException {
  kind: ExceptionKind;
  level: ExceptionLevel;
  employeeId: string | null;
  name: string;
  date: ISODate | null;
  message: string;
  cardId?: string;
}

export interface ExceptionCard {
  id: string;
  employeeId: string;
  date: ISODate;
  clockIn: Date;
  clockOut: Date | null;
  breakMinutes: number;
  rate: number | null;
  tipped: boolean;
}

export interface ExceptionShift {
  id: string;
  employeeId: string;
  date: ISODate;
  start: Date;
  end: Date;
  breakMinutes: number;
  label: string; // "4p–10p"
}

export interface ExceptionInput {
  cards: ExceptionCard[];
  /** Published, assigned shifts in the period. */
  shifts: ExceptionShift[];
  people: Map<string, { name: string; squareTeamMemberId: string | null }>;
  lines: { employeeId: string; overtimeHours: number; spreadHours: number }[];
  rules: LaborRules;
  today: ISODate;
  now: Date;
  /** Only flag missing Square ids when Square is connected. */
  squareInUse: boolean;
  /** Pay-period days with no finalized tip pool (only flagged when tips exist at all). */
  tipsUncovered?: ISODate[];
}

const H = 3_600_000;
const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

/**
 * Call-in pay owed per timecard: someone who reports for a scheduled shift and
 * works less than min(call-in minimum, scheduled hours) is paid up to it at
 * minimum wage. Returns unworked hours owed, keyed by card id.
 */
export function callInOwed(cards: ExceptionCard[], shifts: ExceptionShift[], rules: LaborRules): Map<string, number> {
  const out = new Map<string, number>();
  if (!ruleOn(rules, "call-in")) return out;
  for (const c of cards) {
    if (!c.clockOut) continue;
    const s = shifts.find((x) => x.employeeId === c.employeeId && overlaps(c.clockIn, c.clockOut!, x.start, x.end));
    if (!s) continue;
    const worked = paidHours({ start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes });
    const owedTo = Math.min(rules.callInMinHours, paidHours(s));
    if (worked < owedTo - 0.01) out.set(c.id, Math.round((owedTo - worked) * 100) / 100);
  }
  return out;
}

const LEVEL_RANK: Record<ExceptionLevel, number> = { block: 0, warn: 1, info: 2 };
const KIND_RANK: ExceptionKind[] = ["missing-clock-out", "missing-rate", "below-min-wage", "no-show", "call-in", "long-punch", "meal-break", "missing-square-id", "tips-missing", "unscheduled", "overtime", "spread"];

/** Everything to look at before approving payroll, most urgent first. */
export function payrollExceptions(input: ExceptionInput): PayrollException[] {
  const { cards, shifts, people, rules, today, now } = input;
  const name = (id: string) => people.get(id)?.name ?? "Someone";
  const out: PayrollException[] = [];
  const hasSchedule = shifts.length > 0;

  for (const c of cards) {
    const n = name(c.employeeId);
    if (!c.clockOut) {
      if (c.date < today) out.push({ kind: "missing-clock-out", level: "block", employeeId: c.employeeId, name: n, date: c.date, cardId: c.id, message: "Never clocked out. Add the clock-out time." });
      continue;
    }
    const span = (c.clockOut.getTime() - c.clockIn.getTime()) / H;
    const worked = paidHours({ start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes });
    if (worked > rules.maxShiftHours) out.push({ kind: "long-punch", level: "warn", employeeId: c.employeeId, name: n, date: c.date, cardId: c.id, message: `${worked.toFixed(1)}h on one card. Check for a missed clock-out.` });
    if (ruleOn(rules, "meal-break") && span > rules.mealBreakAfterHours && c.breakMinutes < rules.mealBreakMinutes) {
      out.push({ kind: "meal-break", level: "warn", employeeId: c.employeeId, name: n, date: c.date, cardId: c.id, message: `${span.toFixed(1)}h with ${c.breakMinutes ? `a ${c.breakMinutes}-min` : "no"} break recorded (rule: ${rules.mealBreakMinutes} min).` });
    }
    if (hasSchedule && !shifts.some((s) => s.employeeId === c.employeeId && overlaps(c.clockIn, c.clockOut!, s.start, s.end))) {
      out.push({ kind: "unscheduled", level: "info", employeeId: c.employeeId, name: n, date: c.date, cardId: c.id, message: "Worked without a scheduled shift." });
    }
  }

  const owed = callInOwed(cards, shifts, rules);
  for (const c of cards) {
    const h = owed.get(c.id);
    if (h) out.push({ kind: "call-in", level: "warn", employeeId: c.employeeId, name: name(c.employeeId), date: c.date, cardId: c.id, message: `Left early: ${h.toFixed(2)}h call-in pay owed at minimum wage (added to the export).` });
  }

  for (const s of shifts) {
    if (s.end > now) continue;
    const worked = cards.some((c) => c.employeeId === s.employeeId && overlaps(c.clockIn, c.clockOut ?? now, s.start, s.end));
    if (!worked) out.push({ kind: "no-show", level: "warn", employeeId: s.employeeId, name: name(s.employeeId), date: s.date, message: `Scheduled ${s.label} but no timecard. A missed punch or a no-show.` });
  }

  const byEmp = new Map<string, ExceptionCard[]>();
  for (const c of cards) byEmp.set(c.employeeId, [...(byEmp.get(c.employeeId) ?? []), c]);
  for (const [id, list] of byEmp) {
    const n = name(id);
    if (list.some((c) => c.rate == null)) out.push({ kind: "missing-rate", level: "block", employeeId: id, name: n, date: null, message: "No pay rate, so wages come out as $0. Set one on the Team page." });
    const low = list.find((c) => c.rate != null && c.rate < (c.tipped ? rules.tippedMinimumWage : rules.minimumWage) - 0.005);
    if (low && ruleOn(rules, "min-wage")) {
      const floor = low.tipped ? rules.tippedMinimumWage : rules.minimumWage;
      out.push({ kind: "below-min-wage", level: "warn", employeeId: id, name: n, date: low.date, message: `Paid $${low.rate!.toFixed(2)}/h, under the ${low.tipped ? "tipped " : ""}minimum of $${floor.toFixed(2)}.` });
    }
    if (input.squareInUse && !people.get(id)?.squareTeamMemberId) out.push({ kind: "missing-square-id", level: "warn", employeeId: id, name: n, date: null, message: "Not linked to a Square team member, so the payroll import can't match them." });
  }

  for (const l of input.lines) {
    if (l.overtimeHours > 0.005 && ruleOn(rules, "overtime")) out.push({ kind: "overtime", level: "info", employeeId: l.employeeId, name: name(l.employeeId), date: null, message: `${l.overtimeHours.toFixed(2)}h overtime at ${rules.overtimeMultiplier}×.` });
    if (l.spreadHours > 0) out.push({ kind: "spread", level: "info", employeeId: l.employeeId, name: name(l.employeeId), date: null, message: `${l.spreadHours} spread-of-hours day${l.spreadHours === 1 ? "" : "s"}: an extra hour at minimum wage each.` });
  }

  if (input.tipsUncovered?.length) {
    const d = input.tipsUncovered;
    out.push({ kind: "tips-missing", level: "warn", employeeId: null, name: "Tips", date: d[0], message: `No finalized tip pool covers ${d.length} day${d.length === 1 ? "" : "s"} of this period (${d[0]}${d.length > 1 ? ` to ${d[d.length - 1]}` : ""}).` });
  }

  return out.sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind) ||
      (a.date ?? "").localeCompare(b.date ?? "") ||
      a.name.localeCompare(b.name),
  );
}

// ---- Adjustments --------------------------------------------------------------------

export const ADJUSTMENT_KINDS = ["BONUS", "CORRECTION", "DEDUCTION", "REIMBURSEMENT"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = { BONUS: "Bonus", CORRECTION: "Correction", DEDUCTION: "Deduction", REIMBURSEMENT: "Reimbursement" };

/**
 * Signed amount for an adjustment as typed: deductions are always negative,
 * bonuses and reimbursements always positive, corrections keep their sign.
 */
export function signedAdjustment(kind: AdjustmentKind, amount: number): number {
  const a = Math.round(amount * 100) / 100;
  if (kind === "DEDUCTION") return -Math.abs(a);
  if (kind === "CORRECTION") return a;
  return Math.abs(a);
}

// ---- Rows & CSV ----------------------------------------------------------------------

export interface PayrollRow {
  employeeId: string;
  name: string;
  squareTeamMemberId: string | null;
  rate: number | null;
  regularHours: number;
  overtimeHours: number;
  spreadHours: number;
  spreadPay: number;
  callInHours: number;
  callInPay: number;
  sickHours: number;
  sickPay: number;
  ptoHours: number;
  ptoPay: number;
  /** Worked wages incl. overtime and spread-of-hours. */
  wages: number;
  /** Signed sum of bonuses, corrections, deductions (excl. reimbursements). */
  adjustments: number;
  reimbursements: number;
  adjustmentNotes: string;
  /** wages + call-in + sick + PTO + adjustments. */
  gross: number;
  tips: number;
  sickBalance: number | null;
  missingRate: boolean;
  openCards: number;
}

export interface PayInputs {
  lines: { employeeId: string; name: string; squareTeamMemberId: string | null; regularHours: number; overtimeHours: number; spreadHours: number; wages: number; missingRate: boolean; openCards: number }[];
  /** Base rate per employee (for call-in, sick and PTO pay). */
  rates: Map<string, number | null>;
  info: Map<string, { name: string; squareTeamMemberId: string | null }>;
  callInHours: Map<string, number>;
  sickHours: Map<string, number>;
  ptoHours: Map<string, number>;
  tips: Map<string, number>;
  adjustments: { employeeId: string; kind: AdjustmentKind; amount: number; note: string | null }[];
  sickBalance: Map<string, number>;
  rules: LaborRules;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One row per person who worked, was paid leave, tipped or adjusted in the period. */
export function buildPayrollRows(p: PayInputs): PayrollRow[] {
  const ids = new Set<string>([...p.lines.map((l) => l.employeeId), ...p.callInHours.keys(), ...p.sickHours.keys(), ...p.ptoHours.keys(), ...p.tips.keys(), ...p.adjustments.map((a) => a.employeeId)]);
  const rows: PayrollRow[] = [];
  for (const id of ids) {
    const l = p.lines.find((x) => x.employeeId === id);
    const info = p.info.get(id);
    const rate = p.rates.get(id) ?? null;
    const callInHours = r2(p.callInHours.get(id) ?? 0);
    const sickHours = r2(p.sickHours.get(id) ?? 0);
    const ptoHours = r2(p.ptoHours.get(id) ?? 0);
    const adj = p.adjustments.filter((a) => a.employeeId === id);
    const adjustments = r2(adj.filter((a) => a.kind !== "REIMBURSEMENT").reduce((s, a) => s + a.amount, 0));
    const reimbursements = r2(adj.filter((a) => a.kind === "REIMBURSEMENT").reduce((s, a) => s + a.amount, 0));
    const wages = r2(l?.wages ?? 0);
    const callInPay = r2(callInHours * p.rules.minimumWage);
    const sickPay = r2(sickHours * (rate ?? 0));
    const ptoPay = r2(ptoHours * (rate ?? 0));
    if (!l && !callInHours && !sickHours && !ptoHours && !(p.tips.get(id) ?? 0) && !adj.length) continue;
    rows.push({
      employeeId: id,
      name: l?.name ?? info?.name ?? "Unknown",
      squareTeamMemberId: l?.squareTeamMemberId ?? info?.squareTeamMemberId ?? null,
      rate,
      regularHours: r2(l?.regularHours ?? 0),
      overtimeHours: r2(l?.overtimeHours ?? 0),
      spreadHours: l?.spreadHours ?? 0,
      spreadPay: r2((l?.spreadHours ?? 0) * p.rules.minimumWage),
      callInHours,
      callInPay,
      sickHours,
      sickPay,
      ptoHours,
      ptoPay,
      wages,
      adjustments,
      reimbursements,
      adjustmentNotes: adj.map((a) => `${ADJUSTMENT_LABELS[a.kind]} ${a.amount < 0 ? "-" : ""}$${Math.abs(a.amount).toFixed(2)}${a.note ? ` (${a.note})` : ""}`).join("; "),
      gross: r2(wages + callInPay + sickPay + ptoPay + adjustments),
      tips: r2(p.tips.get(id) ?? 0),
      sickBalance: p.sickBalance.has(id) ? r2(p.sickBalance.get(id)!) : null,
      missingRate: (l?.missingRate ?? false) || ((sickHours > 0 || ptoHours > 0) && rate == null),
      openCards: l?.openCards ?? 0,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface PayrollTotals {
  hours: number;
  overtimeHours: number;
  wages: number;
  gross: number;
  tips: number;
  adjustments: number;
  reimbursements: number;
}

export function payrollTotals(rows: PayrollRow[]): PayrollTotals {
  const t = { hours: 0, overtimeHours: 0, wages: 0, gross: 0, tips: 0, adjustments: 0, reimbursements: 0 };
  for (const r of rows) {
    t.hours += r.regularHours + r.overtimeHours;
    t.overtimeHours += r.overtimeHours;
    t.wages += r.wages;
    t.gross += r.gross;
    t.tips += r.tips;
    t.adjustments += r.adjustments;
    t.reimbursements += r.reimbursements;
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)])) as unknown as PayrollTotals;
}

/** What's stored on PayPeriod.snapshot when a period is approved. */
export interface PayrollSnapshot {
  version: 1;
  start: ISODate;
  end: ISODate;
  approvedAt: string;
  approvedBy: string;
  rows: PayrollRow[];
  totals: PayrollTotals;
  exceptions: { block: number; warn: number; info: number };
}

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const PAYROLL_HEADER = [
  "Employee", "Square team member ID", "Period start", "Period end", "Status",
  "Base rate", "Regular hours", "Overtime hours", "Spread-of-hours (days)", "Spread-of-hours pay",
  "Call-in hours", "Call-in pay", "Sick hours", "Sick pay", "PTO hours", "PTO pay",
  "Worked wages", "Adjustments", "Gross wages", "Tips", "Reimbursements", "Sick balance (hours)", "Notes",
];

/** The payroll CSV. Status is APPROVED for a snapshot, DRAFT otherwise. */
export function payrollCsv(rows: PayrollRow[], meta: { start: ISODate; end: ISODate; status: "APPROVED" | "DRAFT" }): string {
  const f = (n: number) => n.toFixed(2);
  const lines = [
    PAYROLL_HEADER.map(csvCell).join(","),
    ...rows.map((r) =>
      [
        r.name, r.squareTeamMemberId ?? "", meta.start, meta.end, meta.status,
        r.rate == null ? "" : f(r.rate), f(r.regularHours), f(r.overtimeHours), r.spreadHours, f(r.spreadPay),
        f(r.callInHours), f(r.callInPay), f(r.sickHours), f(r.sickPay), f(r.ptoHours), f(r.ptoPay),
        f(r.wages), f(r.adjustments), f(r.gross), f(r.tips), f(r.reimbursements), r.sickBalance == null ? "" : f(r.sickBalance),
        [r.missingRate ? "MISSING RATE" : "", r.openCards ? "STILL CLOCKED IN" : "", r.adjustmentNotes].filter(Boolean).join("; "),
      ].map(csvCell).join(","),
    ),
  ];
  return lines.join("\n") + "\n";
}
