import "server-only";
import { addDays, parseISODate, toISODate } from "@/domain/dates";
import { cardHours, myPay, recentTipRate } from "@/domain/myPay";
import { payPeriodFor, tipsForPeriod } from "@/domain/payroll";
import { shiftPaidHours } from "@/domain/schedule";
import { zonedTime } from "@/domain/timecards";
import { db } from "../db";
import { env } from "../env";
import { getLaborRules } from "./labor-rules";
import { businessToday } from "./sales";
import { shiftView } from "./scheduling";

/** One person's hours and tips this pay period so far (estimate — payroll is the real number). */
export async function myPayThisPeriod(employeeId: string, now = new Date()) {
  const tz = env.BUSINESS_TIMEZONE;
  const today = businessToday();
  const rules = await getLaborRules();
  const period = payPeriodFor(today, rules);
  const start = zonedTime(period.start, 0, tz);
  const end = zonedTime(addDays(period.end, 1), 0, tz);
  const [cards, shifts, pools, recent, emp] = await Promise.all([
    db.timecard.findMany({ where: { employeeId, clockIn: { gte: start, lt: end } }, select: { clockIn: true, clockOut: true, breakMinutes: true } }),
    db.shift.findMany({ where: { employeeId, published: true, start: { gte: now, lt: end } } }),
    db.tipPeriod.findMany({ where: { finalized: true, startDate: { lte: parseISODate(period.end) }, endDate: { gte: parseISODate(period.start) } }, include: { allocations: { where: { employeeId } } } }),
    db.tipAllocation.findMany({ where: { employeeId, period: { finalized: true, endDate: { gte: parseISODate(addDays(today, -56)) } } }, select: { amount: true, hours: true } }),
    db.employee.findUnique({ where: { id: employeeId }, select: { positions: { select: { position: { select: { tipEligible: true } } } } } }),
  ]);
  const cardRows = cards.map((c) => cardHours(c, now));
  const worked = cardRows.reduce((a, c) => a + c.hours, 0);
  const staleCards = cardRows.filter((c) => c.stale).length;
  const scheduled = shifts.reduce((a, s) => a + shiftPaidHours(shiftView(s)), 0);
  const fin = tipsForPeriod(pools.map((p) => ({ start: toISODate(p.startDate), end: toISODate(p.endDate), allocations: p.allocations.map((a) => ({ employeeId: a.employeeId, amount: a.amount.toNumber() })) })), period);
  const finalizedHours = pools.reduce((a, p) => a + p.allocations.reduce((b, x) => b + x.hours.toNumber(), 0), 0);
  const pay = myPay({
    workedHours: worked,
    scheduledHours: scheduled,
    finalizedTips: fin.byEmployee.get(employeeId) ?? 0,
    finalizedHours,
    recentRate: recentTipRate(recent.map((r) => ({ amount: r.amount.toNumber(), hours: r.hours.toNumber() }))),
    tipped: emp?.positions.some((p) => p.position.tipEligible) ?? false,
  });
  return { period, staleCards, ...pay };
}

export type MyPayView = Awaited<ReturnType<typeof myPayThisPeriod>>;
