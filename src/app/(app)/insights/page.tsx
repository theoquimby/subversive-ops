import { HelpTip, HelpZone } from "@/components/help";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import { allFindings, type PriceFit } from "@/domain/analytics";
import { daysBetween } from "@/domain/dates";
import { priceResults, trackRecord, type ProfitBase } from "@/domain/lab";
import { money, relativeTime, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { analyticsStatus, getFixedCosts, getRange, insightFeed, labSetup, refreshIfStale } from "@/server/services/analytics";
import { FixedCostsForm, PriceSlider } from "./client";
import { ActionDeck } from "./deck";
import { toDeck } from "./deck-data";
import { LabTile, TILES, UpdatedNote } from "./lab-tiles";
import { RangeControl, RefreshLink } from "./range";
import { ProfitStory } from "./story";

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
      description="Your numbers, turned into one thing to do at a time — with the dollars, the reason and how sure we are."
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
  const actions = items.map(toDeck);

  // How it connects: a month of the business, and the levers (drivers model).
  const dd = r.drivers?.status === "ok" ? (r.drivers.details as { base?: ProfitBase & { costMeasured?: boolean }; levers?: { key: string; label: string; monthly: number }[]; month?: { sales: number; cogs: number; labor: number; laborHours: number; waste: number; openDays: number }; elasticity?: number; laborSplit?: { fixed: number; variable: number }; fixedTotal?: number }) : null;
  const base: (ProfitBase & { costMeasured?: boolean }) | null = dd?.base ?? (dd?.month ? { ...dd.month, guests: 0, elasticity: dd.elasticity ?? -0.8, fixed: dd.fixedTotal ?? 0, costMeasured: true } : null);
  const fixedTotal = (fixed?.rent ?? 0) + (fixed?.utilities ?? 0) + (fixed?.insurance ?? 0) + (fixed?.other ?? 0);
  const fits = r.price?.status === "ok" ? ((r.price.details.items as PriceFit[] | undefined) ?? []).filter((f) => f.unitCost != null).slice(0, 40) : [];

  const track = trackRecord(state, findings);
  const priceNews = priceResults(findings).filter((p) => p.good).slice(0, 4);
  const age = daysBetween(run.computedAt.slice(0, 10), new Date().toISOString().slice(0, 10));

  return (
    <>
      {header(span)}

      <HelpZone id="insights.hero">
        <ActionDeck actions={actions} />
      </HelpZone>

      {base && base.sales > 0 && (
        <Section
          help="insights.story"
          className="scroll-mt-20"
          title={<span id="lab-story" className="inline-flex items-center gap-1">How it all connects <HelpTip id="insights.story" /></span>}
          description="A month of the business as a chain: guests bring sales, food, drink and wages come off, the rest is yours."
        >
          <ProfitStory base={{ ...base, fixed: fixedTotal }} levers={(dd?.levers ?? []).filter((l) => l.monthly >= 1)} costMeasured={base.costMeasured ?? true} fixedSet={fixedTotal > 0} />
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

      <Section help="insights.lab" title={<span className="inline-flex items-center gap-1">The Lab <HelpTip id="insights.lab" /></span>} description="One question per tile. The big line is the answer; “Show me how” is the evidence.">
        <div className="grid items-stretch gap-4 lg:grid-cols-2" data-tour="insights.lab">
          {TILES.map((t) => (
            <LabTile key={t.id} spec={{ ...t, setup: t.id === "menu" ? setup.menu : t.id === "orders" ? setup.orders : t.id === "staffing" || t.id === "week" ? setup.timecards : undefined }} r={r[t.id]} />
          ))}
        </div>
        {fits.length > 0 && (
          <HelpZone id="insights.price" className="mt-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-2 text-sm font-medium text-ink">Try a price on any item</div>
              <PriceSlider fits={fits} />
            </div>
          </HelpZone>
        )}
      </Section>

      <Section help="insights.track" title={<span className="inline-flex items-center gap-1">Your track record <HelpTip id="insights.track" /></span>} description={track.items.length ? `${track.items.length} done, expected to be worth about ${whole(track.monthly)} a month together.` : "What you've acted on, and what it was worth, shows up here."}>
        <div data-tour="insights.track" className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface">
            {track.items.length ? (
              <ul className="divide-y divide-border">
                {track.items.slice(0, 8).map((t) => (
                  <li key={t.key} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{t.title}</div>
                      <div className="mt-0.5 text-xs text-muted">Done {shortDate(t.at)}{t.measured ? ` · ${t.measured}` : " · we'll measure what it changes"}</div>
                    </div>
                    {t.monthly > 0 && <span className="num shrink-0 text-sm text-ink">{whole(t.monthly)}<span className="text-xs text-muted">/mo</span></span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-muted">Nothing marked done yet. Press <span className="font-medium text-ink-2">Do it</span> on today&apos;s one thing and it lands here, with a before-and-after once there&apos;s enough data.</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted">Price changes that worked</div>
            {priceNews.length ? (
              <ul className="divide-y divide-border">
                {priceNews.map((p) => (
                  <li key={p.key} className="px-4 py-3 text-sm text-ink">{p.title}</li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-muted">When you change a price in Square, we compare the weeks before and after here — allowing for how busy the place was.</p>
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
    </>
  );
}
