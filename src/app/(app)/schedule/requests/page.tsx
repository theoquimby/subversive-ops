import { PageHeader } from "@/components/ui";
import { addDays, toISODate } from "@/domain/dates";
import { inclusiveDates, shiftLabel } from "@/domain/schedule";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { instantAt, shiftView } from "@/server/services/scheduling";
import { RequestsList } from "./requests-list";

export const metadata = { title: "Schedule requests" };

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

  // Shifts each time-off request would clash with.
  const clashes = await Promise.all(
    off.map(async (r) => {
      const s = toISODate(r.startDate);
      const e = toISODate(r.endDate);
      const rows = await db.shift.findMany({ where: { employeeId: r.employeeId, start: { gte: instantAt(s, 0), lt: instantAt(addDays(e, 1), 0) } }, orderBy: { start: "asc" } });
      return rows.map((x) => {
        const v = shiftView(x);
        return `${v.date}|${shiftLabel(v.startMin, v.endMin)}`;
      });
    }),
  );

  const swapRow = (w: (typeof swaps)[number]) => {
    const v = shiftView(w.shift);
    return {
      id: w.id,
      status: w.status,
      requester: w.requester.name,
      requesterId: w.requesterId,
      taker: w.taker?.name ?? null,
      date: v.date,
      time: shiftLabel(v.startMin, v.endMin),
      position: w.shift.position.name,
      color: w.shift.position.color,
      candidates: team.filter((t) => t.id !== w.requesterId && t.positions.some((p) => p.positionId === w.shift.positionId)).map((t) => ({ value: t.id, label: t.name })),
    };
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Requests" description="Time off and shift swaps from the team. One tap to approve or deny." back={{ href: "/schedule", label: "Schedule" }} />
      <RequestsList
        timeOff={off.map((r, i) => ({ id: r.id, name: r.employee.name, start: toISODate(r.startDate), end: toISODate(r.endDate), days: inclusiveDates(toISODate(r.startDate), toISODate(r.endDate)).length, note: r.note, status: r.status, clashes: clashes[i] }))}
        swaps={swaps.map(swapRow)}
        recentOff={recentOff.map((r) => ({ id: r.id, name: r.employee.name, start: toISODate(r.startDate), end: toISODate(r.endDate), days: 0, note: r.note, status: r.status, clashes: [] }))}
        recentSwaps={recentSwaps.map(swapRow)}
      />
    </div>
  );
}
