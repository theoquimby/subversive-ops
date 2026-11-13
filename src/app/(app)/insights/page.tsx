import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Card, EmptyState, PageHeader, Section, type Tone } from "@/components/ui";
import { allFindings, MODEL_IDS, rankFeed, type Insight, type ModelId, type PriceFit } from "@/domain/analytics";
import { money, relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { analyticsStatus, getFixedCosts, insightFeed, refreshIfStale } from "@/server/services/analytics";
import { businessToday } from "@/server/services/sales";
import { InsightChart } from "./charts";
import { FeedList, FixedCostsForm, HowWeKnow, PriceSlider, RefreshButton } from "./client";
import { toRow } from "./rows";

export const metadata = { title: "Insights" };

const ORDER: ModelId[] = ["menu", "price", "forecast", "orders", "staffing", "drivers", "anomalies"];
const HELP: Record<ModelId, string> = { menu: "insights.menu", price: "insights.price", forecast: "insights.forecast", orders: "insights.orders", anomalies: "insights.anomalies", drivers: "insights.drivers", staffing: "insights.staffing" };
const confTone = (l: Insight["confidence"]["level"]): Tone => (l === "high" ? "good" : l === "medium" ? "neutral" : "warn");


export default async function InsightsPage() {
  await requireUser("MANAGER");
  const [{ items: feed, run, state }, status, fixed] = await Promise.all([insightFeed({ limit: 30, remember: true }), analyticsStatus(), getFixedCosts()]);
  await refreshIfStale(run);

  if (!run) {
    return (
      <>
        <PageHeader help="insights.page" title="Insights" description="What your numbers say you should do — each one worked out from your own sales, costs and timecards." actions={<RefreshButton />} />
        <EmptyState title="Insights update overnight">
          {status.error ? `The last try didn't finish (${status.error}). ` : ""}The first set is worked out after the nightly sync, or press Refresh to work them out now (takes a few seconds).
        </EmptyState>
      </>
    );
  }

  const top = rankFeed(allFindings(run), state, businessToday(), { novelty: false }).slice(0, 5);
  const topKeys = new Set(top.map((t) => t.key));
  const more = feed.filter((f) => !topKeys.has(f.key)).slice(0, 8);
  const total = top.reduce((s, t) => s + t.monthly, 0);

  return (
    <>
      <PageHeader
        help="insights.page"
        title="Insights"
        description="What your numbers say you should do, in dollars a month. Each one shows how sure we are and how we worked it out."
        actions={
          <>
            <span className="text-xs text-muted">Updated {relativeTime(new Date(run.computedAt))}{status.error ? " · last refresh failed, showing the previous one" : ""}</span>
            <RefreshButton />
          </>
        }
      />

      <Section help="insights.top" title={<span className="inline-flex items-center gap-1">Top 5 opportunities <HelpTip id="insights.top" /></span>} description={top.length ? `Together worth about ${money(total, { whole: true })} a month. Mark each Done, Later or Not useful — it learns what you care about.` : undefined}>
        {top.length ? <FeedList items={top.map(toRow)} numbered /> : <EmptyState title="Nothing worth chasing right now">Everything we checked is in line. New findings show up here as they appear.</EmptyState>}
      </Section>

      {more.length > 0 && (
        <Section help="insights.feed" title={<span className="inline-flex items-center gap-1">Worth knowing <HelpTip id="insights.feed" /></span>} description="Other things the numbers turned up, newest and most surprising first. Things you've already seen fade unless they change.">
          <FeedList items={more.map(toRow)} />
        </Section>
      )}

      <Section title="The models" description="One card per question. The number at the top is the answer; the chart and “How we worked this out” are the evidence.">
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          {ORDER.filter((m) => MODEL_IDS.includes(m)).map((m) => {
            const r = run.results[m];
            return (
              <HelpZone key={m} id={HELP[m]} className="h-full min-w-0">
                <ModelCard id={m} r={r} fixed={fixed} />
              </HelpZone>
            );
          })}
        </div>
      </Section>
      <p className="text-xs text-muted">
        Worked out {run.source === "service" ? "by the analytics service" : "on this machine"} in {run.seconds != null ? `${Math.round(run.seconds)}s` : "—"}. Models: menu engineering (Kasavana–Smith), log-log price response with category priors, SARIMAX and Holt-Winters forecasts, newsvendor order sizing, robust z-scores and STL, OLS labor split, hour-of-week sales per labor hour.
      </p>
    </>
  );
}

function ModelCard({ id, r, fixed }: { id: ModelId; r: Insight | undefined; fixed: Awaited<ReturnType<typeof getFixedCosts>> }) {
  if (!r) {
    return (
      <Card id={id} className="flex h-full flex-col p-5">
        <div className="text-[0.95rem] font-semibold text-ink">{id}</div>
        <p className="mt-2 text-sm text-muted">Insights update overnight.</p>
      </Card>
    );
  }
  const thin = r.status !== "ok";
  const details = r.details as Record<string, unknown>;
  let extra: React.ReactNode = null;
  if (id === "price" && !thin) {
    const fits = (details.items as PriceFit[] | undefined)?.filter((f) => f.unitCost != null) ?? [];
    extra = fits.length ? <PriceSlider fits={fits} /> : null;
  }
  if (id === "drivers" && !thin) {
    const m = details.month as { sales: number; cogs: number; waste: number; openDays: number } | undefined;
    const split = details.laborSplit as { fixed: number; variable: number } | undefined;
    extra = (
      <HelpZone id="insights.fixedCosts">
        <FixedCostsForm
          initial={{ rent: fixed?.rent ?? null, utilities: fixed?.utilities ?? null, insurance: fixed?.insurance ?? null, other: fixed?.other ?? null }}
          be={m && split && m.sales > 0 ? { laborFixedDaily: split.fixed, laborVariable: split.variable, cogsPct: m.cogs / m.sales, wastePct: m.waste / m.sales, openDaysPerMonth: m.openDays, avgDaily: m.sales / m.openDays } : null}
        />
      </HelpZone>
    );
  }
  return (
    <Card id={id} className="flex h-full scroll-mt-20 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[0.8rem] font-medium text-muted">{r.title}</h3>
        <Badge tone={thin ? "warn" : confTone(r.confidence.level)} className="max-w-[60%] truncate">{thin ? "Needs more data" : r.confidence.note}</Badge>
      </div>
      <p className={thin ? "mt-2 text-[1.05rem] font-medium text-ink-2" : "mt-2 text-[1.15rem] leading-snug font-semibold tracking-tight text-ink"}>{r.headline}</p>
      <p className="mt-1.5 text-sm text-ink-2">{r.action}</p>
      {!thin && r.chart && (
        <div className="mt-4 min-w-0">
          <InsightChart chart={r.chart} />
        </div>
      )}
      {extra && <div className="mt-4">{extra}</div>}
      <div className="mt-auto">
        <HowWeKnow how={r.how} inputs={r.inputs} />
      </div>
    </Card>
  );
}
