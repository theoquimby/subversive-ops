import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section, type Tone } from "@/components/ui";
import { profileLabel, weekdaysText } from "@/domain/brewProfiles";
import { addDays, daysBetween } from "@/domain/dates";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { scheduleView, type BatchView, type ScheduleView } from "@/server/services/brewery";
import { calendarToken } from "@/server/services/breweryWrite";
import { publicOrigin } from "@/server/services/public-url";
import { Lock } from "lucide-react";
import Link from "next/link";
import { BeerDot, beerFill, KIND_LABEL, STATUS } from "../bits";
import { CalendarCard } from "./calendar-client";
import { PlanArea, PlannedList } from "./plan-client";

export const metadata = { title: "Brewery schedule" };

const WEEKS = 12;
const monthName = (ym: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));

export default async function Page() {
  await requireUser("MANAGER");
  const [v, token, origin] = await Promise.all([scheduleView(WEEKS), calendarToken(), publicOrigin()]);
  const header = <PageHeader help="brewery.schedule" title="Tank schedule" description="Plan brews onto the tanks with their dry-hop, transfer, packaging and release days, see what's suggested from keg sales, and every tank over the next 12 weeks." />;
  if (!v.tanks.length) {
    return (
      <>
        {header}
        <EmptyState title="No tanks yet" action={<LinkButton href="/brewery/setup" variant="primary">Add your tanks</LinkButton>}>Add your fermenters and brite tanks first; the schedule plans brews onto them.</EmptyState>
      </>
    );
  }
  const feed = `${origin}/api/brewery/calendar/${token}.ics`;
  const webcal = feed.replace(/^https?:\/\//, "webcal://");
  return (
    <>
      {header}
      <PlanArea today={v.today} recipes={v.recipes} beers={v.beers} tanks={v.tanks} suggestions={v.suggestions} />

      <Section
        title={`Next ${WEEKS} weeks`}
        description={v.clashes.length ? undefined : `Solid bars are in the tank now or done; light dashed bars are planned. Transfers land on ${weekdaysText(v.snap.transferDays)}, packaging on ${weekdaysText(v.snap.packageDays)}.`}
        actions={v.clashes.length ? <Badge tone="bad">{v.clashes.length} clash{v.clashes.length === 1 ? "" : "es"}: outlined in red</Badge> : undefined}
      >
        <Timeline v={v} />
        <TankList v={v} />
      </Section>

      <Section title="Planned brews" description="Move one to a new day and its tanks and dates are worked out again. A locked release stays put.">
        <PlannedList planned={v.planned} stays={v.plannedStays} today={v.today} tanks={v.tanks} />
      </Section>

      <Section title="Brews by month" description="Every brew this year and what's planned after, by brew day, with its timing, release and orders.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {v.months.map((m) => <MonthCard key={m.month} month={m.month} brews={m.brews} current={v.today.startsWith(m.month)} past={`${m.month}-31` < v.today} orders={v.orders} today={v.today} />)}
        </div>
      </Section>

      <Section title="Calendar" description="Brew days, dry hops, transfers, packaging and release days in your own calendar, from last month to six months on. It updates itself.">
        <CalendarCard url={feed} googleUrl={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} />
      </Section>
    </>
  );
}

/** Live brews whose release day falls in the window, soonest first. */
const releasesIn = (v: ScheduleView) =>
  Object.values(v.batches)
    .filter((b) => b.tapOn && b.tapOn >= v.from && b.tapOn < v.to && b.status !== "DUMPED")
    .sort((a, b) => a.tapOn!.localeCompare(b.tapOn!));

/** Desktop and tablet: tanks as rows, days as columns, a bar for each stay, dry hops marked; releases on their own row. Scrolls inside itself when narrow. */
function Timeline({ v }: { v: ScheduleView }) {
  const span = WEEKS * 7;
  const at = (d: string) => (Math.max(0, Math.min(span, daysBetween(v.from, d))) / span) * 100;
  const mid = (d: string) => at(d) + 100 / span / 2;
  const todayAt = mid(v.today);
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(v.from, i * 7));
  const grid = { backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px)", backgroundSize: `${100 / WEEKS}% 100%` };
  const releases = releasesIn(v);
  return (
    <Card className="hidden overflow-x-auto overscroll-x-contain md:block">
      <div className="min-w-[52rem]">
        <div className="grid grid-cols-[8rem_1fr] border-b border-border">
          <div className="px-3 py-2 text-[0.75rem] font-medium text-muted">Tank</div>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
            {weeks.map((w, i) => (
              <div key={w} className={cx("num border-l border-border px-1.5 py-2 text-[0.72rem] whitespace-nowrap", i === 0 || w.slice(5, 7) !== weeks[i - 1].slice(5, 7) ? "font-medium text-ink-2" : "text-muted")}>{shortDate(w)}</div>
            ))}
          </div>
        </div>
        {v.rows.map((r) => (
          <div key={r.tank.id} className="grid grid-cols-[8rem_1fr] border-b border-border">
            <div className="min-w-0 px-3 py-2.5">
              <div className="truncate text-sm font-medium">{r.tank.name}</div>
              <div className="num truncate text-[0.72rem] text-muted">{KIND_LABEL[r.tank.kind]} · {r.tank.capacityBbl} bbl</div>
            </div>
            <div className="relative h-14" style={grid}>
              <div aria-hidden className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-area" style={{ left: `${todayAt}%` }} />
              {r.bars.map((b) => {
                const batch = v.batches[b.batchId] as BatchView | undefined;
                const fill = beerFill(batch?.color ?? null);
                const left = at(b.start), right = at(b.end);
                const dryHop = batch?.dryHopOn && b.stage === "ferment" && batch.dryHopOn >= b.start && batch.dryHopOn < b.end ? batch.dryHopOn : null;
                const title = `${batch?.code ?? ""} ${batch?.name ?? ""} · ${r.tank.name} · ${shortDate(b.start)} to ${shortDate(b.end)}${b.planned ? " · planned" : ""}${dryHop ? ` · dry hop ${shortDate(dryHop)}` : ""}${b.clash ? " · clashes with another brew" : ""}${b.tooSmall ? ` · bigger than ${r.tank.name}` : ""}`;
                return (
                  <Link
                    key={b.stayId}
                    href={`/brewery/batches/${b.batchId}`}
                    title={title}
                    aria-label={title}
                    className={cx(
                      "absolute top-2 bottom-2 flex items-center overflow-hidden rounded-md px-1.5 text-[0.72rem] font-medium whitespace-nowrap transition-[filter] duration-120 hover:brightness-95",
                      b.planned && "border border-dashed border-ink/40 opacity-55",
                      (b.clash || b.tooSmall) && "z-20 ring-2 ring-bad ring-offset-1 ring-offset-surface",
                    )}
                    style={{ left: `${left}%`, width: `max(${right - left}%, 0.5rem)`, background: fill.bg, color: fill.fg }}
                  >
                    <span className="truncate">{batch?.code} {batch?.name}</span>
                    {dryHop && <span aria-hidden className="absolute top-0 bottom-0 w-0.5 bg-current opacity-70" style={{ left: `${((daysBetween(b.start, dryHop) + 0.5) / Math.max(1, daysBetween(b.start, b.end))) * 100}%` }} />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[8rem_1fr]">
          <div className="min-w-0 px-3 py-2.5">
            <div className="text-sm font-medium">Releases</div>
            <div className="text-[0.72rem] text-muted">On tap</div>
          </div>
          <div className="relative h-14" style={grid}>
            <div aria-hidden className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-area" style={{ left: `${todayAt}%` }} />
            {releases.map((b, i) => {
              const title = `${b.code} ${b.name} · release ${shortDate(b.tapOn!)}${b.tapLocked ? ` · locked${b.lockedReason ? `: ${b.lockedReason}` : ""}` : ""}`;
              return (
                <Link key={b.id} href={`/brewery/batches/${b.id}`} title={title} aria-label={title} className={cx("absolute flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border bg-surface px-1.5 text-[0.68rem] font-medium whitespace-nowrap shadow-sm", b.tapLocked ? "border-warn/50 text-warn" : "border-border-strong text-ink-2", i % 2 ? "top-7" : "top-1")} style={{ left: `${mid(b.tapOn!)}%` }}>
                  {b.tapLocked ? <Lock className="size-3" aria-hidden /> : <BeerDot color={b.color} className="size-2" />}
                  <span className="max-w-24 truncate">{b.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <p className="border-t border-border px-3 py-2 text-xs text-muted">A thin line inside a bar is its dry-hop day.</p>
    </Card>
  );
}

/** Phone: each tank's stays from today on, as a short list, then the releases. */
function TankList({ v }: { v: ScheduleView }) {
  const releases = releasesIn(v).filter((b) => b.tapOn! >= v.today);
  return (
    <div className="space-y-3 md:hidden">
      {v.rows.map((r) => {
        const bars = r.bars.filter((b) => b.end > v.today);
        return (
          <Card key={r.tank.id} className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-semibold">{r.tank.name}</div>
              <div className="num text-xs text-muted">{KIND_LABEL[r.tank.kind]} · {r.tank.capacityBbl} bbl</div>
            </div>
            {bars.length ? (
              <ul className="mt-2 divide-y divide-border">
                {bars.map((b) => {
                  const batch = v.batches[b.batchId];
                  const dryHop = batch?.dryHopOn && b.stage === "ferment" && batch.dryHopOn >= b.start && batch.dryHopOn < b.end && batch.dryHopOn >= v.today ? batch.dryHopOn : null;
                  return (
                    <li key={b.stayId}>
                      <Link href={`/brewery/batches/${b.batchId}`} className="flex min-h-12 items-center gap-2.5 py-2">
                        <BeerDot color={batch?.color ?? null} className={cx(b.planned && "opacity-50")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{batch?.name}</span>
                          <span className="num block truncate text-xs text-muted">{batch?.code} · {b.current ? "in now" : shortDate(b.start)} to {shortDate(b.end)}{b.planned ? " · planned" : ""}{dryHop ? ` · dry hop ${shortDate(dryHop)}` : ""}</span>
                        </span>
                        {b.clash && <Badge tone="bad">Clash</Badge>}
                        {b.tooSmall && <Badge tone="bad">Too big</Badge>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-muted">Free for the next {WEEKS} weeks.</p>
            )}
          </Card>
        );
      })}
      {releases.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-semibold">Releases</div>
          <ul className="mt-2 divide-y divide-border">
            {releases.map((b) => (
              <li key={b.id}>
                <Link href={`/brewery/batches/${b.id}`} className="flex min-h-12 items-center gap-2.5 py-2">
                  <span className="num w-14 shrink-0 text-xs text-muted">{shortDate(b.tapOn!)}</span>
                  <BeerDot color={b.color} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                  {b.tapLocked && <Badge tone="warn"><Lock className="mr-1 size-3" aria-hidden />Locked</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Orders = ScheduleView["orders"];

/** "Orders: 2 of 3 placed", amber when one should have been placed by now. */
function OrdersChip({ list, today }: { list: Orders[string] | undefined; today: string }) {
  if (!list?.length) return null;
  const placed = list.filter((o) => o.placedOn).length;
  const late = list.some((o) => !o.placedOn && o.orderBy <= today);
  const tone: Tone = placed === list.length ? "good" : late ? "warn" : "neutral";
  const title = list.map((o) => `${o.supplier}: ${o.placedOn ? `placed ${shortDate(o.placedOn)}` : `order by ${shortDate(o.orderBy)}`}`).join(" · ");
  return <span title={title}><Badge tone={tone}>Orders: {placed} of {list.length} placed</Badge></span>;
}

function MonthCard({ month, brews, current, past, orders, today }: { month: string; brews: BatchView[]; current: boolean; past: boolean; orders: Orders; today: string }) {
  return (
    <Card className={cx("p-4", current && "ring-1 ring-area/40", past && !brews.length && "opacity-70")}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">{monthName(month)}</div>
        <div className="num text-xs text-muted">{brews.length ? `${brews.length} brew${brews.length === 1 ? "" : "s"}` : "None"}</div>
      </div>
      {brews.length > 0 && (
        <ul className="mt-2 space-y-1">
          {brews.map((b) => {
            const day = b.brewedOn ?? b.plannedOn!;
            const status = b.status === "PACKAGED" && b.packagedOn ? `kegged ${shortDate(b.packagedOn)}` : STATUS[b.status].label.toLowerCase();
            return (
              <li key={b.id}>
                <Link href={`/brewery/batches/${b.id}`} className="flex min-h-10 items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-2/60">
                  <span className="num w-12 shrink-0 pt-0.5 text-xs text-muted">{shortDate(day)}</span>
                  <BeerDot color={b.color} className={cx("mt-1.5 size-2.5", b.status === "PLANNED" && "opacity-50")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{b.name}</span>
                      {b.tapLocked && <Lock className="size-3 shrink-0 text-warn" aria-label="Release locked" />}
                    </span>
                    <span className="num block truncate text-xs text-muted">
                      {profileLabel(b.profile)}{b.tapOn ? ` · release ${shortDate(b.tapOn)}` : ""}{b.tapLocked && b.lockedReason ? ` · ${b.lockedReason}` : ""}
                    </span>
                    {b.status === "PLANNED" && <span className="mt-1 block"><OrdersChip list={orders[b.id]} today={today} /></span>}
                  </span>
                  <span className={cx("shrink-0 pt-0.5 text-xs", b.status === "PLANNED" ? "text-muted" : "text-ink-2")}>{status}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
