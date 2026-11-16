/**
 * Workforce demo: a new-hire checklist for the Line login and one more new
 * hire, swaps in each state (offered, asked of Line, claimed, approved), an
 * open shift, shout-outs with points and rewards, a finalized tip pool, a
 * staff message, and the payroll provider. Assumes seedLabor + seedScheduling.
 * Safe to re-run: it removes its own rows first.
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { addDays, parseISODate, todayIn } from "../../domain/dates";
import { defaultTemplateItems } from "../../domain/onboarding";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const log = (by: string, what: string, daysAgo = 0) => ({ at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), by, what });

export async function seedWorkforce(db: PrismaClient): Promise<void> {
  const today = todayIn(TZ);
  const line = await db.user.findFirst({ where: { name: "Line" } });
  const me = line ? await db.employee.findUnique({ where: { userId: line.id }, include: { positions: true } }) : null;
  if (!me) return;
  const max = await db.user.findFirst({ where: { role: "MANAGER" } });

  // ---- Clean up our own rows --------------------------------------------------------------
  await db.shiftSwap.deleteMany({ where: { note: { startsWith: "[demo]" } } });
  await db.onboarding.deleteMany({});
  await db.onboardingTemplate.deleteMany({});
  await db.shoutout.deleteMany({});
  await db.rewardRedemption.deleteMany({});
  await db.reward.deleteMany({});
  await db.staffMessage.deleteMany({});
  await db.employee.deleteMany({ where: { name: "Remy Stone" } });

  await db.setting.upsert({ where: { key: "payroll.provider" }, create: { key: "payroll.provider", value: JSON.stringify({ id: "GUSTO" }) }, update: { value: JSON.stringify({ id: "GUSTO" }) } });
  await db.setting.upsert({ where: { key: "recognition.config" }, create: { key: "recognition.config", value: JSON.stringify({ pointsEnabled: true, peerShoutouts: true, managerPoints: 10 }) }, update: { value: JSON.stringify({ pointsEnabled: true, peerShoutouts: true, managerPoints: 10 }) } });

  // ---- Onboarding ------------------------------------------------------------------------
  const tpl = await db.onboardingTemplate.create({ data: { name: "Everyone", items: { create: defaultTemplateItems("Gusto").map((it, i) => ({ ...it, detail: it.detail ?? null, sort: i })) } }, include: { items: { orderBy: { sort: "asc" } } } });
  const posId = me.positions[0]?.positionId;
  const remy = await db.employee.create({ data: { name: "Remy Stone", email: "remy@example.com", startDate: parseISODate(addDays(today, -2)), positions: posId ? { create: [{ positionId: posId }] } : undefined } });
  for (const [who, start, seen] of [[me.id, addDays(today, -3), false], [remy.id, addDays(today, -2), true]] as const) {
    await db.employee.update({ where: { id: who }, data: { startDate: parseISODate(start) } });
    await db.onboarding.create({
      data: {
        employeeId: who,
        templateId: tpl.id,
        startDate: parseISODate(start),
        dueOn: parseISODate(addDays(start, 14)),
        createdBy: "Max",
        seenAt: seen ? new Date() : null,
        items: { create: tpl.items.map((it, i) => ({ sort: i, kind: it.kind, title: it.title, detail: it.detail, refId: it.refId, required: it.required, staffCanTick: it.staffCanTick, doneAt: who === remy.id && it.kind === "TASK" && i === 6 ? new Date() : null, doneBy: who === remy.id && it.kind === "TASK" && i === 6 ? "Max" : null })) },
      },
    });
  }

  // ---- Swaps -----------------------------------------------------------------------------
  const now = new Date();
  const coworkers = await db.employee.findMany({ where: { active: true, id: { not: me.id }, positions: { some: { positionId: { in: me.positions.map((p) => p.positionId) } } } }, select: { id: true, name: true } });
  const theirShifts = await db.shift.findMany({ where: { published: true, start: { gt: now }, employeeId: { in: coworkers.map((c) => c.id) }, positionId: { in: me.positions.map((p) => p.positionId) } }, orderBy: { start: "asc" }, take: 6 });
  const mine = await db.shift.findMany({ where: { published: true, start: { gt: now }, employeeId: me.id }, orderBy: { start: "asc" }, take: 3 });
  const name = (id: string | null) => coworkers.find((c) => c.id === id)?.name ?? "Someone";
  if (theirShifts[0]) await db.shiftSwap.create({ data: { shiftId: theirShifts[0].id, requesterId: theirShifts[0].employeeId!, kind: "GIVE", note: "[demo] Family thing — can anyone grab it?", log: [log(name(theirShifts[0].employeeId), "Offered it up", 1)] } });
  if (theirShifts[1]) await db.shiftSwap.create({ data: { shiftId: theirShifts[1].id, requesterId: theirShifts[1].employeeId!, takerId: me.id, kind: "GIVE", note: "[demo] You free? Would owe you one", log: [log(name(theirShifts[1].employeeId), "Offered it up — asked one person")] } });
  if (theirShifts[2] && theirShifts[3] && theirShifts[3].employeeId !== theirShifts[2].employeeId) {
    await db.shiftSwap.create({ data: { shiftId: theirShifts[2].id, requesterId: theirShifts[2].employeeId!, takerId: theirShifts[3].employeeId, claimedAt: new Date(), kind: "GIVE", note: "[demo] Concert tickets", log: [log(name(theirShifts[2].employeeId), "Offered it up", 2), log(name(theirShifts[3].employeeId), "Said they'll take it", 1)] } });
  }
  if (mine[1]) await db.shiftSwap.create({ data: { shiftId: mine[1].id, requesterId: me.id, kind: "SWAP", note: "[demo] Need this evening off", log: [log("Line", "Offered it as a trade")] } });
  if (theirShifts[4]) await db.shiftSwap.create({ data: { shiftId: theirShifts[4].id, requesterId: theirShifts[4].employeeId!, takerId: me.id, claimedAt: new Date(Date.now() - 4 * 86_400_000), decidedAt: new Date(Date.now() - 3 * 86_400_000), status: "CANCELLED", kind: "GIVE", note: "[demo] history", log: [log(name(theirShifts[4].employeeId), "Offered it up", 4), log("Line", "Withdrew it", 3)] } });
  // One open shift for Line's position later this week.
  const sample = theirShifts[5] ?? theirShifts[0];
  if (sample) {
    const start = new Date(sample.start.getTime() + 86_400_000);
    await db.shift.create({ data: { positionId: sample.positionId, start, end: new Date(start.getTime() + 5 * 3_600_000), published: true, notes: "Trivia night" } });
  }

  // ---- Recognition ------------------------------------------------------------------------
  const [a, b] = coworkers;
  const shout = (employeeId: string, fromName: string, value: string | null, body: string, points: number, daysAgo: number) =>
    db.shoutout.create({ data: { employeeId, fromName, fromUserId: fromName === "Max" ? max?.id ?? null : null, value, body, points, createdAt: new Date(Date.now() - daysAgo * 86_400_000) } });
  await shout(me.id, "Max", "Got your back", "Covered the patio solo during Saturday's rush and kept every table happy.", 10, 1);
  if (a) await shout(a.id, "Max", "Craft & care", "Re-did the tap list chalkboard — guests keep taking photos of it.", 10, 2);
  if (b) await shout(b.id, "Line", "Guests first", "Remembered a regular's allergy without being asked.", 5, 0);
  await shout(me.id, a?.name ?? "Max", "Own it", "Stayed to help close when we were short.", 5, 5);
  const rewards = await Promise.all([
    db.reward.create({ data: { name: "Growler fill", description: "Any beer on tap", cost: 15, sort: 0 } }),
    db.reward.create({ data: { name: "Shift meal for a friend", cost: 25, sort: 1 } }),
    db.reward.create({ data: { name: "First pick of next month's shifts", cost: 40, sort: 2 } }),
  ]);
  if (a) await db.rewardRedemption.create({ data: { employeeId: a.id, rewardId: rewards[0].id, points: 15 } });

  // ---- Messages ---------------------------------------------------------------------------
  await db.staffMessage.create({ data: { employeeId: me.id, kind: "QUESTION", body: "Can we get a second bar mat for the far well? The old one is torn.", createdAt: new Date(Date.now() - 2 * 86_400_000), reply: "Ordered — should be here Thursday.", repliedAt: new Date(Date.now() - 86_400_000), repliedBy: "Max", readAt: new Date(), readBy: "Max" } });
  if (b) await db.staffMessage.create({ data: { employeeId: b.id, kind: "IDEA", anonymous: true, body: "What if we did a staff tasting of new releases before they go on tap? Easier to sell what we've tried." } });

  // ---- A finalized tip pool for last week (so tips estimates have history) -----------------
  const lastMon = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) - 7);
  const exists = await db.tipPeriod.findFirst({ where: { startDate: parseISODate(lastMon) } });
  if (!exists) {
    const people = [me, ...coworkers.slice(0, 4)];
    await db.tipPeriod.create({
      data: {
        startDate: parseISODate(lastMon),
        endDate: parseISODate(addDays(lastMon, 6)),
        totalTips: new Prisma.Decimal(1840),
        method: "HOURS",
        finalized: true,
        cardTips: new Prisma.Decimal(1380),
        cashTips: new Prisma.Decimal(460),
        allocations: { create: people.map((p, i) => ({ employeeId: p.id, hours: new Prisma.Decimal(18 + i * 3), points: new Prisma.Decimal(18 + i * 3), amount: new Prisma.Decimal(368), cardAmount: new Prisma.Decimal(276), cashAmount: new Prisma.Decimal(92) })) },
      },
    });
  }
}
