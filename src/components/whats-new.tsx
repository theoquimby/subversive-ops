"use client";

/**
 * The What's new sheet. Mounted once in the app layout with the entries this
 * person may see (src/help/whatsNew.ts) and which are new to them. It opens:
 *  - by itself, once, after a release brings something new (a moment after the
 *    page settles, never over a tour or on setup);
 *  - from the help menu (`openWhatsNew()`), or `?whatsnew=1` (⌘K → What's new).
 * Closing it, or "Show me", marks everything shown as seen for this person.
 * A bottom sheet on phones, a centered panel from `sm` up.
 */

import clsx from "clsx";
import {
  AlarmClock,
  ArrowRight,
  Beer,
  BookOpen,
  Calculator,
  ChartLine,
  ChartNoAxesCombined,
  ChefHat,
  ClipboardCheck,
  FileScan,
  Gauge,
  Globe,
  HandCoins,
  Lightbulb,
  ListChecks,
  NotebookPen,
  PartyPopper,
  Receipt,
  Rocket,
  Settings2,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Sunrise,
  Table2,
  Tv,
  WandSparkles,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { seenWhatsNew } from "@/app/(app)/help/whats-new-actions";
import { groupByRelease } from "@/help/releases";
import { showMeHref, type WhatsNewEntry, type WhatsNewIcon } from "@/help/whatsNew";
import { areaStyle } from "@/lib/areas";
import { shortDate } from "@/lib/format";
import { useTour } from "./tour";
import { usePresence } from "./motion";
import { Button } from "./ui";

// ---- Store: open state + how many are new (the help menu shows a dot) --------------------

let state = { open: false, unseen: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const server = { open: false, unseen: 0 };

export const openWhatsNew = () => set({ open: true });
/** How many entries are new to this person (0 once they've looked). */
export const useWhatsNewUnseen = () => useSyncExternalStore(subscribe, () => state.unseen, () => server.unseen);

const ICONS: Record<WhatsNewIcon, LucideIcon> = {
  start: Rocket,
  ordering: ShoppingCart,
  deadline: AlarmClock,
  pace: Gauge,
  pnl: Receipt,
  insights: Lightbulb,
  brief: Sunrise,
  notes: NotebookPen,
  prep: ChefHat,
  keg: Beer,
  tv: Tv,
  party: PartyPopper,
  invoice: FileScan,
  draft: WandSparkles,
  tips: HandCoins,
  learn: Sparkles,
  areas: Warehouse,
  count: ClipboardCheck,
  table: Table2,
  settings: Settings2,
  quickbooks: Calculator,
  today: Smartphone,
  website: Globe,
  analytics: ChartLine,
  checklist: ListChecks,
  accounting: ChartNoAxesCombined,
};

const AUTO_KEY = "so.whatsnew.auto";
const safe = <T,>(f: () => T, fallback: T) => {
  try {
    return f();
  } catch {
    return fallback;
  }
};

export function WhatsNew({ entries, unseen }: { entries: WhatsNewEntry[]; unseen: string[] }) {
  return (
    <>
      <Sheet entries={entries} unseen={unseen} />
      <Suspense fallback={null}>
        <UrlOpen />
      </Suspense>
    </>
  );
}

/** `?whatsnew=1` on any page opens the sheet (and is taken off the URL). */
function UrlOpen() {
  const params = useSearchParams();
  const pathname = usePathname();
  useEffect(() => {
    if (!params.get("whatsnew")) return;
    const rest = new URLSearchParams(params);
    rest.delete("whatsnew");
    window.history.replaceState(null, "", `${pathname}${rest.size ? `?${rest}` : ""}`);
    openWhatsNew();
  }, [params, pathname]);
  return null;
}

function Sheet({ entries, unseen }: { entries: WhatsNewEntry[]; unseen: string[] }) {
  const open = useSyncExternalStore(subscribe, () => state.open, () => false);
  const { mounted, closing } = usePresence(open, 200);
  const router = useRouter();
  const pathname = usePathname();
  const { active: tour } = useTour();
  const tourRef = useRef(tour);
  useEffect(() => { tourRef.current = tour; }, [tour]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // What counts as "new" is fixed for as long as the sheet is up, so marks don't vanish while reading.
  const [fresh, setFresh] = useState<Set<string>>(() => new Set(unseen));
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setFresh(new Set(unseen));
    set({ unseen: unseen.length });
  }, [unseen]);

  // Once per release: open by itself a moment after the page settles. Never over a tour, help mode or setup.
  useEffect(() => {
    if (!unseen.length || pathname.startsWith("/welcome")) return;
    const sig = unseen.join(",");
    if (safe(() => sessionStorage.getItem(AUTO_KEY), null) === sig) return;
    const t = setTimeout(() => {
      if (state.open || document.documentElement.hasAttribute("data-help-mode") || tourRef.current) return;
      safe(() => sessionStorage.setItem(AUTO_KEY, sig), undefined);
      openWhatsNew();
    }, 1200);
    return () => clearTimeout(t);
    // Only on first load and when the list changes, not on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen]);

  // A tour starting (e.g. from "Show me") closes the sheet.
  useEffect(() => {
    if (tour && state.open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour]);

  function markSeen() {
    if (!state.unseen) return;
    set({ unseen: 0 });
    // Fire and forget: nothing to wait for, and never inside a transition.
    void seenWhatsNew(entries.map((e) => e.id)).catch(() => undefined);
  }

  function close() {
    set({ open: false });
    markSeen();
  }

  useEffect(() => {
    if (!open) return;
    setShowAll(false);
    requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      // Keep Tab inside the sheet.
      if (e.key === "Tab" && panelRef.current) {
        const f = Array.from(panelRef.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled])"));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const newOnes = useMemo(() => entries.filter((e) => fresh.has(e.id)), [entries, fresh]);
  const earlier = useMemo(() => entries.filter((e) => !fresh.has(e.id)), [entries, fresh]);
  // Lots new at once (a first look): show the latest few, the rest one tap away.
  const FIRST = 8;
  const shown = showAll ? entries : newOnes.length ? newOnes.slice(0, FIRST) : entries;
  const hidden = entries.length - shown.length;
  const groups = useMemo(() => groupByRelease(shown), [shown]);
  // "New" marks only mean something when some cards aren't new.
  const markNew = newOnes.length > 0 && newOnes.length < entries.length;

  if (!mounted) return null;

  const showMe = (e: WhatsNewEntry) => {
    set({ open: false });
    markSeen();
    router.push(showMeHref(e));
  };

  return (
    <div
      data-closing={closing || undefined}
      className={clsx("dialog-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center sm:p-6", closing && "pointer-events-none")}
      onMouseDown={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        data-closing={closing || undefined}
        onMouseDown={(e) => e.stopPropagation()}
        className="dialog-panel dialog-sheet flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:max-h-[min(44rem,86dvh)] sm:max-w-lg sm:rounded-2xl"
      >
        {/* Grabber on phones, so it reads as a sheet. */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong sm:hidden" />
        <header className="relative shrink-0 px-5 pt-4 pb-4 sm:px-6 sm:pt-6">
          <HeaderArt />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium tracking-wide text-muted uppercase">What&apos;s new</div>
              <h2 id="whats-new-title" className="mt-1 text-xl font-semibold tracking-tight text-balance">
                {newOnes.length ? `${newOnes.length} new ${newOnes.length === 1 ? "thing" : "things"} since you last looked` : "The latest changes"}
              </h2>
              <p className="mt-1 text-sm text-muted">Tap <span className="font-medium text-ink-2">Show me</span> and we&apos;ll take you there{entries.some((e) => e.tour) ? " — with a short tour where there is one" : ""}.</p>
            </div>
            <button ref={closeRef} type="button" onClick={close} aria-label="Close" className="-mt-1 -mr-2 grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink">
              <X className="size-5" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border px-3 pt-2 pb-4 sm:px-4">
          {groups.map(({ release, date, items }) => (
            <section key={release?.version ?? date} className="mt-2">
              <h3 className="flex items-baseline gap-2 px-2 pt-2 pb-1.5 text-xs font-medium text-muted">
                {release && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-semibold text-ink-2 tabular-nums">v{release.version}</span>}
                <span className="min-w-0 truncate">{release ? release.title : "Updates"}</span>
                <span className="ml-auto shrink-0 tabular-nums">{shortDate(date)}</span>
              </h3>
              <ul className="space-y-1.5">
                {items.map((e, i) => (
                  <li key={e.id} style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }} className="animate-rise-in">
                    <EntryCard entry={e} isNew={markNew && fresh.has(e.id)} onShowMe={() => showMe(e)} onRead={() => { set({ open: false }); markSeen(); }} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {hidden > 0 && (
            <div className="mt-4 flex justify-center">
              <Button variant="ghost" size="sm" className="h-10 sm:h-8" onClick={() => setShowAll(true)}>
                {earlier.length === hidden ? "Earlier changes" : "Show the rest"} ({hidden})
              </Button>
            </div>
          )}
          {entries.length === 0 && <p className="px-2 py-10 text-center text-sm text-muted">Nothing new right now.</p>}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <Link href="/help/releases" onClick={close} className="inline-flex h-10 items-center gap-1.5 text-sm text-muted underline-offset-2 hover:text-ink hover:underline sm:h-8">
            <BookOpen className="size-4" strokeWidth={1.75} /> All release notes
          </Link>
          <Button variant="primary" className="h-10 px-5 sm:h-9" onClick={close}>Got it</Button>
        </footer>
      </div>
    </div>
  );
}

function EntryCard({ entry: e, isNew, onShowMe, onRead }: { entry: WhatsNewEntry; isNew: boolean; onShowMe: () => void; onRead: () => void }) {
  const Icon = ICONS[e.icon];
  return (
    <div style={areaStyle(e.area)} className="group flex gap-3.5 rounded-xl p-2.5 transition-colors hover:bg-surface-2/60 sm:p-3">
      <Illustration icon={Icon} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-[0.95rem] leading-snug font-medium text-ink">{e.title}</h4>
          {isNew && <span className="shrink-0 rounded-full bg-area/12 px-1.5 py-px text-[0.68rem] font-semibold tracking-wide text-area uppercase">New</span>}
        </div>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{e.line}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0">
          <button type="button" onClick={onShowMe} className="-ml-2 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 sm:h-8">
            Show me <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
          </button>
          {e.help && !e.href.startsWith("/help/") && (
            <Link href={`/help/${e.help}`} onClick={onRead} className="inline-flex h-10 items-center rounded-lg px-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:h-8">
              Read more
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** A small tile: the area's hue in a soft gradient, a ring, the icon, and two quiet dots. */
function Illustration({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div aria-hidden className="relative mt-0.5 grid size-11 shrink-0 place-items-center rounded-[0.8rem] bg-gradient-to-br from-area/20 to-area/5 text-area ring-1 ring-area/20 ring-inset">
      <Icon className="size-[1.3rem]" strokeWidth={1.75} />
      <span className="absolute top-1.5 right-1.5 size-1 rounded-full bg-area/50" />
      <span className="absolute bottom-1.5 left-1.5 size-0.5 rounded-full bg-area/40" />
    </div>
  );
}

/** Quiet confetti of area-colored dots behind the header. Decorative. */
function HeaderArt() {
  const dots: [string, number, number, number][] = [
    ["today", 72, 24, 7],
    ["food", 84, 58, 5],
    ["floor", 66, 64, 4],
    ["numbers", 80, 16, 4],
    ["assist", 76, 84, 6],
    ["people", 60, 34, 3],
  ];
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-70 dark:opacity-60" preserveAspectRatio="none">
      {dots.map(([a, x, y, r]) => (
        <circle key={a} cx={`${x}%`} cy={`${y}%`} r={r} fill={`var(--area-${a})`} fillOpacity={0.22} />
      ))}
    </svg>
  );
}
