import { EmptyState, PageHeader } from "@/components/ui";
import { addDays, toISODate } from "@/domain/dates";
import { shiftPaidHours, weekStartOf } from "@/domain/schedule";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { employeeForUser, instantAt, shiftView } from "@/server/services/scheduling";
import { MyApp, type MyShift } from "./my-app";

export const metadata = { title: "My shifts" };

export default async function MyPage() {
  const session = await requireUser();
  const me = await employeeForUser(session.userId);
  if (!me) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="My shifts" />
        <EmptyState title={`Hi ${session.name} — you're not on the schedule yet`}>
          Your login isn&apos;t linked to a team member. Ask a manager to connect it on the Team page, then your shifts, open shifts and time off will show up here.
        </EmptyState>
      </div>
    );
  }
  const now = new Date();
  const today = businessToday();
  const myPositions = me.positions.map((p) => p.positionId);
  const [mine, open, board, timeOff, team] = await Promise.all([
    db.shift.findMany({ where: { employeeId: me.id, published: true, end: { gte: now } }, orderBy: { start: "asc" }, take: 40, include: { position: true, swaps: { where: { status: "PENDING" }, include: { taker: { select: { name: true } } } } } }),
    db.shift.findMany({ where: { employeeId: null, published: true, start: { gte: now }, positionId: { in: myPositions } }, orderBy: { start: "asc" }, take: 30, include: { position: true } }),
    db.shiftSwap.findMany({
      where: { status: "PENDING", takerId: null, requesterId: { not: me.id }, shift: { start: { gte: now }, positionId: { in: myPositions } } },
      include: { shift: { include: { position: true } }, requester: { select: { name: true } } },
      take: 30,
    }),
    db.timeOffRequest.findMany({ where: { employeeId: me.id, endDate: { gte: new Date(`${addDays(today, -30)}T00:00:00Z`) } }, orderBy: { startDate: "asc" } }),
    db.employee.findMany({ where: { active: true, id: { not: me.id } }, select: { id: true, name: true, positions: { select: { positionId: true } } }, orderBy: { name: "asc" } }),
  ]);

  const toShift = (s: (typeof open)[number]): MyShift => {
    const v = shiftView(s);
    return { id: s.id, date: v.date, startMin: v.startMin, endMin: v.endMin, hours: shiftPaidHours(v), position: s.position.name, color: s.position.color, positionId: s.positionId, notes: s.notes };
  };
  const monday = weekStartOf(today);
  const weekEnd = instantAt(addDays(monday, 7), 0);
  const weekHours = mine.filter((s) => s.start < weekEnd).reduce((a, s) => a + shiftPaidHours(shiftView(s)), 0);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My shifts" description={`Hi ${me.name.split(" ")[0]}. Your schedule, open shifts you can pick up, and time off.`} />
      <MyApp
        today={today}
        weekHours={weekHours}
        mine={mine.map((s) => ({ ...toShift(s), swap: s.swaps[0] ? { id: s.swaps[0].id, taker: s.swaps[0].taker?.name ?? null } : null }))}
        open={open.map(toShift)}
        board={board.map((b) => ({ swapId: b.id, from: b.requester.name, ...toShift(b.shift) }))}
        timeOff={timeOff.map((t) => ({ id: t.id, start: toISODate(t.startDate), end: toISODate(t.endDate), note: t.note, status: t.status }))}
        team={team.map((t) => ({ id: t.id, name: t.name, positionIds: t.positions.map((p) => p.positionId) }))}
      />
    </div>
  );
}
