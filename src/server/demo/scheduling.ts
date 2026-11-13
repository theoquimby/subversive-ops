/**
 * Scheduling demo: availability, time-off and swap requests, a published
 * schedule for this week and an unpublished draft for next week.
 * Assumes positions and employees exist (seedLabor). Safe to re-run: it
 * replaces shifts in those two weeks and its own requests.
 */

import type { PrismaClient } from "@prisma/client";
import { addDays, parseISODate, todayIn, weekday } from "../../domain/dates";
import { assignShifts, curveToBlocks, defaultBreakMinutes, NY_DEFAULT_RULES } from "../../domain/labor";
import { clipAvailability, dayRequirement, hourlySalesOrFallback, parseAvailability, splitLongBlocks, weekDates, weekStartOf, zonedInstant } from "../../domain/schedule";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const DEFAULT_OPENING: Record<number, [number, number]> = { 0: [12, 19], 1: [16, 20], 3: [16, 20], 4: [16, 20], 5: [16, 21], 6: [12, 21] };
// Typical daily sales by weekday, used only to shape the demo schedule.
const NOMINAL_SALES = [3200, 1500, 0, 1600, 1900, 3800, 4600];

const AVAILABILITY_PATTERNS: (Record<string, [string, string][]> | null)[] = [
  null, // anytime
  { "0": [["11:00", "22:00"]], "1": [["15:00", "22:00"]], "3": [["15:00", "22:00"]], "4": [["15:00", "22:00"]], "5": [["15:00", "23:00"]], "6": [["11:00", "23:00"]] },
  { "4": [["15:00", "22:00"]], "5": [["15:00", "23:00"]], "6": [["11:00", "23:00"]], "0": [["11:00", "20:00"]] },
  { "1": [["15:00", "22:00"]], "3": [["15:00", "22:00"]], "5": [["16:00", "23:00"]], "6": [["11:00", "18:00"]] },
  null,
  { "0": [["11:00", "21:00"]], "3": [["14:00", "22:00"]], "4": [["14:00", "22:00"]], "5": [["14:00", "23:00"]], "6": [["11:00", "23:00"]] },
];

export async function seedScheduling(db: PrismaClient): Promise<void> {
  const [positions, employees, openingSetting, line] = await Promise.all([
    db.position.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] }),
    db.employee.findMany({ where: { active: true }, include: { positions: true }, orderBy: { name: "asc" } }),
    db.setting.findUnique({ where: { key: "openingHours" } }),
    db.user.findFirst({ where: { name: "Line" } }),
  ]);
  if (!positions.length || !employees.length) return;
  const opening: Record<number, [number, number]> = openingSetting ? JSON.parse(openingSetting.value) : DEFAULT_OPENING;

  // Line (staff login) gets an employee record so the staff app has something to show.
  if (line && !employees.some((e) => e.userId === line.id)) {
    const pick = employees.find((e) => !e.userId && e.positions.length > 0 && !e.isMinor);
    if (pick) {
      await db.employee.update({ where: { id: pick.id }, data: { userId: line.id } });
      pick.userId = line.id;
    }
  }

  // Availability: leave the Line employee and managers open; give everyone else a pattern.
  for (const [i, e] of employees.entries()) {
    if (e.availability != null) continue;
    const pattern = e.userId ? null : AVAILABILITY_PATTERNS[i % AVAILABILITY_PATTERNS.length];
    if (pattern) {
      await db.employee.update({ where: { id: e.id }, data: { availability: pattern } });
      e.availability = pattern;
    }
  }

  const today = todayIn(TZ);
  const thisWeek = weekStartOf(today);
  const nextWeek = addDays(thisWeek, 7);
  const ids = employees.map((e) => e.id);

  // Requests: approved time off next week, pending time off later, a pending swap.
  await db.shiftSwap.deleteMany({ where: { requesterId: { in: ids } } });
  await db.timeOffRequest.deleteMany({ where: { employeeId: { in: ids } } });
  const at = (i: number) => employees[i % employees.length];
  const offApproved = { employeeId: at(2).id, start: addDays(nextWeek, 4), end: addDays(nextWeek, 5) };
  await db.timeOffRequest.createMany({
    data: [
      { employeeId: offApproved.employeeId, startDate: parseISODate(offApproved.start), endDate: parseISODate(offApproved.end), note: "Sister's wedding", status: "APPROVED" },
      { employeeId: at(3).id, startDate: parseISODate(addDays(nextWeek, 9)), endDate: parseISODate(addDays(nextWeek, 11)), note: "Family visit", status: "PENDING" },
      { employeeId: at(5).id, startDate: parseISODate(addDays(nextWeek, 6)), endDate: parseISODate(addDays(nextWeek, 6)), note: "Concert in Albany", status: "PENDING" },
      { employeeId: at(4).id, startDate: parseISODate(addDays(thisWeek, 6)), endDate: parseISODate(addDays(thisWeek, 6)), type: "SICK", note: "Fever", status: "PENDING" },
      { employeeId: at(6).id, startDate: parseISODate(addDays(thisWeek, -12)), endDate: parseISODate(addDays(thisWeek, -12)), type: "SICK", hours: 6, status: "APPROVED" },
      { employeeId: at(1).id, startDate: parseISODate(addDays(thisWeek, -10)), endDate: parseISODate(addDays(thisWeek, -9)), status: "DENIED" },
    ],
  });

  // Shifts for this week (published) and next week (draft).
  for (const [monday, published] of [[thisWeek, true], [nextWeek, false]] as const) {
    const dates = weekDates(monday);
    await db.shift.deleteMany({ where: { start: { gte: zonedInstant(monday, 0, TZ), lt: zonedInstant(addDays(monday, 7), 0, TZ) } } });
    const blocks: { positionId: string; day: string; weekday: number; startHour: number; endHour: number }[] = [];
    for (const date of dates) {
      const wd = weekday(date);
      const hours = hourlySalesOrFallback(new Array(24).fill(0), NOMINAL_SALES[wd] * (published ? 1 : 1.05), opening[wd]);
      const req = dayRequirement(hours, positions.map((p) => ({ id: p.id, name: p.name, salesPerHour: p.salesPerHour?.toNumber() ?? null, minStaff: p.minStaff, maxStaff: p.maxStaff })), opening[wd]);
      for (const p of positions) for (const b of splitLongBlocks(curveToBlocks(req.get(p.id) ?? [], 4))) blocks.push({ positionId: p.id, day: date, weekday: wd, ...b });
    }
    const off = published ? [] : [offApproved.start, offApproved.end].map((day) => ({ employeeId: offApproved.employeeId, day }));
    const people = employees
      .filter((e) => e.positions.length)
      .map((e) => {
        const a = parseAvailability(e.availability);
        return { id: e.id, name: e.name, rate: e.hourlyRate?.toNumber() ?? null, positionIds: e.positions.map((p) => p.positionId), isMinor: e.isMinor, maxHoursWeek: e.maxHoursWeek, availability: e.isMinor ? clipAvailability(a, NY_DEFAULT_RULES.minorLatestHour) : a };
      });
    const planned = assignShifts(blocks, people, off);
    // Leave one open shift on the busiest day of the published week so there's something to pick up.
    let leftOpen = !published;
    await db.shift.createMany({
      data: planned.map((s) => {
        let employeeId = s.employeeId;
        if (!leftOpen && employeeId && weekday(s.day) === 6 && s.endHour - s.startHour <= 6) {
          employeeId = null;
          leftOpen = true;
        }
        const breakMinutes = defaultBreakMinutes(s.endHour - s.startHour, NY_DEFAULT_RULES);
        return { employeeId, positionId: s.positionId, start: zonedInstant(s.day, s.startHour * 60, TZ), end: zonedInstant(s.day, s.endHour * 60, TZ), breakMinutes, published };
      }),
    });
  }

  // Card tips per day (normally written by the Square sync) so the tip pool has something to split.
  const since = addDays(today, -28);
  const sales = await db.dailySale.groupBy({ by: ["date"], where: { date: { gte: parseISODate(since), lt: parseISODate(today) } }, _sum: { netSales: true } });
  const haveTips = new Set((await db.setting.findMany({ where: { key: { startsWith: "tips." } }, select: { key: true } })).map((s) => s.key));
  for (const s of sales) {
    const key = `tips.${s.date.toISOString().slice(0, 10)}`;
    const net = s._sum.netSales?.toNumber() ?? 0;
    if (haveTips.has(key) || net <= 0) continue;
    await db.setting.create({ data: { key, value: (net * (0.13 + ((s.date.getUTCDate() % 5) * 0.01))).toFixed(2) } });
  }

  // A pending swap: someone gives away a shift later this week.
  const later = await db.shift.findFirst({ where: { published: true, employeeId: { not: null }, start: { gte: new Date() } }, orderBy: { start: "desc" } });
  if (later?.employeeId) await db.shiftSwap.create({ data: { shiftId: later.id, requesterId: later.employeeId } });

  // A pinned announcement for My shifts (only if there are none yet).
  if ((await db.announcement.count()) === 0) {
    await db.announcement.create({ data: { body: "New fall menu starts Thursday. Tasting at 3:30 before service, so come in 30 minutes early (paid).", author: "Max", pinned: true } });
  }
}
