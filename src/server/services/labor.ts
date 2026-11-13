import "server-only";
import { addDays, businessDate, ISODate } from "@/domain/dates";
import { payForWeek, PayLine } from "@/domain/labor";
import { blockHours, zonedTime } from "@/domain/timecards";
import { Prisma } from "@prisma/client";
import { db, num } from "../db";
import { env, squareConfigured } from "../env";
import { getWageJobs, listTeamMembers, listTimecards } from "../integrations/square-labor";
import { getLaborRules } from "./labor-rules";

const tz = () => env.BUSINESS_TIMEZONE;

/** UTC instants bounding business dates [from, toExclusive). */
export const dayBounds = (from: ISODate, toExclusive: ISODate) => ({ gte: zonedTime(from, 0, tz()), lt: zonedTime(toExclusive, 0, tz()) });

export async function loadTeam() {
  const [positions, employees, users] = await Promise.all([
    db.position.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] }),
    db.employee.findMany({ include: { positions: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
  ]);
  return { positions, employees, users };
}

/**
 * Timecards that clocked in during business dates [from, toExclusive), with
 * the pay rate resolved: the card's own rate, else the employee's rate for
 * that position, else their base rate, else the position default.
 */
export async function loadTimecards(from: ISODate, toExclusive: ISODate) {
  const rows = await db.timecard.findMany({
    where: { clockIn: dayBounds(from, toExclusive) },
    include: {
      employee: { select: { id: true, name: true, hourlyRate: true, squareTeamMemberId: true, positions: { select: { positionId: true, rate: true } } } },
      position: { select: { id: true, name: true, defaultRate: true } },
    },
    orderBy: [{ clockIn: "asc" }],
  });
  return rows.map((t) => {
    const posRate = t.positionId ? num(t.employee.positions.find((p) => p.positionId === t.positionId)?.rate) : null;
    const rate = num(t.hourlyRate) ?? posRate ?? num(t.employee.hourlyRate) ?? num(t.position?.defaultRate) ?? null;
    return { ...t, rate, date: businessDate(t.clockIn, tz()) };
  });
}

export type LoadedTimecard = Awaited<ReturnType<typeof loadTimecards>>[number];

export interface WeekPayLine extends PayLine {
  name: string;
  squareTeamMemberId: string | null;
  totalHours: number;
  burden: number;
  cost: number;
  openCards: number;
}

/** Wages for a Monday–Sunday week using the configured labor rules (open cards count up to now). */
export async function weeklyPay(weekStart: ISODate, now = new Date()) {
  const [cards, rules] = await Promise.all([loadTimecards(weekStart, addDays(weekStart, 7)), getLaborRules()]);
  const blocks = cards.map((c) => {
    const end = c.clockOut ?? (now > c.clockIn ? now : c.clockIn);
    return { employeeId: c.employeeId, start: c.clockIn, end, breakMinutes: c.clockOut ? c.breakMinutes : 0, rate: c.rate, hours: blockHours({ start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate }, now) };
  });
  // payForWeek subtracts breaks itself; open cards use blockHours' partial-break rule via an adjusted break.
  const adjusted = blocks.map((b) => ({ ...b, breakMinutes: Math.max(0, Math.round(((b.end.getTime() - b.start.getTime()) / 3_600_000 - b.hours) * 60)) }));
  const pay = payForWeek(adjusted, rules, (d) => businessDate(d, tz()));
  const info = new Map(cards.map((c) => [c.employeeId, c.employee]));
  const lines: WeekPayLine[] = pay.map((p) => {
    const e = info.get(p.employeeId)!;
    const burden = p.wages * rules.employerBurdenPct;
    return {
      ...p,
      name: e.name,
      squareTeamMemberId: e.squareTeamMemberId,
      totalHours: p.regularHours + p.overtimeHours,
      burden,
      cost: p.wages + burden,
      openCards: cards.filter((c) => c.employeeId === p.employeeId && !c.clockOut).length,
    };
  });
  lines.sort((a, b) => a.name.localeCompare(b.name));
  return { lines, cards, rules };
}

// ---- Square sync ---------------------------------------------------------------

/**
 * Pull team members, wages and timecards from Square for business dates
 * [from, toExclusive). Employees match on Square id (or, the first time, on
 * an unlinked employee with the same name); timecards upsert on Square id.
 */
export async function syncLabor(from: ISODate, toExclusive: ISODate): Promise<{ skipped: string } | { members: number; timecards: number; positionsCreated: number }> {
  if (!squareConfigured()) return { skipped: "Square isn't connected — add the access token and location ID first." };

  const members = await listTeamMembers();
  const positions = await db.position.findMany();
  const posByName = new Map(positions.map((p) => [p.name.toLowerCase(), p.id]));
  let positionsCreated = 0;
  const positionFor = async (title: string | null) => {
    if (!title) return null;
    const hit = posByName.get(title.toLowerCase());
    if (hit) return hit;
    const created = await db.position.create({ data: { name: title, sort: positions.length + positionsCreated } });
    positionsCreated++;
    posByName.set(title.toLowerCase(), created.id);
    return created.id;
  };

  const empBySquare = new Map<string, string>();
  for (const m of members) {
    const jobs = await getWageJobs(m.id);
    const baseRate = jobs.find((j) => j.hourlyRate != null)?.hourlyRate ?? null;
    let emp = await db.employee.findUnique({ where: { squareTeamMemberId: m.id } });
    if (!emp) emp = await db.employee.findFirst({ where: { squareTeamMemberId: null, name: { equals: m.name, mode: "insensitive" } } });
    const data = {
      name: m.name,
      email: m.email,
      phone: m.phone,
      active: m.active,
      squareTeamMemberId: m.id,
      ...(baseRate != null ? { hourlyRate: new Prisma.Decimal(baseRate.toFixed(2)) } : {}),
    };
    emp = emp ? await db.employee.update({ where: { id: emp.id }, data }) : await db.employee.create({ data });
    empBySquare.set(m.id, emp.id);
    for (const j of jobs) {
      const positionId = await positionFor(j.title);
      if (!positionId) continue;
      const rate = j.hourlyRate != null ? new Prisma.Decimal(j.hourlyRate.toFixed(2)) : null;
      await db.employeePosition.upsert({
        where: { employeeId_positionId: { employeeId: emp.id, positionId } },
        create: { employeeId: emp.id, positionId, rate },
        update: { rate },
      });
    }
  }

  const { gte, lt } = dayBounds(from, toExclusive);
  const cards = await listTimecards(gte.toISOString(), lt.toISOString());
  let saved = 0;
  for (const c of cards) {
    const employeeId = empBySquare.get(c.teamMemberId);
    if (!employeeId) continue; // team member at another location
    const data = {
      employeeId,
      positionId: await positionFor(c.jobTitle),
      clockIn: new Date(c.startAt),
      clockOut: c.endAt ? new Date(c.endAt) : null,
      breakMinutes: c.unpaidBreakMinutes,
      hourlyRate: c.hourlyRate != null ? new Prisma.Decimal(c.hourlyRate.toFixed(2)) : null,
      source: "SQUARE" as const,
    };
    await db.timecard.upsert({ where: { squareId: c.id }, create: { ...data, squareId: c.id }, update: data });
    saved++;
  }
  await db.setting.upsert({
    where: { key: "square.lastLaborSync" },
    create: { key: "square.lastLaborSync", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
  return { members: members.length, timecards: saved, positionsCreated };
}

export async function lastLaborSync() {
  const s = await db.setting.findUnique({ where: { key: "square.lastLaborSync" } });
  return s ? new Date(s.value) : null;
}
