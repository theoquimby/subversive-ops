import { Verdict, type FindingTone } from "@/components/chapter";
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
import { TanksDownNote } from "../tanks-down";
import { CalendarCard } from "./calendar-client";
import { PlanArea, PlannedList } from "./plan-client";

export const metadata = { title: "Brewery schedule" };

const WEEKS = 12;
const monthName = (ym: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));

/**
 * The finding the schedule opens with: a beer already out or late to brew
 * first, then tank clashes, then planned brew days that have passed, then
 * brews due soon. Everything after the first goes in the line under it.
 */
function verdictOf(v: ScheduleView): { tone: FindingTone; title: string; line: string | null; action: { href: string; label: string } | null } {
  const open = v.suggestions.filter((s) => !s.planned);
  const out = open.filter((s) => s.state === "late" && s.alreadyOut);
  const late = open.filter((s) => s.state === "late" && !s.alreadyOut);
  const soon = open.filter((s) => s.state === "soon");
  const passed = v.planned.filter((b) => b.plannedOn && b.plannedOn < v.today);
  const points: { tone: FindingTone; title: string; more: string }[] = [];
  if (out.length) {
    const one = out.length === 1;
    points.push({
      tone: "bad",
      title: one ? `${out[0].name} is already out: it should have been brewed by ${shortDate(out[0].brewBy)}` : `${andList(out.map((s) => s.name))} are already out`,
      more: one ? `${out[0].name} is already out.` : `${andList(out.map((s) => s.name))} are already out.`,
    });
  }
  if (late.length) {
    const one = late.length === 1;
    points.push({
      tone: "bad",
      title: one ? `${late[0].name} is late: it should have been brewed by ${shortDate(late[0].brewBy)}` : `${andList(late.map((s) => s.name))} are late to brew`,
      more: one ? `${late[0].name} is late too: it should have been brewed by ${shortDate(late[0].brewBy)} and runs out about ${shortDate(late[0].runOutOn)}.` : `${andList(late.map((s) => s.name))} are late to brew too.`,
    });
  }
  if (v.clashes.length) {
    const t = `${v.clashes.length} tank clash${v.clashes.length === 1 ? "" : "es"} on the schedule`;
    points.push({ tone: "bad", title: t, more: `${t}, outlined in red below.` });
  }
  if (passed.length) {
    const one = passed.length === 1;
    points.push({
      tone: "warn",
      title: one ? `${passed[0].code} ${passed[0].name} was planned for ${shortDate(passed[0].plannedOn!)} and hasn't been brewed` : `${passed.length} planned brew days have passed`,
      more: one ? `${passed[0].code} ${passed[0].name}'s brew day (${shortDate(passed[0].plannedOn!)}) has passed: brew it or move it.` : `${passed.length} planned brew days have passed: brew or move them.`,
    });
  }
  if (soon.length) {
    const first = soon[0];
    points.push({
      tone: "warn",
      title: `Brew ${first.name} by ${shortDate(first.brewBy)}`,
      more: soon.length === 1 ? `${first.name} is due: brew it by ${shortDate(first.brewBy)}.` : `${andList(soon.map((s) => s.name))} are due in the next two weeks.`,
    });
  }
  if (!points.length) {
    const next = v.planned.find((b) => b.plannedOn && b.plannedOn >= v.today);
    return { tone: "good", title: next ? `Nothing is late: the next brew day is ${shortDate(next.plannedOn!)}` : "Nothing is late to brew", line: next ? `${next.code} ${next.name}.` : "Suggested brews show here as keg sales come in.", action: null };
  }
  const [head, ...rest] = points;
  const suggest = out.length || late.length || soon.length;
  return {
    tone: head.tone,
    title: head.title,
    line: rest.map((p) => p.more).join(" ") || null,
    action: suggest ? { href: "#suggested-brews", label: "Plan it from Suggested brews" } : passed.length ? { href: "#planned", label: "See planned brews" } : null,
  };
}

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
  const verdict = verdictOf(v);
  const fermenters = v.rows.filter((r) => r.tank.kind === "FERMENTER");
  const freeNow = fermenters.filter((r) => !r.bars.some((b) => b.start <= v.today && b.end > v.today)).length;
  const lateCount = v.suggestions.filter((s) => !s.planned && s.state === "late").length;
  const nextBrew = v.planned.find((b) => b.plannedOn && b.plannedOn >= v.today);
  const withBrews = v.months.filter((m) => m.brews.length > 0);
  const emptyMonths = v.months.length - withBrews.length;
  return (
    <>
      {header}
      <TanksDownNote />
      <Verdict
        badge={{ tone: verdict.tone }}
        title={verdict.title}
        line={verdict.line}
        stats={[
          { label: "Beers out or late to brew", value: lateCount, tone: lateCount ? "bad" : "neutral" },
          { label: "Next planned brew day", value: nextBrew?.plannedOn ? shortDate(nextBrew.plannedOn) : "None planned", hint: nextBrew ? `${nextBrew.code} ${nextBrew.name}` : undefined },
          { label: "Fermenters free today", value: `${freeNow} of ${fermenters.length}` },
        ]}
      >
        {verdict.action && <LinkButton href={verdict.action.href} variant="primary">{verdict.action.label}</LinkButton>}
      </Verdict>
      <PlanArea today={v.today} recipes={v.recipes} beers={v.beers} tanks={v.tanks} suggestions={v.suggestions} />

      <Section
        title={`Next ${WEEKS} weeks`}
        description={v.clashes.length ? undefined : `Solid bars are in the tank now or done; light dashed bars are planned. Transfers land on ${weekdaysText(v.snap.transferDays)}, packaging on ${weekdaysText(v.snap.packageDays)}.`}
        actions={v.clashes.length ? <Badge tone="bad">{v.clashes.length} clash{v.clashes.length === 1 ? "" : "es"}: outlined in red</Badge> : undefined}
      >
        <Timeline v={v} />
        <TankList v={v} />
      </Section>

      <div id="planned" className="scroll-mt-24">
        <Section title="Planned brews" description="Move one to a new day and its tanks and dates are worked out again. A locked release stays put.">
          <PlannedList planned={v.planned} stays={v.plannedStays} today={v.today} tanks={v.tanks} />
        </Section>
      </div>

      <Section
        title="Brews by month"
        description={`Every brew this year and what's planned after, by brew day, with its timing, release and orders.${withBrews.length && emptyMonths ? ` ${emptyMonths} month${emptyMonths === 1 ? "" : "s"} with no brew ${emptyMonths === 1 ? "is" : "are"} left out.` : ""}`}
      >
        {withBrews.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {withBrews.map((m) => <MonthCard key={m.month} month={m.month} brews={m.brews} current={v.today.startsWith(m.month)} orders={v.orders} today={v.today} />)}
          </div>
        ) : (
          <Card className="px-4 py-3.5 text-sm text-muted">No brews this year yet. Brews show here by month once they&apos;re planned or brewed.</Card>
        )}
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

function MonthCard({ month, brews, current, orders, today }: { month: string; brews: BatchView[]; current: boolean; orders: Orders; today: string }) {
  return (
    <Card className={cx("p-4", current && "ring-1 ring-area/40")}>
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
