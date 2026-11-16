import { EmptyState, PageHeader } from "@/components/ui";
import { addDays, toISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { getOpeningHours } from "@/server/services/labor-rules";
import { myShiftsBoard } from "@/server/services/myShifts";
import { sickBalances } from "@/server/services/payroll";
import { businessToday } from "@/server/services/sales";
import { employeeForUser } from "@/server/services/scheduling";
import { MyApp } from "../my-app";
import { SwapBoard } from "../swap-board";

export const metadata = { title: "My shifts" };

export default async function MyPage() {
  const session = await requireUser();
  const me = await employeeForUser(session.userId);
  if (!me) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader help="my.page" title="My shifts" />
        <EmptyState title={`Hi ${session.name} — you're not on the schedule yet`}>
          Your login isn&apos;t linked to a team member. Ask a manager to connect it on the Team page, then your shifts, open shifts and time off will show up here.
        </EmptyState>
      </div>
    );
  }
  const now = new Date();
  const today = businessToday();
  const myPositions = me.positions.map((p) => p.positionId);
  const [board, timeOff, team, sick, opening] = await Promise.all([
    myShiftsBoard(me, now),
    db.timeOffRequest.findMany({ where: { employeeId: me.id, status: { not: "CANCELLED" }, endDate: { gte: new Date(`${addDays(today, -30)}T00:00:00Z`) } }, orderBy: { startDate: "asc" } }),
    db.employee.findMany({ where: { active: true, id: { not: me.id }, positions: { some: { positionId: { in: myPositions } } } }, select: { id: true, name: true, positions: { select: { positionId: true } } }, orderBy: { name: "asc" } }),
    sickBalances(today, [me.id]),
    getOpeningHours(),
  ]);
  // "This week" = the next 7 days, so Sunday night doesn't read "0h" while next week is already out.
  const weekEnd = addDays(today, 7);
  const weekHours = board.mine.filter((s) => s.date < weekEnd).reduce((a, s) => a + s.hours, 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10">
      <PageHeader
        help="my.page"
        title="My shifts"
        description={<>
          Your schedule, swaps and pickups, time off and when you can work.
          {session.name !== me.name && <span className="mt-1 block text-xs text-muted">Signed in as {session.name} ({me.name})</span>}
        </>}
      />
      <SwapBoard
        today={today}
        weekHours={weekHours}
        allowDrop={board.rules.allowDrop}
        mine={board.mine}
        open={board.open}
        posted={board.posted}
        asks={board.asks}
        waiting={board.waiting}
        history={board.history}
        team={team.map((t) => ({ id: t.id, name: t.name, positionIds: t.positions.map((p) => p.positionId) }))}
      />
      <MyApp
        today={today}
        timeOff={timeOff.filter((t) => t.status !== "CANCELLED").map((t) => ({ id: t.id, start: toISODate(t.startDate), end: toISODate(t.endDate), note: t.note, status: t.status as "PENDING" | "APPROVED" | "DENIED", type: t.type, hours: t.hours?.toNumber() ?? null }))}
        sick={sick.get(me.id) ?? null}
        availability={(me.availability ?? null) as Record<string, [string, string][]> | null}
        openingHours={opening}
      />
    </div>
  );
}
