import { Badge, Card, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { addDays, dateRange } from "@/domain/dates";
import { payPeriodFor, PayrollException, PayrollRow, PayrollSnapshot, periodDays } from "@/domain/payroll";
import { blockCost, blockHours, clockLabel, localMinutes } from "@/domain/timecards";
import { dayDate, money, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { loadTeam } from "@/server/services/labor";
import { getLaborRules } from "@/server/services/labor-rules";
import { computePayroll, findPayPeriod, recentPayPeriods } from "@/server/services/payroll";
import { businessToday } from "@/server/services/sales";
import { isSquareConnected } from "@/server/services/square";
import { refreshIfStale } from "@/server/services/square-sync";
import { Download } from "lucide-react";
import Link from "next/link";
import { AdjustmentsGrid, ApprovalBar, LevelBadge, PeriodPicker } from "./payroll-client";
import { SquareSyncButton } from "./square-sync-button";
import { TimecardGrid } from "./timecard-grid";

export const metadata = { title: "Timecards" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function LaborPage({ searchParams }: { searchParams: Promise<{ week?: string; start?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  await refreshIfStale();
  const today = businessToday();
  const rules = await getLaborRules();
  const asked = [sp.start, sp.week].find((d) => d && ISO.test(d)) ?? today;
  const period = payPeriodFor(asked, rules);
  const now = new Date();
  const [data, team, saved, history, squareConnected] = await Promise.all([computePayroll(period, now), loadTeam(), findPayPeriod(period), recentPayPeriods(), isSquareConnected()]);
  const { cards, exceptions } = data;
  const approved = saved?.status === "APPROVED";
  const snapshot = approved ? (saved?.snapshot as unknown as PayrollSnapshot | null) : null;
  const rows: PayrollRow[] = snapshot?.rows ?? data.rows;
  const tz = env.BUSINESS_TIMEZONE;
  const twoWeeks = periodDays(period) > 7;

  const days = dateRange(period.start, addDays(period.end, 1)).map((d) => ({ value: d, label: dayDate(d) }));
  const employees = team.employees.filter((e) => e.active || cards.some((c) => c.employeeId === e.id) || rows.some((r) => r.employeeId === e.id)).map((e) => ({ value: e.id, label: e.name }));
  const positions = team.positions.map((p) => ({ value: p.id, label: p.name }));
  const cardRows = cards.map((c) => {
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
      edited: c.manuallyEdited,
    };
  });

  const total = rows.reduce(
    (a, r) => ({ hours: a.hours + r.regularHours + r.overtimeHours, ot: a.ot + r.overtimeHours, gross: a.gross + r.gross, tips: a.tips + r.tips, spread: a.spread + r.spreadHours }),
    { hours: 0, ot: 0, gross: 0, tips: 0, spread: 0 },
  );
  const label = `${shortDate(period.start)} – ${shortDate(period.end)}`;
  const blocks = exceptions.filter((e) => e.level === "block").length;
  const warns = exceptions.filter((e) => e.level === "warn").length;
  const inPeriod = today >= period.start && today <= period.end;
  const extras = (r: PayrollRow) => r.callInPay + r.sickPay + r.ptoPay;

  return (
    <>
      <PageHeader
        title="Timecards"
        description={`Clock-ins from Square plus anything added by hand. Click a cell to fix a time: type 4p, 16:30 or 10:15pm. ${twoWeeks ? "Two-week" : "Weekly"} pay periods, set in Settings.`}
        actions={
          <>
            <PeriodPicker start={period.start} prev={payPeriodFor(addDays(period.start, -1), rules).start} next={addDays(period.end, 1)} label={label} />
            <SquareSyncButton periodStart={period.start} connected={squareConnected} />
            <LinkButton href={`/labor/payroll?start=${period.start}`} prefetch={false}><Download className="size-3.5" />{approved ? "Payroll CSV" : "Draft CSV"}</LinkButton>
          </>
        }
      />

      <ApprovalBar start={period.start} label={label} approved={approved} approvedBy={saved?.approvedBy ?? null} approvedAt={saved?.approvedAt?.toISOString() ?? null} blocks={blocks} warns={warns} />

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Hours" value={qty(total.hours, 1)} hint={label} />
        <Stat label="Overtime" value={`${qty(total.ot, 1)} h`} tone={total.ot > 0 ? "warn" : undefined} hint={total.spread ? `${total.spread} spread-of-hours` : `over ${rules.weeklyOvertimeHours}h/week`} />
        <Stat label="Gross wages" value={money(total.gross, { whole: true })} hint="incl. OT, leave and adjustments" />
        <Stat label="Tips" value={money(total.tips, { whole: true })} hint={data.tips.uncovered.length && !approved ? "from finalized tip pools · incomplete" : "from finalized tip pools"} />
      </div>

      {!approved && (
        <Section title="Before you approve" description={exceptions.length ? "Most urgent first. Fix what you can in the timecards below." : undefined}>
          {exceptions.length === 0 ? (
            <Card className="px-4 py-5 text-sm text-muted">{cards.length ? "Nothing to check. Every card has a clock-out and a rate." : "No timecards in this period yet."}</Card>
          ) : (
            <Card className="divide-y divide-border">
              {exceptions.slice(0, SHOW_EXCEPTIONS).map((e, i) => <ExceptionRow key={i} e={e} />)}
              {exceptions.length > SHOW_EXCEPTIONS && (
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm text-ink-2 hover:bg-surface-2/60 group-open:border-b group-open:border-border">
                    Show {exceptions.length - SHOW_EXCEPTIONS} more
                  </summary>
                  <div className="divide-y divide-border">
                    {exceptions.slice(SHOW_EXCEPTIONS).map((e, i) => <ExceptionRow key={i} e={e} />)}
                  </div>
                </details>
              )}
            </Card>
          )}
        </Section>
      )}

      <Section title="Timecards" description={`${cards.length} in this period${cards.some((c) => !c.clockOut) ? " · open cards count up to now" : ""}${approved ? " · locked" : " · cards you edit are kept when Square syncs"}`}>
        <Card>
          {cards.length === 0 && <div className="px-4 pt-6 pb-2 text-center text-sm text-muted">No timecards in this period yet.</div>}
          <TimecardGrid cards={cardRows} employees={employees} positions={positions} days={days} defaultDay={inPeriod ? today : period.start} locked={approved} />
        </Card>
      </Section>

      <Section title="Adjustments" description="Bonuses, corrections, deductions and reimbursements. They go in the payroll file as their own columns.">
        <Card>
          <AdjustmentsGrid
            rows={data.adjustments.map((a) => ({ id: a.id, employeeId: a.employeeId, date: a.date.toISOString().slice(0, 10), kind: a.kind, amount: a.amount.toNumber(), note: a.note }))}
            employees={employees}
            days={days}
            defaultDay={inPeriod ? today : period.end}
            locked={approved}
          />
        </Card>
      </Section>

      <Section title="Payroll" description={approved ? "As approved. This is what the CSV contains." : "What goes to payroll. Tips come from finalized tip pools; sick and PTO hours from approved requests."}>
        {rows.length === 0 ? (
          <EmptyState title="Nothing to pay yet">Totals appear once there are timecards in this period.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th align="right">Hours</Th>
                <Th align="right">OT</Th>
                <Th align="right" className="hidden md:table-cell">Call-in · leave</Th>
                <Th align="right" className="hidden md:table-cell">Adjust.</Th>
                <Th align="right">Gross</Th>
                <Th align="right" className="hidden sm:table-cell">Tips</Th>
                <Th align="right" className="hidden lg:table-cell">Sick bal.</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.employeeId}>
                  <Td>
                    <span className="font-medium">{r.name}</span>
                    {r.missingRate && <Badge tone="warn" className="ml-2">No rate</Badge>}
                    {r.openCards > 0 && <Badge tone="good" className="ml-2">On shift</Badge>}
                    {(r.sickHours > 0 || r.ptoHours > 0) && <span className="block text-xs text-muted">{[r.sickHours ? `${r.sickHours}h sick` : "", r.ptoHours ? `${r.ptoHours}h PTO` : "", r.callInHours ? `${r.callInHours}h call-in` : ""].filter(Boolean).join(" · ")}</span>}
                  </Td>
                  <Td align="right">{(r.regularHours + r.overtimeHours).toFixed(2)}</Td>
                  <Td align="right" className={r.overtimeHours > 0 ? "text-warn" : "text-muted"}>{r.overtimeHours.toFixed(2)}</Td>
                  <Td align="right" className="hidden text-muted md:table-cell">{extras(r) ? money(extras(r)) : "—"}</Td>
                  <Td align="right" className={`hidden md:table-cell ${r.adjustments < 0 ? "text-bad" : r.adjustments ? "" : "text-muted"}`}>{r.adjustments || r.reimbursements ? money(r.adjustments + r.reimbursements) : "—"}</Td>
                  <Td align="right" className="font-medium">{money(r.gross)}</Td>
                  <Td align="right" className="hidden sm:table-cell">{r.tips ? money(r.tips) : "—"}</Td>
                  <Td align="right" className="hidden text-muted lg:table-cell">{r.sickBalance == null ? "—" : `${r.sickBalance.toFixed(1)}h`}</Td>
                </Tr>
              ))}
              <tr className="font-semibold">
                <Td>Total</Td>
                <Td align="right">{total.hours.toFixed(2)}</Td>
                <Td align="right">{total.ot.toFixed(2)}</Td>
                <Td align="right" className="hidden md:table-cell">{money(rows.reduce((a, r) => a + extras(r), 0))}</Td>
                <Td align="right" className="hidden md:table-cell">{money(rows.reduce((a, r) => a + r.adjustments + r.reimbursements, 0))}</Td>
                <Td align="right">{money(total.gross)}</Td>
                <Td align="right" className="hidden sm:table-cell">{money(total.tips)}</Td>
                <Td className="hidden lg:table-cell" />
              </tr>
            </tbody>
          </Table>
        )}
      </Section>

      {history.length > 0 && (
        <Section title="Approved pay periods">
          <Card className="divide-y divide-border">
            {history.map((h) => (
              <Link key={h.start} href={`/labor?start=${h.start}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2/60">
                <span className="min-w-0">
                  <span className="num font-medium">{shortDate(h.start)} – {shortDate(h.end)}</span>
                  <span className="block text-xs text-muted">{h.approvedBy ? `by ${h.approvedBy}` : ""}{h.people != null ? ` · ${h.people} people` : ""}</span>
                </span>
                <span className="num text-right">{money(h.gross)}<span className="block text-xs text-muted">{h.tips ? `+ ${money(h.tips)} tips` : ""}</span></span>
              </Link>
            ))}
          </Card>
        </Section>
      )}
    </>
  );
}

const SHOW_EXCEPTIONS = 8;

function ExceptionRow({ e }: { e: PayrollException }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 text-sm">
      <LevelBadge level={e.level} />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{e.name}</span>
        {e.date && <span className="text-muted"> · {dayDate(e.date)}</span>}
        <span className="block text-ink-2">{e.message}</span>
      </span>
    </div>
  );
}
