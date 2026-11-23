import { Verdict } from "@/components/chapter";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { beerCosts, beerDemand, type BeerDemandRow } from "@/server/services/kegs";
import Link from "next/link";
import { BeerDot, sizeShort } from "../bits";
import { CoreHelperSection } from "../core-helper";
import { AddBeerFromSquare } from "../setup/setup-client";
import { ShowMore } from "@/components/show-more";
import { DemandBrowser, type DemandItem } from "./browser";
import { MonthBars, WeeklyPints } from "./chart";

export const metadata = { title: "Demand per beer" };

const r1 = (n: number) => (n < 10 ? Math.round(n * 10) / 10 : Math.round(n));
const range = (lo: number, hi: number) => (Math.round(lo) === Math.round(hi) ? `${Math.round(lo)}` : `${Math.round(lo)} to ${Math.round(hi)}`);

type Cost = Awaited<ReturnType<typeof beerCosts>> extends Map<string, infer V> ? V : never;

/**
 * Demand per beer in three groups: core beers with the plan and what to fill,
 * beers in rotation with their pace for information only, and retired beers
 * behind "Show retired".
 */
export default async function DemandPage({ searchParams }: { searchParams: Promise<{ retired?: string }> }) {
  await requireUser("MANAGER");
  const showRetired = (await searchParams).retired === "1";
  const [{ rows, seasonal, yield: yi, from, unmatched }, costs] = await Promise.all([beerDemand(), beerCosts()]);
  const core = rows.filter((r) => r.standing === "core");
  // In rotation: what's pouring or full first, then the rest by name.
  const rotation = rows.filter((r) => r.standing === "rotation").sort((a, z) => z.onTap - a.onTap || z.full - a.full || a.name.localeCompare(z.name));
  const retired = rows.filter((r) => r.standing === "retired").sort((a, z) => a.name.localeCompare(z.name));
  const short = core.filter((r) => r.plan.toFill > 0);
  const toFill = short.reduce((s, r) => s + r.plan.toFill, 0);
  const names = short.slice(0, 3).map((r) => r.name).join(", ") + (short.length > 3 ? ` and ${short.length - 3} more` : "");
  return (
    <>
      <PageHeader
        help="kegs.demand"
        title="Demand per beer"
        description="Pints a week from Square and the next four weeks. For core beers, full kegs on hand against what you'll need, so you know what to fill next."
      />

      <CoreHelperSection />

      <Verdict
        badge={short.length ? { tone: "warn" } : core.length ? { tone: "good" } : undefined}
        title={short.length ? `Fill ${toFill} keg${toFill === 1 ? "" : "s"} for ${short.length === 1 ? "one core beer" : `${short.length} core beers`}: ${names}` : core.length ? "Every core beer is covered for the next two weeks" : "Pick your core beers to get a fill plan"}
        line={short.length ? "Enough to cover the next two weeks at the busy end. Each beer below says how many and why." : core.length ? "Nothing to fill yet. The beers below show how fast each is pouring." : "Core beers are the ones you never want to run out of; this page plans their fills."}
        stats={[
          { label: "Kegs to fill", value: toFill, tone: toFill ? "warn" : "neutral", hint: "To cover the next two weeks" },
          { label: "Pints per 1/2 bbl", value: `~${Math.round(yi.pintsPerHalf)}`, hint: yi.measured ? `From ${yi.samples} kicked kegs` : "Assumed until kegs kick" },
          { label: "Sales history from", value: from ? shortDate(from) : "Not in yet", tone: from ? "neutral" : "unknown", hint: seasonal ? "Allows for the time of year" : "Under a year: no seasons yet" },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState title="No beers yet" action={<LinkButton href="/kegs/setup" variant="primary">Add beers</LinkButton>}>Add your beers on Setup and say which Square items pour them. Demand comes from Square sales.</EmptyState>
      ) : (
        <DemandBrowser
          showRetired={showRetired}
          groups={[
            {
              key: "core",
              title: "Core beers",
              help: "kegs.demand.beers",
              description: "The ones you never want to run out of. Most urgent first. Ranges are how far this method has been off for each beer before.",
              limit: 12,
              items: core.map((r) => item(r, costs.get(r.beerId))),
              empty: <p className="text-sm text-muted">No core beers yet. Pick them above, or set a beer to Core on <Link href="/kegs/setup" className="underline hover:text-ink">Setup</Link> or on its own page.</p>,
            },
            { key: "rotation", title: "In rotation", help: "kegs.standing", description: "Brewed sometimes, what's pouring or full first. Their pace is here for information; they're never flagged to fill.", limit: 6, items: rotation.map((r) => item(r, costs.get(r.beerId))) },
            { key: "retired", title: "Retired", description: "Not brewed any more. Kept for their history.", limit: 6, items: retired.map((r) => item(r, costs.get(r.beerId))) },
          ]}
        />
      )}

      {unmatched.length > 0 && (
        <Section title="Square items that look like draft beer" description="Not linked to a beer yet, so their pours aren't counted. Add them as a beer, or add the name to a beer on Setup.">
          <Card>
            <ShowMore limit={8} noun={["item", "items"]} className="divide-y divide-border" buttonClassName="mx-2 mb-1.5">
              {unmatched.map((u) => (
                <div key={u.base} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{u.base} <span className="num text-xs text-muted">· {Math.round(u.qty)} sold in 90 days</span></span>
                  <AddBeerFromSquare base={u.base} />
                </div>
              ))}
            </ShowMore>
          </Card>
        </Section>
      )}

      {yi.kicks.length > 0 && (
        <Section help="kegs.yield" title="What kicked kegs say" description="Square ounces between tapping and kicking, against what the keg holds. This sets the pints per keg above and is the real pour yield for costing.">
          <Card className="divide-y divide-border">
            {yi.kicks.slice(0, 10).map((k) => {
              const y = k.soldOz / k.kegOz;
              return (
                <div key={`${k.kegCode}-${+k.kickedAt}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{k.beer} <span className="text-xs text-muted">· {sizeShort(k.sizeId)} · kicked {shortDate(k.kickedAt.toISOString().slice(0, 10))}</span></span>
                  <span className={`num shrink-0 ${y < 0.75 || y > 1.05 ? "text-warn" : ""}`}>{Math.round(k.soldOz / 16)} pints · {Math.round(y * 100)}%</span>
                </div>
              );
            })}
          </Card>
        </Section>
      )}
    </>
  );
}

/** A beer's card with what the page's search and filters need to know about it. */
function item(r: BeerDemandRow, cost: Cost | undefined): DemandItem {
  return {
    id: r.beerId,
    name: r.name,
    inStock: r.full > 0 || r.onTap > 0,
    soldLately: r.weekly.slice(-4).some((w) => w.pints > 0),
    card: <DemandCard r={r} cost={cost} />,
  };
}

/** One beer: the plan and "Fill N" for a core beer; for the others the same pace and history, in neutral words. */
function DemandCard({ r, cost }: { r: BeerDemandRow; cost: Cost | undefined }) {
  const w = r.forecast.weeks;
  const plan = r.standing === "core";
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/kegs/beers/${r.beerId}`} className="flex min-w-0 items-center gap-2 hover:underline"><BeerDot color={r.color} className="size-3.5" /><h3 className="truncate font-semibold">{r.name}</h3></Link>
        {plan ? (
          <Badge tone={r.plan.tone}>{r.plan.tone === "bad" ? "Runs out soon" : r.plan.toFill > 0 ? `Fill ${r.plan.toFill}` : "Covered"}</Badge>
        ) : r.standing === "retired" ? (
          <Badge>Retired</Badge>
        ) : r.onTap > 0 ? (
          <Badge>On tap</Badge>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-ink-2">{plan ? r.plan.sentence : r.info}</p>
      {plan && (
        <dl className="num mt-3 grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg bg-surface-2/70 px-2.5 py-2"><dt className="text-[11px] text-muted">On hand</dt><dd className="font-semibold">{r1(r.plan.onHandKegs)} kegs</dd><dd className="text-[11px] text-muted">{r.full} full · {r.onTap} on tap</dd></div>
          <div className="rounded-lg bg-surface-2/70 px-2.5 py-2"><dt className="text-[11px] text-muted">Need, 2 weeks</dt><dd className="font-semibold">{range(r.plan.need2.low, r.plan.need2.high)}</dd><dd className="text-[11px] text-muted">{sizeShort(r.sizeId)} kegs</dd></div>
          <div className="rounded-lg bg-surface-2/70 px-2.5 py-2"><dt className="text-[11px] text-muted">Need, 4 weeks</dt><dd className="font-semibold">{range(r.plan.need4.low, r.plan.need4.high)} kegs</dd><dd className="text-[11px] text-muted">{w[0] ? `${range(w[0].low, w[0].high)} pints/wk` : "—"}</dd></div>
        </dl>
      )}
      <div className="mt-3"><WeeklyPints history={r.weekly} forecast={w} /></div>
      <div className="mt-auto flex items-end justify-between gap-4 pt-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] text-muted">Its year</div>
          <MonthBars months={r.months} />
        </div>
        <div className="shrink-0 text-right text-xs text-muted">
          {cost ? <>~${cost.perPint.toFixed(2)} a pint{cost.incomplete ? "+" : ""}<br />from {cost.recipe}</> : r.perOz ? <>${(r.perOz * 16).toFixed(2)} a pint in sales</> : null}
        </div>
      </div>
    </Card>
  );
}
