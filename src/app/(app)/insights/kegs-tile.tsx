import { Beer } from "lucide-react";
import { HelpZone } from "@/components/help";
import { Card, LinkButton } from "@/components/ui";
import { beerColor } from "@/domain/kegs";
import { beerDemand } from "@/server/services/kegs";
import { ShowMeHow } from "./deck";

/**
 * The Lab's keg tile: which beer runs out first. Worked out here from live
 * kegs and Square (not the Python service), so it's always current.
 */
export async function KegsTile() {
  let data: Awaited<ReturnType<typeof beerDemand>> | null = null;
  try {
    data = await beerDemand();
  } catch {
    data = null;
  }
  const rows = (data?.rows ?? []).filter((r) => r.forecast.ozPerDay > 0 || r.full > 0 || r.onTap > 0);
  const first = rows[0];
  // Days-left gauges share one scale: four weeks, with a tick at two (what an order should cover).
  const SCALE = 28;
  return (
    <HelpZone id="insights.kegs" className="h-full min-w-0">
      <Card id="lab-kegs" className="lab flex h-full scroll-mt-20 flex-col rounded-2xl p-5 shadow-[var(--lab-card-shadow)] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--area)_10%,var(--surface))]"><Beer className="size-[18px] text-area" strokeWidth={1.8} /></span>
            <div className="min-w-0">
              <h3 className="truncate text-[0.98rem] font-semibold tracking-tight text-ink">Kegs</h3>
              <div className="truncate text-xs text-muted">Which beer runs out first?</div>
            </div>
          </div>
          {data && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted">~{Math.round(data.yield.pintsPerHalf)} pints a ½ bbl</span>}
        </div>
        {!first ? (
          <>
            <p className="mt-4 text-[1.02rem] leading-snug font-medium text-ink-2">Add your beers and scan kegs onto taps, and this shows which runs out first and what to fill.</p>
            <div className="mt-4"><LinkButton href="/kegs/setup" size="sm" className="h-10 sm:h-8">Set up kegs →</LinkButton></div>
          </>
        ) : (
          <>
            <p className="mt-4 text-[1.1rem] leading-snug font-semibold tracking-tight text-ink">
              {first.plan.runOutDays != null ? `${first.name} runs out in ~${Math.max(1, Math.round(first.plan.runOutDays))} days; ${first.full} full in the walk-in` : `${first.name}: ${first.full} full kegs`}
            </p>
            <p className="mt-1.5 text-sm text-ink-2">{first.plan.toFill > 0 ? `Fill ${first.plan.toFill} keg${first.plan.toFill === 1 ? "" : "s"} of it to cover the next two weeks.` : "Every beer is covered for the next two weeks."}</p>
            <figure className="mt-5" aria-label={`Days until each beer runs out: ${rows.slice(0, 5).map((r) => `${r.name} ${r.plan.runOutDays == null ? "not known" : `${Math.round(r.plan.runOutDays)} days`}`).join(", ")}`}>
              <ul className="flex flex-col gap-3" aria-hidden>
                {rows.slice(0, 5).map((r, i) => {
                  const d = r.plan.runOutDays;
                  const pct = d == null ? 0 : Math.min(100, (d / SCALE) * 100);
                  return (
                    <li key={r.beerId}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-2">
                          <span className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10 ring-inset" style={{ background: beerColor(r.color).bg }} />
                          <span className="truncate">{r.name}</span>
                        </span>
                        <span className={`num shrink-0 font-semibold ${r.plan.tone === "bad" ? "text-bad" : "text-ink"}`}>{d == null ? "—" : d > SCALE ? `${SCALE}+ days` : `${Math.round(d)} days`}</span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-[var(--lab-context-2)]">
                        <div className="lab-grow-x absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(pct, d == null ? 0 : 2)}%`, background: r.plan.tone === "bad" ? "var(--lab-hot)" : "var(--lab-accent)", animationDelay: `${i * 70}ms` }} />
                        <div className="absolute -inset-y-1 left-1/2 w-[2px] rounded bg-ink-2/70" />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <figcaption className="mt-2 flex justify-between text-[11px] text-muted"><span>today</span><span>2 weeks</span><span>4 weeks</span></figcaption>
            </figure>
          </>
        )}
        <div className="mt-auto pt-2">
          {first && (
            <ShowMeHow
              className="border-t border-border"
              how={[
                "Days left = what's on tap (Square pours since tapping, against the keg) plus full kegs, at the forecast pace.",
                `The pace is each beer's last four weeks of Square pours${data?.seasonal ? ", adjusted for the time of year from every year of draft sales" : ""}.`,
                `Pints per keg come from ${data?.yield.measured ? `${data.yield.samples} kicked kegs` : "a 90% assumption until kegs kick"}.`,
              ]}
              inputs={[{ label: "Beers", value: String(rows.length) }, { label: "To fill", value: String(rows.reduce((s, r) => s + r.plan.toFill, 0)) }]}
            />
          )}
        </div>
      </Card>
    </HelpZone>
  );
}
