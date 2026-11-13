import { refreshIfStale } from "@/server/services/square-sync";
import { Badge, Card, cx, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { HelpTip, HelpZone } from "@/components/help";
import { addDays } from "@/domain/dates";
import { costTone, gapTone, KPI_LABELS, PERIODS, PeriodKind, periodRange, salesTone, Tone } from "@/domain/pnl";
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
  // Today is still in progress: it only counts toward the totals when "Today" is picked.
  const includeToday = period === "today";
  const [report, counts] = await Promise.all([pnlReport(from, toExclusive, now, { includeToday }), actualFromCounts()]);
  const { total: t, budget, split, targets, kpis } = report;
  const todayRow = report.days.find((d) => d.isToday);
  // "Today" with no Square sales yet: show the sync state instead of $0 and red ratios.
  const salesPending = includeToday && !!todayRow && !todayRow.salesSynced;
  const nothingCounted = kpis.counted.length === 0;
  const foodTarget = budget?.foodCostPct ?? targets.food;

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
  const countedLabel = kpis.counted.length === 0 ? "finished days (none yet)" : kpis.counted.length === 1 ? dayDate(kpis.counted[0]) + (kpis.partial ? " so far" : "") : `${shortDate(kpis.counted[0])} – ${shortDate(kpis.counted[kpis.counted.length - 1])}`;
  const vsForecast = ratio(report.salesToDate, report.forecastToDate);
  const totalTarget = budget?.foodCostPct ?? null;
  const muted = (v: string) => <span className="text-base font-medium text-muted">{v}</span>;

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

      {kpis.todayExcluded && (
        <p className="-mt-3 mb-4 text-sm text-muted">
          Totals cover finished days{nothingCounted ? " — none yet this period" : ` (${shortDate(kpis.counted[0])} – ${shortDate(kpis.counted[kpis.counted.length - 1])})`}. Today is still in progress. <Link href="/pnl?period=today" className="underline">See today so far</Link>
        </p>
      )}
      <HelpZone id="pnl.page" tour="pnl.stats" className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={KPI_LABELS.sales}
          value={salesPending ? muted("Sales sync pending") : nothingCounted ? "—" : money(t.sales, { whole: true })}
          hint={
            salesPending ? (
              "Today's sales arrive with the next Square sync"
            ) : t.sales === 0 && !report.days.some((d) => d.future === false && d.date < today) ? (
              "Sales arrive with the Square sync"
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {budget?.sales != null && <Badge tone={salesTone(t.sales, budget.sales)}>{pct(budget.sales > 0 ? t.sales / budget.sales : null, 0)} of budget</Badge>}
                {vsForecast != null && <Badge tone={salesTone(report.salesToDate, report.forecastToDate)}>{signedPct(vsForecast, 0)} vs forecast</Badge>}
                {budget?.sales == null && vsForecast == null && (kpis.partial ? "so far today" : rangeLabel)}
              </span>
            )
          }
        />
        <Stat
          label={<span className="inline-flex items-center gap-1.5">{KPI_LABELS.food} <HelpTip id="pnl.split" /></span>}
          value={salesPending ? "—" : pct(kpis.foodPct)}
          hint={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span>{KPI_LABELS.foodHint}</span>
              {!salesPending && kpis.foodPct != null && <Badge tone={kpis.partial ? "neutral" : costTone(kpis.foodPct, foodTarget)}>target {pct(foodTarget, 0)}</Badge>}
              {kpis.beveragePct != null && <span>bev {pct(kpis.beveragePct, 0)} of bev sales</span>}
            </span>
          }
        />
        <Stat
          label={KPI_LABELS.labor}
          value={salesPending ? "—" : pct(kpis.laborPct)}
          hint={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span>{salesPending ? `${money(t.labor, { whole: true })} so far` : `${money(t.labor, { whole: true })} · % of net sales`}</span>
              {!salesPending && budget?.laborPct != null && kpis.laborPct != null && <Badge tone={kpis.partial ? "neutral" : costTone(kpis.laborPct, budget.laborPct)}>target {pct(budget.laborPct, 0)}</Badge>}
              {report.scheduledToDate != null && report.scheduledToDate > 0 && (
                <span className={report.laborToDate > report.scheduledToDate * 1.05 ? "text-warn" : undefined}>
                  {money(report.laborToDate, { whole: true })} vs {money(report.scheduledToDate, { whole: true })} scheduled{period === "week" || period === "month" ? " to yesterday" : ""}
                </span>
              )}
            </span>
          }
        />
        <Stat
          label={<span className="inline-flex items-center gap-1.5">{KPI_LABELS.prime} <HelpTip id="pnl.prime" /></span>}
          value={salesPending ? "—" : pct(kpis.primePct)}
          hint={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {money(t.primeCost, { whole: true })}{kpis.cogsPct != null ? ` · COGS ${pct(kpis.cogsPct, 0)} + labor` : " · COGS + labor"}
              {!salesPending && !kpis.partial && totalTarget != null && budget?.laborPct != null && <Badge tone={costTone(kpis.primePct, totalTarget + budget.laborPct)}>target {pct(totalTarget + budget.laborPct, 0)}</Badge>}
            </span>
          }
        />
      </HelpZone>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Profit before overhead"
          value={salesPending ? "—" : money(t.profit, { whole: true })}
          tone={!salesPending && !kpis.partial && t.profit < 0 ? "bad" : undefined}
          hint={salesPending ? "waiting for today's sales" : t.sales > 0 ? `${pct(t.profit / t.sales)} of sales${kpis.partial ? " so far" : ""}` : "no sales yet"}
        />
        <Stat label="Labor hours" value={qty(t.laborHours, 1)} hint={report.openCards ? `${report.openCards} on the clock now` : `incl. ${Math.round(report.burdenPct * 100)}% burden in cost`} />
        <Stat label={<span className="inline-flex items-center gap-1.5">Sales per labor hour <HelpTip id="pnl.splh" /></span>} value={salesPending ? "—" : money(t.salesPerLaborHour, { whole: true })} />
        <Stat label="Orders per labor hour" value={salesPending || t.ordersPerLaborHour == null ? "—" : qty(t.ordersPerLaborHour, 1)} hint={report.hasHourly ? `${qty(t.orders ?? 0, 0)} orders` : "needs Square order sync"} />
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
          description={counts ? `Theoretical for ${countedLabel}. Each line's cost % is of its own sales. Actual is from your last two counts (${shortDate(counts.from)} → ${shortDate(counts.to)}).` : `Theoretical for ${countedLabel}. Each line's cost % is of its own sales. Count twice to see actual next to it.`}
          actions={<LinkButton href="/variance" variant="ghost" size="sm">Margin gap →</LinkButton>}
        >
          <Table>
            <thead>
              <tr>
                <Th className="px-2! sm:px-4!" />
                <Th align="right" className="px-2! sm:px-4!">Sales</Th>
                <Th align="right" className="px-2! sm:px-4! hidden sm:table-cell">Mix</Th>
                <Th align="right" className="px-2! sm:px-4! hidden md:table-cell">Cost</Th>
                <Th align="right" className="px-2! sm:px-4!">Cost %</Th>
                <Th align="right" className="px-2! sm:px-4! hidden sm:table-cell">Target</Th>
                <Th align="right" className="pr-4! pl-2! sm:px-4!"><span className="inline-flex items-center gap-1">Actual <HelpTip id="pnl.actual" /></span></Th>
              </tr>
            </thead>
            <tbody>
              {splitRows.map((r) => {
                const tone = r.target != null ? costTone(r.line.pct, r.target) : "neutral";
                return (
                  <Tr key={r.key} className={cx(r.muted && "text-muted")}>
                    <Td className={cx("px-2! sm:whitespace-nowrap sm:px-4!", r.sub ? "pl-5! text-muted sm:pl-7!" : "font-medium")}>{r.label}</Td>
                    <Td align="right" className="px-2! sm:px-4!">{money(r.line.sales, { whole: true })}</Td>
                    <Td align="right" className="px-2! sm:px-4! hidden text-muted sm:table-cell">{pct(r.line.mix, 0)}</Td>
                    <Td align="right" className="px-2! sm:px-4! hidden md:table-cell">{r.muted ? "—" : money(r.line.cogs, { whole: true })}</Td>
                    <Td align="right" className="px-2! sm:px-4!">{r.muted ? "—" : r.target != null && r.line.pct != null && !r.sub ? <Badge tone={tone}>{pct(r.line.pct)}</Badge> : pct(r.line.pct)}</Td>
                    <Td align="right" className="px-2! sm:px-4! hidden text-muted sm:table-cell">{r.target != null && !r.sub ? pct(r.target, 0) : ""}</Td>
                    <Td align="right" className="px-2! sm:px-4!">
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
                <Td className="px-2! sm:px-4!">Total</Td>
                <Td align="right" className="px-2! sm:px-4!">{money(split.total.sales, { whole: true })}</Td>
                <Td align="right" className="px-2! sm:px-4! hidden sm:table-cell" />
                <Td align="right" className="px-2! sm:px-4! hidden md:table-cell">{money(split.total.cogs, { whole: true })}</Td>
                <Td align="right" className="px-2! sm:px-4!">{totalTarget != null && split.total.pct != null ? <Badge tone={costTone(split.total.pct, totalTarget)}>{pct(split.total.pct)}</Badge> : pct(split.total.pct)}</Td>
                <Td align="right" className="px-2! sm:px-4! hidden text-muted sm:table-cell">{totalTarget != null ? pct(totalTarget, 0) : ""}</Td>
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
                  <Th align="right" className="hidden md:table-cell">Food cost %</Th>
                  <Th align="right" className="hidden md:table-cell">Bev cost %</Th>
                  <Th align="right" className="hidden lg:table-cell">Labor</Th>
                  <Th align="right" className="hidden xl:table-cell">Scheduled</Th>
                  <Th align="right">Labor %</Th>
                  <Th align="right" className="hidden lg:table-cell">Prime %</Th>
                  <Th align="right" className="hidden sm:table-cell">Profit</Th>
                  <Th align="right" className="hidden 2xl:table-cell">SPLH</Th>
                  <Th align="right" className="hidden 2xl:table-cell">Orders/LH</Th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) => {
                  const empty = d.sales === 0 && d.labor === 0 && !d.isToday;
                  const off = ratio(d.sales, d.forecast);
                  // Today is in progress: no red/amber, and no ratios until sales sync.
                  const live = d.isToday;
                  const pending = live && !d.salesSynced;
                  const tt = (t: Tone) => (live ? "" : toneText[t]);
                  return (
                    <Tr key={d.date} className={cx(d.date === day && "bg-surface-2/70", (d.future || empty) && "text-muted")}>
                      <Td className="sm:whitespace-nowrap">
                        <Link href={query({ day: d.date })} scroll={false} className="relative whitespace-nowrap after:absolute after:content-[''] after:-inset-x-2 after:-inset-y-3 font-medium hover:underline">{dayDate(d.date)}</Link>
                        {live && <Badge className="ml-2 hidden sm:inline-flex" tone="neutral">Today · in progress</Badge>}
                        {live && <span className="block text-xs text-muted sm:hidden">Today · in progress</span>}
                      </Td>
                      {d.future || empty ? (
                        <>
                          <Td align="right" className="text-muted">{d.future ? "" : "Closed"}</Td>
                          <Td align="right" className="hidden text-muted sm:table-cell">{d.forecast != null && d.forecast >= 1 ? money(d.forecast, { whole: true }) : ""}</Td>
                          <Td colSpan={10} />
                        </>
                      ) : (
                        <>
                          <Td align="right" className={cx(live && "text-muted")}>{pending ? <span className="text-xs whitespace-nowrap">Sync pending</span> : money(d.sales, { whole: true })}</Td>
                          <Td align="right" className="hidden sm:table-cell">
                            {d.forecast == null ? "—" : (
                              <span className="inline-flex items-center justify-end gap-1.5">
                                <span className="text-muted">{money(d.forecast, { whole: true })}</span>
                                {off != null && !live && d.date < today && <Badge tone={salesTone(d.sales, d.forecast)}>{signedPct(off, 0)}</Badge>}
                              </span>
                            )}
                          </Td>
                          <Td align="right" className={cx("hidden md:table-cell", tt(costTone(d.split.food.pct, targets.food)))}>{pending ? "—" : pct(d.split.food.pct)}</Td>
                          <Td align="right" className={cx("hidden md:table-cell", tt(costTone(d.split.beverage.pct, targets.beverage)))}>{pending ? "—" : pct(d.split.beverage.pct)}</Td>
                          <Td align="right" className="hidden lg:table-cell">{money(d.labor, { whole: true })}</Td>
                          <Td align="right" className={cx("hidden xl:table-cell", d.scheduledLabor != null && d.labor > d.scheduledLabor * 1.1 ? "text-warn" : "text-muted")}>{d.scheduledLabor != null ? money(d.scheduledLabor, { whole: true }) : "—"}</Td>
                          <Td align="right" className={budget?.laborPct != null ? tt(costTone(d.laborPct, budget.laborPct)) : ""}>{pending ? "—" : pct(d.laborPct)}</Td>
                          <Td align="right" className="hidden lg:table-cell">{pending ? "—" : pct(d.primePct)}</Td>
                          <Td align="right" className={cx("hidden sm:table-cell", !live && d.profit < 0 && "text-bad", live && "text-muted")}>{pending ? "—" : money(d.profit, { whole: true })}</Td>
                          <Td align="right" className="hidden 2xl:table-cell">{pending ? "—" : money(d.salesPerLaborHour, { whole: true })}</Td>
                          <Td align="right" className="hidden 2xl:table-cell">{d.ordersPerLaborHour == null ? "—" : qty(d.ordersPerLaborHour, 1)}</Td>
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
