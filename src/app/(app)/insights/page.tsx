import { CircleCheck } from "lucide-react";
import { HelpTip, HelpZone } from "@/components/help";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import { allFindings, allWatching, type PriceFit } from "@/domain/analytics";
import { daysBetween } from "@/domain/dates";
import { priceResults, trackRecord, watchList, type ProfitBase } from "@/domain/lab";
import { money, relativeTime, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { analyticsStatus, getFixedCosts, getRange, insightFeed, labSetup, refreshIfStale } from "@/server/services/analytics";
import { FixedCostsForm, PriceSlider } from "./client";
import { ActionDeck } from "./deck";
import { toDeck } from "./deck-data";
import { KegsTile } from "./kegs-tile";
import { LabTile, TILES, UpdatedNote } from "./lab-tiles";
import { RangeControl, RefreshLink } from "./range";
import { ProfitStory } from "./story";
import { JumpNav } from "./jump";
import { PriceWins, WatchList } from "./watching";
import "./lab.css";

export const metadata = { title: "Insights Lab" };

const whole = (n: number) => money(n, { whole: true });

/** "3 years (Nov 2023 – Nov 12, 2026)" */
function spanLabel(from: string, through: string) {
  const days = daysBetween(from, through) + 1;
  const years = days / 365.25;
  const len = years >= 1.9 ? `${Math.round(years * 2) / 2} years` : years >= 0.95 ? "12 months" : `${Math.round(days / 30.4)} months`;
  const y = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return `${len} · ${y(from)} – ${y(through)}`;
}

export default async function InsightsPage() {
  await requireUser("MANAGER");
  const [{ items, run, state }, status, fixed, preset, setup] = await Promise.all([insightFeed({ limit: 30, remember: true }), analyticsStatus(), getFixedCosts(), getRange(), labSetup()]);
  await refreshIfStale(run);
  const header = (span: string | null) => (
    <PageHeader
      help="insights.page"
      title="Insights Lab"
      description={<span className="hidden sm:inline">Your numbers, turned into one thing to do at a time — with the dollars, the reason and how sure we are.</span>}
      actions={<RangeControl preset={preset} span={span} />}
    />
  );

  if (!run) {
    return (
      <>
        {header(null)}
        <EmptyState title="Insights update overnight" action={<RefreshLink />}>
          {status.error ? `The last try didn't finish (${status.error}). ` : ""}The first set is worked out after the nightly sync, or work it out now — it takes a few seconds.
        </EmptyState>
      </>
    );
  }

  const r = run.results;
  const findings = allFindings(run);
  const span = run.window ? spanLabel(run.data?.from ?? run.window.from, run.window.through) : null;
  const watching = watchList(allWatching(run), state);

  // How it connects: a month of the business, and the levers (drivers model).
  const dd = r.drivers?.status === "ok" ? (r.drivers.details as { base?: ProfitBase & { costMeasured?: boolean }; levers?: { key: string; label: string; monthly: number }[]; month?: { sales: number; cogs: number; labor: number; laborHours: number; waste: number; openDays: number }; elasticity?: number; laborSplit?: { fixed: number; variable: number }; fixedTotal?: number }) : null;
  const base: (ProfitBase & { costMeasured?: boolean }) | null = dd?.base ?? (dd?.month ? { ...dd.month, guests: 0, elasticity: dd.elasticity ?? -0.8, fixed: dd.fixedTotal ?? 0, costMeasured: true } : null);
  const fixedTotal = (fixed?.rent ?? 0) + (fixed?.utilities ?? 0) + (fixed?.insurance ?? 0) + (fixed?.other ?? 0);
  const allFits = r.price?.status === "ok" ? ((r.price.details.items as PriceFit[] | undefined) ?? []) : [];
  const fits = allFits.filter((f) => f.unitCost != null).slice(0, 40);
  const actions = items.map((a) => toDeck(a, { fits: allFits }));

  const track = trackRecord(state, findings);
  const priceNews = priceResults(findings).filter((p) => p.good).slice(0, 4);
  const watchingPrices = watching.filter((w) => w.area === "menu").length;
  const age = daysBetween(run.computedAt.slice(0, 10), new Date().toISOString().slice(0, 10));

  const title = (id: string, text: string, help: string) => (
    <span id={id} className="inline-flex scroll-mt-36 items-center lg:scroll-mt-24 gap-1 text-[1.05rem] tracking-tight">{text} <HelpTip id={help} /></span>
  );
  return (
    <div className="lab">
      {header(span)}

      <JumpNav
        links={[
          { href: "#lab-today", label: "Today" },
          ...(actions.length > 1 ? [{ href: "#lab-next", label: "Up next", count: actions.length - 1 }] : []),
          ...(watching.length ? [{ href: "#lab-watching", label: "Watching", count: watching.length }] : []),
          ...(base && base.sales > 0 ? [{ href: "#lab-story", label: "How it connects" }] : []),
          { href: "#lab-tiles", label: "The Lab" },
          { href: "#lab-track", label: "Track record" },
        ]}
      />

      <HelpZone id="insights.hero">
        <ActionDeck actions={actions} />
      </HelpZone>

      {watching.length > 0 && (
        <Section
          help="insights.watching"
          className="mb-12 scroll-mt-20"
          title={title("lab-watching", "Watching", "insights.watching")}
          description="These looked like something on the raw numbers, but not once we allow for how busy you were, the weekday, the season and events. Nothing to do — each says what would make it count."
        >
          <div data-tour="insights.watching">
            <WatchList items={watching} />
          </div>
        </Section>
      )}

      {base && base.sales > 0 && (
        <Section
          help="insights.story"
          className="mb-12 scroll-mt-20"
          title={title("lab-story", "How it all connects", "insights.story")}
          description="A month of the business as a chain: guests bring sales, food, drink and wages come off, the rest is yours."
        >
          <ProfitStory base={{ ...base, fixed: fixedTotal }} levers={(dd?.levers ?? []).filter((l) => l.monthly >= 1).sort((a, b) => b.monthly - a.monthly)} costMeasured={base.costMeasured ?? true} fixedSet={fixedTotal > 0} />
          {dd?.month && dd.laborSplit && (
            <HelpZone id="insights.fixedCosts" className="mt-4">
              <FixedCostsForm
                initial={{ rent: fixed?.rent ?? null, utilities: fixed?.utilities ?? null, insurance: fixed?.insurance ?? null, other: fixed?.other ?? null }}
                be={dd.month.sales > 0 ? { laborFixedDaily: dd.laborSplit.fixed, laborVariable: dd.laborSplit.variable, cogsPct: base.cogs / base.sales, wastePct: dd.month.waste / dd.month.sales, openDaysPerMonth: dd.month.openDays, avgDaily: dd.month.sales / dd.month.openDays } : null}
              />
            </HelpZone>
          )}
        </Section>
      )}

      <Section help="insights.lab" className="mb-12" title={title("lab-tiles", "The Lab", "insights.lab")} description="One question per tile. The big line is the answer; “Show me how” is the evidence.">
        <div className="grid items-stretch gap-4 lg:grid-cols-2 lg:gap-5" data-tour="insights.lab">
          {TILES.map((t) => (
            <LabTile key={t.id} spec={{ ...t, setup: t.id === "menu" ? setup.menu : t.id === "orders" ? setup.orders : t.id === "staffing" || t.id === "week" ? setup.timecards : undefined }} r={r[t.id]} />
          ))}
          <KegsTile />
        </div>
        {fits.length > 0 && (
          <HelpZone id="insights.price" className="mt-4 lg:mt-5">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--lab-card-shadow)] sm:p-6">
              <div className="mb-4">
                <h3 className="text-[0.98rem] font-semibold tracking-tight text-ink">Try a price on any item</h3>
                <p className="mt-0.5 text-sm text-muted">Pick an item, drag the price, and see what it does to profit a month — with the likely range.</p>
              </div>
              <PriceSlider fits={fits} />
            </div>
          </HelpZone>
        )}
      </Section>

      <Section help="insights.track" className="mb-10" title={title("lab-track", "Your track record", "insights.track")} description={track.items.length ? `${track.items.length} done, expected to be worth about ${whole(track.monthly)} a month together.` : "What you've acted on, and what it was worth, shows up here."}>
        <div data-tour="insights.track" className="grid gap-4 lg:grid-cols-2 lg:gap-5">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--lab-card-shadow)]">
            <div className="border-b border-border px-5 py-3 text-[0.7rem] font-medium tracking-[0.06em] text-muted uppercase">Done</div>
            {track.items.length ? (
              <ul className="divide-y divide-border">
                {track.items.slice(0, 8).map((t) => (
                  <li key={t.key} className="flex items-start gap-3 px-5 py-3.5">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" strokeWidth={1.9} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{t.title}</div>
                      <div className="mt-0.5 text-xs text-muted">Done {shortDate(t.at)}{t.measured ? ` · ${t.measured}` : " · we'll measure what it changes"}</div>
                    </div>
                    {t.monthly > 0 && <span className="num shrink-0 text-sm font-semibold text-ink">{whole(t.monthly)}<span className="text-xs font-normal text-muted">/mo</span></span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-sm leading-relaxed text-muted">Nothing marked done yet. Press <span className="font-medium text-ink-2">Do it</span> on today&apos;s one thing and it lands here, with a before-and-after once there&apos;s enough data.</p>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--lab-card-shadow)]">
            <div className="border-b border-border px-5 py-3 text-[0.7rem] font-medium tracking-[0.06em] text-muted uppercase">Price changes that worked</div>
            {priceNews.length ? (
              <PriceWins items={priceNews} />
            ) : (
              <p className="px-5 py-8 text-sm leading-relaxed text-muted">When you change a price in Square, we compare the weeks before and after here — allowing for how busy the place was{watchingPrices ? `. ${watchingPrices} recent price changes are on the watch list above` : ""}.</p>
            )}
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <UpdatedNote>
          Worked out {relativeTime(new Date(run.computedAt))}
          {run.data ? ` from ${run.data.openDays.toLocaleString("en-US")} open days` : ""}
          {run.data?.strayDays ? ` (${run.data.strayDays} closed days with a stray sale left out)` : ""}
          {status.error ? " · the last update didn't finish, showing the one before" : age > 1 ? " · updates every night" : ""}
        </UpdatedNote>
        <RefreshLink />
      </div>
    </div>
  );
}
