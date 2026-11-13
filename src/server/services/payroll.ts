import "server-only";
import { addDays, ISODate, parseISODate, toISODate } from "@/domain/dates";
import type { LaborRules } from "@/domain/labor";
import {
  AdjustmentKind, buildPayrollRows, callInOwed, ExceptionCard, ExceptionShift, FinalizedTipPeriod, payPeriodFor, payrollExceptions, PayrollRow, PayrollSnapshot, payrollTotals,
  PeriodRange, periodWeeks, tipsForPeriod,
} from "@/domain/payroll";
import { shiftLabel } from "@/domain/schedule";
import { leaveHours, leaveHoursIn, sickBalance, SickBalance } from "@/domain/sickLeave";
import { Prisma } from "@prisma/client";
import { db, num } from "../db";
import { getLaborRules } from "./labor-rules";
import { loadTimecards, weeklyPay, WeekPayLine } from "./labor";
import { businessToday } from "./sales";
import { instantAt, shiftView } from "./scheduling";
import { isSquareConnected } from "./square";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The pay period containing `date` under the configured weekly/bi-weekly setting. */
export async function currentPeriod(date: ISODate = businessToday()): Promise<PeriodRange> {
  return payPeriodFor(date, await getLaborRules());
}

// ---- Sick leave ------------------------------------------------------------------

/** Paid hours scheduled per employee per date (published shifts), for leave requests with no hours. */
async function scheduledHoursLookup(employeeIds: string[], from: ISODate, to: ISODate) {
  const rows = await db.shift.findMany({ where: { employeeId: { in: employeeIds }, start: { gte: instantAt(from, 0), lt: instantAt(addDays(to, 1), 0) } } });
  const m = new Map<string, number>();
  for (const s of rows) {
    const v = shiftView(s);
    const k = `${s.employeeId}|${v.date}`;
    m.set(k, (m.get(k) ?? 0) + Math.max(0, (v.endMin - v.startMin - v.breakMinutes) / 60));
  }
  return (employeeId: string, date: ISODate) => m.get(`${employeeId}|${date}`) ?? 0;
}

/** Hours a leave request is worth: its own hours, else the person's scheduled hours on those days. */
export async function requestHours(r: { employeeId: string; startDate: Date; endDate: Date; hours: Prisma.Decimal | null }) {
  const from = toISODate(r.startDate);
  const to = toISODate(r.endDate);
  if (r.hours != null) return r.hours.toNumber();
  const look = await scheduledHoursLookup([r.employeeId], from, to);
  return leaveHours({ startDate: from, endDate: to, hours: null }, (d) => look(r.employeeId, d));
}

/**
 * NY paid sick leave balance per employee for the calendar year of `asOf`:
 * hours worked this year (closed timecards) and approved SICK time this year.
 */
export async function sickBalances(asOf: ISODate = businessToday(), employeeIds?: string[]): Promise<Map<string, SickBalance>> {
  const rules = await getLaborRules();
  const year = asOf.slice(0, 4);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const filter = employeeIds ? Prisma.sql`AND "employeeId" IN (${Prisma.join(employeeIds.length ? employeeIds : ["-"])})` : Prisma.empty;
  const worked = await db.$queryRaw<{ employeeId: string; hours: number }[]>`
    SELECT "employeeId", COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM ("clockOut" - "clockIn")) / 3600.0 - "breakMinutes" / 60.0)), 0)::float AS hours
    FROM "Timecard"
    WHERE "clockOut" IS NOT NULL AND "clockIn" >= ${instantAt(from, 0)} AND "clockIn" < ${instantAt(addDays(asOf, 1), 0)} ${filter}
    GROUP BY "employeeId"`;
  const sick = await db.timeOffRequest.findMany({
    where: { type: "SICK", status: "APPROVED", startDate: { lte: parseISODate(to) }, endDate: { gte: parseISODate(from) }, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
  });
  const used = new Map<string, number>();
  for (const r of sick) used.set(r.employeeId, (used.get(r.employeeId) ?? 0) + (await requestHours(r)));
  const ids = new Set([...worked.map((w) => w.employeeId), ...used.keys(), ...(employeeIds ?? [])]);
  const out = new Map<string, SickBalance>();
  for (const id of ids) out.set(id, sickBalance(Number(worked.find((w) => w.employeeId === id)?.hours ?? 0), used.get(id) ?? 0, rules));
  return out;
}

// ---- Payroll for a period --------------------------------------------------------

export type PeriodStatus = "OPEN" | "APPROVED";

export async function findPayPeriod(p: PeriodRange) {
  return db.payPeriod.findUnique({ where: { startDate_endDate: { startDate: parseISODate(p.start), endDate: parseISODate(p.end) } } });
}

/** Every number behind the payroll export for a period, computed live. */
export async function computePayroll(period: PeriodRange, now = new Date()) {
  const rules = await getLaborRules();
  const today = businessToday();
  const weeks = periodWeeks(period);
  const weekly = await Promise.all(weeks.map((w) => weeklyPay(w, now)));
  // Overtime is per workweek; a period is whole weeks, so lines add up.
  const lineMap = new Map<string, WeekPayLine>();
  for (const w of weekly) {
    for (const l of w.lines) {
      const cur = lineMap.get(l.employeeId);
      if (!cur) lineMap.set(l.employeeId, { ...l });
      else {
        cur.regularHours += l.regularHours;
        cur.overtimeHours += l.overtimeHours;
        cur.spreadHours += l.spreadHours;
        cur.wages += l.wages;
        cur.burden += l.burden;
        cur.cost += l.cost;
        cur.totalHours += l.totalHours;
        cur.openCards += l.openCards;
        cur.missingRate ||= l.missingRate;
      }
    }
  }
  const lines = [...lineMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const cards = weekly.flatMap((w) => w.cards);

  const [positions, employees, shiftRows, pools, leave, adjustments, squareInUse] = await Promise.all([
    db.position.findMany({ select: { id: true, tipEligible: true } }),
    db.employee.findMany({ select: { id: true, name: true, squareTeamMemberId: true, hourlyRate: true, positions: { select: { positionId: true, rate: true } } } }),
    db.shift.findMany({ where: { published: true, employeeId: { not: null }, start: { gte: instantAt(period.start, 0), lt: instantAt(addDays(period.end, 1), 0) } } }),
    db.tipPeriod.findMany({ where: { finalized: true, startDate: { lte: parseISODate(period.end) }, endDate: { gte: parseISODate(period.start) } }, include: { allocations: true } }),
    db.timeOffRequest.findMany({ where: { status: "APPROVED", type: { in: ["SICK", "PTO"] }, startDate: { lte: parseISODate(period.end) }, endDate: { gte: parseISODate(period.start) } } }),
    db.payAdjustment.findMany({ where: { date: { gte: parseISODate(period.start), lte: parseISODate(period.end) } }, orderBy: { createdAt: "asc" } }),
    isSquareConnected().catch(() => false),
  ]);
  const tipped = new Map(positions.map((p) => [p.id, p.tipEligible]));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const baseRate = (id: string) => {
    const e = empById.get(id);
    return num(e?.hourlyRate) ?? num(e?.positions.find((p) => p.rate != null)?.rate) ?? null;
  };

  const exCards: ExceptionCard[] = cards.map((c) => ({
    id: c.id,
    employeeId: c.employeeId,
    date: c.date,
    clockIn: c.clockIn,
    clockOut: c.clockOut,
    breakMinutes: c.breakMinutes,
    rate: c.rate,
    tipped: tipped.get(c.positionId ?? empById.get(c.employeeId)?.positions[0]?.positionId ?? "") ?? false,
  }));
  const exShifts: ExceptionShift[] = shiftRows.map((s) => {
    const v = shiftView(s);
    return { id: s.id, employeeId: s.employeeId!, date: v.date, start: s.start, end: s.end, breakMinutes: s.breakMinutes, label: shiftLabel(v.startMin, v.endMin) };
  });

  const finalized: FinalizedTipPeriod[] = pools.map((p) => ({ start: toISODate(p.startDate), end: toISODate(p.endDate), allocations: p.allocations.map((a) => ({ employeeId: a.employeeId, amount: a.amount.toNumber() })) }));
  const tips = tipsForPeriod(finalized, period);
  const anyTipPools = (await db.tipPeriod.count()) > 0;

  const people = new Map(employees.map((e) => [e.id, { name: e.name, squareTeamMemberId: e.squareTeamMemberId }]));
  const owedByCard = callInOwed(exCards, exShifts, rules);
  const callInHours = new Map<string, number>();
  for (const c of exCards) {
    const h = owedByCard.get(c.id);
    if (h) callInHours.set(c.employeeId, r2((callInHours.get(c.employeeId) ?? 0) + h));
  }

  const sickHours = new Map<string, number>();
  const ptoHours = new Map<string, number>();
  for (const r of leave) {
    const hours = await requestHours(r);
    const inPeriod = leaveHoursIn({ startDate: toISODate(r.startDate), endDate: toISODate(r.endDate), hours }, period.start, period.end);
    if (!inPeriod) continue;
    const m = r.type === "SICK" ? sickHours : ptoHours;
    m.set(r.employeeId, r2((m.get(r.employeeId) ?? 0) + inPeriod));
  }

  const exceptions = payrollExceptions({
    cards: exCards,
    shifts: exShifts,
    people,
    lines,
    rules,
    today,
    now,
    squareInUse,
    tipsUncovered: anyTipPools && period.start <= today ? tips.uncovered.filter((d) => d < today) : [],
  });

  const rowIds = [...new Set([...lines.map((l) => l.employeeId), ...sickHours.keys(), ...ptoHours.keys(), ...tips.byEmployee.keys(), ...adjustments.map((a) => a.employeeId)])];
  const balances = await sickBalances(period.end < today ? period.end : today, rowIds);
  const rows = buildPayrollRows({
    lines,
    rates: new Map(rowIds.map((id) => [id, baseRate(id)])),
    info: people,
    callInHours,
    sickHours,
    ptoHours,
    tips: tips.byEmployee,
    adjustments: adjustments.map((a) => ({ employeeId: a.employeeId, kind: a.kind as AdjustmentKind, amount: a.amount.toNumber(), note: a.note })),
    sickBalance: new Map([...balances].map(([k, v]) => [k, v.available])),
    rules,
  });

  return {
    period,
    rules,
    lines,
    cards,
    rows,
    totals: payrollTotals(rows),
    exceptions,
    adjustments,
    tips,
    burden: lines.reduce((a, l) => a + l.burden, 0),
    cost: lines.reduce((a, l) => a + l.cost, 0) + rows.reduce((a, r) => a + (r.gross - r.wages), 0) * (1 + rules.employerBurdenPct),
  };
}

export type PayrollData = Awaited<ReturnType<typeof computePayroll>>;

/** Approve a period: stamp its timecards (locking them) and store the payroll rows as they are now. */
export async function approvePayPeriod(period: PeriodRange, by: string) {
  const data = await computePayroll(period);
  const approvedAt = new Date();
  const snapshot: PayrollSnapshot = {
    version: 1,
    start: period.start,
    end: period.end,
    approvedAt: approvedAt.toISOString(),
    approvedBy: by,
    rows: data.rows,
    totals: data.totals,
    exceptions: {
      block: data.exceptions.filter((e) => e.level === "block").length,
      warn: data.exceptions.filter((e) => e.level === "warn").length,
      info: data.exceptions.filter((e) => e.level === "info").length,
    },
  };
  const key = { startDate: parseISODate(period.start), endDate: parseISODate(period.end) };
  const json = snapshot as unknown as Prisma.InputJsonValue;
  await db.$transaction([
    db.payPeriod.upsert({
      where: { startDate_endDate: key },
      create: { ...key, status: "APPROVED", approvedBy: by, approvedAt, snapshot: json },
      update: { status: "APPROVED", approvedBy: by, approvedAt, snapshot: json },
    }),
    db.timecard.updateMany({ where: { id: { in: data.cards.map((c) => c.id) } }, data: { approvedAt, approvedBy: by } }),
  ]);
  return snapshot;
}

/** Reopen an approved period so its timecards can be edited again. The old snapshot is dropped. */
export async function unlockPayPeriod(period: PeriodRange) {
  const cards = await loadTimecards(period.start, addDays(period.end, 1));
  await db.$transaction([
    db.payPeriod.updateMany({ where: { startDate: parseISODate(period.start), endDate: parseISODate(period.end) }, data: { status: "OPEN", approvedAt: null, approvedBy: null, snapshot: Prisma.JsonNull } }),
    db.timecard.updateMany({ where: { id: { in: cards.map((c) => c.id) } }, data: { approvedAt: null, approvedBy: null } }),
  ]);
}

/** Is the business date inside an approved pay period? (Edits there are refused.) */
export async function dateIsLocked(date: ISODate) {
  const d = parseISODate(date);
  return (await db.payPeriod.count({ where: { status: "APPROVED", startDate: { lte: d }, endDate: { gte: d } } })) > 0;
}

export async function recentPayPeriods(limit = 8) {
  const rows = await db.payPeriod.findMany({ where: { status: "APPROVED" }, orderBy: { startDate: "desc" }, take: limit });
  return rows.map((p) => {
    const snap = p.snapshot as unknown as PayrollSnapshot | null;
    return { start: toISODate(p.startDate), end: toISODate(p.endDate), approvedBy: p.approvedBy, approvedAt: p.approvedAt, gross: snap?.totals.gross ?? null, tips: snap?.totals.tips ?? null, people: snap?.rows.length ?? null };
  });
}

export type { LaborRules, PayrollRow };
