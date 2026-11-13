import { HelpTip, HelpZone } from "@/components/help";
import { Card, EmptyState, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { displayCode, sinceLabel } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { stockSummary, tapBoard } from "@/server/services/kegs";
import { ChartColumn, FileUp, History, ListChecks, Printer, ScanLine, Settings2, Warehouse } from "lucide-react";
import Link from "next/link";
import { BeerDot, daysText, LeftBar, pctText, sizeShort } from "./bits";
import { QueueWatcher } from "./scanner";

export const metadata = { title: "Kegs" };

export default async function KegsPage() {
  const me = await requireUser();
  const manager = me.role === "MANAGER";
  const [{ taps, yield: yi }, stock] = await Promise.all([tapBoard(), stockSummary()]);
  const onTap = taps.filter((t) => t.keg);
  const dry = onTap.filter((t) => t.keg?.beerId && t.backups === 0 && (t.estimate?.daysLeft ?? 99) < 7);

  return (
    <>
      <PageHeader
        help="kegs.page"
        title="Kegs"
        description={manager ? "What's on tap, how much is left, and what's in the walk-in. Staff scan kegs when they kick." : "Scan a keg when it kicks, goes on, or moves. Tap a line to see the keg."}
      />

      <div className="mb-4"><QueueWatcher /></div>

      <HelpZone id="kegs.scan" tour="kegs.scan-button" className="mb-8">
        <LinkButton href="/kegs/scan" variant="primary" size="lg" className="h-16 w-full rounded-2xl text-lg sm:w-auto sm:px-8">
          <ScanLine className="size-6" /> Scan a keg
        </LinkButton>
      </HelpZone>

      {dry.length > 0 && (
        <Card className="mb-8 border-bad/25 bg-bad-bg p-4">
          <div className="text-sm font-semibold text-bad">Nothing full behind {dry.length === 1 ? "this one" : "these"}</div>
          <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
            {dry.map((t) => <li key={t.line}>{t.keg!.beer} on tap {t.line} · {daysText(t.estimate?.daysLeft) ?? pctText(t.estimate?.pctLeft)} · 0 full in cold storage</li>)}
          </ul>
        </Card>
      )}

      <Section help="kegs.taps" title={<span className="inline-flex items-center gap-1">On tap <HelpTip id="kegs.taps" /></span>} description={`Estimated from Square pours since each keg went on. You get about ${Math.round(yi.pintsPerHalf)} pints from a 1/2 bbl${yi.measured ? ` (from ${yi.samples} kicked keg${yi.samples === 1 ? "" : "s"})` : " until a few kegs kick and we can measure it"}.`}>
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
                    <span className={t.estimate?.overdue ? "font-medium text-warn" : ""}>{t.estimate?.overdue ? "Should have kicked — check it" : pctText(t.estimate?.pctLeft)}</span>
                    {daysText(t.estimate?.daysLeft) && <span>{daysText(t.estimate?.daysLeft)}</span>}
                    {t.keg.tappedAt && <span>on {sinceLabel(new Date(t.keg.tappedAt))}</span>}
                    <span className={t.backups === 0 ? "text-bad" : ""}>{t.backups} full behind it</span>
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

      <Section help="kegs.stock" title="Full kegs per beer" description={`${stock.empties} empty and clean · ${stock.toClean + stock.kicked} waiting to be cleaned`} actions={<LinkButton href="/kegs/cooler" size="sm" className="h-10 sm:h-8"><Warehouse className="size-4" /> Walk-in</LinkButton>}>
        {stock.beers.length === 0 ? (
          <p className="text-sm text-muted">No kegs with beer in them yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {stock.beers.map((b) => (
              <Link key={b.beerId} href={`/kegs/cooler?beer=${b.beerId}`} className="rounded-xl border border-border bg-surface px-3.5 py-3 transition-colors duration-120 hover:bg-surface-2/60">
                <div className="flex items-center gap-2 text-sm font-medium"><BeerDot color={b.color} /><span className="truncate">{b.name}</span></div>
                <div className="num mt-1 text-2xl font-semibold tracking-tight">{b.full}<span className="ml-1 text-xs font-normal text-muted">full</span></div>
                <div className={`text-xs ${b.full < b.minFull ? "text-bad" : "text-muted"}`}>{b.onTap ? `${b.onTap} on tap` : "not on tap"}{b.out ? ` · ${b.out} out` : ""}</div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {manager && (
        <Section title="Manage">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Kegs" value={stock.total} hint={`${onTap.length} on tap`} />
            <Stat label="Pints per 1/2 bbl" value={`~${Math.round(yi.pintsPerHalf)}`} hint={yi.measured ? `Measured from ${yi.samples} kicks` : "Assumed 90% until kegs kick"} help="kegs.yield" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { href: "/kegs/cooler", label: "Walk-in board", icon: Warehouse, hint: "Where every keg is" },
              { href: "/kegs/demand", label: "Demand per beer", icon: ChartColumn, hint: "What to fill next" },
              { href: "/kegs/all", label: "All kegs & labels", icon: Printer, hint: "Add kegs, print stickers" },
              { href: "/kegs/setup", label: "Setup", icon: Settings2, hint: "Beers, spots, taps, accounts" },
              { href: "/kegs/history", label: "History", icon: History, hint: "Every scan, who and when" },
              { href: "/kegs/import", label: "Import", icon: FileUp, hint: "From your old keg app" },
            ].map(({ href, label, icon: Icon, hint }) => (
              <Link key={href} href={href} className="flex min-h-[4.5rem] items-start gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors duration-120 hover:bg-surface-2/60">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-area/10 text-area"><Icon className="size-4" /></span>
                <span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
              </Link>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><ListChecks className="size-3.5" /> Staff see Scan, On tap, the walk-in and full kegs per beer.</p>
        </Section>
      )}
    </>
  );
}
