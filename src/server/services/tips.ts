import "server-only";
import { addDays, ISODate, parseISODate, toISODate } from "@/domain/dates";
import { paidHours } from "@/domain/labor";
import { inclusiveDates } from "@/domain/schedule";
import { splitPool, TipMethod, tipsCsv, tipShares } from "@/domain/tips";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { instantAt } from "./scheduling";

export interface TipShareRow {
  employeeId: string;
  name: string;
  positionId: string;
  position: string;
  hours: number;
  points: number;
}

/** Worked hours from timecards in [from, to] (business dates), as tip-pool shares. */
export async function tipSharesFor(from: ISODate, to: ISODate) {
  const [cards, positions, employees] = await Promise.all([
    db.timecard.findMany({ where: { clockIn: { gte: instantAt(from, 0), lt: instantAt(addDays(to, 1), 0) }, clockOut: { not: null } } }),
    db.position.findMany(),
    db.employee.findMany({ include: { positions: true } }),
  ]);
  const emp = new Map(employees.map((e) => [e.id, e]));
  const pos = new Map(positions.map((p) => [p.id, p]));
  const shares = tipShares(
    cards.map((c) => ({ employeeId: c.employeeId, positionId: c.positionId, hours: paidHours({ start: c.clockIn, end: c.clockOut!, breakMinutes: c.breakMinutes }) })),
    positions.map((p) => ({ id: p.id, tipPoints: p.tipPoints.toNumber(), tipEligible: p.tipEligible })),
    (id) => emp.get(id)?.positions[0]?.positionId ?? null,
  );
  const rows: TipShareRow[] = shares
    .map((s) => ({ ...s, name: emp.get(s.employeeId)?.name ?? "Unknown", position: pos.get(s.positionId)?.name ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.position.localeCompare(b.position));
  const excludedHours = cards.reduce((a, c) => a + paidHours({ start: c.clockIn, end: c.clockOut!, breakMinutes: c.breakMinutes }), 0) - rows.reduce((a, r) => a + r.hours, 0);
  return { rows, excludedHours: Math.max(0, excludedHours), cardCount: cards.length };
}

/** Card tips recorded by the Square sync (Setting keys tips.YYYY-MM-DD). */
export async function syncedTips(from: ISODate, to: ISODate) {
  const keys = inclusiveDates(from, to).map((d) => `tips.${d}`);
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  const total = rows.reduce((a, r) => a + (Number(r.value) || 0), 0);
  return { total: Math.round(total * 100) / 100, days: rows.length, ofDays: keys.length };
}

export async function listPeriods() {
  const rows = await db.tipPeriod.findMany({ orderBy: { startDate: "desc" }, take: 20, include: { _count: { select: { allocations: true } } } });
  return rows.map((p) => ({ id: p.id, start: toISODate(p.startDate), end: toISODate(p.endDate), total: p.totalTips.toNumber(), method: p.method as TipMethod, finalized: p.finalized, people: p._count.allocations }));
}

export async function findPeriod(from: ISODate, to: ISODate) {
  return db.tipPeriod.findFirst({ where: { startDate: parseISODate(from), endDate: parseISODate(to) }, orderBy: { createdAt: "desc" }, include: { allocations: true } });
}

/** Save (or re-save, while not finalized) a period with allocations recomputed from timecards. */
export async function savePeriod(from: ISODate, to: ISODate, total: number, method: TipMethod) {
  const existing = await findPeriod(from, to);
  if (existing?.finalized) return { error: "This period is finalized. Unlock isn't supported — make a new period instead." };
  const { rows } = await tipSharesFor(from, to);
  const split = splitPool(total, rows, method);
  const data = split.map((s) => ({ employeeId: s.employeeId, hours: new Prisma.Decimal(s.hours.toFixed(2)), points: new Prisma.Decimal(s.weightedPoints.toFixed(2)), amount: new Prisma.Decimal(s.amount.toFixed(2)) }));
  const period = await db.$transaction(async (tx) => {
    const p = existing
      ? await tx.tipPeriod.update({ where: { id: existing.id }, data: { totalTips: new Prisma.Decimal(total.toFixed(2)), method } })
      : await tx.tipPeriod.create({ data: { startDate: parseISODate(from), endDate: parseISODate(to), totalTips: new Prisma.Decimal(total.toFixed(2)), method } });
    await tx.tipAllocation.deleteMany({ where: { periodId: p.id } });
    await tx.tipAllocation.createMany({ data: data.map((d) => ({ ...d, periodId: p.id })) });
    return p;
  });
  return { id: period.id };
}

export async function periodCsv(id: string) {
  const p = await db.tipPeriod.findUnique({ where: { id }, include: { allocations: { include: { employee: { select: { name: true } } } } } });
  if (!p) return null;
  const start = toISODate(p.startDate);
  const end = toISODate(p.endDate);
  return {
    filename: `tips-${start}-to-${end}.csv`,
    body: tipsCsv(
      p.allocations.map((a) => ({ name: a.employee.name, hours: a.hours.toNumber(), points: a.points.toNumber(), amount: a.amount.toNumber() })).sort((a, b) => a.name.localeCompare(b.name)),
      { start, end, method: p.method as TipMethod, total: p.totalTips.toNumber() },
    ),
  };
}
