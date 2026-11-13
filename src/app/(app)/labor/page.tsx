import { Badge, Card, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { addDays, dateRange } from "@/domain/dates";
import { mondayOf } from "@/domain/pnl";
import { blockCost, blockHours, clockLabel, localMinutes } from "@/domain/timecards";
import { dayDate, money, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { loadTeam, weeklyPay } from "@/server/services/labor";
import { businessToday } from "@/server/services/sales";
import { Download } from "lucide-react";
import { TimecardGrid, WeekPicker } from "./timecard-grid";

export const metadata = { title: "Timecards" };

export default async function LaborPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireUser("MANAGER");
  const { week: w } = await searchParams;
  const today = businessToday();
  const week = mondayOf(w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : today);
  const now = new Date();
  const [{ lines, cards, rules }, team] = await Promise.all([weeklyPay(week, now), loadTeam()]);
  const tz = env.BUSINESS_TIMEZONE;

  const days = dateRange(week, addDays(week, 7)).map((d) => ({ value: d, label: dayDate(d) }));
  const employees = team.employees.filter((e) => e.active || cards.some((c) => c.employeeId === e.id)).map((e) => ({ value: e.id, label: e.name }));
  const positions = team.positions.map((p) => ({ value: p.id, label: p.name }));
  const rows = cards.map((c) => {
    const b = { start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate };
    return {
      id: c.id,
      employeeId: c.employeeId,
      positionId: c.positionId,
      date: c.date,
      inLabel: clockLabel(localMinutes(c.clockIn, tz)),
      outLabel: c.clockOut ? clockLabel(localMinutes(c.clockOut, tz)) : null,
      breakMinutes: c.breakMinutes,
      ownRate: c.hourlyRate?.toNumber() ?? null,
      rate: c.rate,
      hours: blockHours(b, now),
      cost: blockCost(b, rules.employerBurdenPct, now),
      source: c.source,
      open: !c.clockOut,
    };
  });

  const total = lines.reduce((a, l) => ({ hours: a.hours + l.totalHours, ot: a.ot + l.overtimeHours, wages: a.wages + l.wages, cost: a.cost + l.cost, spread: a.spread + l.spreadHours }), { hours: 0, ot: 0, wages: 0, cost: 0, spread: 0 });
  const missing = lines.filter((l) => l.missingRate);
  const weekLabel = `${shortDate(week)} – ${shortDate(addDays(week, 6))}`;

  return (
    <>
      <PageHeader
        title="Timecards"
        description="Clock-ins from Square plus anything added by hand. Click a cell to fix a time — type 4p, 16:30 or 10:15pm. Overtime and spread of hours follow your labor rules."
        actions={
          <>
            <WeekPicker week={week} label={weekLabel} />
            <LinkButton href={`/labor/payroll?week=${week}`} prefetch={false}><Download className="size-3.5" />Payroll CSV</LinkButton>
          </>
        }
      />

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Hours" value={qty(total.hours, 1)} hint={weekLabel} />
        <Stat label="Overtime" value={`${qty(total.ot, 1)} h`} tone={total.ot > 0 ? "warn" : undefined} hint={total.spread ? `${total.spread} spread-of-hours` : `over ${rules.weeklyOvertimeHours}h/week`} />
        <Stat label="Wages" value={money(total.wages, { whole: true })} hint="incl. overtime and spread" />
        <Stat label="Labor cost" value={money(total.cost, { whole: true })} hint={`wages + ${Math.round(rules.employerBurdenPct * 100)}% employer burden`} />
      </div>

      <Section title="Timecards" description={`${cards.length} this week${cards.some((c) => !c.clockOut) ? " · open cards count up to now" : ""}`}>
        <Card>
          {cards.length === 0 && <div className="px-4 pt-6 pb-2 text-center text-sm text-muted">No timecards this week yet.</div>}
          <TimecardGrid cards={rows} employees={employees} positions={positions} days={days} defaultDay={today >= week && today < addDays(week, 7) ? today : week} />
        </Card>
      </Section>

      <Section title="Weekly totals" description="What goes to Square Payroll. Tips are paid out separately.">
        {lines.length === 0 ? (
          <EmptyState title="Nothing to pay yet">Totals appear once there are timecards this week.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th align="right">Hours</Th>
                <Th align="right" className="hidden sm:table-cell">Regular</Th>
                <Th align="right">OT</Th>
                <Th align="right" className="hidden md:table-cell">Spread</Th>
                <Th align="right" className="hidden sm:table-cell">Wages</Th>
                <Th align="right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <Tr key={l.employeeId}>
                  <Td>
                    <span className="font-medium">{l.name}</span>
                    {l.missingRate && <Badge tone="warn" className="ml-2">No rate</Badge>}
                    {l.openCards > 0 && <Badge tone="good" className="ml-2">On shift</Badge>}
                  </Td>
                  <Td align="right">{l.totalHours.toFixed(2)}</Td>
                  <Td align="right" className="hidden sm:table-cell">{l.regularHours.toFixed(2)}</Td>
                  <Td align="right" className={l.overtimeHours > 0 ? "text-warn" : "text-muted"}>{l.overtimeHours.toFixed(2)}</Td>
                  <Td align="right" className="hidden text-muted md:table-cell">{l.spreadHours || "—"}</Td>
                  <Td align="right" className="hidden sm:table-cell">{money(l.wages)}</Td>
                  <Td align="right">{money(l.cost)}</Td>
                </Tr>
              ))}
              <tr className="font-semibold">
                <Td>Total</Td>
                <Td align="right">{total.hours.toFixed(2)}</Td>
                <Td align="right" className="hidden sm:table-cell">{(total.hours - total.ot).toFixed(2)}</Td>
                <Td align="right">{total.ot.toFixed(2)}</Td>
                <Td align="right" className="hidden md:table-cell">{total.spread || "—"}</Td>
                <Td align="right" className="hidden sm:table-cell">{money(total.wages)}</Td>
                <Td align="right">{money(total.cost)}</Td>
              </tr>
            </tbody>
          </Table>
        )}
        {missing.length > 0 && (
          <p className="mt-2 text-sm text-warn">
            {missing.map((m) => m.name).join(", ")} {missing.length === 1 ? "has" : "have"} hours with no pay rate — set one on the Team page.
          </p>
        )}
      </Section>
    </>
  );
}
