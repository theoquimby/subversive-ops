import { refreshIfStale } from "@/server/services/square-sync";
import { addDays, businessDate, zonedMidnightUTC } from "@/domain/dates";
import { dayDate, money, pct, qty, shortDate, signedPct } from "@/lib/format";
import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import type { Tone } from "@/components/ui";
import { costTone } from "@/domain/pnl";
import { pnlReport, todaySoFar } from "@/server/services/pnl";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadCostingSnapshot } from "@/server/services/costing";
import { menuCosts, recentPriceMoves } from "@/server/services/insights";
import { deliveryWindow } from "@/server/services/planning";
import { businessToday } from "@/server/services/sales";
import { squareSummary } from "@/server/services/square";
import Link from "next/link";
import { HelpTip, HelpZone } from "@/components/help";
import { onboardingState } from "@/server/services/onboarding";
import { ratingTrend } from "@/domain/alerts";
import { env } from "@/server/env";
import { buildContext } from "@/server/services/costing";
import { DismissSetupButton } from "./welcome/dismiss-setup";

export const metadata = { title: "Overview" };

function LiveFigure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <div>
      <div className="text-[0.8rem] text-muted">{label}</div>
      <div className={cx("num text-xl font-semibold", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink")}>{value}</div>
      {hint && <div className="num text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default async function OverviewPage() {
  await requireUser("MANAGER");
  await refreshIfStale();
  const today = businessToday();
  const snap = await loadCostingSnapshot();
  const now = new Date();
  const [{ rows }, moves, week, live, suppliers, square, ob, recentReviews, waste] = await Promise.all([
    menuCosts(snap),
    recentPriceMoves(30, snap),
    pnlReport(addDays(today, -7), today, now),
    todaySoFar(now),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    squareSummary(),
    onboardingState(),
    db.review.findMany({ where: { postedAt: { gte: zonedMidnightUTC(addDays(today, -60), env.BUSINESS_TIMEZONE) } }, select: { rating: true, postedAt: true } }),
    db.wasteLog.findMany({ where: { loggedAt: { gte: zonedMidnightUTC(addDays(today, -7), env.BUSINESS_TIMEZONE), lt: zonedMidnightUTC(today, env.BUSINESS_TIMEZONE) } }, select: { id: true, batchId: true, ingredientId: true, qtyBase: true } }),
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
  const vsForecast = live.projected != null && live.forecastDay ? live.projected / live.forecastDay - 1 : null;
  const pnlWeek = `/pnl?period=custom&from=${addDays(today, -7)}&to=${addDays(today, -1)}`;

  return (
    <>
      <PageHeader
        help="overview.page"
        title="Overview"
        description={<>{dayDate(today)} · <Link href="/settings/square" className="underline-offset-2 hover:text-ink hover:underline">{square.text}</Link></>}
      />
      {!ob.complete && !ob.dismissed && (
        <HelpZone id="overview.setup" className="mb-8"><Card className="flex flex-wrap items-center justify-between gap-3 p-4">
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

      <HelpZone id="overview.today" tour="overview.today" className="mb-8">
        <Card className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 lg:grid-cols-4">
          <div className="col-span-2 flex items-center justify-between gap-2 lg:col-span-4">
            <div className="inline-flex items-center gap-1.5 text-sm font-medium">Today so far <HelpTip id="overview.today" /></div>
            <LinkButton href="/pnl?period=today" variant="ghost" size="sm">Today&apos;s P&amp;L →</LinkButton>
          </div>
          <LiveFigure label="Sales" value={money(live.soFar, { whole: true })} hint={live.hasSales ? `${live.orders} orders` : "nothing synced yet today"} />
          <LiveFigure label="Labor so far" value={money(live.laborSoFar, { whole: true })} hint={`${qty(live.laborHours, 1)} hours`} />
          <LiveFigure
            label="Labor %"
            value={pct(live.laborPct, 0)}
            tone={budget?.laborPct != null ? costTone(live.laborPct, budget.laborPct) : undefined}
            hint={live.projectedLaborPct != null ? `${pct(live.projectedLaborPct, 0)} by close, on schedule` : budget?.laborPct != null ? `target ${pct(budget.laborPct, 0)}` : undefined}
          />
          {live.hasSales ? (
            <LiveFigure
              label="Projected close"
              value={live.projected != null ? money(live.projected, { whole: true }) : "—"}
              tone={vsForecast == null ? undefined : vsForecast >= 0 ? "good" : vsForecast >= -0.1 ? "warn" : "bad"}
              hint={live.forecastDay != null ? `forecast ${money(live.forecastDay, { whole: true })}${vsForecast != null ? ` · ${signedPct(vsForecast, 0)}` : ""}` : "no forecast yet"}
            />
          ) : (
            <LiveFigure label="Forecast today" value={live.forecastDay != null ? money(live.forecastDay, { whole: true }) : "—"} hint="projection starts once today's sales sync" />
          )}
        </Card>
      </HelpZone>

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-2">Last 7 days</h2>
        <LinkButton href={pnlWeek} variant="ghost" size="sm">P&amp;L →</LinkButton>
      </div>
      <HelpZone id="overview.week" tour="overview.stats" className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={<span className="inline-flex items-center gap-1.5">Sales <HelpTip id="overview.sales" /></span>} value={money(t.sales, { whole: true })} hint={`food ${pct(split.food.mix, 0)} · drinks ${pct(split.beverage.mix, 0)}`} />
        <Stat label={<span className="inline-flex items-center gap-1.5">Food cost <HelpTip id="overview.foodCost" /></span>} value={pct(split.food.pct)} hint={`Target ${pct(targets.food, 0)} · theoretical`} tone={split.food.pct == null ? undefined : costTone(split.food.pct, targets.food)} />
        <Stat label={<span className="inline-flex items-center gap-1.5">Beverage cost <HelpTip id="overview.bevCost" /></span>} value={pct(split.beverage.pct)} hint={split.beverage.sales > 0 && split.beverage.cogs === 0 ? "drinks not costed yet" : `Target ${pct(targets.beverage, 0)} · theoretical`} tone={split.beverage.pct == null || split.beverage.cogs === 0 ? undefined : costTone(split.beverage.pct, targets.beverage)} />
        <Stat label="Labor" value={pct(t.laborPct)} hint={`prime cost ${pct(t.primePct, 0)}${budget?.laborPct != null ? ` · target ${pct(budget.laborPct, 0)}` : ""}`} tone={budget?.laborPct != null ? costTone(t.laborPct, budget.laborPct) : undefined} />
      </HelpZone>
      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6 [&>[data-help-zone]>*]:h-full">
        <Stat help="overview.overTarget" label={<span className="inline-flex items-center gap-1.5">Items over target <HelpTip id="overview.overTarget" /></span>} value={over.length} hint={`of ${menuItems.length} menu items`} tone={over.length ? "warn" : "good"} />
        <Stat help="overview.priceIncreases" label="Price increases" value={ups.length} hint="Last 30 days" tone={ups.length ? "warn" : undefined} />
        <Link href="/reviews" className="block h-full rounded-xl [&>*]:h-full">
          <Stat
            help="overview.rating"
            label="Rating, 30 days"
            value={rating.avg != null ? `${rating.avg.toFixed(1)}★` : "—"}
            hint={rating.avg == null ? "no reviews in 30 days" : `${rating.count} review${rating.count === 1 ? "" : "s"}${rating.delta != null && Math.abs(rating.delta) >= 0.05 ? ` · ${rating.delta > 0 ? "▲" : "▼"} ${Math.abs(rating.delta).toFixed(1)} vs prior` : rating.delta != null ? " · steady" : ""}`}
            tone={rating.delta != null && rating.delta <= -0.3 ? "warn" : undefined}
          />
        </Link>
        <Link href="/waste" className="block h-full rounded-xl [&>*]:h-full">
          <Stat help="overview.waste" label="Waste, 7 days" value={money(wasteCost, { whole: true })} hint={wasteLogs ? `${wasteLogs} log${wasteLogs === 1 ? "" : "s"}` : "nothing logged"} tone={wasteLogs ? undefined : "warn"} />
        </Link>
        <div className="hidden lg:block">
          <Stat help="overview.profit" label="Profit before overhead" value={money(t.profit, { whole: true })} hint="last 7 days" tone={t.profit < 0 ? "bad" : undefined} />
        </div>
        <div className="hidden lg:block">
          <Stat help="pnl.splh" label="Sales per labor hour" value={money(t.salesPerLaborHour, { whole: true })} hint={t.ordersPerLaborHour != null ? `${qty(t.ordersPerLaborHour, 1)} orders per labor hour` : "last 7 days"} />
        </div>
      </div>

      <div className="grid gap-x-8 lg:grid-cols-5">
        <HelpZone id="overview.priceChanges" tour="overview.price-changes" className="mb-10 lg:col-span-3 [&>section]:mb-0">
        <Section title="Price changes" description="Last 30 days, biggest moves first" actions={<LinkButton href="/prices" variant="ghost" size="sm">All prices →</LinkButton>}>
          {moves.length === 0 ? (
            <EmptyState title="No price changes">Import a distributor sheet to start tracking prices.</EmptyState>
          ) : (
            <Table>
              <thead><tr><Th>Item</Th><Th align="right" className="hidden sm:table-cell">Was</Th><Th align="right">Now</Th><Th align="right">Change</Th></tr></thead>
              <tbody>
                {moves.slice(0, 7).map((m) => (
                  <Tr key={m.productId}>
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
        <Section title="Over target" description="Menu items above their food cost target" actions={<LinkButton href="/menu" variant="ghost" size="sm">Menu →</LinkButton>}>
          {over.length === 0 ? (
            <EmptyState title="Everything's on target" />
          ) : (
            <Card className="divide-y divide-border">
              {over.slice(0, 6).map((r) => (
                <Link key={r.id} href={`/menu/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2/60">
                  <div>
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="num text-xs text-muted">{money(r.cost)} on {money(r.menuPrice)}</div>
                  </div>
                  <div className="num text-right">
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

      <HelpZone id="overview.deliveries" tour="overview.deliveries">
      <Section title="Next deliveries" description="Suggested orders are drafted from forecast sales, recipes and your last count.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => {
            const w = deliveryWindow(s, today);
            const days = Math.round((Date.parse(w.deliveryDate) - Date.parse(today)) / 86_400_000);
            return (
              <Link key={s.id} href={`/ordering/${s.id}`}>
                <Card className="p-4 transition-colors hover:border-border-strong">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium">{s.name}</div>
                    <Badge>{s.kind === "LOCAL" ? "Local" : "Distributor"}</Badge>
                  </div>
                  <div className="mt-3 text-[0.8rem] text-muted">Next delivery</div>
                  <div className={cx("num text-sm font-medium", days <= 1 && "text-warn")}>
                    {dayDate(w.deliveryDate)} {days === 0 ? "· today" : days === 1 ? "· tomorrow" : ""}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </Section>
      </HelpZone>
    </>
  );
}
