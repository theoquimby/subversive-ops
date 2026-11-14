import { refreshIfStale } from "@/server/services/square-sync";
import { addDays, businessDate, WEEKDAYS, weekday, zonedMidnightUTC } from "@/domain/dates";
import { dayDate, money, pct, qty, relativeTime, shortDate, signedPct } from "@/lib/format";
import { TopInsights } from "@/app/(app)/insights/top-insights";
import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { costTone } from "@/domain/pnl";
import { bridge, pointsChange, unlinkedSales } from "@/domain/pnlStory";
import { pnlReport, todaySoFar } from "@/server/services/pnl";
import { periodKpis } from "@/server/services/kpis";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadCostingSnapshot } from "@/server/services/costing";
import { menuCosts, recentPriceMoves } from "@/server/services/insights";
import { deliveryWindow } from "@/server/services/planning";
import { businessToday } from "@/server/services/sales";
import { squareSummary } from "@/server/services/square";
import { attentionList } from "@/server/services/attention";
import Link from "next/link";
import { HelpTip, HelpZone } from "@/components/help";
import { onboardingState } from "@/server/services/onboarding";
import { ratingTrend } from "@/domain/alerts";
import { env } from "@/server/env";
import { buildContext } from "@/server/services/costing";
import { CircleCheck, ChevronRight, ClipboardList, FileCheck, GraduationCap, Beer, MessageSquareText, ShoppingCart, CalendarCheck, Users, Truck, type LucideIcon } from "lucide-react";
import { DismissSetupButton } from "./welcome/dismiss-setup";
import { TodayChart, WeekStrip } from "./_overview/charts";
import { Delta, fmt } from "./pnl/story";

export const metadata = { title: "Overview" };

const whole = (n: number) => money(n, { whole: true });
const signedWhole = (n: number) => (Math.round(n) < 0 ? `−${whole(-n)}` : whole(Math.max(0, n) || 0));

const ATTENTION_ICON: Record<string, LucideIcon> = { orders: ShoppingCart, invoices: FileCheck, kegs: Beer, requests: Users, schedule: CalendarCheck, certs: GraduationCap, reviews: MessageSquareText };
const toneChip = { bad: "bg-bad-bg text-bad", warn: "bg-warn-bg text-warn", neutral: "bg-surface-2 text-ink-2" } as const;

export default async function OverviewPage() {
  await requireUser("MANAGER");
  await refreshIfStale();
  const today = businessToday();
  const snap = await loadCostingSnapshot();
  const now = new Date();
  const [{ rows }, moves, week, prevWeek, live, suppliers, square, ob, recentReviews, waste, needs] = await Promise.all([
    menuCosts(snap),
    recentPriceMoves(30, snap),
    pnlReport(addDays(today, -7), today, now),
    periodKpis(addDays(today, -14), addDays(today, -7), { snap }),
    todaySoFar(now),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    squareSummary(),
    onboardingState(),
    db.review.findMany({ where: { postedAt: { gte: zonedMidnightUTC(addDays(today, -60), env.BUSINESS_TIMEZONE) } }, select: { rating: true, postedAt: true } }),
    db.wasteLog.findMany({ where: { loggedAt: { gte: zonedMidnightUTC(addDays(today, -7), env.BUSINESS_TIMEZONE), lt: zonedMidnightUTC(today, env.BUSINESS_TIMEZONE) } }, select: { id: true, batchId: true, ingredientId: true, qtyBase: true } }),
    attentionList(now),
  ]);
  const rating = ratingTrend(recentReviews.map((r) => ({ rating: r.rating, date: businessDate(r.postedAt, env.BUSINESS_TIMEZONE) })), today, 30);
  const ctx = buildContext(snap, today);
  const wasteCost = waste.reduce((s, w) => s + w.qtyBase.toNumber() * (ctx.ingredients.get(w.ingredientId)?.costPerBase ?? 0), 0);
  const wasteLogs = new Set(waste.map((w) => w.batchId ?? w.id)).size;

  const sold = rows.filter((r) => r.kind !== "PREP");
  // "Items over target" is about what guests order, so add-ons (modifiers) don't count.
  const menuItems = sold.filter((r) => r.kind === "MENU");
  const { split, targets, total: t, budget } = week;
  const over = menuItems.filter((r) => r.foodCostPct != null && r.foodCostPct > r.target).sort((a, b) => b.foodCostPct! - b.target - (a.foodCostPct! - a.target));
  const ups = moves.filter((m) => m.changePct > 0);
  const pnlWeek = `/pnl?period=custom&from=${addDays(today, -7)}&to=${addDays(today, -1)}`;

  // The last 7 finished days, with the same estimate for unlinked items as the P&L.
  const weekDays = week.days.filter((d) => d.date < today);
  const weekB = bridge({ sales: t.sales, cogs: t.cogs, labor: t.labor, unlinkedSales: weekDays.reduce((s, d) => s + d.unlinkedSales, 0) });
  const prevB = bridge({ sales: prevWeek.total.sales, cogs: prevWeek.total.cogs, labor: prevWeek.total.labor, unlinkedSales: prevWeek.days.filter((d) => d.date < today).reduce((s, d) => s + unlinkedSales(d.split, d.sales), 0) });
  const hasPrev = prevWeek.total.sales > 0;
  const strip = weekDays.map((d) => ({ date: d.date, sales: d.sales, forecast: d.forecast, profit: bridge(d).profit, closed: d.sales <= 0 }));

  // Today: pace against what the forecast expected by now.
  const pace = live.pace;
  const vsForecast = live.projected != null && live.forecastDay ? live.projected / live.forecastDay - 1 : null;
  const scale = Math.max(1, live.forecastDay ?? 0, live.projected ?? 0, live.soFar);
  const paceTone = pace == null ? "neutral" : pace >= 1.02 ? "good" : pace >= 0.9 ? "neutral" : "warn";
  const paceText =
    pace == null ? null : Math.abs(pace - 1) < 0.02 ? "Right on forecast for this time of day" : `${pct(Math.abs(pace - 1), 0)} ${pace > 1 ? "ahead of" : "behind"} the forecast for this time of day`;
  const wd = WEEKDAYS[weekday(today)];

  // Deliveries grouped by day: a short line per date, not a card per supplier.
  const deliveries = new Map<string, { id: string; name: string }[]>();
  for (const s of suppliers) {
    const w = deliveryWindow(s, today);
    deliveries.set(w.deliveryDate, [...(deliveries.get(w.deliveryDate) ?? []), { id: s.id, name: s.name }]);
  }
  const deliveryDays = [...deliveries].sort(([a], [b]) => a.localeCompare(b)).slice(0, 4);

  return (
    <>
      <PageHeader
        help="overview.page"
        title="Overview"
        description={<>{dayDate(today)} · <Link href="/settings/square" className="underline-offset-2 hover:text-ink hover:underline">{square.connected && square.lastSync ? `Square synced ${relativeTime(square.lastSync)}` : square.text}</Link></>}
      />
      {!ob.complete && !ob.dismissed && (
        <HelpZone id="overview.setup" className="mb-6"><Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm font-medium">Finish setting up <span className="num font-normal text-muted">· {ob.done} of {ob.total} done</span></div>
            <div className="mt-1.5 h-1.5 w-48 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${(ob.done / ob.total) * 100}%` }} /></div>
          </div>
          <div className="flex items-center gap-1">
            <LinkButton href={ob.href} size="sm" variant="primary">Continue setup</LinkButton>
            <DismissSetupButton />
          </div>
        </Card></HelpZone>
      )}

      {/* ---- Today ---- */}
      <HelpZone id="overview.today" tour="overview.today" className="mb-6">
        <Card className="overflow-hidden">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 text-[0.8rem] font-medium text-muted">
                  {live.hasSales && <span aria-hidden className="relative inline-flex size-2"><span className="absolute inset-0 rounded-full bg-good opacity-40 motion-safe:animate-ping" /><span className="relative size-2 rounded-full bg-good" /></span>}
                  Today so far <HelpTip id="overview.today" />
                </div>
                <LinkButton href="/pnl?period=today" variant="ghost" size="sm" className="-mr-2">Today&apos;s P&amp;L →</LinkButton>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[2.75rem] leading-none font-semibold tracking-tight sm:text-5xl">{whole(live.soFar)}</span>
                <span className="text-sm text-muted">{live.hasSales ? `${live.orders} orders` : "nothing synced yet"}</span>
              </div>
              {paceText && <p className={cx("mt-3 text-[0.95rem]", paceTone === "good" ? "text-good" : paceTone === "warn" ? "text-warn" : "text-ink-2")}>{paceText}.</p>}
              {!live.hasSales && live.forecastDay != null && <p className="mt-3 text-[0.95rem] text-ink-2">The forecast for {wd} is {whole(live.forecastDay)}. Pace shows once today&apos;s first sales sync.</p>}

              {live.forecastDay != null && live.forecastDay > 0 && (
                <div className="mt-5">
                  {/* sold so far → likely close, with the day's forecast marked */}
                  <div className="relative h-2.5 rounded-full bg-surface-2" aria-hidden>
                    {live.projected != null && <div className="absolute inset-y-0 left-0 rounded-full bg-series-1/25" style={{ width: `${(live.projected / scale) * 100}%` }} />}
                    <div className="absolute inset-y-0 left-0 rounded-full bg-series-1" style={{ width: `${Math.max(live.soFar > 0 ? 1.5 : 0, (live.soFar / scale) * 100)}%` }} />
                    <div className="absolute -inset-y-1.5 w-0.5 rounded-full bg-ink" style={{ left: `calc(${(live.forecastDay / scale) * 100}% - 1px)` }} />
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-3 text-xs text-muted">
                    <span>{live.projected != null && live.hasSales ? <>Likely close <b className="num font-medium text-ink">{whole(live.projected)}</b>{vsForecast != null && <> · {signedPct(vsForecast, 0)}</>}</> : "Projection starts with the first sale"}</span>
                    <span className="text-right">Forecast <b className="num font-medium text-ink">{whole(live.forecastDay)}</b></span>
                  </div>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                <div>
                  <div className="text-xs text-muted">Labor so far</div>
                  <div className="num mt-0.5 font-medium text-ink">{whole(live.laborSoFar)} <span className="font-normal text-muted">· {qty(live.laborHours, 1)} h</span></div>
                </div>
                <div>
                  <div className="text-xs text-muted">Labor % of sales</div>
                  <div className={cx("num mt-0.5 font-medium", budget?.laborPct != null && live.laborPct != null && costTone(live.laborPct, budget.laborPct) !== "good" ? (costTone(live.laborPct, budget.laborPct) === "bad" ? "text-bad" : "text-warn") : "text-ink")}>
                    {pct(live.laborPct, 0)} <span className="font-normal text-muted">{live.projectedLaborPct != null ? `· ${pct(live.projectedLaborPct, 0)} by close` : budget?.laborPct != null ? `· target ${pct(budget.laborPct, 0)}` : ""}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-border p-5 sm:p-6 lg:border-t-0 lg:border-l">
              <div className="mb-3 text-[0.8rem] font-medium text-muted">Hour by hour</div>
              <TodayChart hours={live.hours} hour={live.hour} minute={live.minute} />
            </div>
          </div>
        </Card>
      </HelpZone>

      {/* ---- What needs you ---- */}
      <HelpZone id="overview.needs" tour="overview.needs" className="mb-10">
        <Section title={<span className="inline-flex items-center gap-1.5">Needs you <HelpTip id="overview.needs" /></span>} className="mb-0">
          {needs.length === 0 ? (
            <Card className="flex items-center gap-3 p-4 text-sm text-ink-2">
              <span className="grid size-8 place-items-center rounded-lg bg-good-bg text-good"><CircleCheck aria-hidden className="size-4" /></span>
              Nothing needs you right now. Orders, invoices, requests and certificates are all clear.
            </Card>
          ) : (
            <Card className="divide-y divide-border">
              {needs.slice(0, 6).map((n) => {
                const Icon = ATTENTION_ICON[n.key.startsWith("order.") ? "orders" : n.key] ?? ClipboardList;
                return (
                  <Link key={n.key} href={n.href} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-120 first:rounded-t-xl last:rounded-b-xl hover:bg-surface-2/60">
                    <span aria-hidden className={cx("grid size-8 shrink-0 place-items-center rounded-lg", toneChip[n.tone])}><Icon className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{n.title}</span>
                      <span className="block truncate text-xs text-muted">{n.detail}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                  </Link>
                );
              })}
            </Card>
          )}
        </Section>
      </HelpZone>

      <div className="empty:hidden"><TopInsights /></div>

      {/* ---- The last 7 days ---- */}
      <HelpZone id="overview.week" tour="overview.stats" className="mb-10">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[0.95rem] font-semibold text-ink">Last 7 days</h2>
            <p className="mt-0.5 text-sm text-muted">{shortDate(addDays(today, -7))} – {shortDate(addDays(today, -1))}, against the 7 days before</p>
          </div>
          <LinkButton href={pnlWeek} variant="ghost" size="sm">P&amp;L →</LinkButton>
        </div>
        <Card className="mb-3 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold tracking-tight">{whole(t.sales)}</span>
              <span className="text-sm text-muted">sales <HelpTip id="overview.sales" /></span>
            </div>
            {hasPrev && <Delta value={t.sales / prevWeek.total.sales - 1} format={fmt.pct} label={`vs ${whole(prevWeek.total.sales)}`} flatBelow={0.005} />}
          </div>
          <WeekStrip days={strip} />
          <div className="mt-3 flex items-center gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] bg-series-1" /> Sales</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded-full bg-ink" /> Forecast</span>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            help="overview.profit"
            label={<span className="inline-flex items-center gap-1.5">Profit <HelpTip id="overview.profit" /></span>}
            value={signedWhole(weekB.profit)}
            tone={weekB.profit < 0 ? "bad" : undefined}
            hint={<span className="flex flex-col gap-1">{hasPrev && <Delta value={weekB.profit - prevB.profit} format={fmt.money} label="vs week before" compact />}<span className="truncate">{pct(weekB.margin, 0)} of sales{weekB.estimated ? " · est." : ""}</span></span>}
          />
          <Stat
            label="Labor"
            value={pct(t.laborPct)}
            tone={budget?.laborPct != null && costTone(t.laborPct, budget.laborPct) !== "good" ? costTone(t.laborPct, budget.laborPct) : undefined}
            hint={<span className="flex flex-col gap-1">{hasPrev && <Delta value={pointsChange(t.laborPct, prevWeek.total.laborPct)} format={fmt.pts} label="vs week before" goodWhenUp={false} flatBelow={0.0025} compact />}<span className="truncate">{whole(t.labor)}{budget?.laborPct != null ? ` · target ${pct(budget.laborPct, 0)}` : ` · ${money(t.salesPerLaborHour, { whole: true })} per hour`}</span></span>}
          />
          <Stat
            help="overview.foodCost"
            label={<span className="inline-flex items-center gap-1.5">Food cost <HelpTip id="overview.foodCost" /></span>}
            value={pct(split.food.pct)}
            tone={split.food.pct == null || costTone(split.food.pct, targets.food) === "good" ? undefined : costTone(split.food.pct, targets.food)}
            hint={<span className="flex flex-col gap-1">{hasPrev && prevWeek.split.food.pct != null && split.food.pct != null && <Delta value={pointsChange(split.food.pct, prevWeek.split.food.pct)} format={fmt.pts} label="vs week before" goodWhenUp={false} flatBelow={0.0025} compact />}<span className="truncate">Target {pct(targets.food, 0)}</span></span>}
          />
          <Link href="/reviews" className="block h-full rounded-xl [&>*]:h-full">
            <Stat
              help="overview.rating"
              label="Rating, 30 days"
              value={rating.avg != null ? `${rating.avg.toFixed(1)}★` : "—"}
              hint={rating.avg == null ? "No reviews in 30 days" : `${rating.count} review${rating.count === 1 ? "" : "s"}${rating.delta != null && Math.abs(rating.delta) >= 0.05 ? ` · ${rating.delta > 0 ? "▲" : "▼"} ${Math.abs(rating.delta).toFixed(1)} vs prior` : rating.delta != null ? " · steady" : ""}`}
              tone={rating.delta != null && rating.delta <= -0.3 ? "warn" : undefined}
            />
          </Link>
        </div>
        {weekB.estimated && weekB.coverage != null && (
          <p className="mt-2 text-xs text-muted">Profit counts {pct(1 - weekB.coverage, 0)} of sales not linked to a recipe at a typical 30% cost. <Link href="/sales#sales-items" className="underline underline-offset-2 hover:text-ink">Link items</Link></p>
        )}
      </HelpZone>

      {/* ---- Costs to watch ---- */}
      <div className="grid gap-x-8 lg:grid-cols-5">
        <HelpZone id="overview.priceChanges" tour="overview.price-changes" className="mb-10 lg:col-span-3 [&>section]:mb-0">
          <Section
            fill
            title="Price changes"
            description={<>{ups.length} up in the last 30 days{wasteLogs ? ` · waste ${whole(wasteCost)} this week` : " · no waste logged this week"}</>}
            actions={<LinkButton href="/prices" variant="ghost" size="sm">All prices →</LinkButton>}
          >
            {moves.length === 0 ? (
              <EmptyState title="No price changes">Import a distributor sheet to start tracking prices.</EmptyState>
            ) : (
              <Table>
                <thead><tr><Th>Item</Th><Th align="right" className="hidden sm:table-cell">Was</Th><Th align="right">Now</Th><Th align="right">Change</Th></tr></thead>
                <tbody>
                  {moves.slice(0, 5).map((m, i) => (
                    <Tr key={m.productId} className={cx(i >= 3 && "max-sm:hidden")}>
                      <Td>
                        <div className="font-medium">{m.ingredient ?? m.description}</div>
                        <div className="text-xs text-muted">{m.supplier} · {shortDate(m.date)}</div>
                      </Td>
                      <Td align="right" className="hidden text-muted sm:table-cell">{money(m.oldPrice)}</Td>
                      <Td align="right">{money(m.newPrice)}</Td>
                      <Td align="right"><Badge tone={m.changePct > 0 ? "bad" : "good"}>{signedPct(m.changePct)}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
        </HelpZone>

        <HelpZone id="overview.overTarget" tour="overview.over-target" className="mb-10 lg:col-span-2 [&>section]:mb-0">
          <Section fill title="Over target" description={`${over.length} of ${menuItems.length} menu items above their food cost target`} actions={<LinkButton href="/menu" variant="ghost" size="sm">Menu →</LinkButton>}>
            {over.length === 0 ? (
              <EmptyState title="Everything's on target" />
            ) : (
              <Card className="divide-y divide-border">
                {over.slice(0, 5).map((r, i) => (
                  <Link key={r.id} href={`/menu/${r.id}`} className={cx(i >= 3 && "max-sm:hidden", "flex items-center justify-between gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl hover:bg-surface-2/60")}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="num text-xs text-muted">{money(r.cost)} on {money(r.menuPrice)}</div>
                    </div>
                    <div className="num shrink-0 text-right">
                      <div className="text-sm font-medium text-bad">{pct(r.foodCostPct)}</div>
                      <div className="text-xs text-muted">target {pct(r.target, 0)}</div>
                    </div>
                  </Link>
                ))}
              </Card>
            )}
          </Section>
        </HelpZone>
      </div>

      {/* ---- Deliveries ---- */}
      {deliveryDays.length > 0 && (
        <HelpZone id="overview.deliveries" tour="overview.deliveries">
          <Section title="Next deliveries" description="Tap a supplier to build its order from the forecast and your last count." actions={<LinkButton href="/ordering" variant="ghost" size="sm">Ordering →</LinkButton>}>
            <Card className="divide-y divide-border">
              {deliveryDays.map(([date, list]) => {
                const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
                return (
                  <div key={date} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex w-40 shrink-0 items-center gap-2 text-sm">
                      <Truck aria-hidden className={cx("size-4", days <= 1 ? "text-warn" : "text-muted")} />
                      <span className="font-medium text-ink">{days === 0 ? "Today" : days === 1 ? "Tomorrow" : dayDate(date)}</span>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {list.map((s) => (
                        <Link key={s.id} href={`/ordering/${s.id}`} className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[0.8rem] text-ink-2 transition-colors hover:border-border-strong hover:text-ink">{s.name}</Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </Card>
          </Section>
        </HelpZone>
      )}
    </>
  );
}
