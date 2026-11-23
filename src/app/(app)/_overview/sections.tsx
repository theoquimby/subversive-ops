import Link from "next/link";
import { cache } from "react";
import { Beer, CalendarCheck, CalendarClock, ChevronRight, CircleCheck, ClipboardList, Cylinder, FileCheck, GraduationCap, Landmark, ListChecks, MessageSquareText, ShoppingCart, Truck, Users, Wrench, type LucideIcon } from "lucide-react";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Card, cx, EmptyState, LinkButton, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import type { AttentionItem } from "@/domain/attention";
import { ratingTrend } from "@/domain/alerts";
import { addDays, businessDate, WEEKDAYS, weekday, zonedMidnightUTC, type ISODate } from "@/domain/dates";
import type { ElsewhereGroup } from "@/domain/focus";
import { hourLabel } from "@/domain/openingHours";
import { costTone } from "@/domain/pnl";
import { bridge, pointsChange, unlinkedSales } from "@/domain/pnlStory";
import { dayDate, money, pct, qty, shortDate, signedPct } from "@/lib/format";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { attentionList } from "@/server/services/attention";
import { tanksFloor } from "@/server/services/brewery";
import { buildContext, firstPriceDate, loadCostingSnapshot } from "@/server/services/costing";
import { menuCosts, recentPriceMoves } from "@/server/services/insights";
import { periodKpis } from "@/server/services/kpis";
import { deliveryWindow } from "@/server/services/planning";
import { pnlReport, todaySoFar } from "@/server/services/pnl";
import { Delta, fmt } from "../pnl/story";
import { dayStates } from "@/server/services/dayState";
import { TodayChart, WeekStrip, type StripDay } from "./charts";

/**
 * The Overview's blocks. Each loads its own data, so a block that isn't shown
 * (it's outside what the person looks after) costs nothing. The shared reads
 * (the last 7 days' P&L, "Needs you") are made once per render.
 */

const whole = (n: number) => money(n, { whole: true });
const signedWhole = (n: number) => (Math.round(n) < 0 ? `−${whole(-n)}` : whole(Math.max(0, n) || 0));

/** "Needs you", once per render (the list, the Brewery card and Elsewhere share it). */
export const overviewNeeds = cache(() => attentionList(new Date()));
/** The last 7 days' P&L, once per render (Today's labor target and the week both read it). */
const weekReport = cache((today: ISODate) => pnlReport(addDays(today, -7), today, new Date()));

const ATTENTION_ICON: Record<string, LucideIcon> = { orders: ShoppingCart, invoices: FileCheck, kegs: Beer, "kegs.out": Beer, "kegs.idle": Beer, "kegs.orders": Truck, requests: Users, schedule: CalendarCheck, certs: GraduationCap, reviews: MessageSquareText, checklists: ListChecks, upkeep: Wrench, "upkeep.down": Wrench, "beertax.federal": Landmark, "beertax.brop": Landmark, "beertax.ny": Landmark, "brewery.transfer": Cylinder, "brewery.package": Cylinder, "brewery.clash": CalendarClock, "brewery.suggest": CalendarClock };
const iconFor = (key: string) => ATTENTION_ICON[key.startsWith("order.") ? "orders" : key] ?? ClipboardList;
const toneChip = { bad: "bg-bad-bg text-bad", warn: "bg-warn-bg text-warn", neutral: "bg-surface-2 text-ink-2" } as const;

function NeedRow({ n }: { n: AttentionItem }) {
  const Icon = iconFor(n.key);
  return (
    <Link href={n.href} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-120 first:rounded-t-xl last:rounded-b-xl hover:bg-surface-2/60">
      <span aria-hidden className={cx("grid size-8 shrink-0 place-items-center rounded-lg", toneChip[n.tone])}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{n.title}</span>
        <span className="block truncate text-xs text-muted">{n.detail}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

// ---- Today ----------------------------------------------------------------------------------

export async function TodayBlock({ today }: { today: ISODate }) {
  const now = new Date();
  const [live, week] = await Promise.all([todaySoFar(now), weekReport(today)]);
  const budget = week.budget;
  // Today: pace against what the forecast expected by now.
  const pace = live.pace;
  // "vs forecast" leaves out one-off orders (a deposit or event payment), like pace does.
  const vsForecast = live.projectedUsual != null && live.forecastDay ? live.projectedUsual / live.forecastDay - 1 : null;
  const scale = Math.max(1, live.forecastDay ?? 0, live.projected ?? 0, live.soFar);
  const paceTone = pace == null ? "neutral" : pace >= 1.02 ? "good" : pace >= 0.9 ? "neutral" : "warn";
  const paceText =
    pace == null ? null : Math.abs(pace - 1) < 0.02 ? "Right on forecast for this time of day" : `${pct(Math.abs(pace - 1), 0)} ${pace > 1 ? "ahead of" : "behind"} the forecast for this time of day`;
  const wd = WEEKDAYS[weekday(today)];
  return (
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
            {live.hasSales && pace == null && live.paceFrom != null && live.forecastDay != null && live.forecastDay > 0 && (
              <p className="mt-3 text-[0.95rem] text-ink-2">Too early to compare: the forecast expects most of {wd}&apos;s sales later. Pace starts around {hourLabel(live.paceFrom)}.</p>
            )}
            {live.oneOff && (
              <p className="mt-2 text-sm text-muted">
                Includes {live.oneOff.orders === 1 ? "one" : live.oneOff.orders} {whole(live.oneOff.amount)} order{live.oneOff.orders === 1 ? "" : "s"} around {hourLabel(live.oneOff.hour)}, left out of the pace. A deposit or event payment? If it isn&apos;t a sale, mark its item <Link href="/sales#square-items" className="underline underline-offset-2 hover:text-ink">Not sales</Link>.
              </p>
            )}

            {live.forecastDay != null && live.forecastDay > 0 && (
              <div className="mt-5">
                {/* sold so far → likely close, with the day's forecast marked */}
                <div className="relative h-2.5 rounded-full bg-surface-2" aria-hidden>
                  {live.projected != null && <div className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--money-sales)_25%,transparent)]" style={{ width: `${(live.projected / scale) * 100}%` }} />}
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--money-sales)]" style={{ width: `${Math.max(live.soFar > 0 ? 1.5 : 0, (live.soFar / scale) * 100)}%` }} />
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
  );
}

// ---- Needs you ------------------------------------------------------------------------------

/** "Needs you". With a focus, `items` is the person's share (their areas plus anything urgent) and `elsewhere` how many wait in other areas. */
export function NeedsBlock({ items, elsewhere }: { items: AttentionItem[]; elsewhere?: number }) {
  return (
    <HelpZone id="overview.needs" tour="overview.needs" className="mb-10">
      <Section title={<span className="inline-flex items-center gap-1.5">Needs you <HelpTip id="overview.needs" /></span>} className="mb-0">
        {items.length === 0 ? (
          <Card className="flex items-center gap-3 p-4 text-sm text-ink-2">
            <span className="grid size-8 place-items-center rounded-lg bg-good-bg text-good"><CircleCheck aria-hidden className="size-4" /></span>
            {elsewhere == null ? "Nothing needs you right now. Orders, invoices, requests and certificates are all clear." : `Nothing in your areas needs you right now.${elsewhere ? ` ${elsewhere} other thing${elsewhere === 1 ? " waits" : "s wait"} under Elsewhere.` : ""}`}
          </Card>
        ) : (
          <Card className="divide-y divide-border">
            {items.slice(0, 6).map((n) => <NeedRow key={n.key} n={n} />)}
          </Card>
        )}
      </Section>
    </HelpZone>
  );
}

// ---- Brewery --------------------------------------------------------------------------------

const STAGE_WORD = { ferment: "Fermenting", condition: "Conditioning" } as const;

/** What's in the tanks, what's due and brewery orders: on the Overview when the brewery is something you look after. */
export async function BreweryBlock() {
  const [fv, needs] = await Promise.all([
    tanksFloor().catch((e) => {
      console.error("overview: brewery floor failed", e);
      return null;
    }),
    overviewNeeds(),
  ]);
  // Due transfers and packaging show on their tanks; brewery orders get a line of their own ("Needs you" lists both too).
  const orders = needs.filter((n) => n.key === "brewery.orders" || n.key.startsWith("brewery.order."));
  const inUse = fv ? fv.tanks.filter((t) => t.now) : [];
  const next = fv?.brewHouse.next ?? null;
  return (
    <HelpZone id="overview.brewery" className="mb-10">
      <Section
        title={<span className="inline-flex items-center gap-1.5">Brewery <HelpTip id="overview.brewery" /></span>}
        description={fv ? `${fv.stats.fermenting} fermenting · ${fv.stats.conditioning} conditioning · ${fv.stats.plannedNext14} brew${fv.stats.plannedNext14 === 1 ? "" : "s"} planned in the next 14 days` : "The tank floor couldn't be read just now."}
        actions={<LinkButton href="/brewery" variant="ghost" size="sm">Tanks →</LinkButton>}
        className="mb-0"
      >
        <Card className="overflow-hidden">
          {fv && fv.tanks.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">No tanks yet. <Link href="/brewery" className="underline underline-offset-2 hover:text-ink">Add them on the Brewery page</Link>.</p>
          ) : inUse.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">Every tank is empty.</p>
          ) : (
            <div className="divide-y divide-border">
              {inUse.slice(0, 8).map((t) => {
                const now = t.now!;
                const b = fv!.batches[now.batchId];
                return (
                  <Link key={t.tank.id} href="/brewery" className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2/60">
                    <span className="num w-14 shrink-0 font-medium text-ink">{t.tank.name}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{b?.name ?? "A brew"}</span>
                      <span className="block truncate text-xs text-muted">{STAGE_WORD[now.stage]} · day {now.day} of {now.of}</span>
                    </span>
                    {now.prompt && <Badge tone={now.prompt.overdueDays >= 3 ? "bad" : "warn"}>{now.prompt.kind === "transfer" ? "Transfer" : "Package"}{now.prompt.overdueDays > 0 ? ` · ${now.prompt.overdueDays}d late` : " today"}</Badge>}
                  </Link>
                );
              })}
              {inUse.length > 8 && <div className="px-4 py-2 text-xs text-muted">and {inUse.length - 8} more on the <Link href="/brewery" className="underline underline-offset-2 hover:text-ink">Brewery page</Link></div>}
            </div>
          )}
          {orders.length > 0 && <div className="divide-y divide-border border-t border-border">{orders.slice(0, 3).map((n) => <NeedRow key={n.key} n={n} />)}</div>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2/40 px-4 py-2.5 text-sm">
            <span className="min-w-0 text-ink-2">{next ? <>Next brew: <b className="font-medium text-ink">{next.name}</b> {dayDate(next.on)}</> : "No brew planned yet"}</span>
            <span className="flex gap-1">
              <LinkButton href="/brewery/schedule" variant="ghost" size="sm" className="h-10 sm:h-8">Schedule</LinkButton>
              <LinkButton href="/brewery/ordering" variant="ghost" size="sm" className="h-10 sm:h-8">Orders</LinkButton>
            </span>
          </div>
        </Card>
      </Section>
    </HelpZone>
  );
}

// ---- Elsewhere -------------------------------------------------------------------------------

/** The areas you don't look after, a line each, from the "Needs you" list already loaded. */
export function ElsewhereBlock({ groups }: { groups: ElsewhereGroup<AttentionItem>[] }) {
  if (!groups.length) return null;
  return (
    <HelpZone id="overview.elsewhere" className="mb-10">
      <Section title={<span className="inline-flex items-center gap-1.5">Elsewhere <HelpTip id="overview.elsewhere" /></span>} description="The areas you don't look after. Tap one to see what's there." actions={<LinkButton href="/settings/notifications#focus" variant="ghost" size="sm">Change →</LinkButton>} className="mb-0">
        <Card className="divide-y divide-border">
          {groups.map((g) =>
            g.items.length ? (
              <details key={g.area} className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
                  <span className="w-20 shrink-0 font-medium text-ink">{g.label}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{g.line}</span>
                  <span className="num shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-2">{g.items.length}</span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
                </summary>
                <div className="divide-y divide-border border-t border-border bg-surface-2/30">
                  {g.items.map((n) => <NeedRow key={n.key} n={n} />)}
                </div>
              </details>
            ) : (
              <Link key={g.area} href={g.href} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                <span className="w-20 shrink-0 font-medium text-ink">{g.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{g.line}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
              </Link>
            ),
          )}
        </Card>
      </Section>
    </HelpZone>
  );
}

// ---- The last 7 days -------------------------------------------------------------------------

export async function WeekBlock({ today }: { today: ISODate }) {
  const [snap, week, prevWeek, recentReviews] = await Promise.all([
    loadCostingSnapshot(),
    weekReport(today),
    periodKpis(addDays(today, -14), addDays(today, -7)),
    db.review.findMany({ where: { postedAt: { gte: zonedMidnightUTC(addDays(today, -60), env.BUSINESS_TIMEZONE) } }, select: { rating: true, postedAt: true } }),
  ]);
  const reviewsEver = recentReviews.length ? 1 : await db.review.count({ take: 1 });
  const rating = ratingTrend(recentReviews.map((r) => ({ rating: r.rating, date: businessDate(r.postedAt, env.BUSINESS_TIMEZONE) })), today, 30);
  const { split, targets, total: t, budget } = week;
  const pnlWeek = `/pnl?period=custom&from=${addDays(today, -7)}&to=${addDays(today, -1)}`;

  // The last 7 finished days, with the same estimate for unlinked items as the P&L.
  const weekDays = week.days.filter((d) => d.date < today);
  const weekB = bridge({ sales: t.sales, cogs: t.cogs, labor: t.labor, unlinkedSales: weekDays.reduce((s, d) => s + d.unlinkedSales, 0), fees: weekDays.reduce((s, d) => s + (d.fees ?? 0), 0) });
  const prevB = bridge({ sales: prevWeek.total.sales, cogs: prevWeek.total.cogs, labor: prevWeek.total.labor, unlinkedSales: prevWeek.days.filter((d) => d.date < today).reduce((s, d) => s + unlinkedSales(d.split, d.sales), 0), fees: prevWeek.days.filter((d) => d.date < today).reduce((s, d) => s + ("fees" in d && typeof d.fees === "number" ? d.fees : 0), 0) });
  const hasPrev = prevWeek.total.sales > 0;

  // ---- What's missing, so the cards never compare against a half-empty week.
  const firstPrice = firstPriceDate(snap);
  const weekFrom = addDays(today, -7);
  const COVERED = 0.8;
  const foodCovered = (l: { sales: number; costedShare: number | null }) => l.sales > 0 && (l.costedShare ?? 0) >= COVERED;
  const foodOk = foodCovered(split.food);
  const prevFoodOk = foodCovered(prevWeek.split.food);
  const laborOk = t.labor > 0 || t.sales <= 0;
  const prevLaborOk = prevWeek.total.labor > 0;
  // A day with no sales isn't a closed day: one Square hasn't synced yet holds every comparison back.
  const [states, prevStates] = await Promise.all([dayStates(weekDays), dayStates(prevWeek.days.filter((d) => d.date < addDays(today, -7)))]);
  const stateOf = (date: ISODate) => (states.get(date) === "closed" ? "closed" : states.get(date) === "notIn" ? "notIn" : "in") as StripDay["state"];
  const notIn = weekDays.filter((d) => stateOf(d.date) === "notIn").length;
  const prevNotIn = [...prevStates.values()].filter((s) => s === "notIn").length;
  /** Why the weeks can't be compared, in a few words (null when they can). */
  const prevGap = !hasPrev ? null : prevNotIn ? "days not in yet" : !prevLaborOk ? "no timecards" : !prevFoodOk ? "no food costs" : null;
  const nowGap = notIn ? `${notIn === 1 ? "a day" : `${notIn} days`} not in yet` : !laborOk ? "no timecards" : !foodOk && split.food.sales > 0 ? "incomplete food costs" : null;
  const pricedFrom = firstPrice && firstPrice > addDays(today, -14) ? firstPrice : null;
  const strip: StripDay[] = weekDays.map((d) => ({ date: d.date, sales: d.sales, forecast: d.forecast, profit: bridge(d).profit, state: stateOf(d.date) }));
  const compareSales = hasPrev && !notIn && !prevNotIn;

  return (
    <HelpZone id="overview.week" tour="overview.stats" className="mb-10">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[0.95rem] font-semibold text-ink">Last 7 days</h2>
          <p className="mt-0.5 text-sm text-muted">{shortDate(addDays(today, -7))} to {shortDate(addDays(today, -1))}, against the 7 days before</p>
        </div>
        <LinkButton href={pnlWeek} variant="ghost" size="sm">P&amp;L →</LinkButton>
      </div>
      <Card className="mb-3 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-3">
            <span className={cx("text-2xl font-semibold tracking-tight", notIn ? "text-muted" : "text-ink")}>{whole(t.sales)}</span>
            <span className="text-sm text-muted">sales{notIn ? " so far" : ""} <HelpTip id="overview.sales" /></span>
          </div>
          {compareSales ? (
            <Delta value={t.sales / prevWeek.total.sales - 1} format={fmt.pct} label={`vs ${whole(prevWeek.total.sales)}`} flatBelow={0.005} />
          ) : notIn ? (
            <span className="text-sm text-muted">{notIn === 1 ? "1 day" : `${notIn} days`} not in from Square yet, so not compared</span>
          ) : null}
        </div>
        <WeekStrip days={strip} />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--money-sales)]" /> Sales</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded-full bg-ink" /> Forecast</span>
          {notIn > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] border border-dashed border-border-strong" /> Not in yet</span>}
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          help="overview.profit"
          label={<span className="inline-flex items-center gap-1.5">Profit <HelpTip id="overview.profit" /></span>}
          value={signedWhole(weekB.profit)}
          tone={notIn ? "unknown" : weekB.profit < 0 ? "bad" : undefined}
          hint={<span className="flex flex-col gap-1">{hasPrev && !prevGap && !nowGap && <Delta value={weekB.profit - prevB.profit} format={fmt.money} label="vs week before" compact />}{(prevGap || nowGap) && <Missing unknown>Not compared: {nowGap ? `this week has ${nowGap}` : `the week before has ${prevGap}`}</Missing>}<span>{notIn ? "So far, " : ""}{pct(weekB.margin, 0)} of sales{weekB.estimated || nowGap ? ", estimated" : ""}</span></span>}
        />
        <Stat
          help="overview.labor"
          label={<span className="inline-flex items-center gap-1.5">Labor <HelpTip id="overview.labor" /></span>}
          tone={!laborOk ? "unknown" : budget?.laborPct != null && costTone(t.laborPct, budget.laborPct) !== "good" ? costTone(t.laborPct, budget.laborPct) : undefined}
          value={laborOk ? pct(t.laborPct) : "—"}
          hint={laborOk ? <span className="flex flex-col gap-1">{hasPrev && prevLaborOk ? <Delta value={pointsChange(t.laborPct, prevWeek.total.laborPct)} format={fmt.pts} label="vs week before" goodWhenUp={false} flatBelow={0.0025} compact /> : hasPrev ? <Missing>Week before had no timecards</Missing> : null}{week.missingRates > 0 && <Missing href="/team">{week.missingRates} shift{week.missingRates === 1 ? "" : "s"} with no pay rate</Missing>}<span className="truncate">{whole(t.labor)} · {money(t.salesPerLaborHour, { whole: true })} sales per labor hour{budget?.laborPct != null ? ` · target ${pct(budget.laborPct, 0)}` : ""}</span></span> : <Missing href="/team">No timecards this week. Connect Square Team or add shifts.</Missing>}
        />
        <Stat
          help="overview.foodCost"
          label={<span className="inline-flex items-center gap-1.5">Food cost <HelpTip id="overview.foodCost" /></span>}
          value={foodOk ? pct(split.food.pct) : "—"}
          tone={!foodOk ? "unknown" : split.food.pct == null || costTone(split.food.pct, targets.food) === "good" ? undefined : costTone(split.food.pct, targets.food)}
          hint={<span className="flex flex-col gap-1">
            {split.food.sales <= 0 ? <Missing href="/sales#sales-items">No food sales linked to recipes</Missing>
              : !foodOk ? <Missing href="/prices">Only {pct(split.food.costedShare ?? 0, 0)} of food sales have prices behind them. Add ingredient prices.</Missing>
              : hasPrev && prevFoodOk && prevWeek.split.food.pct != null && split.food.pct != null ? <Delta value={pointsChange(split.food.pct, prevWeek.split.food.pct)} format={fmt.pts} label="vs week before" goodWhenUp={false} flatBelow={0.0025} compact />
              : hasPrev ? <Missing>Week before had no food costs</Missing> : null}
            {foodOk && pricedFrom && pricedFrom > weekFrom.slice(0, 10) ? <span className="truncate">Days before {shortDate(pricedFrom)} at {shortDate(pricedFrom)} prices</span> : null}
            <span className="truncate">Target {pct(targets.food, 0)}</span>
          </span>}
        />
        <Link href="/reviews" className="block h-full rounded-xl [&>*]:h-full">
          <Stat
            help="overview.rating"
            label={<span className="inline-flex items-center gap-1.5">Rating, 30 days <HelpTip id="overview.rating" /></span>}
            value={rating.avg != null ? `${rating.avg.toFixed(1)}★` : "—"}
            hint={rating.avg == null ? (reviewsEver ? "No reviews in 30 days" : <Missing>Reviews aren&apos;t coming in yet. Connect Google.</Missing>) : `${rating.count} review${rating.count === 1 ? "" : "s"}${rating.delta != null && Math.abs(rating.delta) >= 0.05 ? ` · ${rating.delta > 0 ? "▲" : "▼"} ${Math.abs(rating.delta).toFixed(1)} vs prior` : rating.delta != null ? " · steady" : ""}`}
            tone={rating.delta != null && rating.delta <= -0.3 ? "warn" : undefined}
          />
        </Link>
      </div>
      {weekB.estimated && weekB.coverage != null && (
        <p className="mt-2 text-xs text-muted">Profit counts {pct(1 - weekB.coverage, 0)} of sales not linked to a recipe at a typical 30% cost. <Link href="/sales/link" className="underline underline-offset-2 hover:text-ink">Link items</Link></p>
      )}
    </HelpZone>
  );
}

// ---- Costs to watch --------------------------------------------------------------------------

export async function CostsBlock({ today }: { today: ISODate }) {
  const [snap, { rows }, moves, waste] = await Promise.all([
    loadCostingSnapshot(),
    menuCosts(),
    recentPriceMoves(30),
    db.wasteLog.findMany({ where: { loggedAt: { gte: zonedMidnightUTC(addDays(today, -7), env.BUSINESS_TIMEZONE), lt: zonedMidnightUTC(today, env.BUSINESS_TIMEZONE) } }, select: { id: true, batchId: true, ingredientId: true, qtyBase: true } }),
  ]);
  const ctx = buildContext(snap, today);
  const wasteCost = waste.reduce((s, w) => s + w.qtyBase.toNumber() * (ctx.ingredients.get(w.ingredientId)?.costPerBase ?? 0), 0);
  const wasteLogs = new Set(waste.map((w) => w.batchId ?? w.id)).size;
  const sold = rows.filter((r) => r.kind !== "PREP");
  // "Items over target" is about what guests order, so add-ons (modifiers) don't count.
  const menuItems = sold.filter((r) => r.kind === "MENU");
  const over = menuItems.filter((r) => r.foodCostPct != null && r.foodCostPct > r.target).sort((a, b) => b.foodCostPct! - b.target - (a.foodCostPct! - a.target));
  const ups = moves.filter((m) => m.changePct > 0);
  return (
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
  );
}

// ---- Deliveries ------------------------------------------------------------------------------

export async function DeliveriesBlock({ today }: { today: ISODate }) {
  const suppliers = await db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  // Deliveries grouped by day: a short line per date, not a card per supplier.
  const deliveries = new Map<string, { id: string; name: string }[]>();
  for (const s of suppliers) {
    const w = deliveryWindow(s, today);
    deliveries.set(w.deliveryDate, [...(deliveries.get(w.deliveryDate) ?? []), { id: s.id, name: s.name }]);
  }
  const deliveryDays = [...deliveries].sort(([a], [b]) => a.localeCompare(b)).slice(0, 4);
  if (deliveryDays.length === 0) return null;
  return (
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
  );
}

/** A quiet "this figure is missing something" line, optionally linking to the fix. */
function Missing({ children, href, unknown }: { children: React.ReactNode; href?: string; unknown?: boolean }) {
  const body = <><span aria-hidden className={cx("mt-[0.3rem] size-1.5 shrink-0 rounded-full", unknown ? "border border-dashed border-muted" : "bg-warn")} /><span>{children}</span></>;
  return href ? (
    <Link href={href} className="flex items-start gap-1.5 text-xs text-ink-2 underline-offset-2 hover:text-ink hover:underline">{body}</Link>
  ) : (
    <span className="flex items-start gap-1.5 text-xs text-ink-2">{body}</span>
  );
}
