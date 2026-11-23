import { Verdict, type FindingTone } from "@/components/chapter";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { addDays, dateRange } from "@/domain/dates";
import { openingPeriod, payPeriodFor, PayrollException, PayrollRow, PayrollSnapshot, periodDays } from "@/domain/payroll";
import { blockCost, blockHours, clockLabel, formatClock, localMinutes } from "@/domain/timecards";
import { dayDate, money, pct, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { loadTeam } from "@/server/services/labor";
import { getLaborRules } from "@/server/services/labor-rules";
import { actualProductivity } from "@/server/services/covers";
import { computePayroll, findPayPeriod, recentPayPeriods, recentPeriodsForOpening, scheduledEnds } from "@/server/services/payroll";
import { businessToday } from "@/server/services/sales";
import { isSquareConnected } from "@/server/services/square";
import { refreshIfStale } from "@/server/services/square-sync";
import { Download } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdjustmentsGrid, ApprovalBar, LevelBadge, PeriodPicker } from "./payroll-client";
import { SquareSyncButton } from "./square-sync-button";
import { TimecardGrid } from "./timecard-grid";
import { MissingOutFix } from "./missing-out";

export const metadata = { title: "Timecards" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function LaborPage({ searchParams }: { searchParams: Promise<{ week?: string; start?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  await refreshIfStale();
  const today = businessToday();
  const rules = await getLaborRules();
  const asked = [sp.start, sp.week].find((d) => d && ISO.test(d));
  // With no period asked for, open on the one waiting for approval, not the week that just started.
  const opening = openingPeriod(await recentPeriodsForOpening(today, rules), today);
  const period = payPeriodFor(asked ?? opening.open, rules);
  const waiting = opening.pending.filter((w) => w.start !== period.start);
  const now = new Date();
  const soFar = period.end < today ? period.end : today;
  const [data, team, saved, history, squareConnected, prod] = await Promise.all([
    computePayroll(period, now),
    loadTeam(),
    findPayPeriod(period),
    recentPayPeriods(),
    isSquareConnected(),
    soFar >= period.start ? actualProductivity(period.start, soFar).catch(() => null) : null,
  ]);
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
      // A card from an earlier business day that's still open: they forgot to clock out.
      missing: !c.clockOut && c.date < today,
      edited: c.manuallyEdited,
    };
  });
  const missingCards = cards.filter((c) => !c.clockOut && c.date < today);
  const missingBy = new Set(missingCards.map((c) => c.employeeId));
  const ends = approved ? new Map<string, number>() : await scheduledEnds(missingCards.map((c) => ({ id: c.id, employeeId: c.employeeId, date: c.date })));
  const fixFor = (e: PayrollException) => {
    if (e.kind !== "missing-clock-out" || !e.cardId) return undefined;
    const end = ends.get(e.cardId);
    return { cardId: e.cardId, scheduled: end == null ? null : { value: formatClock(end), label: clockLabel(end) } };
  };

  const total = rows.reduce(
    (a, r) => ({ hours: a.hours + r.regularHours + r.overtimeHours, ot: a.ot + r.overtimeHours, gross: a.gross + r.gross, tips: a.tips + r.tips, spread: a.spread + r.spreadHours }),
    { hours: 0, ot: 0, gross: 0, tips: 0, spread: 0 },
  );
  const label = `${shortDate(period.start)} to ${shortDate(period.end)}`;
  const blocks = exceptions.filter((e) => e.level === "block").length;
  const warns = exceptions.filter((e) => e.level === "warn").length;
  const inPeriod = today >= period.start && today <= period.end;
  const extras = (r: PayrollRow) => r.callInPay + r.sickPay + r.ptoPay;
  const noClockIns = exceptions.find((e) => e.kind === "no-timecards");
  const salesIn = !!prod && prod.days > 0 && prod.sales > 0;
  const laborPct = salesIn && total.gross > 0 ? total.gross / prod!.sales : null;
  const verdict = periodVerdict({ approved, label, end: period.end, start: period.start, cards: cards.length, hours: total.hours, gross: total.gross, blocks, warns, noClockIns, started: period.start <= today, ended: period.end < today, squareConnected, approvedBy: saved?.approvedBy ?? null });

  return (
    <>
      <PageHeader
        help="labor.page"
        title="Timecards"
        description={`Clock-ins from Square plus anything added by hand, approved one pay period at a time. ${twoWeeks ? "Two-week" : "Weekly"} pay periods, set in Settings.`}
        actions={
          <>
            <HelpZone id="labor.period"><PeriodPicker start={period.start} prev={payPeriodFor(addDays(period.start, -1), rules).start} next={addDays(period.end, 1)} label={label} /></HelpZone>
            <HelpZone id="labor.squareSync" className="flex flex-wrap items-center gap-2"><SquareSyncButton periodStart={period.start} connected={squareConnected} /></HelpZone>
            <HelpZone id="labor.export"><LinkButton href={`/labor/payroll?start=${period.start}`} prefetch={false}><Download className="size-3.5" />{approved ? "Payroll spreadsheet" : "Draft spreadsheet"}</LinkButton></HelpZone>
            <LinkButton href={`/labor/handoff?start=${period.start}`} variant={approved ? "primary" : "secondary"}>Payroll hand-off</LinkButton>
          </>
        }
      />

      <Verdict
        badge={{ tone: verdict.tone, label: verdict.badge }}
        title={verdict.title}
        line={verdict.line}
        stats={[
          {
            label: <span className="inline-flex items-center gap-1">Hours worked <HelpTip id="labor.hours" /></span>,
            value: cards.length ? qty(total.hours, 1) : "—",
            hint: !cards.length ? "No clock-ins yet" : total.ot > 0 ? `${qty(total.ot, 1)}h overtime${total.spread ? `, ${total.spread} spread-of-hours` : ""}` : `No overtime (over ${rules.weeklyOvertimeHours}h a week)`,
            tone: cards.length ? (total.ot > 0 ? "warn" : "neutral") : "unknown",
          },
          {
            label: <span className="inline-flex items-center gap-1">Gross wages <HelpTip id="labor.gross" /></span>,
            value: cards.length || total.gross ? money(total.gross, { whole: true }) : "—",
            hint: total.tips ? `Plus ${money(total.tips, { whole: true })} tips from tip pools` : "Includes overtime, leave and adjustments",
            tone: cards.length || total.gross ? "neutral" : "unknown",
          },
          {
            label: <span className="inline-flex items-center gap-1">Wages against sales <HelpTip id="labor.productivity" /></span>,
            value: laborPct != null ? pct(laborPct) : "—",
            hint: laborPct != null && prod?.salesPerLaborHour != null
              ? `Of ${money(prod.sales, { whole: true })} sales: ${money(prod.salesPerLaborHour, { whole: true })} per hour worked`
              : !cards.length ? "Needs timecards" : !salesIn ? "No Square sales synced for these days yet" : "No wages yet",
            tone: laborPct != null ? "neutral" : "unknown",
          },
        ]}
      >
        {(verdict.actions || waiting.length > 0) && (
          <div className="flex flex-col gap-3">
            {verdict.actions && <div className="flex flex-wrap items-center gap-2">{verdict.actions}</div>}
            {waiting.length > 0 && (
              <p className="text-sm text-ink-2">
                Also waiting for approval:{" "}
                {waiting.map((w, i) => (
                  <span key={w.start}>
                    {i > 0 && ", "}
                    <Link href={`/labor?start=${w.start}`} className="num font-medium text-ink underline underline-offset-2 hover:text-ink-2">{shortDate(w.start)} to {shortDate(w.end)}</Link>
                    {!w.cards && <span className="text-muted"> (no clock-ins)</span>}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </Verdict>

      <HelpZone id="labor.approve"><ApprovalBar start={period.start} label={label} approved={approved} approvedBy={saved?.approvedBy ?? null} approvedAt={saved?.approvedAt?.toISOString() ?? null} blocks={blocks} hours={total.hours} /></HelpZone>

      <div id="before-you-approve" className="scroll-mt-24" />
      {!approved && (cards.length > 0 || exceptions.length > 0) && (
        <Section help="labor.exceptions" title="Before you approve" description={exceptions.length ? "Most urgent first. Fix what you can in the timecards below." : undefined}>
          {exceptions.length === 0 ? (
            <Card className="px-4 py-5 text-sm text-muted">{cards.length ? "Nothing to check. Every card has a clock-out and a rate." : "No timecards in this period yet."}</Card>
          ) : noClockIns ? (
            <Card className="px-4 py-4 text-sm text-ink-2">
              Once clock-ins come in, each missing punch, break and pay rate is listed here.
              {exceptions.length > 1 && <> Meanwhile: {exceptions.filter((e) => e !== noClockIns).map((e) => e.message.replace(/\.$/, "")).join("; ")}.</>}
            </Card>
          ) : (
            <Card className="divide-y divide-border">
              {exceptions.slice(0, SHOW_EXCEPTIONS).map((e, i) => <ExceptionRow key={i} e={e} fix={fixFor(e)} />)}
              {exceptions.length > SHOW_EXCEPTIONS && (
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm text-ink-2 hover:bg-surface-2/60 group-open:border-b group-open:border-border">
                    Show {exceptions.length - SHOW_EXCEPTIONS} more
                  </summary>
                  <div className="divide-y divide-border">
                    {exceptions.slice(SHOW_EXCEPTIONS).map((e, i) => <ExceptionRow key={i} e={e} fix={fixFor(e)} />)}
                  </div>
                </details>
              )}
            </Card>
          )}
        </Section>
      )}

      <div id="timecards" className="scroll-mt-24" />
      <Section help="labor.timecards" title="Timecards" description={`${cards.length} in this period${cards.some((c) => !c.clockOut) ? ", open cards count up to now" : ""}.${approved ? " Locked." : " Click a cell to fix a time: type 4p, 16:30 or 10:15pm. Cards you edit are kept when Square syncs."}`}>
        <Card>
          {cards.length === 0 && <div className="px-4 pt-6 pb-2 text-center text-sm text-muted">No timecards in this period yet.</div>}
          <TimecardGrid cards={cardRows} employees={employees} positions={positions} days={days} defaultDay={inPeriod ? today : period.start} locked={approved} />
        </Card>
      </Section>

      <Section help="labor.adjustments" title="Adjustments" description="Bonuses, corrections, deductions and reimbursements. They go in the payroll file as their own columns.">
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

      <Section help="labor.payroll" title="Payroll" description={approved ? "As approved. This is what the payroll spreadsheet contains." : "What goes to payroll. Tips come from finalized tip pools; sick and PTO hours from approved requests."}>
        {rows.length === 0 ? (
          <EmptyState title="Nothing to pay yet">Totals appear once there are timecards in this period.</EmptyState>
        ) : (
          <Table sticky>
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
                    {missingBy.has(r.employeeId) ? <Badge tone="bad" className="ml-2">Missing clock-out</Badge> : r.openCards > 0 && <Badge tone="good" className="ml-2">On shift</Badge>}
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
        <Section help="labor.history" title="Approved pay periods">
          <Card className="divide-y divide-border">
            {history.map((h) => (
              <Link key={h.start} href={`/labor?start=${h.start}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2/60">
                <span className="min-w-0">
                  <span className="num font-medium">{shortDate(h.start)} to {shortDate(h.end)}</span>
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

/** The one-line story of the period on screen, and the one thing to do next. */
function periodVerdict(v: {
  approved: boolean; label: string; start: string; end: string; cards: number; hours: number; gross: number; blocks: number; warns: number;
  noClockIns?: PayrollException; started: boolean; ended: boolean; squareConnected: boolean; approvedBy: string | null;
}): { tone: FindingTone; badge?: string; title: string; line: string; actions?: ReactNode } {
  const addHand = <LinkButton href="#timecards" variant="ghost" className="max-sm:h-11">Add timecards by hand</LinkButton>;
  if (v.approved) {
    return { tone: "good", badge: "Approved", title: `Approved: ${money(v.gross, { whole: true })} for ${qty(v.hours, 1)} hours`, line: `${v.approvedBy ? `${v.approvedBy} approved ${v.label}. ` : ""}The timecards are locked and the payroll file is frozen as approved.` };
  }
  if (v.noClockIns) {
    const shifts = v.noClockIns.message.split(" ended")[0];
    return {
      tone: "bad",
      badge: "Timecards missing",
      title: "No clock-ins came in for this pay period",
      line: `${shifts} ended with no timecards at all. ${v.squareConnected ? "Square timecards haven't come in for these days: sync them now, or add the cards by hand." : "Square isn't connected, so nothing comes in by itself: connect it, or add the cards by hand."}`,
      actions: (
        <>
          {v.squareConnected ? <SquareSyncButton periodStart={v.start} connected /> : <LinkButton href="/settings/square" variant="primary" className="max-sm:h-11">Connect Square</LinkButton>}
          {addHand}
        </>
      ),
    };
  }
  if (!v.cards) {
    return v.started
      ? { tone: "unknown", title: "No clock-ins yet this pay period", line: v.squareConnected ? "They come in from Square as people clock out. Nothing to approve yet." : "Square isn't connected, so add timecards by hand as the week goes." }
      : { tone: "neutral", title: "This pay period hasn't started", line: "Nothing to approve yet." };
  }
  if (v.blocks) {
    return { tone: "bad", title: `${v.blocks} thing${v.blocks === 1 ? "" : "s"} to fix before payroll`, line: `They'd be wrong in the payroll file until fixed.${v.warns ? ` ${v.warns} more ${v.warns === 1 ? "is" : "are"} worth a check.` : ""}`, actions: <LinkButton href="#before-you-approve" variant="primary" className="max-sm:h-11">See what to fix</LinkButton> };
  }
  if (!v.ended) {
    return { tone: "neutral", title: `${qty(v.hours, 1)} hours so far, ${money(v.gross, { whole: true })} in wages`, line: `The pay period ends ${shortDate(v.end)}. Approve it once the last shift is in.${v.warns ? ` ${v.warns} card${v.warns === 1 ? " is" : "s are"} worth a check meanwhile.` : ""}` };
  }
  return v.warns
    ? { tone: "warn", title: `Ready to approve, after a look at ${v.warns} card${v.warns === 1 ? "" : "s"}`, line: "Nothing would be wrong in the payroll file, but a few cards look unusual: a long shift, a missed break or a no-show.", actions: <LinkButton href="#before-you-approve" className="max-sm:h-11">See what to check</LinkButton> }
    : { tone: "good", title: "Ready to approve", line: "Every card has a clock-out and a pay rate. Approve it to lock the timecards and freeze the payroll file." };
}

function ExceptionRow({ e, fix }: { e: PayrollException; fix?: { cardId: string; scheduled: { value: string; label: string } | null } }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 text-sm">
      <LevelBadge level={e.level} />
      <div className="min-w-0 flex-1">
        <span className="font-medium">{e.name}</span>
        {e.date && <span className="text-muted"> · {dayDate(e.date)}</span>}
        {e.cardId && <a href={`#tc-${e.cardId}`} className="ml-2 text-xs text-ink-2 underline underline-offset-2 hover:text-ink">See the card</a>}
        <span className="block text-ink-2">{e.message}</span>
        {fix && <MissingOutFix cardId={fix.cardId} who={`${e.name}${e.date ? `, ${dayDate(e.date)}` : ""}`} scheduled={fix.scheduled} />}
      </div>
    </div>
  );
}
