import { refreshIfStale } from "@/server/services/square-sync";
import { Badge, Card, cx, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { HelpTip, HelpZone } from "@/components/help";
import { addDays } from "@/domain/dates";
import { costTone, gapTone, KPI_LABELS, PERIODS, PeriodKind, periodRange, salesTone, Tone } from "@/domain/pnl";
import { bridge, pointsChange, TYPICAL_COST_SHARE } from "@/domain/pnlStory";
import { dayDate, money, pct, qty, shortDate, signedPct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { actualFromCounts, hourlyDay, pnlReport, pnlStory } from "@/server/services/pnl";
import { businessToday } from "@/server/services/sales";
import { Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { HourlyChart } from "./hourly-chart";
import { PeriodSwitch } from "./period-switch";
import { bridgeSteps, chipLabel, Delta, fmt, StoryNotes } from "./story";
import { BridgeChart, MixBar, TrendChart } from "./story-charts";

export const metadata = { title: "P&L" };

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toneText: Record<Tone, string> = { good: "", warn: "text-warn", bad: "text-bad", neutral: "" };
const ratio = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b - 1 : null);
const whole = (n: number) => money(n, { whole: true });
const signedWhole = (n: number) => (Math.round(n) < 0 ? `−${whole(-n)}` : whole(Math.max(0, n) || 0));

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
  const [hourly, story] = await Promise.all([hourlyDay(day, now), pnlStory(report, period)]);
  const dayLabor = hourly.hours.reduce((s, h) => s + h.labor, 0);
  const daySched = hourly.hours.reduce((s, h) => s + h.scheduled, 0);

  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ period, ...(period === "custom" ? { from, to: addDays(toExclusive, -1) } : {}), ...extra });
    return `/pnl?${q}`;
  };
  const multiDay = report.days.length > 1;
  const countedLabel = nothingCounted ? "" : kpis.counted.length === 1 ? dayDate(kpis.counted[0]) + (kpis.partial ? " so far" : "") : `${shortDate(kpis.counted[0])} – ${shortDate(kpis.counted[kpis.counted.length - 1])}`;
  const vsForecast = ratio(report.salesToDate, report.forecastToDate);
  const b = story.bridge;
  const prev = story.prev;
  const year = story.year;
  const showStory = !salesPending && !nothingCounted && t.sales > 0;
  const unlinked = story.figures.unlinkedSales;
  const primeTarget = budget?.foodCostPct != null && budget?.laborPct != null ? budget.foodCostPct + budget.laborPct : null;
  const trendCurrent = new Set(kpis.counted.map((d) => d));
  const trend = story.trend.map((w) => ({ ...w, current: [0, 1, 2, 3, 4, 5, 6].some((i) => trendCurrent.has(addDays(w.weekStart, i))) }));

  // Food and drink cards
  const bevPct = split.beverage.sales > 0 && split.beverage.cogs > 0 ? split.beverage.pct : null;
  const caveats: { text: ReactNode; tone?: "warn" }[] = [];
  if (b.estimated && b.coverage != null) caveats.push({ text: <>{pct(1 - b.coverage, 0)} of sales ({whole(unlinked)}) are items not linked to a recipe, so their cost is estimated at a typical {pct(TYPICAL_COST_SHARE, 0)}. <Link href="/sales#sales-items" className="underline underline-offset-2 hover:text-ink">Link them</Link> to make this exact.</> });
  if (report.uncosted.length > 0) caveats.push({ tone: "warn", text: <>Food & drink cost is a floor: {report.uncosted.slice(0, 4).join(", ")}{report.uncosted.length > 4 ? ` and ${report.uncosted.length - 4} more` : ""} {report.uncosted.length === 1 ? "is" : "are"} missing prices.</> });
  if (report.missingRates > 0) caveats.push({ tone: "warn", text: <>{report.missingRates} timecard{report.missingRates === 1 ? " has" : "s have"} no pay rate, so labor is understated. <Link href="/team" className="underline underline-offset-2">Set rates</Link></> });
  if (!budget) caveats.push({ text: <>No budget for {multiDay ? "these weeks" : "this week"}, so there are no targets yet. <Link href="/budgets" className="underline underline-offset-2 hover:text-ink">Budgets</Link></> });
  if (!story.fixedMonthly) caveats.push({ text: <>Add rent and other fixed costs in <Link href="/settings/money#fixed" className="underline underline-offset-2 hover:text-ink">Settings → Money</Link> to see profit after them.</> });

  return (
    <>
      <PageHeader help="pnl.page" title="P&L" description="Where each dollar of sales went: food and drink, labor, and what was left." />
      <HelpZone id="pnl.period" className="mb-6">
        <PeriodSwitch period={period} from={from} to={addDays(toExclusive, -1)} />
      </HelpZone>

      {kpis.todayExcluded && (
        <p className="-mt-3 mb-5 text-sm text-muted">
          {nothingCounted ? "No finished days yet this period." : <>Finished days only ({countedLabel}).</>} Today is still in progress. <Link href="/pnl?period=today" className="underline underline-offset-2 hover:text-ink">See today so far</Link>
        </p>
      )}

      {/* ---- Headline: profit, margin, the bridge ---- */}
      <HelpZone id="pnl.headline" tour="pnl.headline" className="mb-3">
        <Card className="overflow-hidden">
          {showStory ? (
            <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="border-b border-border p-5 sm:p-6 lg:border-r lg:border-b-0">
                <div className="flex items-center gap-1.5 text-[0.8rem] font-medium text-muted">
                  Profit before overhead{kpis.partial ? " so far" : ""} <HelpTip id="pnl.headline" />
                </div>
                <div className={cx("mt-2 text-[2.75rem] leading-none font-semibold tracking-tight sm:text-[3.25rem]", b.profit < 0 ? "text-bad" : "text-ink")}>{signedWhole(b.profit)}</div>
                <p className="mt-3 text-[0.95rem] text-ink-2">
                  {b.margin != null && b.margin > 0 ? <>You kept <b className="font-semibold text-ink">{Math.round(b.margin * 100)}¢</b> of every sales dollar{b.estimated ? " (est.)" : ""}.</> : b.margin != null ? <>Costs ran {pct(-b.margin, 0)} over sales.</> : null}
                </p>
                {(prev || year) && (
                  <div className="mt-4 flex flex-col gap-1.5">
                    {prev && <Delta value={b.profit - prev.bridge.profit} format={fmt.money} label={<>{chipLabel(prev.label)} · margin {fmt.pts(pointsChange(b.margin, prev.bridge.margin) ?? 0)}</>} />}
                    {year && <Delta value={b.profit - year.bridge.profit} format={fmt.money} label={<>{chipLabel(year.label)} · margin {fmt.pts(pointsChange(b.margin, year.bridge.margin) ?? 0)}</>} />}
                  </div>
                )}
                {b.afterFixed != null && (
                  <div className="mt-5 rounded-lg bg-surface-2/70 px-3.5 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink-2">After rent &amp; fixed costs</span>
                      <span className={cx("num text-base font-semibold", b.afterFixed < 0 ? "text-bad" : "text-ink")}>{signedWhole(b.afterFixed)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{whole(b.fixed!)} for {kpis.counted.length === 1 ? "this day" : `these ${kpis.counted.length} days`} of {whole(story.fixedMonthly!)} a month</div>
                  </div>
                )}
              </div>
              <div className="p-5 sm:p-6">
                <div className="mb-4 text-[0.8rem] font-medium text-muted">From sales to profit · {countedLabel}</div>
                <BridgeChart steps={bridgeSteps(b, { hours: t.laborHours })} sales={b.sales} />
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-muted">
              {salesPending ? "Today's sales arrive with the next Square sync. Labor on the clock so far: " + whole(t.labor) + "." : nothingCounted ? "No finished days in this period yet." : "No sales in this period."}
            </div>
          )}
        </Card>
      </HelpZone>

      {/* ---- The four ratios ---- */}
      {showStory && prev && <p className="mb-2 text-xs text-muted sm:hidden">Arrows compare with {prev.label}.</p>}
      <HelpZone id="pnl.kpis" tour="pnl.stats" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={KPI_LABELS.sales}
          value={salesPending ? "—" : nothingCounted ? "—" : whole(t.sales)}
          hint={
            showStory ? (
              <span className="flex flex-col gap-1">
                {prev ? <Delta value={ratio(t.sales, prev.figures.sales)} format={fmt.pct} label={chipLabel(prev.label)} compact flatBelow={0.005} /> : null}
                {budget?.sales != null ? <span><Badge tone={salesTone(t.sales, budget.sales)}>{pct(budget.sales > 0 ? t.sales / budget.sales : null, 0)} of budget</Badge></span> : vsForecast != null ? <span><Badge tone={salesTone(report.salesToDate, report.forecastToDate)}>{signedPct(vsForecast, 0)} vs forecast</Badge></span> : !prev ? `${qty(t.orders ?? 0, 0)} orders` : null}
              </span>
            ) : salesPending ? "Arrives with the next Square sync" : undefined
          }
        />
        <Stat
          label={<span className="inline-flex items-center gap-1.5">{KPI_LABELS.labor} <HelpTip id="pnl.labor" /></span>}
          value={salesPending || !showStory ? "—" : pct(kpis.laborPct)}
          tone={!kpis.partial && budget?.laborPct != null ? (costTone(kpis.laborPct, budget.laborPct) === "good" ? undefined : costTone(kpis.laborPct, budget.laborPct)) : undefined}
          hint={
            <span className="flex flex-col gap-1">
              {prev && showStory ? <Delta value={pointsChange(kpis.laborPct, prev.bridge.laborPct)} format={fmt.pts} label={chipLabel(prev.label)} compact goodWhenUp={false} flatBelow={0.0025} /> : null}
              <span className="truncate">{whole(t.labor)} · {qty(t.laborHours, 0)} hours{budget?.laborPct != null ? ` · target ${pct(budget.laborPct, 0)}` : ""}</span>
            </span>
          }
        />
        <Stat
          label={<span className="inline-flex items-center gap-1.5">{KPI_LABELS.prime} <HelpTip id="pnl.prime" /></span>}
          value={salesPending || !showStory ? "—" : pct(b.primePct)}
          tone={primeTarget != null && !kpis.partial && costTone(b.primePct, primeTarget) !== "good" ? costTone(b.primePct, primeTarget) : undefined}
          hint={
            <span className="flex flex-col gap-1">
              {prev && showStory ? <Delta value={pointsChange(b.primePct, prev.bridge.primePct)} format={fmt.pts} label={chipLabel(prev.label)} compact goodWhenUp={false} flatBelow={0.0025} /> : null}
              <span className="truncate">Food, drink &amp; labor{b.estimated ? " · incl. est." : ""}{primeTarget != null ? ` · target ${pct(primeTarget, 0)}` : ""}</span>
            </span>
          }
        />
        <Stat
          label={<span className="inline-flex items-center gap-1.5">Sales per labor hour <HelpTip id="pnl.splh" /></span>}
          value={salesPending || !showStory ? "—" : whole(t.salesPerLaborHour ?? 0)}
          hint={
            <span className="flex flex-col gap-1">
              {prev && showStory && prev.laborHours > 0 && t.salesPerLaborHour != null ? <Delta value={ratio(t.salesPerLaborHour, prev.figures.sales / prev.laborHours)} format={fmt.pct} label={chipLabel(prev.label)} compact flatBelow={0.005} /> : null}
              <span className="truncate">{t.ordersPerLaborHour != null ? `${qty(t.ordersPerLaborHour, 1)} orders per labor hour` : report.openCards ? `${report.openCards} on the clock now` : "net sales ÷ hours worked"}</span>
            </span>
          }
        />
      </HelpZone>

      {/* ---- What moved ---- */}
      {showStory && story.notes.some((n) => n.kind !== "sales" || n.prev || n.year) && (
        <HelpZone id="pnl.notes" tour="pnl.notes">
          <Section title="What moved" description={prev ? `Compared with ${prev.label} (${prev.from === addDays(prev.toExclusive, -1) ? dayDate(prev.from) : `${shortDate(prev.from)} – ${shortDate(addDays(prev.toExclusive, -1))}`}).` : "Only what the numbers show."}>
            <Card className="p-5">
              <StoryNotes notes={story.notes} />
            </Card>
          </Section>
        </HelpZone>
      )}

      {/* ---- Over time ---- */}
      {story.trend.length > 1 && (
        <HelpZone id="pnl.trend" tour="pnl.trend">
          <Section title="The last 12 weeks" description="Each week's sales and where they went. The weeks you picked are shaded; tap a week for its numbers.">
            <Card className="p-4 sm:p-5">
              <TrendChart weeks={trend} />
            </Card>
          </Section>
        </HelpZone>
      )}

      {/* ---- Food and drink ---- */}
      {showStory && (
        <HelpZone id="pnl.split" tour="pnl.split">
          <Section
            title="Food and drink"
            description={`What sold and what it cost, ${countedLabel}. Each cost % is of its own sales.`}
            actions={<LinkButton href="/variance" variant="ghost" size="sm">Margin gap →</LinkButton>}
          >
            <Card className="p-4 sm:p-5">
              <MixBar
                ariaLabel="Sales split into food, drinks and items not linked to a recipe"
                parts={[
                  { key: "food", label: "Food", value: split.food.sales, color: "var(--area-food)", ink: "dark" },
                  { key: "bev", label: "Drinks", value: split.beverage.sales, color: "var(--area-today)", ink: "dark" },
                  { key: "other", label: "Not linked to a recipe", value: Math.max(0, t.sales - split.food.sales - split.beverage.sales), color: "hatch", ink: "dark" },
                ]}
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <SplitTile
                  name="Food"
                  sales={split.food.sales}
                  mix={split.food.mix}
                  costPct={split.food.pct}
                  target={foodTarget}
                  partial={kpis.partial}
                  actual={counts?.food ?? null}
                  empty="No food items linked to a recipe sold"
                />
                <SplitTile
                  name="Drinks"
                  sales={split.beverage.sales}
                  mix={split.beverage.mix}
                  costPct={bevPct}
                  target={targets.beverage}
                  partial={kpis.partial}
                  actual={counts?.beverage ?? null}
                  sub={split.beer.sales > 0 ? `beer ${whole(split.beer.sales)}${split.beer.cogs > 0 ? ` at ${pct(split.beer.pct, 0)}` : ""}` : undefined}
                  empty={split.beverage.sales > 0 ? "Drinks have no cost yet" : "No drinks linked to a recipe sold"}
                  emptyHref={split.beverage.sales > 0 ? "/menu/draft-beer" : "/sales#sales-items"}
                />
              </div>
              {counts ? (
                <p className="mt-3 text-xs text-muted">Actual is from your last two counts ({shortDate(counts.from)} → {shortDate(counts.to)}){counts.skipped > 0 ? `; ${counts.skipped} ingredient${counts.skipped === 1 ? " wasn't" : "s weren't"} counted at both ends` : ""}. <HelpTip id="pnl.actual" /></p>
              ) : (
                <p className="mt-3 text-xs text-muted">Count stock twice to see actual cost next to these.</p>
              )}
            </Card>
          </Section>
        </HelpZone>
      )}

      {/* ---- About these numbers ---- */}
      {caveats.length > 0 && (
        <HelpZone id="pnl.caveats" className="mb-10">
          <Card className="bg-surface-2/40 p-4 sm:p-5">
            <div className="mb-2 flex items-center gap-1.5 text-[0.8rem] font-medium text-ink-2"><Info aria-hidden className="size-3.5" /> About these numbers</div>
            <ul className="space-y-1.5 text-sm text-muted">
              {caveats.map((c, i) => (
                <li key={i} className={cx("flex gap-2", c.tone === "warn" && "text-warn")}><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-current opacity-60" />{<span>{c.text}</span>}</li>
              ))}
            </ul>
          </Card>
        </HelpZone>
      )}

      <HelpZone id="pnl.hourly" tour="pnl.hourly">
        <Section
          title={`Hour by hour · ${dayDate(day)}`}
          description={
            <>
              {hourly.hasSchedule ? <>Actual labor {whole(dayLabor)} vs scheduled {whole(daySched)}{hourly.scheduleDraft ? " (draft schedule)" : ""}. </> : null}
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
          <Section title="By day" description={report.days.some((d) => d.unlinkedSales > 0) ? `Profit includes the estimated cost of items not linked to a recipe.` : undefined}>
            <Table sticky>
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
                  const db = bridge(d);
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
                          <Td align="right" className="hidden text-muted sm:table-cell">{d.forecast != null && d.forecast >= 1 ? whole(d.forecast) : ""}</Td>
                          <Td colSpan={10} />
                        </>
                      ) : (
                        <>
                          <Td align="right" className={cx(live && "text-muted")}>{pending ? <span className="text-xs whitespace-nowrap">Sync pending</span> : whole(d.sales)}</Td>
                          <Td align="right" className="hidden sm:table-cell">
                            {d.forecast == null ? "—" : (
                              <span className="inline-flex items-center justify-end gap-1.5">
                                <span className="text-muted">{whole(d.forecast)}</span>
                                {off != null && !live && d.date < today && <Badge tone={salesTone(d.sales, d.forecast)}>{signedPct(off, 0)}</Badge>}
                              </span>
                            )}
                          </Td>
                          <Td align="right" className={cx("hidden md:table-cell", tt(costTone(d.split.food.pct, targets.food)))}>{pending ? "—" : pct(d.split.food.pct)}</Td>
                          <Td align="right" className={cx("hidden md:table-cell", tt(costTone(d.split.beverage.pct, targets.beverage)))}>{pending ? "—" : pct(d.split.beverage.pct)}</Td>
                          <Td align="right" className="hidden lg:table-cell">{whole(d.labor)}</Td>
                          <Td align="right" className={cx("hidden xl:table-cell", d.scheduledLabor != null && d.labor > d.scheduledLabor * 1.1 ? "text-warn" : "text-muted")}>{d.scheduledLabor != null ? whole(d.scheduledLabor) : "—"}</Td>
                          <Td align="right" className={budget?.laborPct != null ? tt(costTone(d.laborPct, budget.laborPct)) : ""}>{pending ? "—" : pct(d.laborPct)}</Td>
                          <Td align="right" className="hidden lg:table-cell">{pending ? "—" : pct(db.primePct)}</Td>
                          <Td align="right" className={cx("hidden sm:table-cell", !live && db.profit < 0 && "text-bad", live && "text-muted")}>{pending ? "—" : signedWhole(db.profit)}</Td>
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

/** One side of the business: its sales and cost % against target, with actual from counts beside it. */
function SplitTile({ name, sales, mix, costPct, target, partial, actual, sub, empty, emptyHref }: {
  name: string;
  sales: number;
  mix: number | null;
  costPct: number | null;
  target: number;
  partial: boolean;
  actual: { actualPct: number | null; theoreticalPct: number | null } | null;
  sub?: string;
  empty: string;
  emptyHref?: string;
}) {
  const tone = partial ? "neutral" : costTone(costPct, target);
  const fill = costPct == null ? 0 : Math.min(1, costPct / Math.max(target * 1.6, costPct));
  const mark = target / Math.max(target * 1.6, costPct ?? 0);
  return (
    <div className="flex h-full flex-col rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink">{name}</span>
        <span className="num text-sm text-ink-2">{whole(sales)}{mix != null && <span className="ml-1.5 text-xs text-muted">{pct(mix, 0)} of sales</span>}</span>
      </div>
      {costPct != null ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={cx("text-2xl font-semibold tracking-tight", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink")}>{pct(costPct)}</span>
            <span className="text-xs text-muted">cost · target {pct(target, 0)}</span>
          </div>
          {/* meter: cost % with a tick at target */}
          <div className="relative mt-2.5 h-1.5 rounded-full bg-surface-2" aria-hidden>
            <div className={cx("absolute inset-y-0 left-0 rounded-full", tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-ink-2")} style={{ width: `${fill * 100}%` }} />
            <div className="absolute -inset-y-1 w-0.5 rounded-full bg-ink" style={{ left: `calc(${mark * 100}% - 1px)` }} />
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-muted">
            {actual?.actualPct != null && <span className="inline-flex items-center gap-1">Actual <Badge tone={gapTone(actual.actualPct, actual.theoreticalPct)}>{pct(actual.actualPct)}</Badge></span>}
            {sub && <span>{sub}</span>}
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-muted">{emptyHref ? <Link href={emptyHref} className="underline underline-offset-2 hover:text-ink">{empty}</Link> : empty}</div>
      )}
    </div>
  );
}
