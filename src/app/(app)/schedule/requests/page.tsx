import { PageHeader } from "@/components/ui";
import { addDays, ISODate, toISODate, weekday } from "@/domain/dates";
import { DayCoverage, inclusiveDates, shiftLabel, shiftPaidHours, weekStartOf } from "@/domain/schedule";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { requestHours, sickBalances } from "@/server/services/payroll";
import { businessToday } from "@/server/services/sales";
import { instantAt, loadWeek, shiftView, WeekData } from "@/server/services/scheduling";
import { RequestsList } from "./requests-list";

export const metadata = { title: "Schedule requests" };

const MAX_COVERAGE_DAYS = 14;

export default async function RequestsPage() {
  await requireUser("MANAGER");
  const today = businessToday();
  const [off, swaps, recentOff, recentSwaps, team] = await Promise.all([
    db.timeOffRequest.findMany({ where: { status: "PENDING" }, orderBy: { startDate: "asc" }, include: { employee: { select: { name: true } } } }),
    db.shiftSwap.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { shift: { include: { position: true } }, requester: { select: { name: true } }, taker: { select: { name: true } } } }),
    db.timeOffRequest.findMany({ where: { status: { not: "PENDING" }, endDate: { gte: new Date(`${addDays(today, -30)}T00:00:00Z`) } }, orderBy: { startDate: "desc" }, take: 15, include: { employee: { select: { name: true } } } }),
    db.shiftSwap.findMany({ where: { status: { not: "PENDING" } }, orderBy: { createdAt: "desc" }, take: 10, include: { shift: { include: { position: true } }, requester: { select: { name: true } }, taker: { select: { name: true } } } }),
    db.employee.findMany({ where: { active: true }, select: { id: true, name: true, positions: { select: { positionId: true } } }, orderBy: { name: "asc" } }),
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

  const swapRow = async (w: (typeof swaps)[number], withImpact: boolean) => {
    const v = shiftView(w.shift);
    const hours = shiftPaidHours(v);
    const wk = withImpact ? await week(v.date) : null;
    const candidates = team
      .filter((t) => t.id !== w.requesterId && t.positions.some((p) => p.positionId === w.shift.positionId))
      .map((t) => {
        if (!wk) return { value: t.id, label: t.name, note: null as string | null };
        const e = wk.employees.find((x) => x.id === t.id);
        const before = wk.shifts.filter((x) => x.employeeId === t.id).reduce((a, x) => a + shiftPaidHours(x), 0);
        const after = before + hours;
        const busy = wk.shifts.some((x) => x.employeeId === t.id && x.date === v.date && x.startMin < v.endMin && v.startMin < x.endMin);
        const off = wk.timeOff[t.id]?.includes(v.date);
        const windows = e?.availability?.[weekday(v.date)];
        const unavailable = e?.availability && !(windows ?? []).some(([a, b]) => a * 60 <= v.startMin && b * 60 >= v.endMin);
        const notes = [
          busy && "already working then",
          off && "on time off",
          unavailable && "outside availability",
          after > wk.rules.weeklyOvertimeHours ? `goes to ${after.toFixed(1)}h: overtime` : e?.maxHoursWeek && after > e.maxHoursWeek ? `over their ${e.maxHoursWeek}h max` : null,
        ].filter(Boolean) as string[];
        return { value: t.id, label: `${t.name} · ${Number(before.toFixed(1))}h this week`, note: notes.length ? notes.join(", ") : null };
      });
    return {
      id: w.id,
      status: w.status,
      requester: w.requester.name,
      requesterId: w.requesterId,
      taker: w.taker?.name ?? null,
      takerId: w.takerId,
      date: v.date,
      time: shiftLabel(v.startMin, v.endMin),
      position: w.shift.position.name,
      color: w.shift.position.color,
      candidates,
    };
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader help="schedule.requests" title="Requests" description="Time off and shift swaps from the team, with who else is off and how each day is covered." back={{ href: "/schedule", label: "Schedule" }} />
      <RequestsList
        timeOff={timeOff}
        swaps={await Promise.all(swaps.map((w) => swapRow(w, true)))}
        recentOff={recentOff.map((r) => ({ id: r.id, name: r.employee.name, start: toISODate(r.startDate), end: toISODate(r.endDate), days: 0, note: r.note, status: r.status, type: r.type, hours: r.hours?.toNumber() ?? null, sickAvailable: null, clashes: [], coverage: [] }))}
        recentSwaps={await Promise.all(recentSwaps.map((w) => swapRow(w, false)))}
      />
    </div>
  );
}
