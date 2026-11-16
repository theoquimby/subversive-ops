import "server-only";
import { addDays, parseISODate, toISODate } from "@/domain/dates";
import { exportFile, handoffSteps, isExportFormat, periodLabel, type ExportFormat, type HandoffFacts, type TipSplit } from "@/domain/payrollHandoff";
import { payPeriodFor, type PayrollSnapshot, type PeriodRange } from "@/domain/payroll";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { getLaborRules } from "./labor-rules";
import { getPayrollProvider } from "./newHires";
import { computePayroll, findPayPeriod } from "./payroll";
import { businessToday } from "./sales";

/** Payroll hand-off: the period's status, the files, and the "entered in the provider" mark. */

/** Card vs cash per person from finalized tip pools that overlap the period. */
export async function tipSplit(p: PeriodRange): Promise<TipSplit> {
  const pools = await db.tipPeriod.findMany({ where: { finalized: true, startDate: { lte: parseISODate(p.end) }, endDate: { gte: parseISODate(p.start) } }, include: { allocations: true } });
  const out: TipSplit = new Map();
  for (const pool of pools) {
    for (const a of pool.allocations) {
      if (a.cardAmount == null && a.cashAmount == null) continue;
      const cur = out.get(a.employeeId) ?? { card: 0, cash: 0 };
      cur.card += a.cardAmount?.toNumber() ?? 0;
      cur.cash += a.cashAmount?.toNumber() ?? 0;
      out.set(a.employeeId, cur);
    }
  }
  return out;
}

/** Rows + totals: the approved snapshot when there is one, else live (a draft). */
export async function periodRows(p: PeriodRange) {
  const saved = await findPayPeriod(p);
  const snap = saved?.status === "APPROVED" ? (saved.snapshot as unknown as PayrollSnapshot | null) : null;
  if (snap) return { saved, approved: true as const, rows: snap.rows, totals: snap.totals, live: null };
  const live = await computePayroll(p);
  return { saved, approved: false as const, rows: live.rows, totals: live.totals, live };
}

export async function handoffView(p: PeriodRange) {
  const today = businessToday();
  const [{ saved, approved, rows, totals, live }, provider, exports, anyPools] = await Promise.all([
    periodRows(p),
    getPayrollProvider(),
    db.payrollExport.findMany({ where: { periodStart: parseISODate(p.start), periodEnd: parseISODate(p.end) }, orderBy: { createdAt: "desc" } }),
    db.tipPeriod.count(),
  ]);
  // Exceptions and tip coverage come from the live numbers (an approved period's are frozen in its snapshot).
  const data = live ?? (await computePayroll(p));
  const snap = approved ? (saved!.snapshot as unknown as PayrollSnapshot) : null;
  const facts: HandoffFacts = {
    periodEnded: p.end < today,
    approved,
    approvedBy: saved?.approvedBy ?? null,
    tipsPooled: anyPools > 0,
    tipDaysUncovered: anyPools > 0 ? data.tips.uncovered.filter((d) => d < today).length : 0,
    blockingIssues: snap ? snap.exceptions.block : data.exceptions.filter((e) => e.level === "block").length,
    warnings: snap ? snap.exceptions.warn : data.exceptions.filter((e) => e.level === "warn").length,
    exports: exports.filter((e) => isExportFormat(e.format)).map((e) => ({ format: e.format as ExportFormat, approved: e.approved, at: e.createdAt.toISOString(), by: e.createdBy })),
    handedOffAt: saved?.handedOffAt?.toISOString() ?? null,
    handedOffBy: saved?.handedOffBy ?? null,
    provider: provider.name,
  };
  return { period: p, provider, rows, totals, facts, steps: handoffSteps(facts), label: periodLabel(facts), exceptions: data.exceptions };
}

export type HandoffView = Awaited<ReturnType<typeof handoffView>>;

/** Build the file and remember that it was downloaded. */
export async function buildExport(p: PeriodRange, format: ExportFormat, by: string) {
  const [{ approved, rows, totals }, rules, split, provider] = await Promise.all([periodRows(p), getLaborRules(), tipSplit(p), getPayrollProvider()]);
  const file = exportFile(format, rows, totals, { start: p.start, end: p.end, status: approved ? "APPROVED" : "DRAFT", burdenPct: rules.employerBurdenPct, overtimeMultiplier: rules.overtimeMultiplier, provider: provider.name }, split);
  await db.payrollExport.create({
    data: { periodStart: parseISODate(p.start), periodEnd: parseISODate(p.end), format, approved, people: rows.length, hours: new Prisma.Decimal(totals.hours.toFixed(2)), gross: new Prisma.Decimal(totals.gross.toFixed(2)), tips: new Prisma.Decimal(totals.tips.toFixed(2)), createdBy: by },
  });
  return file;
}

/** Mark (or unmark) the period as entered in the payroll provider. Only an approved period can be. */
export async function markHandedOff(p: PeriodRange, by: string, done: boolean) {
  const saved = await findPayPeriod(p);
  if (!saved || saved.status !== "APPROVED") return { error: "Approve the hours first." };
  await db.payPeriod.update({ where: { id: saved.id }, data: done ? { handedOffAt: new Date(), handedOffBy: by } : { handedOffAt: null, handedOffBy: null } });
  return { ok: done ? "Marked as done in payroll." : "Unmarked." };
}

/** The last few periods, newest first, with one word each. */
export async function recentPeriods(n = 6) {
  const rules = await getLaborRules();
  let p = payPeriodFor(businessToday(), rules);
  const list: PeriodRange[] = [];
  for (let i = 0; i < n; i++) {
    list.push(p);
    p = payPeriodFor(addDays(p.start, -1), rules);
  }
  const [saved, exports] = await Promise.all([
    db.payPeriod.findMany({ where: { startDate: { gte: parseISODate(list.at(-1)!.start) } } }),
    db.payrollExport.findMany({ where: { periodStart: { gte: parseISODate(list.at(-1)!.start) } }, select: { periodStart: true, approved: true, format: true, createdAt: true, createdBy: true } }),
  ]);
  return list.map((r) => {
    const s = saved.find((x) => toISODate(x.startDate) === r.start && toISODate(x.endDate) === r.end);
    const ex = exports.filter((e) => toISODate(e.periodStart) === r.start).map((e) => ({ format: e.format as ExportFormat, approved: e.approved, at: e.createdAt.toISOString(), by: e.createdBy }));
    return { ...r, label: periodLabel({ approved: s?.status === "APPROVED", exports: ex, handedOffAt: s?.handedOffAt?.toISOString() ?? null }) };
  });
}
