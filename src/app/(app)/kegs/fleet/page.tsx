import { HelpTip } from "@/components/help";
import { Card, cx, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { displayCode, STATUS_META } from "@/domain/kegs";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { fleetReport, type FleetRange } from "@/server/services/kegFleet";
import Link from "next/link";
import { sizeShort, StatusBadge } from "../bits";
import { BUCKET_KEY, FillBars, FleetArea, Key, WENT_KEY, WentBars } from "./charts";
import { BeerPicker, ExportGrid, RetireKeg } from "./fleet-client";

export const metadata = { title: "Fleet & trends" };

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const kegsWord = (n: number) => `${n} keg${n === 1 ? "" : "s"}`;

export default async function FleetPage({ searchParams }: { searchParams: Promise<{ range?: string; beer?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const range: FleetRange = sp.range === "all" ? "all" : "12m";
  const r = await fleetReport(range, sp.beer ?? null);
  const beer = r.beers.find((b) => b.id === sp.beer) ?? null;
  const chip = (value: FleetRange, label: string) => (
    <Link href={`/kegs/fleet?range=${value}${beer ? `&beer=${beer.id}` : ""}`} scroll={false} className={cx("inline-flex h-10 items-center rounded-full border px-3 text-sm sm:h-8", range === value ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>{label}</Link>
  );

  if (!r.first) {
    return (
      <>
        <PageHeader help="kegs.fleet" title="Fleet & trends" back={{ href: "/kegs", label: "Kegs" }} description="How the keg fleet is used over time, and which kegs need a look." />
        <EmptyState title="No keg history yet" action={<LinkButton href="/kegs/import" variant="primary">Import from your old keg app</LinkButton>}>Trends appear once kegs have been scanned for a while, or as soon as you bring in the history from your old keg app.</EmptyState>
      </>
    );
  }

  const fills = r.months.reduce((s, m) => s + m.kegs, 0);
  const noScan = r.months.reduce((s, m) => s + m.none, 0);
  const retired = r.grid.rows.find((g) => g.status === "RETIRED")?.total ?? 0;
  const outKegs = r.out.reduce((s, g) => s + g.kegs.length, 0);
  const gridLabel = (s: (typeof r.grid.rows)[number]["status"]) => (s === "RETIRED" ? "Retired" : STATUS_META[s].label);
  const gridRows = r.grid.rows.filter((g) => g.total > 0 || g.status !== "RETIRED");
  const rangeWords = `since ${shortDate(r.from)}, ${r.from.slice(0, 4)}`;

  return (
    <>
      <PageHeader
        help="kegs.fleet"
        title="Fleet & trends"
        back={{ href: "/kegs", label: "Kegs" }}
        description="How the keg fleet is used over time, worked out from every scan: where the kegs were, how many were filled, where the beer went, and which kegs need a look."
        actions={<div className="flex gap-1.5">{chip("12m", "12 months")}{chip("all", "All time")}</div>}
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Kegs in service" value={r.stats.inService} hint={retired ? `${retired} retired` : "None retired"} />
        <Stat label="Turns a keg, a year" value={r.stats.turns == null ? "—" : r.stats.turns.toFixed(1)} hint={`${r.stats.fills12} fills in the last 12 months`} help="kegs.fleet.turns" />
        <Stat label="Days per cycle" value={r.stats.medianCycleDays ?? "—"} hint={r.stats.cyclesMeasured ? `Fill to back dirty, the middle of ${r.stats.cyclesMeasured} fills` : "Shows once filled kegs come back"} />
        <Stat label="Need a look" value={outKegs + r.idle.length} tone={outKegs + r.idle.length ? "warn" : "good"} hint={outKegs + r.idle.length ? `${outKegs} out too long · ${r.idle.length} not seen lately` : "Nothing out too long or gone quiet"} />
      </div>

      <Section title="Where the fleet was" description="Kegs in each state at the end of every week. A fleet that's mostly dirty or clean has kegs to spare; one that's always full or out is stretched.">
        <Card className="p-4">
          <FleetArea points={r.weeks} />
          <div className="mt-2"><Key items={BUCKET_KEY} /></div>
        </Card>
      </Section>

      <Section
        title="Kegs filled per month"
        description={`${beer ? beer.name : "Every beer"}, this year beside last year. Hover a month for barrels.`}
        actions={r.beers.length > 1 ? <BeerPicker beers={r.beers} value={beer?.id ?? null} range={range} /> : undefined}
      >
        <Card className="p-4">
          <FillBars thisYear={r.thisYear} lastYear={r.lastYear} />
          <div className="mt-2"><Key items={[{ label: r.lastYear[0]?.month.slice(0, 4) ?? "Last year", fill: "var(--border-strong)", opacity: 1 }, { label: r.thisYear[0]?.month.slice(0, 4) ?? "This year", fill: "var(--area)", opacity: 0.85 }]} /></div>
        </Card>
      </Section>

      <Section
        help="kegs.fleet.went"
        title={<span className="inline-flex items-center gap-1">Where the beer went <HelpTip id="kegs.fleet.went" /></span>}
        description={fills ? `${noScan} of ${fills} fills ${rangeWords} (${Math.round((noScan / fills) * 100)}%) came back with no tap or delivery scan${beer ? `, for ${beer.name}` : ""}. Those are missing from the beer tax worksheet.` : `No fills ${rangeWords}.`}
      >
        <Card className="p-4">
          <WentBars rows={r.months} />
          <div className="mt-2"><Key items={WENT_KEY} /></div>
          {r.unscannedFills > 0 && <p className="mt-3 text-xs text-muted">{kegsWord(r.unscannedFills)} went out or on tap with no fill scan first; each counts as a fill on the day it was first seen full.</p>}
        </Card>
      </Section>

      <Section
        title="Fleet by status and size"
        description="Every keg, right now."
        actions={<ExportGrid header={["Status", "Total", ...r.grid.sizes.map(sizeShort)]} rows={[["All", r.grid.all.total, ...r.grid.sizes.map((s) => r.grid.all.bySize[s])], ...gridRows.map((g) => [gridLabel(g.status), g.total, ...r.grid.sizes.map((s) => g.bySize[s])])]} />}
      >
        <Table>
          <thead><tr><Th>Status</Th><Th align="right">Total</Th>{r.grid.sizes.map((s) => <Th key={s} align="right">{sizeShort(s)}</Th>)}</tr></thead>
          <tbody>
            <Tr><Td className="font-medium">All</Td><Td align="right" className="num font-medium">{r.grid.all.total}</Td>{r.grid.sizes.map((s) => <Td key={s} align="right" className="num font-medium">{r.grid.all.bySize[s]}</Td>)}</Tr>
            {gridRows.map((g) => (
              <Tr key={g.status}>
                <Td>{g.status === "RETIRED" ? <Link href="/kegs/all?retired=1" className="hover:underline">Retired</Link> : <Link href={`/kegs/all?status=${g.status}`} className="hover:underline">{gridLabel(g.status)}</Link>}</Td>
                <Td align="right" className={cx("num", !g.total && "text-muted")}>{g.total}</Td>
                {r.grid.sizes.map((s) => <Td key={s} align="right" className={cx("num", !g.bySize[s] && "text-muted")}>{g.bySize[s]}</Td>)}
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <div id="look" className="scroll-mt-24">
        <Section help="kegs.fleet.look" title={<span className="inline-flex items-center gap-1">Out too long <HelpTip id="kegs.fleet.look" /></span>} description={`Kegs at an account for more than ${days(r.overdueDays)}. Change the number on Setup.`}>
          {r.out.length === 0 ? (
            <p className="text-sm text-muted">No keg has been out longer than {days(r.overdueDays)}.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {r.out.map((g) => (
                <Card key={g.account} className="p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="min-w-0 truncate font-semibold">{g.account}</h3>
                    <span className="num shrink-0 text-sm text-warn">{kegsWord(g.kegs.length)} · longest {days(g.longest)}</span>
                  </div>
                  <ul className="mt-2 divide-y divide-border text-sm">
                    {g.kegs.map((k) => (
                      <li key={k.id} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="min-w-0 truncate"><Link href={`/kegs/k/${k.code}`} className="num font-medium hover:underline">{displayCode(k.code)}</Link> <span className="text-ink-2">{k.beer ?? "Beer not recorded"}</span> <span className="text-muted">· {sizeShort(k.sizeId)}</span></span>
                        <span className="num shrink-0 text-muted">{days(k.days)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </Section>

        <Section title="Not seen lately" description={`Kegs in service that nobody has scanned for more than ${days(r.idleDays)}. Find it and scan it, or retire it; a retired keg keeps its history and comes back from All kegs.`}>
          {r.idle.length === 0 ? (
            <p className="text-sm text-muted">Every keg in service has been scanned in the last {days(r.idleDays)}.</p>
          ) : (
            <Table>
              <thead><tr><Th>Keg</Th><Th>Last known</Th><Th className="hidden sm:table-cell">Beer</Th><Th className="hidden md:table-cell">Last scan</Th><Th align="right">Quiet for</Th><Th /></tr></thead>
              <tbody>
                {r.idle.map((k) => (
                  <Tr key={k.id}>
                    <Td className="num font-medium whitespace-nowrap"><Link href={`/kegs/k/${k.code}`} className="hover:underline">{displayCode(k.code)}</Link> <span className="font-normal text-muted">{sizeShort(k.sizeId)}</span></Td>
                    <Td><StatusBadge status={k.status} /></Td>
                    <Td className="hidden text-ink-2 sm:table-cell">{k.beer ?? "—"}</Td>
                    <Td className="hidden text-muted md:table-cell">{k.lastSeen ? `${shortDate(k.lastSeen)}, ${k.lastSeen.slice(0, 4)}` : "Never scanned"}</Td>
                    <Td align="right" className="num text-muted">{days(k.days)}</Td>
                    <Td align="right" className="py-1"><RetireKeg id={k.id} code={displayCode(k.code)} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      </div>
    </>
  );
}
