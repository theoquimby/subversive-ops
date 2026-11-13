import "server-only";
import { addDays, businessDate, dateRange, ISODate, parseISODate, toISODate } from "@/domain/dates";
import { paidHours } from "@/domain/labor";
import { inclusiveDates } from "@/domain/schedule";
import { cardTipRows, mergeTipInputs, planTips, poolWarnings, SquareTipRow, squareTipsFor, TipInputs, TipKind, TipMode, TipOverrides, TipPlan } from "@/domain/tipSources";
import { TipMethod, tipsCsv, tipShares } from "@/domain/tips";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { friendlySquareError, SquareClient } from "../integrations/square-http";
import { listPaymentTips } from "../integrations/square-payments";
import { instantAt } from "./scheduling";
import { logSquareError, requireSquareClient } from "./square";

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

// ---- Square tips: storage and sync ------------------------------------------------------

/**
 * Replace the stored Square tips of one kind for business dates
 * [from, toExclusive) with `rows`. Rebuilding whole days keeps re-syncs
 * idempotent; manual values live on the tip period and are never touched.
 */
export async function storeSquareTips(kind: TipKind, from: ISODate, toExclusive: ISODate, rows: SquareTipRow[]) {
  const D = (n: number) => new Prisma.Decimal(n.toFixed(2));
  await db.$transaction([
    db.squareTip.deleteMany({ where: { kind, date: { gte: parseISODate(from), lt: parseISODate(toExclusive) } } }),
    db.squareTip.createMany({ data: rows.map((r) => ({ date: parseISODate(r.date), kind: r.kind, teamMemberId: r.teamMemberId, amount: D(r.amount), count: r.count })) }),
  ]);
}

/** Card tips per team member from Square payments created in business dates [from, toExclusive). */
export async function syncCardTips(from: ISODate, toExclusive: ISODate, client?: SquareClient) {
  const c = client ?? (await requireSquareClient());
  const tz = env.BUSINESS_TIMEZONE;
  const payments = await listPaymentTips(c, instantAt(from, 0).toISOString(), instantAt(toExclusive, 0).toISOString());
  const rows = cardTipRows(payments, dateRange(from, toExclusive), (iso) => businessDate(iso, tz));
  await storeSquareTips("CARD", from, toExclusive, rows);
  return { payments: payments.length, tips: rows.reduce((a, r) => a + r.amount, 0) };
}

/**
 * Same, but a failure is logged instead of thrown: card tips by person are
 * extra detail, and must never stop sales or the first import.
 */
export async function syncCardTipsQuietly(from: ISODate, toExclusive: ISODate, client?: SquareClient) {
  try {
    return await syncCardTips(from, toExclusive, client);
  } catch (e) {
    await logSquareError("sales", `Card tips by person: ${friendlySquareError(e)}`).catch(() => undefined);
    return null;
  }
}

// ---- A period's tips --------------------------------------------------------------------

/** Card tips recorded by the Square sync (Setting keys tips.YYYY-MM-DD). */
export async function syncedTips(from: ISODate, to: ISODate) {
  const keys = inclusiveDates(from, to).map((d) => `tips.${d}`);
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  const total = rows.reduce((a, r) => a + (Number(r.value) || 0), 0);
  return { total: Math.round(total * 100) / 100, days: rows.length, ofDays: keys.length };
}

/** What Square says about tips in [from, to], by employee. */
export async function squareTipsInPeriod(from: ISODate, to: ISODate) {
  const dates = inclusiveDates(from, to);
  const [rows, daily, employees] = await Promise.all([
    db.squareTip.findMany({ where: { date: { gte: parseISODate(from), lte: parseISODate(to) } } }),
    db.setting.findMany({ where: { key: { in: dates.map((d) => `tips.${d}`) } } }),
    db.employee.findMany({ where: { squareTeamMemberId: { not: null } }, select: { id: true, squareTeamMemberId: true } }),
  ]);
  const bySquare = new Map(employees.map((e) => [e.squareTeamMemberId!, e.id]));
  return squareTipsFor(
    rows.map((r) => ({ date: toISODate(r.date), kind: r.kind, teamMemberId: r.teamMemberId, amount: r.amount.toNumber() })),
    new Map(daily.map((s) => [s.key.slice(5), Number(s.value) || 0])),
    dates,
    (tm) => bySquare.get(tm) ?? null,
  );
}

export function parseOverrides(raw: unknown): TipOverrides {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rec = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === "object" ? v : {}).filter(([, n]) => typeof n === "number" && Number.isFinite(n))) as Record<string, number>;
  const one = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: TipOverrides = { card: rec(o.card), cash: rec(o.cash) };
  if (one(o.pooledCard) != null) out.pooledCard = one(o.pooledCard);
  if (one(o.pooledCash) != null) out.pooledCash = one(o.pooledCash);
  return out;
}

export interface TipSnapshot {
  inputs: TipInputs;
  square: { cardDays: number; cashDays: number; fallbackDays: number; ofDays: number };
}

/**
 * Everything the tips page shows for [from, to]: pool shares from timecards,
 * the tips (Square, with manual values on top), and the saved period. A
 * finalized period shows the lines it was finalized with.
 */
export async function tipPeriodView(from: ISODate, to: ISODate) {
  const [shares, square, saved, periods] = await Promise.all([tipSharesFor(from, to), squareTipsInPeriod(from, to), findPeriod(from, to), listPeriods()]);
  const overrides = parseOverrides(saved?.overrides);
  const snapshot = saved?.finalized ? (saved.snapshot as unknown as TipSnapshot | null) : null;
  const inputs = snapshot?.inputs ?? mergeTipInputs(square, overrides, [...new Set(shares.rows.map((r) => r.employeeId))]);
  const ids = [...new Set([...inputs.lines.map((l) => l.employeeId), ...(saved?.allocations.map((a) => a.employeeId) ?? [])])];
  const names = new Map((await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  return {
    shares: shares.rows,
    excludedHours: shares.excludedHours,
    inputs,
    overrides,
    coverage: snapshot?.square ?? { cardDays: square.cardDays, cashDays: square.cashDays, fallbackDays: square.fallbackDays, ofDays: square.ofDays },
    names: Object.fromEntries(names),
    warnings: poolWarnings(shares.rows.map((r) => r.position)),
    saved: saved
      ? {
          id: saved.id,
          total: saved.totalTips.toNumber(),
          method: saved.method as TipMethod,
          cardMode: saved.cardMode as TipMode,
          cashMode: saved.cashMode as TipMode,
          finalized: saved.finalized,
          legacy: saved.cardTips == null,
        }
      : null,
    periods,
  };
}

export async function listPeriods() {
  const rows = await db.tipPeriod.findMany({ orderBy: { startDate: "desc" }, take: 20, include: { _count: { select: { allocations: true } } } });
  return rows.map((p) => ({ id: p.id, start: toISODate(p.startDate), end: toISODate(p.endDate), total: p.totalTips.toNumber(), method: p.method as TipMethod, finalized: p.finalized, people: p._count.allocations }));
}

export async function findPeriod(from: ISODate, to: ISODate) {
  return db.tipPeriod.findFirst({ where: { startDate: parseISODate(from), endDate: parseISODate(to) }, orderBy: { createdAt: "desc" }, include: { allocations: true } });
}

const D2 = (n: number) => new Prisma.Decimal(n.toFixed(2));

/**
 * Save (or re-save, while not finalized) a period. Tips come from Square with
 * `overrides` on top, recomputed here so the stored split always matches what
 * Square and the manager say right now; allocations come from timecards.
 */
export async function savePeriod(from: ISODate, to: ISODate, method: TipMethod, cardMode: TipMode, cashMode: TipMode, overrides: TipOverrides): Promise<{ error?: string; id?: string; plan?: TipPlan }> {
  const existing = await findPeriod(from, to);
  if (existing?.finalized) return { error: "This period is finalized. Unlock isn't supported — make a new period instead." };
  const [{ rows }, square] = await Promise.all([tipSharesFor(from, to), squareTipsInPeriod(from, to)]);
  const inputs = mergeTipInputs(square, overrides, [...new Set(rows.map((r) => r.employeeId))]);
  const plan = planTips(inputs, rows, method, cardMode, cashMode);
  const snapshot: TipSnapshot = { inputs, square: { cardDays: square.cardDays, cashDays: square.cashDays, fallbackDays: square.fallbackDays, ofDays: square.ofDays } };
  const fields = {
    totalTips: D2(plan.total),
    cardTips: D2(plan.cardTotal),
    cashTips: D2(plan.cashTotal),
    method,
    cardMode,
    cashMode,
    overrides: overrides as Prisma.InputJsonValue,
    snapshot: snapshot as unknown as Prisma.InputJsonValue,
  };
  const period = await db.$transaction(async (tx) => {
    const p = existing
      ? await tx.tipPeriod.update({ where: { id: existing.id }, data: fields })
      : await tx.tipPeriod.create({ data: { startDate: parseISODate(from), endDate: parseISODate(to), ...fields } });
    await tx.tipAllocation.deleteMany({ where: { periodId: p.id } });
    await tx.tipAllocation.createMany({
      data: plan.people.map((s) => ({ periodId: p.id, employeeId: s.employeeId, hours: D2(s.hours), points: D2(s.weightedPoints), amount: D2(s.amount), cardAmount: D2(s.card), cashAmount: D2(s.cash) })),
    });
    return p;
  });
  return { id: period.id, plan };
}

export async function periodCsv(id: string) {
  const p = await db.tipPeriod.findUnique({ where: { id }, include: { allocations: { include: { employee: { select: { name: true } } } } } });
  if (!p) return null;
  const start = toISODate(p.startDate);
  const end = toISODate(p.endDate);
  return {
    filename: `tips-${start}-to-${end}.csv`,
    body: tipsCsv(
      p.allocations
        .map((a) => ({ name: a.employee.name, hours: a.hours.toNumber(), points: a.points.toNumber(), amount: a.amount.toNumber(), card: a.cardAmount?.toNumber(), cash: a.cashAmount?.toNumber() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      { start, end, method: p.method as TipMethod, total: p.totalTips.toNumber() },
    ),
  };
}
