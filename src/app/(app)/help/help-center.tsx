"use client";

import { HelpZone, toggleHelpMode } from "@/components/help";
import { setTourUser, useTour } from "@/components/tour";
import { Badge, Button, Card, cx, PageHeader } from "@/components/ui";
import { AREAS, helpFor, searchHelp, type HelpEntry } from "@/help/content";
import { toursFor } from "@/help/tours";
import { Check, Command, MousePointerClick, Play, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export function HelpCenter({ userId, role, initialQuery, autoTour }: { userId: string; role: "MANAGER" | "STAFF"; initialQuery: string; autoTour?: string }) {
  const router = useRouter();
  const { start, isDone } = useTour();
  const [q, setQ] = useState(initialQuery);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => helpFor(role), [role]);
  const tours = toursFor(role);
  const results = useMemo(() => (q.trim() ? searchHelp(q, entries, 40) : []), [q, entries]);
  const areaTitle = useMemo(() => new Map(AREAS.map((a) => [a.id, a.title])), []);

  useEffect(() => setTourUser(userId), [userId]);

  // /help?tour=menu starts that tour (used by command bar entries).
  useEffect(() => {
    if (!autoTour) return;
    window.history.replaceState(null, "", "/help");
    // Only tours this role can take (staff never get dropped into manager pages).
    if (tours.some((t) => t.id === autoTour)) start(autoTour);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTour]);

  // Keep ?q= in the URL so a search can be shared or survive Back.
  useEffect(() => {
    const t = setTimeout(() => {
      const url = q.trim() ? `/help?q=${encodeURIComponent(q.trim())}` : "/help";
      window.history.replaceState(null, "", url);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const byArea = useMemo(() => {
    const m = new Map<string, HelpEntry[]>();
    for (const e of entries) m.set(e.area, [...(m.get(e.area) ?? []), e]);
    return m;
  }, [entries]);
  const current = AREAS.filter((a) => !a.upcoming && byArea.has(a.id));
  const upcoming = AREAS.filter((a) => a.upcoming && byArea.has(a.id));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader help="help.center" title="Help" description="Plain-English answers about every page, and short tours that show you around." />

      <HelpZone id="help.search" className="relative mb-10">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" strokeWidth={1.75} />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && results[0]) router.push(`/help/${results[0].id}`); }}
          placeholder="Search help — try “yield”, “paste”, “on hand”, “overtime”"
          aria-label="Search help"
          className="h-13 w-full rounded-xl border border-border-strong bg-surface pr-4 pl-12 text-base text-ink shadow-sm placeholder:text-muted/80 focus:border-ink-2 focus:outline-none"
        />
      </HelpZone>

      {q.trim() ? (
        results.length === 0 ? (
          <Card className="px-6 py-14 text-center">
            <div className="text-[0.95rem] font-medium">Nothing matches “{q.trim()}”</div>
            <p className="mt-1.5 text-sm text-muted">Try a shorter word, or browse the areas below.</p>
            <Button className="mt-5" onClick={() => setQ("")}>Clear search</Button>
          </Card>
        ) : (
          <HelpZone id="help.results"><Card className="divide-y divide-border">
            {results.map((e) => (
              <Link key={e.id} href={`/help/${e.id}`} className="block px-5 py-4 transition-colors hover:bg-surface-2/60">
                <div className="flex items-center gap-2">
                  <span className="text-[0.95rem] font-medium text-ink">{e.title}</span>
                  {e.draft && <Badge>Coming soon</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">{areaTitle.get(e.area)}</div>
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-2">{e.body}</p>
              </Link>
            ))}
          </Card></HelpZone>
        )
      ) : (
        <>
          <HelpZone id="app.tours" className="mb-12"><section>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[0.95rem] font-semibold">Guided tours</h2>
                <p className="mt-0.5 text-sm text-muted">A minute or two each. The app points at each part and explains it.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tours.map((t) => (
                <Card key={t.id} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold">{t.title}</div>
                    {isDone(t.id) && <span className="flex items-center gap-1 text-xs text-good"><Check className="size-3.5" strokeWidth={2.5} />Taken</span>}
                  </div>
                  <p className="mt-1 flex-1 text-sm leading-relaxed text-muted">{t.description}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="num text-xs text-muted">{t.steps.length} steps · ~{t.minutes} min</span>
                    <Button size="sm" variant={isDone(t.id) ? "secondary" : "primary"} onClick={() => start(t.id)}>
                      <Play className="size-3.5" strokeWidth={2} />
                      {isDone(t.id) ? "Again" : "Start"}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </section></HelpZone>

          <HelpZone id="help.shortcuts" className="mb-12"><section className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={toggleHelpMode} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5 text-left transition-colors hover:border-border-strong">
              <MousePointerClick className="mt-0.5 size-5 shrink-0 text-ink-2" strokeWidth={1.75} />
              <span>
                <span className="block text-sm font-semibold">Help mode <kbd className="ml-1 rounded border border-border px-1.5 text-[11px] font-normal text-muted">?</kbd></span>
                <span className="mt-1 block text-sm leading-relaxed text-muted">Point at any section of any page to see what it does. Press ? again to turn it off.</span>
              </span>
            </button>
            <Link href="/help/app.commandBar" className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
              <Command className="mt-0.5 size-5 shrink-0 text-ink-2" strokeWidth={1.75} />
              <span>
                <span className="block text-sm font-semibold">Jump anywhere <kbd className="ml-1 rounded border border-border px-1.5 text-[11px] font-normal text-muted">⌘K</kbd></span>
                <span className="mt-1 block text-sm leading-relaxed text-muted">Search any recipe, ingredient or supplier, or start a task, from any page.</span>
              </span>
            </Link>
          </section></HelpZone>

          <HelpZone id="help.browse"><AreaGrid areas={current} byArea={byArea} expanded={expanded} setExpanded={setExpanded} /></HelpZone>

          {upcoming.length > 0 && (
            <section className="mt-14">
              <div className="mb-4 border-t border-border pt-8">
                <h2 className="text-[0.95rem] font-semibold">Coming soon</h2>
                <p className="mt-0.5 text-sm text-muted">Early notes on pages being built now — team, scheduling, labor, P&L and more. They'll be refined as each one ships.</p>
              </div>
              <AreaGrid areas={upcoming} byArea={byArea} expanded={expanded} setExpanded={setExpanded} muted />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AreaGrid({ areas, byArea, expanded, setExpanded, muted }: { areas: typeof AREAS; byArea: Map<string, HelpEntry[]>; expanded: Record<string, boolean>; setExpanded: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void; muted?: boolean }) {
  return (
    <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {areas.map((a) => {
        const list = byArea.get(a.id) ?? [];
        const open = expanded[a.id];
        const shown = open ? list : list.slice(0, 6);
        return (
          <section key={a.id} id={`area-${a.id}`}>
            <h3 className={cx("text-sm font-semibold", muted ? "text-ink-2" : "text-ink")}>{a.title}</h3>
            <p className="mt-0.5 text-[0.8rem] text-muted">{a.description}</p>
            <ul className="mt-3 space-y-0.5">
              {shown.map((e) => (
                <li key={e.id}>
                  <Link href={`/help/${e.id}`} className="-mx-2 block rounded-md px-2 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                    {e.title}
                  </Link>
                </li>
              ))}
            </ul>
            {list.length > 6 && (
              <button type="button" onClick={() => setExpanded((s) => ({ ...s, [a.id]: !open }))} className="relative mt-1 text-[0.8rem] text-muted after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-ink">
                {open ? "Show fewer" : `Show all ${list.length}`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
