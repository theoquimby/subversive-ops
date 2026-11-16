import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { addDays, daysBetween } from "@/domain/dates";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { scheduleView, type BatchView, type ScheduleView } from "@/server/services/brewery";
import Link from "next/link";
import { BeerDot, beerFill, KIND_LABEL, STATUS } from "../bits";
import { PlanArea, PlannedList } from "./plan-client";

export const metadata = { title: "Brewery schedule" };

const WEEKS = 12;
const monthName = (ym: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));

export default async function Page() {
  await requireUser("MANAGER");
  const v = await scheduleView(WEEKS);
  const header = <PageHeader help="brewery.schedule" title="Tank schedule" description="Plan brews onto the tanks, see what's suggested from keg sales, and every tank over the next 12 weeks." />;
  if (!v.tanks.length) {
    return (
      <>
        {header}
        <EmptyState title="No tanks yet" action={<LinkButton href="/brewery/setup" variant="primary">Add your tanks</LinkButton>}>Add your fermenters and brite tanks first; the schedule plans brews onto them.</EmptyState>
      </>
    );
  }
  return (
    <>
      {header}
      <PlanArea today={v.today} recipes={v.recipes} beers={v.beers} tanks={v.tanks} suggestions={v.suggestions} />

      <Section
        title={`Next ${WEEKS} weeks`}
        description={v.clashes.length ? undefined : "Solid bars are in the tank now or done; light dashed bars are planned."}
        actions={v.clashes.length ? <Badge tone="bad">{v.clashes.length} clash{v.clashes.length === 1 ? "" : "es"}: outlined in red</Badge> : undefined}
      >
        <Timeline v={v} />
        <TankList v={v} />
      </Section>

      <Section title="Planned brews" description="Move one to a new day and its tanks are worked out again.">
        <PlannedList planned={v.planned} stays={v.plannedStays} today={v.today} tanks={v.tanks} />
      </Section>

      <Section title="Brews by month" description={`Every brew this year and what's planned after, by brew day.`}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {v.months.map((m) => <MonthCard key={m.month} month={m.month} brews={m.brews} current={v.today.startsWith(m.month)} past={`${m.month}-31` < v.today} />)}
        </div>
      </Section>
    </>
  );
}

/** Desktop and tablet: tanks as rows, days as columns, a bar for each stay. Scrolls inside itself when narrow. */
function Timeline({ v }: { v: ScheduleView }) {
  const span = WEEKS * 7;
  const at = (d: string) => (Math.max(0, Math.min(span, daysBetween(v.from, d))) / span) * 100;
  const todayAt = at(v.today) + 100 / span / 2;
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(v.from, i * 7));
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
          <div key={r.tank.id} className="grid grid-cols-[8rem_1fr] border-b border-border last:border-b-0">
            <div className="min-w-0 px-3 py-2.5">
              <div className="truncate text-sm font-medium">{r.tank.name}</div>
              <div className="num truncate text-[0.72rem] text-muted">{KIND_LABEL[r.tank.kind]} · {r.tank.capacityBbl} bbl</div>
            </div>
            <div className="relative h-14" style={{ backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px)", backgroundSize: `${100 / WEEKS}% 100%` }}>
              <div aria-hidden className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-area" style={{ left: `${todayAt}%` }} />
              {r.bars.map((b) => {
                const batch = v.batches[b.batchId] as BatchView | undefined;
                const fill = beerFill(batch?.color ?? null);
                const left = at(b.start), right = at(b.end);
                const title = `${batch?.code ?? ""} ${batch?.name ?? ""} · ${r.tank.name} · ${shortDate(b.start)} to ${shortDate(b.end)}${b.planned ? " · planned" : ""}${b.clash ? " · clashes with another brew" : ""}${b.tooSmall ? ` · bigger than ${r.tank.name}` : ""}`;
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
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Phone: each tank's stays from today on, as a short list. */
function TankList({ v }: { v: ScheduleView }) {
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
                  return (
                    <li key={b.stayId}>
                      <Link href={`/brewery/batches/${b.batchId}`} className="flex min-h-12 items-center gap-2.5 py-2">
                        <BeerDot color={batch?.color ?? null} className={cx(b.planned && "opacity-50")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{batch?.name}</span>
                          <span className="num block truncate text-xs text-muted">{batch?.code} · {b.current ? "in now" : shortDate(b.start)} to {shortDate(b.end)}{b.planned ? " · planned" : ""}</span>
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
    </div>
  );
}

function MonthCard({ month, brews, current, past }: { month: string; brews: BatchView[]; current: boolean; past: boolean }) {
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
            return (
              <li key={b.id}>
                <Link href={`/brewery/batches/${b.id}`} className="flex min-h-10 items-center gap-2 rounded-md px-1 text-sm hover:bg-surface-2/60">
                  <span className="num w-12 shrink-0 text-xs text-muted">{shortDate(day)}</span>
                  <BeerDot color={b.color} className={cx("size-2.5", b.status === "PLANNED" && "opacity-50")} />
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  <span className={cx("shrink-0 text-xs", b.status === "PLANNED" ? "text-muted" : "text-ink-2")}>{b.status === "PACKAGED" && b.packagedOn ? `kegged ${shortDate(b.packagedOn)}` : STATUS[b.status].label.toLowerCase()}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
