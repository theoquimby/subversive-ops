import { positionColor } from "@/domain/positionColors";
import { PageHeader } from "@/components/ui";
import { addDays, ISODate, toISODate, weekday } from "@/domain/dates";
import { DayCoverage, inclusiveDates, shiftLabel, shiftPaidHours, weekStartOf } from "@/domain/schedule";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { requestHours, sickBalances } from "@/server/services/payroll";
import { businessToday } from "@/server/services/sales";
import { instantAt, loadWeek, shiftView, WeekData } from "@/server/services/scheduling";
import { RequestsList } from "./requests-list";
import { SwapRequests, type SwapRow } from "./swap-requests";
import { candidatesFor, checkTaker, getSwapRules, weekCache } from "@/server/services/swaps";
import { parseSwapLog, swapStage, type SwapKind } from "@/domain/swaps";
import { dayDate } from "@/lib/format";

export const metadata = { title: "Schedule requests" };

const MAX_COVERAGE_DAYS = 14;

export default async function RequestsPage() {
  await requireUser("MANAGER");
  const today = businessToday();
  const [off, swaps, recentOff, recentSwaps, swapRules] = await Promise.all([
    db.timeOffRequest.findMany({ where: { status: "PENDING" }, orderBy: { startDate: "asc" }, include: { employee: { select: { name: true } } } }),
    db.shiftSwap.findMany({ where: { status: "PENDING", shift: { start: { gte: new Date() } } }, orderBy: { createdAt: "asc" }, include: { shift: { include: { position: true } }, requester: { select: { name: true } }, taker: { select: { name: true } }, offeredShift: true } }),
    db.timeOffRequest.findMany({ where: { status: { not: "PENDING" }, endDate: { gte: new Date(`${addDays(today, -30)}T00:00:00Z`) } }, orderBy: { startDate: "desc" }, take: 15, include: { employee: { select: { name: true } } } }),
    db.shiftSwap.findMany({ where: { status: { not: "PENDING" } }, orderBy: { createdAt: "desc" }, take: 15, include: { shift: { include: { position: true } }, requester: { select: { name: true } }, taker: { select: { name: true } }, offeredShift: true } }),
    getSwapRules(),
  ]);

  // Week data (forecast needs, shifts, time off) shared by every request in that week.
  const weeks = new Map<ISODate, Promise<WeekData>>();
  const week = (date: ISODate) => {
    const m = weekStartOf(date);
    if (!weeks.has(m)) weeks.set(m, loadWeek(m));
    return weeks.get(m)!;
  };
  const allOff = await db.timeOffRequest.findMany({
    where: { status: { in: ["APPROVED", "PENDING"] }, endDate: { gte: new Date(`${today}T00:00:00Z`) } },
    include: { employee: { select: { name: true } } },
  });
  const sick = await sickBalances(today, [...new Set(off.filter((r) => r.type === "SICK").map((r) => r.employeeId))]);

  const timeOff = await Promise.all(
    off.map(async (r) => {
      const s = toISODate(r.startDate);
      const e = toISODate(r.endDate);
      const rows = await db.shift.findMany({ where: { employeeId: r.employeeId, start: { gte: instantAt(s, 0), lt: instantAt(addDays(e, 1), 0) } }, orderBy: { start: "asc" } });
      const theirs = rows.map(shiftView);
      const days = inclusiveDates(s, e);
      const coverage: DayCoverage[] = [];
      for (const date of days.slice(0, MAX_COVERAGE_DAYS)) {
        if (date < today) continue;
        const w = await week(date);
        const sum = w.summary.days.find((d) => d.date === date);
        if (!w.opening[weekday(date)]) continue; // closed
        const others = allOff.filter((o) => o.id !== r.id && o.employeeId !== r.employeeId && toISODate(o.startDate) <= date && toISODate(o.endDate) >= date);
        coverage.push({
          date,
          off: others.filter((o) => o.status === "APPROVED").map((o) => o.employee.name),
          asking: others.filter((o) => o.status === "PENDING").map((o) => o.employee.name),
          scheduledHours: w.shifts.filter((x) => x.date === date && x.employeeId).reduce((a, x) => a + shiftPaidHours(x), 0),
          neededHours: sum?.requiredHours ?? 0,
          theirHours: theirs.filter((x) => x.date === date).reduce((a, x) => a + shiftPaidHours(x), 0),
        });
      }
      return {
        id: r.id,
        name: r.employee.name,
        start: s,
        end: e,
        days: days.length,
        note: r.note,
        status: r.status,
        type: r.type,
        hours: r.type === "UNPAID" ? null : await requestHours(r),
        sickAvailable: r.type === "SICK" ? sick.get(r.employeeId)?.available ?? 0 : null,
        clashes: theirs.map((v) => ({ date: v.date, time: shiftLabel(v.startMin, v.endMin), published: v.published })),
        coverage,
      };
    }),
  );

  const cache = weekCache();
  const tradeLabel = (sh: { start: Date; end: Date; breakMinutes: number; id: string; employeeId: string | null; positionId: string; notes: string | null; published: boolean } | null) => {
    if (!sh) return null;
    const v = shiftView(sh);
    return `${dayDate(v.date)} ${shiftLabel(v.startMin, v.endMin)}`;
  };
  const swapRow = async (w: (typeof swaps)[number], live: boolean): Promise<SwapRow> => {
    const v = shiftView(w.shift);
    const checks: SwapRow["checks"] = [];
    if (live && w.takerId && w.kind !== "DROP") {
      const c = await checkTaker(v, w.takerId, cache, w.offeredShiftId);
      checks.push({ who: w.taker?.name ?? "Taker", eligible: c.eligible, reasons: c.reasons, warnings: c.warnings });
      if (w.kind === "SWAP" && w.offeredShift) {
        const back = await checkTaker(shiftView(w.offeredShift), w.requesterId, cache, w.shiftId);
        checks.push({ who: w.requester.name, eligible: back.eligible, reasons: back.reasons, warnings: back.warnings });
      }
    }
    const candidates = live && w.kind !== "SWAP"
      ? (await candidatesFor(v, w.kind === "PICKUP" ? [] : [w.requesterId], cache)).map((c) => ({ id: c.id, name: c.name, eligible: c.check.eligible, reasons: c.check.reasons, warnings: c.check.warnings, hoursBefore: c.check.hoursBefore, hoursAfter: c.check.hoursAfter }))
      : [];
    return {
      id: w.id,
      kind: w.kind as SwapKind,
      stage: swapStage(w),
      requester: w.requester.name,
      taker: w.taker?.name ?? null,
      takerId: w.takerId,
      date: v.date,
      time: shiftLabel(v.startMin, v.endMin),
      position: w.shift.position.name,
      color: positionColor(w.shift.position.color),
      note: w.note,
      giving: tradeLabel(w.offeredShift),
      checks,
      candidates,
      log: parseSwapLog(w.log),
      auto: w.autoApproved,
      decidedBy: w.decidedBy,
    };
  };
  const needsMe = swaps.filter((w) => w.claimedAt || w.kind === "DROP");
  const offered = swaps.filter((w) => !w.claimedAt && w.kind !== "DROP");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader help="schedule.requests" title="Requests" description="Time off, swaps, drops and pickups from the team — with who else is off, how each day is covered, and whether the person taking a shift passes the schedule rules." back={{ href: "/schedule", label: "Schedule" }} />
      <div className="flex flex-col gap-10">
        <RequestsList
          timeOff={timeOff}
          recentOff={recentOff.map((r) => ({ id: r.id, name: r.employee.name, start: toISODate(r.startDate), end: toISODate(r.endDate), days: 0, note: r.note, status: r.status, type: r.type, hours: r.hours?.toNumber() ?? null, sickAvailable: null, clashes: [], coverage: [] }))}
        />
        <SwapRequests
          decide={await Promise.all(needsMe.map((w) => swapRow(w, true)))}
          open={await Promise.all(offered.map((w) => swapRow(w, true)))}
          recent={await Promise.all(recentSwaps.map((w) => swapRow(w, false)))}
          rules={swapRules}
        />
      </div>
    </div>
  );
}
