import { HelpTip, HelpZone } from "@/components/help";
import { ShowMore } from "@/components/show-more";
import { Card, cx, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { progressLabel } from "@/domain/kegOrders";
import { BUCKET_LABEL, splitOutTooLong } from "@/domain/kegFleet";
import { displayCode, sinceLabel } from "@/domain/kegs";
import { tapLevel } from "@/domain/taps";
import { requireUser } from "@/server/auth";
import { kegHome } from "@/server/services/kegFleet";
import { openOrders } from "@/server/services/kegOrders";
import { beerDemand, stockSummary, tapBoard } from "@/server/services/kegs";
import { ArrowRight, ListOrdered, ScanLine, Truck, Warehouse } from "lucide-react";
import Link from "next/link";
import { BeerDot, LeftBar, sizeShort } from "./bits";
import { BUCKET_KEY, FleetArea, Key } from "./fleet/charts";
import { KEG_STATE_FILL } from "./keg-state";
import { FleetBar, NeedsList, type FleetPart, type NeedsItem } from "./home";
import { DueBadge, linesSummary } from "./orders/bits";
import { QueueWatcher } from "./scanner";

export const metadata = { title: "Kegs" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Gose: about 60 pints a week…" under a title that already names the beer reads better as "About 60 pints a week…". */
const sayWithoutName = (sentence: string, name: string) => {
  const rest = sentence.startsWith(`${name}: `) ? sentence.slice(name.length + 2) : sentence;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

/** A source for the manager's summary that must never take the page down. */
const soft = <T,>(what: string, p: Promise<T>): Promise<T | null> =>
  p.catch((e) => {
    console.error(`kegs: ${what} skipped`, (e as Error).message);
    return null;
  });

export default async function KegsPage() {
  const me = await requireUser();
  const manager = me.role === "MANAGER";
  const [{ taps, yield: yi }, stock, home, demand, orders] = await Promise.all([
    tapBoard(),
    stockSummary(),
    manager ? soft("fleet", kegHome()) : null,
    manager ? soft("demand", beerDemand()) : null,
    // Open keg orders, so staff can start scanning one.
    soft("open orders", openOrders()),
  ]);
  const onTap = taps.filter((t) => t.keg);
  // Only core beers are warned about: one in rotation running dry is the plan.
  const dry = onTap.filter((t) => t.keg?.beerId && t.keg.core && t.backups === 0 && (t.estimate?.daysLeft ?? 99) < 7);

  // What needs someone, most urgent first. Staff see the taps about to run dry; managers the rest too.
  const needs: NeedsItem[] = dry.map((t) => ({
    key: `dry-${t.line}`,
    tone: "bad" as const,
    title: `${t.keg!.beer} on tap ${t.line} has nothing full behind it`,
    detail: `${tapLevel({ pctLeft: t.estimate?.pctLeft, daysLeft: t.estimate?.daysLeft, overdue: t.estimate?.overdue }).text}. Fill one, or plan what goes on that line`,
    href: `/kegs/k/${t.keg!.code}`,
  }));
  if (manager) {
    const dryBeers = new Set(dry.map((t) => t.keg!.beerId));
    for (const r of (demand?.rows ?? []).filter((r) => r.standing === "core" && r.plan.toFill > 0 && !dryBeers.has(r.beerId)).slice(0, 3)) {
      needs.push({ key: `fill-${r.beerId}`, tone: r.plan.tone === "bad" ? "bad" : "warn", title: `Fill ${plural(r.plan.toFill, "keg")} of ${r.name}`, detail: sayWithoutName(r.plan.sentence, r.name), href: "/kegs/demand" });
    }
    const { late, lost } = splitOutTooLong(home?.out ?? []);
    const lateKegs = late.reduce((s, g) => s + g.kegs.length, 0);
    const lostKegs = lost.reduce((s, g) => s + g.kegs.length, 0);
    if (home && lateKegs > 0) {
      needs.push({ key: "out", tone: "warn", title: `${plural(lateKegs, "keg")} out at ${plural(late.length, "account")} for more than ${home.overdueDays} days`, detail: `Longest: ${late[0].account}, ${late[0].longest} days`, href: "/kegs/accounts" });
    }
    if (home && lostKegs > 0) {
      needs.push({ key: "lost", tone: "warn", title: `${plural(lostKegs, "keg")} out so long they're probably lost`, detail: `At ${plural(lost.length, "account")}. Ask for them back, or retire them`, href: "/kegs/fleet#lost" });
    }
    if (home && home.idle.length > 0) {
      needs.push({ key: "idle", tone: "warn", title: `${plural(home.idle.length, "keg")} not scanned in ${home.idleDays} days`, detail: "Find and scan them, or retire them", href: "/kegs/fleet#look" });
    }
  }

  const s = home?.byStatus;
  const parts: FleetPart[] = s
    ? [
        { key: "full", label: BUCKET_LABEL.full, count: s.FILLED + s.COLD, href: "/kegs/cooler", fill: KEG_STATE_FILL.full },
        { key: "tap", label: BUCKET_LABEL.tap, count: s.ON_TAP, href: "/kegs/all?status=ON_TAP", fill: KEG_STATE_FILL.tap },
        { key: "out", label: BUCKET_LABEL.out, count: s.OUT, href: "/kegs/accounts", fill: KEG_STATE_FILL.out },
        { key: "dirty", label: BUCKET_LABEL.dirty, count: s.CLEANING + s.KICKED, href: "/kegs/all?status=CLEANING", fill: KEG_STATE_FILL.dirty },
        { key: "clean", label: BUCKET_LABEL.clean, count: s.EMPTY, href: "/kegs/all?status=EMPTY", fill: KEG_STATE_FILL.clean },
      ]
    : [];
  const scan = (
    <LinkButton href="/kegs/scan" variant="primary" className="hidden h-10 sm:inline-flex sm:h-9">
      <ScanLine className="size-4" /> Scan a keg
    </LinkButton>
  );

  return (
    <>
      <PageHeader
        help="kegs.page"
        title="Kegs"
        description={manager ? "Where every keg is, what needs you, and how much is left on each tap." : "Scan a keg when it kicks, goes on, or moves. Tap a line to see the keg."}
        actions={manager ? scan : undefined}
      />

      <div className="mb-4"><QueueWatcher /></div>

      {/* The big button is for a phone in one hand; managers at a desk have it in the header. */}
      <HelpZone id="kegs.scan" tour="kegs.scan-button" className={manager ? "mb-8 sm:hidden" : "mb-8"}>
        <LinkButton href="/kegs/scan" variant="primary" size="lg" className="h-16 w-full rounded-2xl text-lg sm:w-auto sm:px-8">
          <ScanLine className="size-6" /> Scan a keg
        </LinkButton>
      </HelpZone>

      {needs.length > 0 && (
        <Section title={manager ? "Needs you" : `Nothing full behind ${dry.length === 1 ? "this one" : "these"}`}>
          <NeedsList items={needs} />
        </Section>
      )}

      {manager && home && home.inService > 0 && (
        <Section
          help="kegs.home.fleet"
          title={<span className="inline-flex items-center gap-1">The fleet right now <HelpTip id="kegs.home.fleet" /></span>}
          description={`${plural(home.inService, "keg")} in service${home.stats.turns != null && home.stats.fills12 > 0 ? ` · filled ${home.stats.turns.toFixed(1)} times a year each${home.stats.medianCycleDays != null ? ` · ${home.stats.medianCycleDays} days from a fill to back dirty` : ""}` : ""}`}
          actions={<LinkButton href="/kegs/fleet" size="sm" className="h-10 sm:h-8">Analytics <ArrowRight className="size-4" /></LinkButton>}
        >
          <Card className="grid gap-x-8 gap-y-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <div className="flex min-w-0 flex-col justify-center">
              <FleetBar parts={parts} />
            </div>
            {home.weeks.length > 1 && (
              <div className="min-w-0 border-t border-border pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                <div className="mb-1 text-xs font-medium text-muted">The last 12 weeks</div>
                <FleetArea points={home.weeks} compact />
                <div className="mt-2"><Key items={BUCKET_KEY} /></div>
              </div>
            )}
          </Card>
        </Section>
      )}

      {orders && orders.rows.length > 0 && (
        <Section
          help="kegs.orders.scan"
          title="Orders to send out"
          description="Tap an order, then scan each keg as it leaves."
          actions={manager ? <LinkButton href="/kegs/orders" size="sm" className="h-10 sm:h-8"><Truck className="size-4" /> All orders</LinkButton> : undefined}
        >
          <Card>
            <ShowMore limit={6} noun={["order", "orders"]} className="divide-y divide-border" buttonClassName="mx-2 mb-1.5">
            {orders.rows.map((o) => (
              <Link key={o.id} href={`/kegs/orders/${o.id}/scan`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-120 first:rounded-t-xl last:rounded-b-xl hover:bg-surface-2/60 active:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.account}</span>
                  <span className="block truncate text-xs text-muted">{linesSummary(o.lines)}</span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <DueBadge dueOn={o.dueOn} today={orders.today} />
                  <span className="num block text-xs text-muted">{o.progress.complete ? "All sent" : progressLabel(o.progress)}</span>
                </span>
              </Link>
            ))}
            </ShowMore>
          </Card>
        </Section>
      )}

      <Section help="kegs.taps" title={<span className="inline-flex items-center gap-1">On tap <HelpTip id="kegs.taps" /></span>} description={`Estimated from Square pours since each keg went on. You get about ${Math.round(yi.pintsPerHalf)} pints from a 1/2 bbl${yi.measured ? ` (from ${yi.samples} kicked keg${yi.samples === 1 ? "" : "s"})` : " until a few kegs kick and we can measure it"}.`} actions={<LinkButton href="/kegs/taps" size="sm" className="h-10 sm:h-8"><ListOrdered className="size-4" /> Tap list</LinkButton>}>
        {onTap.length === 0 ? (
          <EmptyState title="Nothing on tap yet" action={<LinkButton href="/kegs/scan">Scan a keg onto a line</LinkButton>}>When a keg goes on, scan it and pick the line. Then its gauge shows here.</EmptyState>
        ) : (
          <Card className="divide-y divide-border" data-tour="kegs.taps">
            {taps.filter((t) => t.keg || manager).map((t) => t.keg ? (
              <Link key={`${t.line}-${t.keg.id}`} href={`/kegs/k/${t.keg.code}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-120 hover:bg-surface-2/60 active:bg-surface-2">
                <span className="num grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-sm font-semibold">{t.line || "—"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <BeerDot color={t.keg.color} />
                    <span className="truncate font-medium">{t.keg.beer ?? "Unknown beer"}</span>
                    <span className="hidden text-xs text-muted sm:inline">{sizeShort(t.keg.sizeId)} · {displayCode(t.keg.code)}</span>
                  </div>
                  <div className="mt-1.5"><LeftBar pct={t.estimate?.pctLeft ?? null} color={t.keg.color} /></div>
                  <div className="num mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <TapLevelText estimate={t.estimate} />
                    {t.keg.tappedAt && <span>on {sinceLabel(new Date(t.keg.tappedAt))}</span>}
                    <span className={t.backups === 0 && t.keg.core ? "text-bad" : ""}>{t.backups} full behind it</span>
                  </div>
                </div>
              </Link>
            ) : (
              <div key={`empty-${t.line}`} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted">
                <span className="num grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-border-strong text-sm">{t.line}</span> Free
              </div>
            ))}
          </Card>
        )}
      </Section>

      <Section
        help="kegs.stock"
        title={<span className="inline-flex items-center gap-1">Full kegs per beer <HelpTip id="kegs.stock" /></span>}
        description={`${stock.empties} empty and clean · ${stock.toClean + stock.kicked} waiting to be cleaned`}
        actions={<LinkButton href="/kegs/cooler" size="sm" className="h-10 sm:h-8"><Warehouse className="size-4" /> Walk-in</LinkButton>}
      >
        {stock.beers.length === 0 ? (
          <p className="text-sm text-muted">
            No kegs with beer in them yet.
            {manager && <> Mark the beers you never want to run out of as core on <Link href="/kegs/setup" className="underline hover:text-ink">Setup</Link>, and they always show here.</>}
          </p>
        ) : (
          <div className="space-y-4">
            {[
              { key: "core", title: "Core beers", rows: stock.beers.filter((b) => b.standing === "core") },
              { key: "other", title: "Also in stock", rows: stock.beers.filter((b) => b.standing !== "core") },
            ].filter((g) => g.rows.length).map((g, _i, groups) => (
              <div key={g.key}>
                {groups.length > 1 && <h3 className="mb-1.5 text-xs font-medium text-muted">{g.title} <span className="num font-normal">{g.rows.length}</span></h3>}
                {/* Core beers always show; a long "also in stock" shows the first two rows' worth. */}
                <ShowMore limit={g.key === "core" ? 1000 : 8} noun={["beer", "beers"]} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {g.rows.map((b) => {
                    const short = b.standing === "core" && b.full < b.minFull;
                    return (
                      <Link key={b.beerId} href={manager ? `/kegs/beers/${b.beerId}` : `/kegs/cooler?beer=${b.beerId}`} className={cx("rounded-xl border bg-surface px-3.5 py-3 transition-colors duration-120 hover:bg-surface-2/60", b.standing === "core" && b.noneFull ? "border-bad/40" : "border-border")}>
                        <div className="flex items-center gap-2 text-sm font-medium"><BeerDot color={b.color} /><span className="truncate">{b.name}</span>{b.retired && <span className="ml-auto shrink-0 text-[11px] font-normal text-muted">retired</span>}</div>
                        <div className={cx("num mt-1 text-2xl font-semibold tracking-tight", b.standing === "core" && b.noneFull && "text-bad")}>{b.full}<span className="ml-1 text-xs font-normal text-muted">full</span></div>
                        <div className={cx("text-xs", short ? "text-bad" : "text-muted")}>
                          {b.standing === "core" && b.noneFull && !b.onTap ? "None full, none on tap" : b.onTap ? `${b.onTap} on tap` : "not on tap"}{b.out ? ` · ${b.out} out` : ""}
                        </div>
                      </Link>
                    );
                  })}
                </ShowMore>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

/** How much is left on a tap, as one signal. */
function TapLevelText({ estimate }: { estimate: { pctLeft: number | null; daysLeft: number | null; overdue: boolean } | null | undefined }) {
  const level = tapLevel({ pctLeft: estimate?.pctLeft, daysLeft: estimate?.daysLeft, overdue: estimate?.overdue });
  return <span className={level.tone === "warn" ? "font-medium text-warn" : ""}>{level.text}</span>;
}
