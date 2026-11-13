import { Badge, Card, cx, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { costTone, PERIODS, PeriodKind, periodRange, salesTone } from "@/domain/pnl";
import { dayDate, money, pct, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { hourlyDay, pnlReport } from "@/server/services/pnl";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { HourlyChart } from "./hourly-chart";
import { PeriodSwitch } from "./period-switch";

export const metadata = { title: "P&L" };

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function PnlPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; day?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const today = businessToday();
  const period = (PERIODS.some((p) => p.kind === sp.period) ? sp.period : "week") as PeriodKind;
  const { from, toExclusive } = periodRange(period, today, { from: sp.from, to: sp.to });
  const now = new Date();
  const report = await pnlReport(from, toExclusive, now);
  const { total: t, budget } = report;

  const past = report.days.filter((d) => !d.future);
  const lastWithSales = [...past].reverse().find((d) => d.sales > 0)?.date;
  const day = isDate(sp.day) && sp.day! >= from && sp.day! < toExclusive ? sp.day! : (period === "today" ? today : (lastWithSales ?? past.at(-1)?.date ?? from));
  const hourly = await hourlyDay(day, now);

  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ period, ...(period === "custom" ? { from, to: addDays(toExclusive, -1) } : {}), ...extra });
    return `/pnl?${q}`;
  };
  const rangeLabel = from === addDays(toExclusive, -1) ? dayDate(from) : `${shortDate(from)} – ${shortDate(addDays(toExclusive, -1))}`;
  const multiDay = report.days.length > 1;

  return (
    <>
      <PageHeader
        title="P&L"
        description="Live prime cost: Square sales against theoretical food cost (items sold × today's recipe cost) and labor from timecards, including people still on the clock. Before rent and other overheads."
      />
      <div className="mb-6">
        <PeriodSwitch period={period} from={from} to={addDays(toExclusive, -1)} />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Net sales"
          value={money(t.sales, { whole: true })}
          hint={t.sales === 0 && !report.days.some((d) => d.future === false && d.date < today) ? "Sales arrive with the Square sync" : budget?.sales != null ? <span className="inline-flex flex-wrap items-center gap-1.5"><Badge tone={salesTone(t.sales, budget.sales)}>{pct(budget.sales > 0 ? t.sales / budget.sales : null, 0)} of budget</Badge>{money(budget.sales, { whole: true })}</span> : rangeLabel}
        />
        <Stat
          label="Food cost"
          value={pct(t.foodPct)}
          hint={<span className="inline-flex flex-wrap items-center gap-1.5">{money(t.cogs, { whole: true })}{budget?.foodCostPct != null && <Badge tone={costTone(t.foodPct, budget.foodCostPct)}>target {pct(budget.foodCostPct, 0)}</Badge>}</span>}
        />
        <Stat
          label="Labor"
          value={pct(t.laborPct)}
          hint={<span className="inline-flex flex-wrap items-center gap-1.5">{money(t.labor, { whole: true })}{budget?.laborPct != null && <Badge tone={costTone(t.laborPct, budget.laborPct)}>target {pct(budget.laborPct, 0)}</Badge>}</span>}
        />
        <Stat
          label="Prime cost"
          value={pct(t.primePct)}
          hint={<span className="inline-flex flex-wrap items-center gap-1.5">{money(t.primeCost, { whole: true })}{budget?.foodCostPct != null && budget.laborPct != null && <Badge tone={costTone(t.primePct, budget.foodCostPct + budget.laborPct)}>target {pct(budget.foodCostPct + budget.laborPct, 0)}</Badge>}</span>}
        />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Profit before overhead" value={money(t.profit, { whole: true })} tone={t.profit < 0 ? "bad" : undefined} hint={t.sales > 0 ? `${pct(t.profit / t.sales)} of sales` : "no sales yet"} />
        <Stat label="Labor hours" value={qty(t.laborHours, 1)} hint={report.openCards ? `${report.openCards} on the clock now` : `incl. ${Math.round(report.burdenPct * 100)}% burden in cost`} />
        <Stat label="Sales per labor hour" value={money(t.salesPerLaborHour, { whole: true })} />
        <Stat label="Orders per labor hour" value={t.ordersPerLaborHour == null ? "—" : qty(t.ordersPerLaborHour, 1)} hint={report.hasHourly ? `${qty(t.orders ?? 0, 0)} orders` : "needs Square order sync"} />
      </div>
      <div className="mb-10 space-y-1 text-sm text-muted">
        {!budget && <p>No budget set for {multiDay ? "these weeks" : "this week"} — targets show here once one is.</p>}
        {report.uncosted.length > 0 && <p className="text-warn">Food cost is a floor: {report.uncosted.slice(0, 4).join(", ")}{report.uncosted.length > 4 ? ` and ${report.uncosted.length - 4} more` : ""} {report.uncosted.length === 1 ? "is" : "are"} missing prices.</p>}
        {report.missingRates > 0 && <p className="text-warn">{report.missingRates} timecard{report.missingRates === 1 ? " has" : "s have"} no pay rate, so labor is understated. <Link href="/team" className="underline">Set rates</Link></p>}
      </div>

      <Section title={`Hour by hour · ${dayDate(day)}`} description={multiDay ? "Pick a day in the table below to see its hours." : undefined}>
        <Card className="p-4">
          {hourly.hasSales || hourly.hours.some((h) => h.labor > 0) ? (
            <HourlyChart hours={hourly.hours} />
          ) : (
            <div className="grid h-40 place-items-center text-sm text-muted">No hourly sales or timecards for this day.</div>
          )}
          {!hourly.hasSales && hourly.hours.some((h) => h.labor > 0) && <p className="mt-2 text-xs text-muted">Hourly sales arrive with the Square sync.</p>}
        </Card>
      </Section>

      {multiDay && (
        <Section title="By day">
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">Sales</Th>
                <Th align="right" className="hidden md:table-cell">Food cost</Th>
                <Th align="right">Food %</Th>
                <Th align="right" className="hidden md:table-cell">Labor</Th>
                <Th align="right">Labor %</Th>
                <Th align="right" className="hidden lg:table-cell">Prime %</Th>
                <Th align="right" className="hidden sm:table-cell">Profit</Th>
                <Th align="right" className="hidden lg:table-cell">SPLH</Th>
              </tr>
            </thead>
            <tbody>
              {report.days.map((d) => {
                const empty = d.sales === 0 && d.labor === 0;
                return (
                  <Tr key={d.date} className={cx(d.date === day && "bg-surface-2/70", (d.future || empty) && "text-muted")}>
                    <Td className="whitespace-nowrap">
                      <Link href={query({ day: d.date })} scroll={false} className="font-medium hover:underline">{dayDate(d.date)}</Link>
                      {d.date === today && <Badge className="ml-2" tone="neutral">Today</Badge>}
                    </Td>
                    {d.future || empty ? (
                      <Td align="right" colSpan={8} className="text-muted">{d.future ? "" : "Closed"}</Td>
                    ) : (
                      <>
                        <Td align="right">{money(d.sales, { whole: true })}</Td>
                        <Td align="right" className="hidden md:table-cell">{money(d.cogs, { whole: true })}</Td>
                        <Td align="right" className={budget?.foodCostPct != null ? { good: "", warn: "text-warn", bad: "text-bad", neutral: "" }[costTone(d.foodPct, budget.foodCostPct)] : ""}>{pct(d.foodPct)}</Td>
                        <Td align="right" className="hidden md:table-cell">{money(d.labor, { whole: true })}</Td>
                        <Td align="right" className={budget?.laborPct != null ? { good: "", warn: "text-warn", bad: "text-bad", neutral: "" }[costTone(d.laborPct, budget.laborPct)] : ""}>{pct(d.laborPct)}</Td>
                        <Td align="right" className="hidden lg:table-cell">{pct(d.primePct)}</Td>
                        <Td align="right" className={cx("hidden sm:table-cell", d.profit < 0 && "text-bad")}>{money(d.profit, { whole: true })}</Td>
                        <Td align="right" className="hidden lg:table-cell">{money(d.salesPerLaborHour, { whole: true })}</Td>
                      </>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Section>
      )}
    </>
  );
}
