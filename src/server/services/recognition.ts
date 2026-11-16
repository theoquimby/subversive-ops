import "server-only";
import { addDays, toISODate, type ISODate } from "@/domain/dates";
import { dateMilestones, parseRecognition, perfectAttendance, pointsBalance, trainingMilestones, type Milestone, type RecognitionConfig } from "@/domain/recognition";
import { db } from "../db";
import { businessToday } from "./sales";
import { instantAt, shiftView } from "./scheduling";

/** Shout-outs, milestones and the points/rewards list. */

export const RECOGNITION_KEY = "recognition.config";

export async function getRecognitionConfig(): Promise<RecognitionConfig> {
  return parseRecognition((await db.setting.findUnique({ where: { key: RECOGNITION_KEY } }))?.value);
}

export async function saveRecognitionConfig(c: RecognitionConfig) {
  const value = JSON.stringify(c);
  await db.setting.upsert({ where: { key: RECOGNITION_KEY }, create: { key: RECOGNITION_KEY, value }, update: { value } });
}

export interface ShoutoutView {
  id: string;
  employeeId: string;
  to: string;
  from: string;
  value: string | null;
  body: string;
  points: number;
  hidden: boolean;
  createdAt: string;
}

const view = (s: { id: string; employeeId: string; employee: { name: string }; fromName: string; value: string | null; body: string; points: number; hidden: boolean; createdAt: Date }): ShoutoutView => ({
  id: s.id,
  employeeId: s.employeeId,
  to: s.employee.name,
  from: s.fromName,
  value: s.value,
  body: s.body,
  points: s.points,
  hidden: s.hidden,
  createdAt: s.createdAt.toISOString(),
});

/** The team feed: newest first, hidden ones only for managers. */
export async function recentShoutouts(opts: { days?: number; limit?: number; includeHidden?: boolean; employeeId?: string } = {}) {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const rows = await db.shoutout.findMany({
    where: { createdAt: { gte: since }, ...(opts.includeHidden ? {} : { hidden: false }), ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 30,
    include: { employee: { select: { name: true } } },
  });
  return rows.map(view);
}

export async function balanceFor(employeeId: string) {
  const [earned, spent] = await Promise.all([
    db.shoutout.findMany({ where: { employeeId }, select: { points: true, hidden: true } }),
    db.rewardRedemption.findMany({ where: { employeeId }, select: { points: true, status: true } }),
  ]);
  return pointsBalance(earned, spent);
}

/**
 * Milestones in a window (default: the last 7 days through the next 7):
 * anniversaries and first months from start dates, perfect attendance over
 * the last 4 weeks from timecards vs published shifts, and finished training.
 */
export async function milestones(from: ISODate = addDays(businessToday(), -7), to: ISODate = addDays(businessToday(), 7)): Promise<Milestone[]> {
  const today = businessToday();
  const windowStart = addDays(today, -28);
  const [emps, shifts, cards, training] = await Promise.all([
    db.employee.findMany({ where: { active: true }, select: { id: true, name: true, startDate: true, createdAt: true } }),
    db.shift.findMany({ where: { published: true, employeeId: { not: null }, start: { gte: instantAt(windowStart, 0), lt: instantAt(today, 0) } } }),
    db.timecard.findMany({ where: { clockIn: { gte: instantAt(addDays(windowStart, -1), 0), lt: instantAt(today, 0) } }, select: { employeeId: true, clockIn: true } }),
    db.trainingAssignment.findMany({ where: { OR: [{ completedAt: { not: null } }, { signedOffAt: { not: null } }], employee: { active: true } }, select: { employeeId: true, completedAt: true, signedOffAt: true, employee: { select: { name: true } }, module: { select: { title: true } } } }),
  ]);
  const names = new Map(emps.map((e) => [e.id, e.name]));
  const out: Milestone[] = dateMilestones(
    emps.map((e) => ({ id: e.id, name: e.name, start: toISODate(e.startDate ?? e.createdAt) })),
    from,
    to,
  );
  const perfect = perfectAttendance(
    shifts.map((s) => ({ employeeId: s.employeeId!, date: shiftView(s).date, start: s.start.getTime() })),
    cards.map((c) => ({ employeeId: c.employeeId, clockIn: c.clockIn.getTime() })),
  );
  for (const id of perfect) out.push({ employeeId: id, name: names.get(id) ?? "", kind: "perfect-attendance", title: `${(names.get(id) ?? "").split(" ")[0]}: on time for every shift, 4 weeks running`, date: addDays(today, -1) });
  out.push(
    ...trainingMilestones(
      training.map((t) => ({ employeeId: t.employeeId, name: t.employee.name, module: t.module.title, date: toISODate((t.signedOffAt ?? t.completedAt)!) })),
      from,
      to,
    ),
  );
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function rewardsList(includeInactive = false) {
  return db.reward.findMany({ where: includeInactive ? {} : { active: true }, orderBy: [{ sort: "asc" }, { cost: "asc" }] });
}
