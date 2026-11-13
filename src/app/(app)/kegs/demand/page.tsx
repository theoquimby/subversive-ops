import { HelpTip } from "@/components/help";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { beerCosts, beerDemand } from "@/server/services/kegs";
import { BeerDot, sizeShort } from "../bits";
import { AddBeerFromSquare } from "../setup/setup-client";
import { MonthBars, WeeklyPints } from "./chart";

export const metadata = { title: "Demand per beer" };

const r1 = (n: number) => (n < 10 ? Math.round(n * 10) / 10 : Math.round(n));
const range = (lo: number, hi: number) => (Math.round(lo) === Math.round(hi) ? `${Math.round(lo)}` : `${Math.round(lo)}–${Math.round(hi)}`);

export default async function DemandPage() {
  await requireUser("MANAGER");
  const [{ rows, seasonal, yield: yi, from, unmatched }, costs] = await Promise.all([beerDemand(), beerCosts()]);
  const short = rows.filter((r) => r.plan.toFill > 0);
  return (
    <>
      <PageHeader
        help="kegs.demand"
        title="Demand per beer"
        back={{ href: "/kegs", label: "Kegs" }}
        description="Pints a week from Square, the next four weeks, and full kegs on hand against what you'll need — so you know what to fill next."
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Beers to fill" value={short.length} tone={short.length ? "warn" : "good"} hint={short.length ? short.slice(0, 3).map((r) => r.name).join(", ") : "Every beer covered for two weeks"} />
        <Stat label="Kegs to fill" value={short.reduce((s, r) => s + r.plan.toFill, 0)} hint="To cover the next two weeks at the busy end" />
        <Stat label="Pints per 1/2 bbl" value={`~${Math.round(yi.pintsPerHalf)}`} hint={yi.measured ? `From ${yi.samples} kicked kegs` : "Assumed until kegs kick"} help="kegs.yield" />
        <Stat label="History" value={from ? shortDate(from) : "—"} hint={seasonal ? "Allows for the time of year" : "Under a year: no seasons yet"} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No beers yet" action={<LinkButton href="/kegs/setup" variant="primary">Add beers</LinkButton>}>Add your beers on Setup and say which Square items pour them. Demand comes from Square sales.</EmptyState>
      ) : (
        <Section help="kegs.demand.beers" title={<span className="inline-flex items-center gap-1">By beer <HelpTip id="kegs.demand.beers" /></span>} description="Most urgent first. Ranges are how far this method has been off for each beer before.">
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => {
              const w = r.forecast.weeks;
              const cost = costs.get(r.beerId);
              return (
                <Card key={r.beerId} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2"><BeerDot color={r.color} className="size-3.5" /><h3 className="truncate font-semibold">{r.name}</h3></div>
                    <Badge tone={r.plan.tone}>{r.plan.tone === "bad" ? "Runs out soon" : r.plan.toFill > 0 ? `Fill ${r.plan.toFill}` : "Covered"}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-2">{r.plan.sentence}</p>
                  <dl className="num mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg bg-surface-2/70 px-2.5 py-2"><dt className="text-[11px] text-muted">On hand</dt><dd className="font-semibold">{r1(r.plan.onHandKegs)} kegs</dd><dd className="text-[11px] text-muted">{r.full} full · {r.onTap} on tap</dd></div>
                    <div className="rounded-lg bg-surface-2/70 px-2.5 py-2"><dt className="text-[11px] text-muted">Need, 2 weeks</dt><dd className="font-semibold">{range(r.plan.need2.low, r.plan.need2.high)}</dd><dd className="text-[11px] text-muted">{sizeShort(r.sizeId)} kegs</dd></div>
                    <div className="rounded-lg bg-surface-2/70 px-2.5 py-2"><dt className="text-[11px] text-muted">Need, 4 weeks</dt><dd className="font-semibold">{range(r.plan.need4.low, r.plan.need4.high)} kegs</dd><dd className="text-[11px] text-muted">{w[0] ? `${range(w[0].low, w[0].high)} pints/wk` : "—"}</dd></div>
                  </dl>
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
            })}
          </div>
        </Section>
      )}

      {unmatched.length > 0 && (
        <Section title="Square items that look like draft beer" description="Not linked to a beer yet, so their pours aren't counted. Add them as a beer, or add the name to a beer on Setup.">
          <Card className="divide-y divide-border">
            {unmatched.map((u) => (
              <div key={u.base} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{u.base} <span className="num text-xs text-muted">· {Math.round(u.qty)} sold in 90 days</span></span>
                <AddBeerFromSquare base={u.base} />
              </div>
            ))}
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
