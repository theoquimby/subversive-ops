import { HelpZone } from "@/components/help";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { localMinutes, clockLabel, zonedTime } from "@/domain/timecards";
import { cardHours } from "@/domain/myPay";
import { addDays } from "@/domain/dates";
import { dayDate, money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { myPayThisPeriod } from "@/server/services/myPay";
import { employeeForUser } from "@/server/services/scheduling";
import { businessDate } from "@/domain/dates";
import Link from "next/link";

export const metadata = { title: "Hours & tips" };

/** Staff: hours on the clock this pay period, what's still scheduled, and tips (finalized or estimated). */
export default async function MyPayPage() {
  const session = await requireUser();
  const me = await employeeForUser(session.userId);
  if (!me) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader help="my.pay" title="Hours & tips" back={{ href: "/my", label: "Today" }} />
        <EmptyState title="Your login isn't linked to a team member yet">Ask a manager to connect it on the Team page.</EmptyState>
      </div>
    );
  }
  const now = new Date();
  const tz = env.BUSINESS_TIMEZONE;
  const pay = await myPayThisPeriod(me.id, now);
  const cards = await db.timecard.findMany({
    where: { employeeId: me.id, clockIn: { gte: zonedTime(pay.period.start, 0, tz), lt: zonedTime(addDays(pay.period.end, 1), 0, tz) } },
    orderBy: { clockIn: "asc" },
    include: { position: { select: { name: true } } },
  });
  const tipLine =
    pay.tips.basis === "finalized" ? "From tip pools your manager has finalized."
    : pay.tips.basis === "mixed" ? `${money(pay.tips.finalized)} finalized, plus about ${money(pay.tips.estimate)} for hours not pooled yet (at your recent tips per hour).`
    : pay.tips.basis === "estimate" ? "An estimate: your hours so far × your recent tips per hour. It firms up when your manager finalizes the tip pool."
    : "Not enough tip history to estimate yet.";

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="my.pay" title="Hours & tips" back={{ href: "/my", label: "Today" }} description={`This pay period: ${shortDate(pay.period.start)} to ${shortDate(pay.period.end)}. Estimates only: your paycheck from payroll is what counts.`} />
      <HelpZone id="my.pay.totals">
        <div className="grid grid-cols-2 gap-3">
          <Card className="px-4 py-4">
            <div className="text-xs font-medium text-muted">Hours worked</div>
            <div className="num mt-1 text-2xl font-semibold">{Number(pay.workedHours.toFixed(2))}</div>
            <div className="mt-0.5 text-xs text-muted">{pay.scheduledHours ? `+ ${Number(pay.scheduledHours.toFixed(1))}h still scheduled` : "nothing else scheduled"}</div>
          </Card>
          <Card className="px-4 py-4">
            <div className="text-xs font-medium text-muted">Tips{pay.tips.basis === "finalized" ? "" : " (estimate)"}</div>
            <div className="num mt-1 text-2xl font-semibold">{pay.tips.basis === "none" ? "—" : money(pay.tips.total)}</div>
            <div className="mt-0.5 text-xs text-muted">{pay.tips.basis === "none" ? "no tips for your roles yet" : "this period so far"}</div>
          </Card>
        </div>
        <p className="mt-3 px-1 text-sm text-muted">{tipLine}</p>
        {pay.staleCards > 0 && <p className="mt-2 px-1 text-sm text-warn">{pay.staleCards} clock-in{pay.staleCards === 1 ? " has" : "s have"} no clock-out, so {pay.staleCards === 1 ? "it isn't" : "they aren't"} counted yet. Tell a manager when you finished.</p>}
      </HelpZone>

      <section className="mt-8">
        <h2 className="mb-3 text-[0.95rem] font-semibold">Clock-ins</h2>
        {cards.length === 0 ? (
          <Card className="px-4 py-5 text-sm text-muted">No clock-ins this period yet. They come from Square when you clock in on the register.</Card>
        ) : (
          <Card className="divide-y divide-border">
            {cards.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{dayDate(businessDate(c.clockIn, tz))}</div>
                  <div className="num text-xs text-muted">{clockLabel(localMinutes(c.clockIn, tz))} to {c.clockOut ? clockLabel(localMinutes(c.clockOut, tz)) : cardHours(c, now).stale ? "no clock-out" : "still on"}{c.breakMinutes ? ` · ${c.breakMinutes} min break` : ""}{c.position ? ` · ${c.position.name}` : ""}</div>
                </div>
                <div className={cardHours(c, now).stale ? "shrink-0 text-xs font-medium text-warn" : "num shrink-0 font-medium"}>{cardHours(c, now).stale ? "ask a manager" : `${cardHours(c, now).hours.toFixed(2)}h`}</div>
              </div>
            ))}
          </Card>
        )}
        <p className="mt-3 px-1 text-xs text-muted">Something wrong? Tell a manager before the period is approved: <Link href="/my/message" className="underline underline-offset-2">send a message</Link>.</p>
      </section>
    </div>
  );
}
