import { Chapter, InShort, Verdict, type Finding } from "@/components/chapter";
import { HelpTip } from "@/components/help";
import { Card, cx, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { PROBABLY_LOST_DAYS, splitOutTooLong } from "@/domain/kegFleet";
import { displayCode, STATUS_META } from "@/domain/kegs";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { fleetReport, type FleetRange } from "@/server/services/kegFleet";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { sizeShort } from "../bits";
import { BUCKET_KEY, FillBars, FleetArea, Key, WENT_KEY, WentBars } from "./charts";
import { BeerPicker, ExportGrid, IdleTable, OutTooLongTable } from "./fleet-client";

export const metadata = { title: "Fleet & trends" };

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const kegsWord = (n: number) => `${n} keg${n === 1 ? "" : "s"}`;
const accountsWord = (n: number) => `${n} account${n === 1 ? "" : "s"}`;
/** Below this share of fills with no tap or delivery scan, the gap is small enough to leave. */
const GAP_OK = 0.1;

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
        <PageHeader help="kegs.fleet" title="Fleet & trends" description="How the keg fleet is used over time, and which kegs need a look." />
        <EmptyState title="No keg history yet" action={<LinkButton href="/kegs/import" variant="primary">Import from your old keg app</LinkButton>}>Trends appear once kegs have been scanned for a while, or as soon as you bring in the history from your old keg app.</EmptyState>
      </>
    );
  }

  const fills = r.months.reduce((s, m) => s + m.kegs, 0);
  const noScan = r.months.reduce((s, m) => s + m.none, 0);
  const tapped = r.months.reduce((s, m) => s + m.tapped, 0);
  const sent = r.months.reduce((s, m) => s + m.out, 0);
  const gap = fills ? noScan / fills : 0;
  const retired = r.grid.rows.find((g) => g.status === "RETIRED")?.total ?? 0;
  const { late, lost } = splitOutTooLong(r.out);
  const lateKegs = late.reduce((s, g) => s + g.kegs.length, 0);
  const lostKegs = lost.reduce((s, g) => s + g.kegs.length, 0);
  const gridLabel = (s: (typeof r.grid.rows)[number]["status"]) => (s === "RETIRED" ? "Retired" : STATUS_META[s].label);
  const gridRows = r.grid.rows.filter((g) => g.total > 0 || g.status !== "RETIRED");
  const rangeWords = `since ${shortDate(r.from)}, ${r.from.slice(0, 4)}`;
  const forBeer = beer ? `, for ${beer.name}` : "";
  const outRows = (groups: typeof late) => groups.flatMap((g) => g.kegs.map((k) => ({ id: k.id, code: k.code, display: displayCode(k.code), size: sizeShort(k.sizeId), beer: k.beer, account: g.account, days: k.days })));

  // The findings, in the order the page tells them.
  const scanPoint: Finding | null = fills
    ? gap >= GAP_OK
      ? {
          tone: "bad",
          title: `${noScan} of ${fills} fills ${rangeWords} (${Math.round(gap * 100)}%) came back with no tap or delivery scan${forBeer}`,
          detail: "Beer tax is owed on beer that leaves the brewery, and Ops only knows it left from those scans. The beer tax worksheet is missing these kegs, so it is probably under-counting.",
          action: "Scan every keg as it goes on a tap or leaves for an account. The worksheet fills itself from those scans.",
        }
      : { tone: "good", title: `Almost every fill ${rangeWords} has a tap or delivery scan${forBeer}`, detail: `${noScan} of ${fills} came back with neither. The beer tax worksheet can be trusted.`, action: null }
    : null;
  const latePoint: Finding = lateKegs
    ? { tone: "warn", title: `${kegsWord(lateKegs)} out at ${accountsWord(late.length)} for more than ${days(r.overdueDays)}`, detail: `Longest: ${late[0].account}, ${days(late[0].longest)}.`, action: "Ask for them back on the next delivery." }
    : { tone: "good", title: `No keg has been out longer than ${days(r.overdueDays)}`, detail: "", action: null };
  const lostPoint: Finding | null = lostKegs
    ? { tone: "warn", title: `${kegsWord(lostKegs)} out more than ${days(PROBABLY_LOST_DAYS)}: probably lost`, detail: `At ${accountsWord(lost.length)}. The longest has been out ${days(lost[0].longest)}.`, action: "Ask each account once. Retire the kegs that don't turn up, so they stop counting as fleet." }
    : null;
  const idlePoint: Finding = r.idle.length
    ? { tone: "warn", title: `${kegsWord(r.idle.length)} not scanned in more than ${days(r.idleDays)}`, detail: "Each one is somewhere: in a corner of the walk-in, at an account, or gone.", action: "Find and scan them, or retire them. A retired keg keeps its history and comes back from All kegs." }
    : { tone: "good", title: `Every keg in service has been scanned in the last ${days(r.idleDays)}`, detail: "", action: null };
  const contents = [
    scanPoint && { id: "no-removal-scan", point: scanPoint },
    { id: "look", point: latePoint },
    lostPoint && { id: "lost", point: lostPoint },
    { id: "idle", point: idlePoint },
  ].filter((x): x is { id: string; point: Finding } => !!x);

  return (
    <>
      <PageHeader
        help="kegs.fleet"
        title="Fleet & trends"
        description="How the keg fleet is used over time, worked out from every scan: where the beer went, where the kegs were, and which kegs need a look."
        actions={<div className="flex gap-1.5">{chip("12m", "12 months")}{chip("all", "All time")}</div>}
      />

      {scanPoint ? (
        <Verdict
          id="no-removal-scan"
          badge={{ tone: scanPoint.tone }}
          title={scanPoint.title}
          line={<>{scanPoint.detail} {scanPoint.action}</>}
          stats={[
            { label: "Fills", value: fills, hint: rangeWords },
            { label: "Tapped here or sent out", value: tapped + sent, hint: `${tapped} tapped · ${sent} sent out` },
            { label: "No tap or delivery scan", value: noScan, tone: gap >= GAP_OK ? "bad" : "neutral", hint: "Missing from the beer tax worksheet" },
          ]}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-1 text-sm font-medium text-ink">Where the beer from each month&apos;s fills went <HelpTip id="kegs.fleet.went" /></h3>
            {gap >= GAP_OK && <LinkButton href="/beer-tax" size="sm" className="h-10 sm:h-8">Beer tax <ArrowRight className="size-4" /></LinkButton>}
          </div>
          <WentBars rows={r.months} />
          <div className="mt-2"><Key items={WENT_KEY} /></div>
          {r.unscannedFills > 0 && <p className="mt-3 text-xs text-muted">{kegsWord(r.unscannedFills)} went out or on tap with no fill scan first; each counts as a fill on the day it was first seen full.</p>}
        </Verdict>
      ) : (
        <Card className="mb-4 p-5 text-sm text-ink-2">No kegs were filled {rangeWords}{forBeer}.</Card>
      )}

      <Section title="In short" description="What stands out, in the order the page tells it. Tap one to jump to it.">
        <InShort items={contents} />
      </Section>

      <Section help="kegs.fleet.look" title={<span className="inline-flex items-center gap-1">Kegs that need a look <HelpTip id="kegs.fleet.look" /></span>} description={`Out at an account for more than ${days(r.overdueDays)} (change the number on Setup), or not scanned for more than ${days(r.idleDays)}.`}>
        <div className="space-y-8">
          <div id="look" className="scroll-mt-24">
            <FindingHead point={latePoint} />
            {lateKegs > 0 && <OutTooLongTable rows={outRows(late)} />}
          </div>
          {lostPoint && (
            <div id="lost" className="scroll-mt-24">
              <FindingHead point={lostPoint} />
              <OutTooLongTable id="kegs-fleet-lost" rows={outRows(lost)} />
            </div>
          )}
          <div id="idle" className="scroll-mt-24">
            <FindingHead point={idlePoint} />
            {r.idle.length > 0 && <IdleTable rows={r.idle.map((k) => ({ id: k.id, code: k.code, display: displayCode(k.code), size: sizeShort(k.sizeId), status: k.status, beer: k.beer, lastSeen: k.lastSeen, days: k.days }))} />}
          </div>
        </div>
      </Section>

      <Section title="How the fleet is used" description={`${kegsWord(r.stats.inService)} in service${retired ? `, ${retired} retired` : ""}.`}>
        <div className="grid gap-4">
          <Chapter
            id="where"
            title="Where the fleet was, week by week"
            detail={`${r.stats.turns == null ? "" : `Each keg was filled about ${r.stats.turns.toFixed(1)} times in the last 12 months. `}${r.stats.medianCycleDays != null ? `A typical keg takes ${days(r.stats.medianCycleDays)} from a fill to back dirty. ` : ""}A fleet that's mostly dirty or clean has kegs to spare; one that's always full or out is stretched.`}
          >
            <FleetArea points={r.weeks} />
            <div className="mt-2"><Key items={BUCKET_KEY} /></div>
          </Chapter>

          <Card className="p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold tracking-tight text-ink sm:text-lg">Kegs filled per month</h3>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">{beer ? beer.name : "Every beer"}, this year beside last year. Hover a month for barrels.</p>
              </div>
              {r.beers.length > 1 && <BeerPicker beers={r.beers} value={beer?.id ?? null} range={range} />}
            </div>
            <div className="mt-5">
              <FillBars thisYear={r.thisYear} lastYear={r.lastYear} />
              <div className="mt-2"><Key items={[{ label: r.lastYear[0]?.month.slice(0, 4) ?? "Last year", fill: "var(--border-strong)" }, { label: r.thisYear[0]?.month.slice(0, 4) ?? "This year", fill: BUCKET_KEY[0].fill }]} /></div>
            </div>
          </Card>
        </div>
      </Section>

      <Section
        title="Fleet by status and size"
        description="Every keg, right now. Tap a status to see those kegs."
        actions={<ExportGrid header={["Status", "Total", ...r.grid.sizes.map(sizeShort)]} rows={[["All", r.grid.all.total, ...r.grid.sizes.map((s) => r.grid.all.bySize[s])], ...gridRows.map((g) => [gridLabel(g.status), g.total, ...r.grid.sizes.map((s) => g.bySize[s])])]} />}
      >
        <Table>
          <thead><tr><Th>Status</Th><Th align="right">Total</Th>{r.grid.sizes.map((s) => <Th key={s} align="right" className="hidden sm:table-cell">{sizeShort(s)}</Th>)}</tr></thead>
          <tbody>
            <Tr><Td className="font-medium">All</Td><Td align="right" className="num font-medium">{r.grid.all.total}</Td>{r.grid.sizes.map((s) => <Td key={s} align="right" className="num hidden font-medium sm:table-cell">{r.grid.all.bySize[s]}</Td>)}</Tr>
            {gridRows.map((g) => (
              <Tr key={g.status}>
                <Td>{g.status === "RETIRED" ? <Link href="/kegs/all?retired=1" className="hover:underline">Retired</Link> : <Link href={`/kegs/all?status=${g.status}`} className="hover:underline">{gridLabel(g.status)}</Link>}</Td>
                <Td align="right" className={cx("num", !g.total && "text-muted")}>{g.total}</Td>
                {r.grid.sizes.map((s) => <Td key={s} align="right" className={cx("num hidden sm:table-cell", !g.bySize[s] && "text-muted")}>{g.bySize[s]}</Td>)}
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  );
}

/** A finding's heading, why, and what to do, above its table. */
function FindingHead({ point }: { point: Finding }) {
  return (
    <div className="mb-3">
      <h3 className="max-w-3xl text-base font-semibold tracking-tight text-balance text-ink">{point.title}</h3>
      {point.detail && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">{point.detail}</p>}
      {point.action && <p className="mt-1 max-w-2xl text-sm font-medium text-ink">{point.action}</p>}
    </div>
  );
}
