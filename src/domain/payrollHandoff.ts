/**
 * Payroll hand-off. Ops never runs payroll: it turns approved hours and
 * finalized tips into files the payroll provider and the accountant can use,
 * and tracks where a pay period is in that hand-off.
 *
 * Column layouts:
 *  - GENERIC: our own payroll CSV (domain/payroll.ts payrollCsv) — every number, one row per person.
 *  - SQUARE_PAYROLL and GUSTO: shaped like each provider's hours-import template.
 *    UNVERIFIED — their help centers (squareup.com, support.gusto.com) couldn't be
 *    reached when this was written, so the headers follow their published import
 *    templates as remembered, not as checked. The page says so next to the
 *    download; check the first import against the provider's template.
 *  - ACCOUNTANT: totals for the books (wages, overtime premium, tips card/cash,
 *    adjustments, reimbursements, estimated employer taxes).
 */

import type { ISODate } from "./dates";
import { payrollCsv, type PayrollRow, type PayrollTotals } from "./payroll";

export type ExportFormat = "SQUARE_PAYROLL" | "GUSTO" | "GENERIC" | "ACCOUNTANT";

export const FORMAT_META: Record<ExportFormat, { label: string; hint: string; verified: boolean }> = {
  SQUARE_PAYROLL: { label: "Square Payroll", hint: "Hours, overtime, sick/PTO and tips per team member, matched on Square team member ID.", verified: false },
  GUSTO: { label: "Gusto", hint: "Gusto's hours import: last name, first name, hours by type, tips, bonus and reimbursements.", verified: false },
  GENERIC: { label: "Every column (CSV)", hint: "Everything Ops worked out, one row per person — works with any provider or a spreadsheet.", verified: true },
  ACCOUNTANT: { label: "Accountant summary", hint: "Totals for the books: wages, overtime premium, tips card and cash, adjustments, employer taxes.", verified: true },
};

export const isExportFormat = (s: string): s is ExportFormat => s in FORMAT_META;

/** Card vs cash share of each person's tips (from finalized pools); missing = all card (paid through payroll). */
export type TipSplit = Map<string, { card: number; cash: number }>;

const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";

/** "Ava Abbott-Lee" → ["Ava", "Abbott-Lee"]; "Cher" → ["Cher", ""]. */
export function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return [parts[0] ?? "", ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

/** Card/cash for one row: the split if known (scaled to the row's tips), else all card. */
export function tipParts(row: Pick<PayrollRow, "employeeId" | "tips">, split?: TipSplit): { card: number; cash: number } {
  const s = split?.get(row.employeeId);
  if (!s || s.card + s.cash <= 0) return { card: row.tips, cash: 0 };
  const card = Math.round(row.tips * (s.card / (s.card + s.cash)) * 100) / 100;
  return { card, cash: Math.round((row.tips - card) * 100) / 100 };
}

const bonusOf = (r: PayrollRow) => Math.max(0, r.adjustments);
const deductionOf = (r: PayrollRow) => Math.min(0, r.adjustments);

export const SQUARE_PAYROLL_HEADER = ["Team Member ID", "First Name", "Last Name", "Regular Hours", "Overtime Hours", "Sick Hours", "PTO Hours", "Declared Cash Tips", "Card Tips", "Bonus", "Reimbursement", "Pay Rate"];

export function squarePayrollCsv(rows: PayrollRow[], split?: TipSplit): string {
  return csv([
    SQUARE_PAYROLL_HEADER,
    ...rows.map((r) => {
      const [first, last] = splitName(r.name);
      const t = tipParts(r, split);
      return [r.squareTeamMemberId ?? "", first, last, f2(r.regularHours), f2(r.overtimeHours), f2(r.sickHours), f2(r.ptoHours), f2(t.cash), f2(t.card), f2(bonusOf(r)), f2(r.reimbursements), r.rate == null ? "" : f2(r.rate)];
    }),
  ]);
}

export const GUSTO_HEADER = ["last_name", "first_name", "regular_hours", "overtime_hours", "double_overtime_hours", "sick_hours", "vacation_hours", "holiday_hours", "bonus", "commission", "paycheck_tips", "cash_tips", "correction_payment", "reimbursement"];

export function gustoCsv(rows: PayrollRow[], split?: TipSplit): string {
  return csv([
    GUSTO_HEADER,
    ...rows.map((r) => {
      const [first, last] = splitName(r.name);
      const t = tipParts(r, split);
      // Spread-of-hours and call-in pay are wages owed at minimum wage: sent as a correction payment, never hidden.
      const correction = r.spreadPay + r.callInPay + deductionOf(r);
      return [last || first, last ? first : "", f2(r.regularHours), f2(r.overtimeHours), "0.00", f2(r.sickHours), f2(r.ptoHours), "0.00", f2(bonusOf(r)), "0.00", f2(t.card), f2(t.cash), f2(correction), f2(r.reimbursements)];
    }),
  ]);
}

export interface AccountantMeta {
  start: ISODate;
  end: ISODate;
  status: "APPROVED" | "DRAFT";
  burdenPct: number;
  overtimeMultiplier: number;
  provider: string;
}

/** Totals the accountant books: one line per figure, then a per-person table. */
export function accountantSummaryCsv(rows: PayrollRow[], totals: PayrollTotals, meta: AccountantMeta, split?: TipSplit): string {
  let card = 0;
  let cash = 0;
  let otPremium = 0;
  let extra = 0;
  for (const r of rows) {
    const t = tipParts(r, split);
    card += t.card;
    cash += t.cash;
    if (r.rate != null) otPremium += r.overtimeHours * r.rate * (meta.overtimeMultiplier - 1);
    extra += r.spreadPay + r.callInPay + r.sickPay + r.ptoPay;
  }
  const employerTaxes = totals.gross * meta.burdenPct;
  return csv([
    ["Payroll summary", `${meta.start} to ${meta.end}`, meta.status],
    ["Prepared from", "Subversive Ops (approved hours + finalized tips). Payroll is run in", meta.provider],
    [],
    ["Line", "Amount"],
    ["Gross wages", f2(totals.gross)],
    ["  of which overtime premium", f2(otPremium)],
    ["  of which sick / PTO / spread-of-hours / call-in pay", f2(extra)],
    ["  of which bonuses / corrections / deductions", f2(totals.adjustments)],
    ["Card tips (paid through payroll)", f2(card)],
    ["Cash tips (already in hand — reported but not paid)", f2(cash)],
    ["Reimbursements (not wages)", f2(totals.reimbursements)],
    [`Employer taxes and burden (estimated at ${Math.round(meta.burdenPct * 1000) / 10}%)`, f2(employerTaxes)],
    ["Hours (regular + overtime)", f2(totals.hours)],
    ["Overtime hours", f2(totals.overtimeHours)],
    ["People paid", rows.length],
    [],
    ["Employee", "Hours", "Overtime hours", "Gross wages", "Card tips", "Cash tips", "Reimbursements"],
    ...rows.map((r) => {
      const t = tipParts(r, split);
      return [r.name, f2(r.regularHours + r.overtimeHours), f2(r.overtimeHours), f2(r.gross), f2(t.card), f2(t.cash), f2(r.reimbursements)];
    }),
  ]);
}

/** The file for a format. */
export function exportFile(format: ExportFormat, rows: PayrollRow[], totals: PayrollTotals, meta: AccountantMeta, split?: TipSplit): { body: string; filename: string } {
  const tag = `${meta.start}-to-${meta.end}${meta.status === "DRAFT" ? "-DRAFT" : ""}`;
  switch (format) {
    case "SQUARE_PAYROLL":
      return { body: squarePayrollCsv(rows, split), filename: `square-payroll-${tag}.csv` };
    case "GUSTO":
      return { body: gustoCsv(rows, split), filename: `gusto-hours-${tag}.csv` };
    case "ACCOUNTANT":
      return { body: accountantSummaryCsv(rows, totals, meta, split), filename: `payroll-summary-${tag}.csv` };
    default:
      return { body: payrollCsv(rows, meta), filename: `payroll-${tag}.csv` };
  }
}

// ---- Period status -----------------------------------------------------------------

export type StepState = "done" | "todo" | "blocked" | "na";

export interface HandoffStep {
  id: "hours" | "tips" | "issues" | "export" | "submitted";
  title: string;
  detail: string;
  state: StepState;
}

export interface HandoffFacts {
  periodEnded: boolean;
  approved: boolean;
  approvedBy: string | null;
  /** Pay-period days not covered by a finalized tip pool (only matters when tips are pooled). */
  tipDaysUncovered: number;
  tipsPooled: boolean;
  blockingIssues: number;
  warnings: number;
  exports: { format: ExportFormat; approved: boolean; at: string; by: string | null }[];
  handedOffAt: string | null;
  handedOffBy: string | null;
  provider: string;
}

/** The hand-off as five steps, in the order they're done. */
export function handoffSteps(f: HandoffFacts): HandoffStep[] {
  const fromApproved = f.exports.filter((e) => e.approved);
  return [
    {
      id: "hours",
      title: "Hours approved",
      state: f.approved ? "done" : f.periodEnded ? "todo" : "blocked",
      detail: f.approved ? `Approved${f.approvedBy ? ` by ${f.approvedBy}` : ""}. Timecards are locked.` : f.periodEnded ? "Check timecards on Timecards & payroll, then approve the period." : "The period hasn't ended yet.",
    },
    {
      id: "tips",
      title: "Tips finalized",
      state: !f.tipsPooled ? "na" : f.tipDaysUncovered === 0 ? "done" : "todo",
      detail: !f.tipsPooled ? "No tip pools — nothing to finalize." : f.tipDaysUncovered === 0 ? "Every day is in a finalized tip pool." : `${f.tipDaysUncovered} day${f.tipDaysUncovered === 1 ? "" : "s"} not in a finalized tip pool yet.`,
    },
    {
      id: "issues",
      title: "No problems left",
      state: f.blockingIssues > 0 ? "todo" : "done",
      detail: f.blockingIssues > 0 ? `${f.blockingIssues} thing${f.blockingIssues === 1 ? "" : "s"} to fix (open timecards, missing rates).` : f.warnings ? `${f.warnings} warning${f.warnings === 1 ? "" : "s"} to glance at.` : "Nothing flagged.",
    },
    {
      id: "export",
      title: "File downloaded",
      state: fromApproved.length ? "done" : f.approved ? "todo" : "blocked",
      detail: fromApproved.length ? `${fromApproved.length} file${fromApproved.length === 1 ? "" : "s"} from the approved period.` : f.approved ? `Download the ${f.provider} file below.` : "Approve hours first, so the file can't change after you send it.",
    },
    {
      id: "submitted",
      title: `Entered in ${f.provider}`,
      state: f.handedOffAt ? "done" : fromApproved.length ? "todo" : "blocked",
      detail: f.handedOffAt ? `Marked done${f.handedOffBy ? ` by ${f.handedOffBy}` : ""}.` : `Import the file (or type the hours) in ${f.provider}, run payroll there, then mark it done here.`,
    },
  ];
}

/** One word for the period list: Open, Approved, Exported, Handed off. */
export function periodLabel(f: Pick<HandoffFacts, "approved" | "exports" | "handedOffAt">): "Open" | "Approved" | "Exported" | "Handed off" {
  if (f.handedOffAt) return "Handed off";
  if (f.exports.some((e) => e.approved)) return "Exported";
  return f.approved ? "Approved" : "Open";
}
