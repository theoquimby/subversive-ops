import "server-only";
import { addDays, businessDate, ISODate } from "@/domain/dates";
import { payForWeek, PayLine } from "@/domain/labor";
import { mergePositionRate, mergeTeamMember, parseTeamDiffs, type TeamDiff } from "@/domain/teamSync";
import { blockHours, zonedTime } from "@/domain/timecards";
import { Prisma } from "@prisma/client";
import { db, num } from "../db";
import { env } from "../env";
import { SquareClient } from "../integrations/square-http";
import { getWageJobs, listTeamMembers, listTimecards } from "../integrations/square-labor";
import { isSquareConnected, recordSquareSync, requireSquareClient } from "./square";
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

type PositionResolver = (title: string | null) => Promise<string | null>;

async function positionResolver(): Promise<{ resolve: PositionResolver; created: () => number }> {
  const positions = await db.position.findMany();
  const posByName = new Map(positions.map((p) => [p.name.toLowerCase(), p.id]));
  let created = 0;
  const resolve: PositionResolver = async (title) => {
    if (!title) return null;
    const hit = posByName.get(title.toLowerCase());
    if (hit) return hit;
    const row = await db.position.create({ data: { name: title, sort: positions.length + created } });
    created++;
    posByName.set(title.toLowerCase(), row.id);
    return row.id;
  };
  return { resolve, created: () => created };
}

export const TEAM_DIFFS_KEY = "team.squareDiffs";
const SYNC_DEACTIVATED_KEY = "team.squareDeactivated";

/** Where Square disagrees with what was set in Ops, by employee id (from the last team sync). */
export async function squareTeamDiffs(): Promise<Record<string, TeamDiff[]>> {
  return parseTeamDiffs((await db.setting.findUnique({ where: { key: TEAM_DIFFS_KEY } }))?.value);
}

const D2 = (n: number) => new Prisma.Decimal(n.toFixed(2));

/**
 * Pull team members and their wage settings from Square. Employees match on
 * Square id (or, the first time, on an unlinked employee with the same name).
 * New people come straight from Square. For people we already have, Square only
 * fills blanks: names, contact details and pay rates edited in Ops are kept and any
 * difference is recorded for /team. Deactivations in Square carry over; someone
 * deactivated in Ops is never reactivated by the sync.
 */
export async function syncSquareTeam(client?: SquareClient) {
  const c = client ?? (await requireSquareClient());
  const members = await listTeamMembers(c);
  const pos = await positionResolver();
  const syncDeactivated = new Set<string>(parseIdList((await db.setting.findUnique({ where: { key: SYNC_DEACTIVATED_KEY } }))?.value));
  const diffs: Record<string, TeamDiff[]> = {};
  const positionNames = new Map((await db.position.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  for (const m of members) {
    const jobs = await getWageJobs(c, m.id);
    const baseRate = jobs.find((j) => j.hourlyRate != null)?.hourlyRate ?? null;
    let emp = await db.employee.findUnique({ where: { squareTeamMemberId: m.id } });
    if (!emp) emp = await db.employee.findFirst({ where: { squareTeamMemberId: null, name: { equals: m.name, mode: "insensitive" } } });
    const merge = mergeTeamMember(
      emp ? { name: emp.name, email: emp.email, phone: emp.phone, hourlyRate: num(emp.hourlyRate), active: emp.active } : null,
      { name: m.name, email: m.email, phone: m.phone, hourlyRate: baseRate, active: m.active },
      emp ? syncDeactivated.has(emp.id) : false,
    );
    const { hourlyRate, ...rest } = merge.data;
    const data = { ...rest, squareTeamMemberId: m.id, ...(hourlyRate != null ? { hourlyRate: D2(hourlyRate) } : {}) };
    if (emp) emp = await db.employee.update({ where: { id: emp.id }, data });
    else emp = await db.employee.create({ data: { ...data, name: m.name } });
    if (merge.deactivatedBySync) syncDeactivated.add(emp.id);
    if (emp.active) syncDeactivated.delete(emp.id);
    const empDiffs = [...merge.diffs];
    const current = new Map((await db.employeePosition.findMany({ where: { employeeId: emp.id }, select: { positionId: true, rate: true } })).map((p) => [p.positionId, p]));
    for (const j of jobs) {
      const positionId = await pos.resolve(j.title);
      if (!positionId) continue;
      const have = current.get(positionId);
      if (!have) {
        await db.employeePosition.create({ data: { employeeId: emp.id, positionId, rate: j.hourlyRate != null ? D2(j.hourlyRate) : null } });
        continue;
      }
      const r = mergePositionRate(num(have.rate), j.hourlyRate, positionNames.get(positionId) ?? j.title ?? "Position");
      if (r.rate != null) await db.employeePosition.update({ where: { employeeId_positionId: { employeeId: emp.id, positionId } }, data: { rate: D2(r.rate) } });
      if (r.diff) empDiffs.push(r.diff);
    }
    if (empDiffs.length) diffs[emp.id] = empDiffs;
  }
  await Promise.all([
    db.setting.upsert({ where: { key: TEAM_DIFFS_KEY }, create: { key: TEAM_DIFFS_KEY, value: JSON.stringify(diffs) }, update: { value: JSON.stringify(diffs) } }),
    db.setting.upsert({ where: { key: SYNC_DEACTIVATED_KEY }, create: { key: SYNC_DEACTIVATED_KEY, value: JSON.stringify([...syncDeactivated]) }, update: { value: JSON.stringify([...syncDeactivated]) } }),
  ]);
  return { members: members.length, positionsCreated: pos.created(), differences: Object.keys(diffs).length };
}

function parseIdList(raw: string | null | undefined): string[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Timecards that started in business dates [from, toExclusive), upserted on
 * Square id. Cards a manager corrected here (manuallyEdited) or that sit in
 * an approved week (approvedAt) are never overwritten. Unknown team members
 * trigger one team sync.
 */
export async function syncSquareTimecards(from: ISODate, toExclusive: ISODate, client?: SquareClient) {
  const c = client ?? (await requireSquareClient());
  const { gte, lt } = dayBounds(from, toExclusive);
  const cards = await listTimecards(c, gte.toISOString(), lt.toISOString());
  const loadEmployees = async () =>
    new Map((await db.employee.findMany({ where: { squareTeamMemberId: { not: null } }, select: { id: true, squareTeamMemberId: true } })).map((e) => [e.squareTeamMemberId!, e.id]));
  let empBySquare = await loadEmployees();
  let team: Awaited<ReturnType<typeof syncSquareTeam>> | null = null;
  if (cards.some((x) => !empBySquare.has(x.teamMemberId))) {
    team = await syncSquareTeam(c);
    empBySquare = await loadEmployees();
  }
  const existing = new Map(
    (await db.timecard.findMany({ where: { squareId: { in: cards.map((x) => x.id) } }, select: { squareId: true, manuallyEdited: true, approvedAt: true } })).map((t) => [t.squareId!, t]),
  );
  const pos = await positionResolver();
  let saved = 0;
  let kept = 0;
  for (const card of cards) {
    const employeeId = empBySquare.get(card.teamMemberId);
    if (!employeeId) continue; // team member at another location
    const prev = existing.get(card.id);
    if (prev && (prev.manuallyEdited || prev.approvedAt)) {
      kept++;
      continue;
    }
    const data = {
      employeeId,
      positionId: await pos.resolve(card.jobTitle),
      clockIn: new Date(card.startAt),
      clockOut: card.endAt ? new Date(card.endAt) : null,
      breakMinutes: card.unpaidBreakMinutes,
      hourlyRate: card.hourlyRate != null ? new Prisma.Decimal(card.hourlyRate.toFixed(2)) : null,
      source: "SQUARE" as const,
    };
    await db.timecard.upsert({ where: { squareId: card.id }, create: { ...data, squareId: card.id }, update: data });
    saved++;
  }
  await db.setting.upsert({
    where: { key: "square.lastLaborSync" },
    create: { key: "square.lastLaborSync", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
  await recordSquareSync("labor", saved, `${from} → ${addDays(toExclusive, -1)}${kept ? `, ${kept} edited kept` : ""}`);
  return { timecards: saved, keptEdited: kept, members: team?.members ?? 0, positionsCreated: (team?.positionsCreated ?? 0) + pos.created() };
}

/** Team members, wages and timecards for business dates [from, toExclusive). */
export async function syncLabor(from: ISODate, toExclusive: ISODate): Promise<{ skipped: string } | { members: number; timecards: number; keptEdited: number; positionsCreated: number; differences: number }> {
  if (!(await isSquareConnected())) return { skipped: "Square isn't connected — connect it under Settings → Square first." };
  const client = await requireSquareClient();
  const team = await syncSquareTeam(client);
  const cards = await syncSquareTimecards(from, toExclusive, client);
  return { members: team.members, timecards: cards.timecards, keptEdited: cards.keptEdited, positionsCreated: team.positionsCreated + cards.positionsCreated, differences: team.differences };
}

export async function lastLaborSync() {
  const s = await db.setting.findUnique({ where: { key: "square.lastLaborSync" } });
  return s ? new Date(s.value) : null;
}
