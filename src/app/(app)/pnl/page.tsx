import { refreshIfStale } from "@/server/services/square-sync";
import { Badge, Card, cx, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { HelpTip, HelpZone } from "@/components/help";
import { addDays } from "@/domain/dates";
import { costTone, gapTone, PERIODS, PeriodKind, periodRange, salesTone, Tone } from "@/domain/pnl";
import { dayDate, money, pct, qty, shortDate, signedPct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { actualFromCounts, hourlyDay, pnlReport } from "@/server/services/pnl";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { HourlyChart } from "./hourly-chart";
import { PeriodSwitch } from "./period-switch";

export const metadata = { title: "P&L" };

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toneText: Record<Tone, string> = { good: "", warn: "text-warn", bad: "text-bad", neutral: "" };
const ratio = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b - 1 : null);

export default async function PnlPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; day?: string }> }) {
  await requireUser("MANAGER");
  await refreshIfStale();
  const sp = await searchParams;
  const today = businessToday();
  const period = (PERIODS.some((p) => p.kind === sp.period) ? sp.period : "week") as PeriodKind;
  const { from, toExclusive } = periodRange(period, today, { from: sp.from, to: sp.to });
  const now = new Date();
  const [report, counts] = await Promise.all([pnlReport(from, toExclusive, now), actualFromCounts()]);
  const { total: t, budget, split, targets } = report;

  const past = report.days.filter((d) => !d.future);
  const lastWithSales = [...past].reverse().find((d) => d.sales > 0)?.date;
  const day = isDate(sp.day) && sp.day! >= from && sp.day! < toExclusive ? sp.day! : (period === "today" ? today : (lastWithSales ?? past.at(-1)?.date ?? from));
  const hourly = await hourlyDay(day, now);
  const dayLabor = hourly.hours.reduce((s, h) => s + h.labor, 0);
  const daySched = hourly.hours.reduce((s, h) => s + h.scheduled, 0);

  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ period, ...(period === "custom" ? { from, to: addDays(toExclusive, -1) } : {}), ...extra });
    return `/pnl?${q}`;
  };
  const rangeLabel = from === addDays(toExclusive, -1) ? dayDate(from) : `${shortDate(from)} – ${shortDate(addDays(toExclusive, -1))}`;
  const multiDay = report.days.length > 1;
  const vsForecast = ratio(report.salesToDate, report.forecastToDate);
  const totalTarget = budget?.foodCostPct ?? null;

  const splitRows = [
    { key: "food", label: "Food", line: split.food, target: targets.food, actual: counts?.food ?? null },
    { key: "beverage", label: "Beverage", line: split.beverage, target: targets.beverage, actual: counts?.beverage ?? null },
    { key: "beer", label: "of which beer", line: split.beer, target: targets.beverage, actual: null, sub: true },
    { key: "other", label: "Other and unlinked", line: split.other, target: null, actual: null, muted: true },
  ];

  return (
    <>
      <PageHeader
        title="P&L"
        description="Live prime cost: Square sales against theoretical cost of goods (items sold × each day's recipe cost) and labor from timecards, including people still on the clock. Before rent and other overheads."
      />
      <div className="mb-6">
        <PeriodSwitch period={period} from={from} to={addDays(toExclusive, -1)} />
      </div>

      <HelpZone id="pnl.page" tour="pnl.stats" className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Net sales"
          value={money(t.sales, { whole: true })}
          hint={
            t.sales === 0 && !report.days.some((d) => d.future === false && d.date < today) ? (
              "Sales arrive with the Square sync"
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {budget?.sales != null && <Badge tone={salesTone(t.sales, budget.sales)}>{pct(budget.sales > 0 ? t.sales / budget.sales : null, 0)} of budget</Badge>}
                {vsForecast != null && <Badge tone={salesTone(report.salesToDate, report.forecastToDate)}>{signedPct(vsForecast, 0)} vs forecast</Badge>}
                {budget?.sales == null && vsForecast == null && rangeLabel}
              </span>
            )
          }
        />
        <Stat
          label={<span className="inline-flex items-center gap-1.5">Cost of goods <HelpTip id="pnl.split" /></span>}
          value={pct(t.foodPct)}
          hint={<span className="inline-flex flex-wrap items-center gap-1.5">{money(t.cogs, { whole: true })}{totalTarget != null && <Badge tone={costTone(t.foodPct, totalTarget)}>target {pct(totalTarget, 0)}</Badge>}<span>food {pct(split.food.pct, 0)} · bev {pct(split.beverage.pct, 0)}</span></span>}
        />
        <Stat
          label="Labor"
          value={pct(t.laborPct)}
          hint={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {money(t.labor, { whole: true })}
              {budget?.laborPct != null && <Badge tone={costTone(t.laborPct, budget.laborPct)}>target {pct(budget.laborPct, 0)}</Badge>}
              {report.scheduledToDate != null && report.scheduledToDate > 0 && (
                <span className={report.laborToDate > report.scheduledToDate * 1.05 ? "text-warn" : undefined}>
                  {money(report.laborToDate, { whole: true })} vs {money(report.scheduledToDate, { whole: true })} scheduled{period === "week" || period === "month" ? " to yesterday" : ""}
                </span>
              )}
            </span>
          }
        />
        <Stat
          label={<span className="inline-flex items-center gap-1.5">Prime cost <HelpTip id="pnl.prime" /></span>}
          value={pct(t.primePct)}
          hint={<span className="inline-flex flex-wrap items-center gap-1.5">{money(t.primeCost, { whole: true })}{totalTarget != null && budget?.laborPct != null && <Badge tone={costTone(t.primePct, totalTarget + budget.laborPct)}>target {pct(totalTarget + budget.laborPct, 0)}</Badge>}</span>}
        />
      </HelpZone>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Profit before overhead" value={money(t.profit, { whole: true })} tone={t.profit < 0 ? "bad" : undefined} hint={t.sales > 0 ? `${pct(t.profit / t.sales)} of sales` : "no sales yet"} />
        <Stat label="Labor hours" value={qty(t.laborHours, 1)} hint={report.openCards ? `${report.openCards} on the clock now` : `incl. ${Math.round(report.burdenPct * 100)}% burden in cost`} />
        <Stat label={<span className="inline-flex items-center gap-1.5">Sales per labor hour <HelpTip id="pnl.splh" /></span>} value={money(t.salesPerLaborHour, { whole: true })} />
        <Stat label="Orders per labor hour" value={t.ordersPerLaborHour == null ? "—" : qty(t.ordersPerLaborHour, 1)} hint={report.hasHourly ? `${qty(t.orders ?? 0, 0)} orders` : "needs Square order sync"} />
      </div>
      <div className="mb-10 space-y-1 text-sm text-muted">
        {!budget && <p>No budget set for {multiDay ? "these weeks" : "this week"}. Targets show here once one is. <Link href="/budgets" className="underline">Budgets</Link></p>}
        {report.uncosted.length > 0 && <p className="text-warn">Cost of goods is a floor: {report.uncosted.slice(0, 4).join(", ")}{report.uncosted.length > 4 ? ` and ${report.uncosted.length - 4} more` : ""} {report.uncosted.length === 1 ? "is" : "are"} missing prices.</p>}
        {split.beverage.sales > 0 && split.beverage.cogs === 0 && <p className="text-warn">Drinks have no cost yet. <Link href="/menu/draft-beer" className="underline">Set up draft beer costing</Link></p>}
        {report.missingRates > 0 && <p className="text-warn">{report.missingRates} timecard{report.missingRates === 1 ? " has" : "s have"} no pay rate, so labor is understated. <Link href="/team" className="underline">Set rates</Link></p>}
      </div>

      <HelpZone id="pnl.split" tour="pnl.split">
        <Section
          title="Food and beverage"
          description={counts ? `Theoretical for ${rangeLabel}. Actual is from your last two counts (${shortDate(counts.from)} → ${shortDate(counts.to)}).` : `Theoretical for ${rangeLabel}. Count twice to see actual next to it.`}
          actions={<LinkButton href="/variance" variant="ghost" size="sm">Margin gap →</LinkButton>}
        >
          <Table>
            <thead>
              <tr>
                <Th />
                <Th align="right">Sales</Th>
                <Th align="right" className="hidden sm:table-cell">Mix</Th>
                <Th align="right" className="hidden md:table-cell">Cost</Th>
                <Th align="right">Cost %</Th>
                <Th align="right" className="hidden sm:table-cell">Target</Th>
                <Th align="right"><span className="inline-flex items-center gap-1">Actual <HelpTip id="pnl.actual" /></span></Th>
              </tr>
            </thead>
            <tbody>
              {splitRows.map((r) => {
                const tone = r.target != null ? costTone(r.line.pct, r.target) : "neutral";
                return (
                  <Tr key={r.key} className={cx(r.muted && "text-muted")}>
                    <Td className={cx("whitespace-nowrap", r.sub ? "pl-7 text-muted" : "font-medium")}>{r.label}</Td>
                    <Td align="right">{money(r.line.sales, { whole: true })}</Td>
                    <Td align="right" className="hidden text-muted sm:table-cell">{pct(r.line.mix, 0)}</Td>
                    <Td align="right" className="hidden md:table-cell">{r.muted ? "—" : money(r.line.cogs, { whole: true })}</Td>
                    <Td align="right">{r.muted ? "—" : r.target != null && r.line.pct != null && !r.sub ? <Badge tone={tone}>{pct(r.line.pct)}</Badge> : pct(r.line.pct)}</Td>
                    <Td align="right" className="hidden text-muted sm:table-cell">{r.target != null && !r.sub ? pct(r.target, 0) : ""}</Td>
                    <Td align="right">
                      {r.actual && r.actual.actualPct != null ? (
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <Badge tone={gapTone(r.actual.actualPct, r.actual.theoreticalPct)}>{pct(r.actual.actualPct)}</Badge>
                          <span className="hidden text-xs text-muted lg:inline">vs {pct(r.actual.theoreticalPct)}</span>
                        </span>
                      ) : r.muted || r.sub ? "" : <span className="text-muted">—</span>}
                    </Td>
                  </Tr>
                );
              })}
              <Tr className="font-medium">
                <Td>Total</Td>
                <Td align="right">{money(split.total.sales, { whole: true })}</Td>
                <Td align="right" className="hidden sm:table-cell" />
                <Td align="right" className="hidden md:table-cell">{money(split.total.cogs, { whole: true })}</Td>
                <Td align="right">{totalTarget != null && split.total.pct != null ? <Badge tone={costTone(split.total.pct, totalTarget)}>{pct(split.total.pct)}</Badge> : pct(split.total.pct)}</Td>
                <Td align="right" className="hidden text-muted sm:table-cell">{totalTarget != null ? pct(totalTarget, 0) : ""}</Td>
                <Td />
              </Tr>
            </tbody>
          </Table>
          {counts && counts.skipped > 0 && <p className="mt-2 text-xs text-muted">{counts.skipped} ingredient{counts.skipped === 1 ? " wasn't" : "s weren't"} counted at both ends, so actual leaves {counts.skipped === 1 ? "it" : "them"} out.</p>}
        </Section>
      </HelpZone>

      <HelpZone id="pnl.hourly" tour="pnl.hourly">
        <Section
          title={`Hour by hour · ${dayDate(day)}`}
          description={
            <>
              {hourly.hasSchedule ? <>Actual labor {money(dayLabor, { whole: true })} vs scheduled {money(daySched, { whole: true })}{hourly.scheduleDraft ? " (draft schedule)" : ""}. </> : null}
              {multiDay ? "Pick a day in the table below to see its hours." : null}
            </>
          }
        >
          <Card className="p-4">
            {hourly.hasSales || hourly.hours.some((h) => h.labor > 0 || h.scheduled > 0) ? (
              <HourlyChart hours={hourly.hours} />
            ) : (
              <div className="grid h-40 place-items-center text-sm text-muted">No hourly sales, timecards or shifts for this day.</div>
            )}
            {!hourly.hasSales && hourly.hours.some((h) => h.labor > 0 || h.scheduled > 0) && <p className="mt-2 text-xs text-muted">Hourly sales arrive with the Square sync.</p>}
          </Card>
        </Section>
      </HelpZone>

      {multiDay && (
        <HelpZone id="pnl.byDay" tour="pnl.by-day">
          <Section title="By day">
            <Table>
              <thead>
                <tr>
                  <Th>Day</Th>
                  <Th align="right">Sales</Th>
                  <Th align="right" className="hidden sm:table-cell"><span className="inline-flex items-center gap-1">Forecast <HelpTip id="pnl.forecast" /></span></Th>
                  <Th align="right" className="hidden md:table-cell">Food %</Th>
                  <Th align="right" className="hidden md:table-cell">Bev %</Th>
                  <Th align="right" className="hidden lg:table-cell">Labor</Th>
                  <Th align="right" className="hidden xl:table-cell">Scheduled</Th>
                  <Th align="right">Labor %</Th>
                  <Th align="right" className="hidden lg:table-cell">Prime %</Th>
                  <Th align="right" className="hidden sm:table-cell">Profit</Th>
                  <Th align="right" className="hidden xl:table-cell">SPLH</Th>
                  <Th align="right" className="hidden xl:table-cell">Orders/LH</Th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) => {
                  const empty = d.sales === 0 && d.labor === 0;
                  const off = ratio(d.sales, d.forecast);
                  return (
                    <Tr key={d.date} className={cx(d.date === day && "bg-surface-2/70", (d.future || empty) && "text-muted")}>
                      <Td className="whitespace-nowrap">
                        <Link href={query({ day: d.date })} scroll={false} className="font-medium hover:underline">{dayDate(d.date)}</Link>
                        {d.date === today && <Badge className="ml-2" tone="neutral">Today</Badge>}
                      </Td>
                      {d.future || empty ? (
                        <>
                          <Td align="right" className="text-muted">{d.future ? "" : "Closed"}</Td>
                          <Td align="right" className="hidden text-muted sm:table-cell">{d.forecast != null && d.forecast >= 1 ? money(d.forecast, { whole: true }) : ""}</Td>
                          <Td colSpan={10} />
                        </>
                      ) : (
                        <>
                          <Td align="right">{money(d.sales, { whole: true })}</Td>
                          <Td align="right" className="hidden sm:table-cell">
                            {d.forecast == null ? "—" : (
                              <span className="inline-flex items-center justify-end gap-1.5">
                                <span className="text-muted">{money(d.forecast, { whole: true })}</span>
                                {off != null && d.date < today && <Badge tone={salesTone(d.sales, d.forecast)}>{signedPct(off, 0)}</Badge>}
                              </span>
                            )}
                          </Td>
                          <Td align="right" className={cx("hidden md:table-cell", toneText[costTone(d.split.food.pct, targets.food)])}>{pct(d.split.food.pct)}</Td>
                          <Td align="right" className={cx("hidden md:table-cell", toneText[costTone(d.split.beverage.pct, targets.beverage)])}>{pct(d.split.beverage.pct)}</Td>
                          <Td align="right" className="hidden lg:table-cell">{money(d.labor, { whole: true })}</Td>
                          <Td align="right" className={cx("hidden xl:table-cell", d.scheduledLabor != null && d.labor > d.scheduledLabor * 1.1 ? "text-warn" : "text-muted")}>{d.scheduledLabor != null ? money(d.scheduledLabor, { whole: true }) : "—"}</Td>
                          <Td align="right" className={budget?.laborPct != null ? toneText[costTone(d.laborPct, budget.laborPct)] : ""}>{pct(d.laborPct)}</Td>
                          <Td align="right" className="hidden lg:table-cell">{pct(d.primePct)}</Td>
                          <Td align="right" className={cx("hidden sm:table-cell", d.profit < 0 && "text-bad")}>{money(d.profit, { whole: true })}</Td>
                          <Td align="right" className="hidden xl:table-cell">{money(d.salesPerLaborHour, { whole: true })}</Td>
                          <Td align="right" className="hidden xl:table-cell">{d.ordersPerLaborHour == null ? "—" : qty(d.ordersPerLaborHour, 1)}</Td>
                        </>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Section>
        </HelpZone>
      )}
    </>
  );
}
