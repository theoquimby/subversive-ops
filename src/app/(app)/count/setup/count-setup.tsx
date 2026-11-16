"use client";

import { Button, Card, cx, Input, Select } from "@/components/ui";
import { HelpTip, HelpZone } from "@/components/help";
import { matchScore, normalize } from "@/domain/dataTable";
import type { CountItem } from "@/server/services/counts";
import { ChevronDown, ChevronUp, ImageOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ItemSheet, packLine } from "../item-sheet";
import { AreasPanel } from "../areas-panel";
import type { AreaRow } from "../area-manager";
import { addPrepToCount, moveCountItem } from "../setup-actions";

export function CountSetup({ items, areas, prepsOff }: { items: CountItem[]; areas: AreaRow[]; prepsOff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [gaps, setGaps] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const missing = (i: CountItem) => !i.photoUrl || !i.countNote;
  const groups = useMemo(() => {
    const f = filter.trim();
    const list = items.filter((i) => (!f || matchScore(f, normalize(`${i.name} ${i.category} ${i.packs.map((p) => p.sku).join(" ")}`)) != null) && (!gaps || missing(i)));
    return [...Map.groupBy(list, (i) => i.area)];
  }, [items, filter, gaps]);
  const ready = items.filter((i) => !missing(i)).length;
  const move = (id: string, dir: -1 | 1) => start(async () => { await moveCountItem(id, dir); router.refresh(); });
  const current = items.find((i) => i.id === open);
  const reorderable = !filter.trim() && !gaps;

  return (
    <div className="pb-16">
      <div className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-10 -mx-4 bg-bg/95 px-4 pb-3 backdrop-blur lg:top-0 lg:pt-2">
        <Input type="search" placeholder="Find an item or item number" aria-label="Find an item" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-11 text-base" />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <HelpZone id="count.setup.gaps"><button type="button" aria-pressed={gaps} onClick={() => setGaps((v) => !v)} className={cx("h-9 rounded-full border px-3 text-sm font-medium transition-colors", gaps ? "border-ink bg-ink text-surface" : "border-border text-ink-2")}>
            Missing a photo or note <span className="num ml-1 opacity-70">{items.length - ready}</span>
          </button></HelpZone>
          <span className="num ml-auto text-xs text-muted">{ready} of {items.length} ready</span>
          <AreasPanel areas={areas} />
        </div>
      </div>

      {groups.length === 0 && <Card className="p-5 text-center text-sm text-muted">Nothing matches.</Card>}
      {groups.map(([area, list]) => (
        <HelpZone key={area} id="count.setup.area" className="mb-6"><section>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{area} <span className="num font-normal normal-case">· {list.length}</span>{area === groups[0][0] && <HelpTip id="count.setup.order" />}</h2>
          <Card className="divide-y divide-border">
            {list.map((i, k) => (
              <div key={i.id} className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
                <button type="button" onClick={() => setOpen(i.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Set up ${i.name}`}>
                  {i.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.photoUrl} alt="" loading="lazy" className="size-11 shrink-0 rounded-lg bg-surface-2 object-cover ring-1 ring-border" />
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-lg text-muted ring-1 ring-border ring-inset" aria-hidden><ImageOff className="size-4" /></span>
                  )}
                  <span className="min-w-0">
                    <span className="line-clamp-2 block font-medium leading-tight">{i.name}</span>
                    <span className="block truncate text-xs text-muted">{packLine(i)}</span>
                    <span className="block truncate text-xs text-ink-2">
                      {i.homeAreas.length > 1 ? `Also in ${i.homeAreas.slice(1).join(", ")} · ` : ""}{i.every === "monthly" ? "Monthly · " : i.every === "changes" ? "When it changes · " : ""}Counts in {i.units[0]}{i.allowed.length ? ` · staff: ${i.allowed.join(", ")}` : ` · any of ${i.allUnits.length} units`}{!i.countNote && <span className="text-warn"> · no note</span>}
                    </span>
                  </span>
                </button>
                {reorderable && (
                  <div className="flex shrink-0 flex-col">
                    <Button size="sm" variant="ghost" className="h-8 w-10 p-0" disabled={pending || k === 0} onClick={() => move(i.id, -1)} aria-label={`Move ${i.name} up`}><ChevronUp className="size-4" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 w-10 p-0" disabled={pending || k === list.length - 1} onClick={() => move(i.id, 1)} aria-label={`Move ${i.name} down`}><ChevronDown className="size-4" /></Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </section></HelpZone>
      ))}
      <AddPrep preps={prepsOff} areas={areas.map((a) => a.name)} />
      {current && <ItemSheet item={current} manager setup areas={areas.map((a) => a.name)} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Put house-made prep items (sauces, portioned proteins) on the count. */
function AddPrep({ preps, areas }: { preps: { id: string; name: string }[]; areas: string[] }) {
  const router = useRouter();
  const [pick, setPick] = useState<string[]>([]);
  const [area, setArea] = useState(areas.find((a) => /walk|cooler|fridge/i.test(a)) ?? areas[0] ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (preps.length === 0) return null;
  return (
    <HelpZone id="count.setup.prep" className="mb-6"><section>
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Prep items not on the count <HelpTip id="count.setup.prep" /></h2>
      <Card className="p-4">
        <p className="text-sm text-muted">Count house-made sauces and portioned proteins too. Their count is valued at recipe cost and becomes the prep list&apos;s on-hand. Add containers like “1/3 pan = 30 each” in each item.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {preps.map((p) => {
            const on = pick.includes(p.id);
            return <button key={p.id} type="button" aria-pressed={on} onClick={() => setPick((v) => (on ? v.filter((x) => x !== p.id) : [...v, p.id]))} className={cx("h-9 rounded-full border px-3 text-sm transition-colors", on ? "border-ink bg-ink text-surface" : "border-border text-ink-2 hover:border-border-strong")}>{p.name}</button>;
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={area} options={areas.map((a) => ({ value: a, label: a }))} onChange={(e) => setArea(e.target.value)} className="!h-10 min-w-40 flex-1" aria-label="Area to count them in" />
          <Button variant="primary" className="h-10" disabled={pending || !pick.length || !area} onClick={() => start(async () => { const r = await addPrepToCount(pick, area); if (r.error) setError(r.error); else { setPick([]); router.refresh(); } })}>Add {pick.length || ""} to the count</Button>
        </div>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      </Card>
    </section></HelpZone>
  );
}
