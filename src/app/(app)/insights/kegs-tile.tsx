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
  const max = Math.max(1, ...rows.slice(0, 5).map((r) => r.plan.runOutDays ?? 0));
  return (
    <HelpZone id="insights.kegs" className="h-full min-w-0">
      <Card id="lab-kegs" className="flex h-full scroll-mt-20 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2"><Beer className="size-4 text-area" strokeWidth={1.9} /></span>
            <div className="min-w-0">
              <h3 className="truncate text-[0.95rem] font-semibold text-ink">Kegs</h3>
              <div className="truncate text-xs text-muted">Which beer runs out first?</div>
            </div>
          </div>
          {data && <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">~{Math.round(data.yield.pintsPerHalf)} pints / 1/2 bbl</span>}
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
            <ul className="mt-4 space-y-2">
              {rows.slice(0, 5).map((r) => (
                <li key={r.beerId} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2 text-xs">
                  <span className="truncate text-ink-2">{r.name}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, ((r.plan.runOutDays ?? 0) / max) * 100)}%`, background: beerColor(r.color).bg }} /></span>
                  <span className={`num text-right ${r.plan.tone === "bad" ? "text-bad" : "text-muted"}`}>{r.plan.runOutDays == null ? "—" : `${Math.round(r.plan.runOutDays)} days`}</span>
                </li>
              ))}
            </ul>
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
