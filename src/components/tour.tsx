"use client";

/**
 * Guided tours.
 *
 *   startTour("menu")            // from anywhere on the client
 *   const tour = useTour();      // in a component: tour.start("menu") also wires up router navigation
 *   <TourHost />                 // mounted once (HelpProvider does it; it auto-mounts if missing)
 *
 * Steps target `[data-tour="…"]` (or a CSS selector), wait for it to appear,
 * scroll it into view and spotlight it with an animated cutout. Steps can move
 * across routes. The active tour is kept in sessionStorage so a full reload
 * resumes it; finished tours are remembered per user in localStorage.
 */

import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getTour, type Tour, type TourStep } from "@/help/tours";

// ---- Store ------------------------------------------------------------------

interface Active {
  tourId: string;
  index: number;
  /** Paths resolved from `routeFrom` steps, so Back/Next return to the same page. */
  resolved: Record<number, string>;
  dir: 1 | -1;
}

const ACTIVE_KEY = "so.tour.active";
const doneKey = (user: string) => `so.tours.done.${user}`;

let active: Active | null = null;
let user = "anon";
let navigate: ((href: string) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

function persist() {
  safe(() => (active ? sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(active)) : sessionStorage.removeItem(ACTIVE_KEY)), undefined);
}

function setActive(next: Active | null) {
  active = next;
  persist();
  emit();
}

/** Who finished tours are remembered for. Call with the signed-in user's id. */
export function setTourUser(key: string) {
  user = key || "anon";
  doneCache = null;
  emit();
}

/** How tours change pages. HelpProvider passes the Next router; otherwise full page loads. */
export function setTourNavigator(fn: ((href: string) => void) | null) {
  navigate = fn;
}

let doneCache: string[] | null = null;
function readDone(): string[] {
  if (doneCache) return doneCache;
  doneCache = safe(() => JSON.parse(localStorage.getItem(doneKey(user)) ?? "[]") as string[], []);
  return doneCache;
}

export function markTourDone(id: string) {
  const next = [...new Set([...readDone(), id])];
  doneCache = next;
  safe(() => localStorage.setItem(doneKey(user), JSON.stringify(next)), undefined);
  emit();
}

export function startTour(id: string) {
  if (!getTour(id)) return;
  setActive({ tourId: id, index: 0, resolved: {}, dir: 1 });
  ensureHost();
}

export const stopTour = () => setActive(null);

function go(delta: 1 | -1) {
  if (!active) return;
  const tour = getTour(active.tourId);
  if (!tour) return setActive(null);
  const index = active.index + delta;
  if (index >= tour.steps.length) {
    markTourDone(tour.id);
    return setActive(null);
  }
  if (index < 0) return;
  setActive({ ...active, index, dir: delta });
}

/** Resume a tour interrupted by a full page load. */
export function resumeTour() {
  if (active) return;
  const saved = safe(() => JSON.parse(sessionStorage.getItem(ACTIVE_KEY) ?? "null") as Active | null, null);
  if (saved && getTour(saved.tourId)) {
    active = saved;
    emit();
    ensureHost();
  }
}

const getActive = () => active;
const getDoneSnapshot = () => readDone();
const emptyDone: string[] = [];

export function useTour() {
  const router = useRouter();
  const current = useSyncExternalStore(subscribe, getActive, () => null);
  const done = useSyncExternalStore(subscribe, getDoneSnapshot, () => emptyDone);
  const start = useCallback(
    (id: string) => {
      if (!navigate) navigate = (href) => router.push(href);
      startTour(id);
    },
    [router],
  );
  return { active: current, start, stop: stopTour, done, isDone: (id: string) => done.includes(id) };
}

// ---- Host mounting -------------------------------------------------------------

let hosts = 0;
let autoRoot: { unmount: () => void; el: HTMLElement } | null = null;

/** If no <TourHost/> is mounted (e.g. the layout doesn't include one), mount our own. */
function ensureHost() {
  if (typeof window === "undefined") return;
  setTimeout(async () => {
    if (hosts > 0 || autoRoot || !active) return;
    const { createRoot } = await import("react-dom/client");
    if (hosts > 0 || autoRoot) return;
    const el = document.createElement("div");
    el.setAttribute("data-tour-root", "");
    document.body.appendChild(el);
    const root = createRoot(el);
    root.render(<TourHost auto />);
    autoRoot = { el, unmount: () => { root.unmount(); el.remove(); } };
  }, 50);
}

// ---- Helpers -------------------------------------------------------------------

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none";
};

function findTarget(step: TourStep): HTMLElement | null {
  const sel = step.target ? `[data-tour="${step.target}"]` : step.selector;
  if (!sel) return null;
  return (Array.from(document.querySelectorAll<HTMLElement>(sel)).find(visible) ?? null);
}

function hrefFrom(name: string): string | null {
  const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)).find(visible);
  const a = el?.closest("a") ?? el?.querySelector("a");
  if (!a) return null;
  const url = new URL(a.href, location.href);
  return url.origin === location.origin ? url.pathname + url.search : null;
}

/** The page a step should be on: its own route, its resolved routeFrom, or the previous step's. */
function pathFor(tour: Tour, index: number, resolved: Record<number, string>): string | null {
  for (let i = index; i >= 0; i--) {
    const s = tour.steps[i];
    if (s.route) return s.route;
    if (s.routeFrom && resolved[i]) return resolved[i];
  }
  return null;
}

const samePath = (want: string, here: string) => want.split("?")[0] === here;

function useMedia(query: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const set = () => setM(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, [query]);
  return m;
}

const PAD = 6;
type Box = { top: number; left: number; width: number; height: number };
const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
};
const sameBox = (a: Box | null, b: Box | null) => (a === null && b === null) || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

const RADIUS = 12;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Full-screen rectangle minus a rounded hole (fill-rule evenodd). */
function holePath(b: Box, w: number, h: number) {
  const r = Math.min(RADIUS, b.width / 2, b.height / 2);
  const { left: x, top: y, width: bw, height: bh } = b;
  return `M0 0H${w}V${h}H0Z M${x + r} ${y}H${x + bw - r}A${r} ${r} 0 0 1 ${x + bw} ${y + r}V${y + bh - r}A${r} ${r} 0 0 1 ${x + bw - r} ${y + bh}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + bh - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

/** Ease the spotlight from its last position to the new one (snaps when not animating). */
function useTween(target: Box | null, animate: boolean): Box | null {
  const [shown, setShown] = useState<Box | null>(target);
  const cur = useRef<Box | null>(target);
  useEffect(() => {
    const from = cur.current;
    if (!target || !animate || !from) {
      cur.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 380);
      const e = 1 - Math.pow(1 - k, 3);
      const b = { top: lerp(from.top, target.top, e), left: lerp(from.left, target.left, e), width: lerp(from.width, target.width, e), height: lerp(from.height, target.height, e) };
      cur.current = b;
      setShown(b);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);
  return shown;
}

// ---- Host ----------------------------------------------------------------------

export function TourHost({ auto = false }: { auto?: boolean }) {
  const current = useSyncExternalStore(subscribe, getActive, () => null);

  useEffect(() => {
    if (auto) return;
    hosts++;
    if (autoRoot) {
      const r = autoRoot;
      autoRoot = null;
      setTimeout(() => r.unmount(), 0);
    }
    return () => void hosts--;
  }, [auto]);

  if (!current) return null;
  const tour = getTour(current.tourId);
  if (!tour) return null;
  return <TourOverlay key={`${tour.id}`} tour={tour} state={current} />;
}

type Phase = "moving" | "waiting" | "shown";

function TourOverlay({ tour, state }: { tour: Tour; state: Active }) {
  const step = tour.steps[state.index];
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const phone = useMedia("(max-width: 639px)");
  // Below lg the app has bottom tabs and no sidebar (and usually no keyboard): use the touch copy.
  const touch = useMedia("(max-width: 1023px)");
  const copy = { title: (touch && step.touch?.title) || step.title, body: (touch && step.touch?.body) || step.body };
  const [phase, setPhase] = useState<Phase>("waiting");
  const [box, setBox] = useState<Box | null>(null);
  const [animate, setAnimate] = useState(false);
  const target = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const tweened = useTween(phase === "moving" ? null : box, animate && !reduced);

  const { refs, floatingStyles, update } = useFloating({
    placement: step.placement && step.placement !== "auto" ? step.placement : "bottom",
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [offset(14), flip({ padding: 12, fallbackPlacements: ["top", "right", "left", "bottom"] }), shift({ padding: 12 })],
  });

  // Resolve the page, wait for the element, scroll it into view.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    target.current = null;
    setPhase("waiting");

    // Navigate for routeFrom (first visit) or when the step lives on another page.
    let resolved = state.resolved;
    if (step.routeFrom && !resolved[state.index]) {
      const href = hrefFrom(step.routeFrom);
      if (href) {
        resolved = { ...resolved, [state.index]: href };
        // Remember it quietly (no re-render) so Back/Next come back to the same page.
        if (active && active.tourId === tour.id) {
          active = { ...active, resolved };
          persist();
        }
      }
    }
    const want = pathFor(tour, state.index, resolved);
    if (want && !samePath(want, location.pathname)) {
      setPhase("moving");
      setBox(null);
      if (navigate) navigate(want);
      else location.assign(want);
    }

    const startedAt = Date.now();
    let renavigated = false;
    const needsTarget = !!(step.target || step.selector);
    const poll = () => {
      if (cancelled) return;
      const onPage = !want || samePath(want, location.pathname);
      const el = needsTarget && onPage ? findTarget(step) : null;
      if (el) {
        target.current = el;
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const isPhone = window.matchMedia("(max-width: 639px)").matches;
        const behavior: ScrollBehavior = reduced ? "auto" : "smooth";
        if (isPhone) {
          // Keep the target in the top part of the screen; the card sits at the bottom.
          const top = Math.max(120, vh * 0.16);
          if (r.top < top - 4 || r.bottom > vh * 0.62) window.scrollBy({ top: r.top - top, behavior });
        } else if (r.top < 70 || r.bottom > vh - 24) {
          el.scrollIntoView({ block: r.height > vh * 0.6 ? "start" : "center", behavior });
        }
        setAnimate(true);
        setPhase("shown");
        timer = setTimeout(() => setAnimate(false), reduced ? 0 : 450);
        return;
      }
      if (!needsTarget && onPage) {
        setPhase("shown");
        return;
      }
      const waited = Date.now() - startedAt;
      if (!onPage && want && !renavigated && waited > 2500) {
        // A competing navigation (e.g. a URL cleanup) can swallow ours; ask once more.
        renavigated = true;
        if (navigate) navigate(want);
        else location.assign(want);
      }
      if (waited > (onPage ? 2500 : 8000)) {
        if (step.ifMissing === "skip") {
          go(state.dir);
          return;
        }
        setPhase("shown"); // centered card, no spotlight
        return;
      }
      timer = setTimeout(poll, 100);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.id, state.index]);

  // Follow the target as the page scrolls, resizes or reflows.
  useEffect(() => {
    if (phase !== "shown") return;
    let raf = 0;
    let last: Box | null | undefined = undefined;
    const tick = () => {
      const el = target.current;
      const next = el && el.isConnected ? boxOf(el) : null;
      if (last === undefined || !sameBox(last, next)) {
        last = next;
        setBox(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    if (!box) return;
    refs.setPositionReference({ getBoundingClientRect: () => ({ x: box.left, y: box.top, top: box.top, left: box.left, width: box.width, height: box.height, right: box.left + box.width, bottom: box.top + box.height }) });
    update();
  }, [box, refs, update]);

  // Keyboard: ← → to move, Esc to stop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopTour(); }
      else if (typing) return;
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Move focus into the card on each step so screen readers announce it and Enter means Next.
  useLayoutEffect(() => {
    if (phase === "shown") (nextRef.current ?? cardRef.current)?.focus({ preventScroll: true });
  }, [phase, state.index]);

  if (!mounted || typeof window === "undefined") return null;
  const spot = tweened;
  const huge = !!spot && spot.height > window.innerHeight * 0.55;
  const centered = phase === "shown" && !spot;
  const docked = phone || huge;
  const dockTop = phone && !!spot && spot.top + spot.height / 2 > window.innerHeight * 0.55;
  const last = state.index === tour.steps.length - 1;

  return createPortal(
    <div className="tour-root" aria-live="polite">
      {/* Dim + spotlight: one SVG path with an even-odd hole, tweened in JS so it animates the same in every browser. */}
      {spot ? (
        <>
          <svg className="pointer-events-none fixed inset-0 z-[70] h-full w-full" aria-hidden>
            <path fill="rgb(20 19 17 / 0.48)" fillRule="evenodd" d={holePath(spot, window.innerWidth, window.innerHeight)} />
            <rect x={spot.left} y={spot.top} width={spot.width} height={spot.height} rx={RADIUS} fill="none" stroke="rgb(255 255 255 / 0.85)" strokeWidth={2} />
          </svg>
          {/* Click blockers around the hole: the highlighted control itself stays usable. */}
          <div className="fixed inset-x-0 top-0 z-[69]" style={{ height: Math.max(0, spot.top) }} />
          <div className="fixed inset-x-0 bottom-0 z-[69]" style={{ top: spot.top + spot.height }} />
          <div className="fixed left-0 z-[69]" style={{ top: spot.top, height: spot.height, width: Math.max(0, spot.left) }} />
          <div className="fixed right-0 z-[69]" style={{ top: spot.top, height: spot.height, left: spot.left + spot.width }} />
        </>
      ) : (
        <div className={clsx("fixed inset-0 z-[69] bg-[rgb(20_19_17/0.48)]", !reduced && "animate-[tour-fade_200ms_ease-out]")} />
      )}

      {phase === "shown" && (
        <div
          ref={(el) => {
            cardRef.current = el;
            if (!docked && !centered) refs.setFloating(el);
          }}
          role="dialog"
          aria-modal="false"
          aria-label={`${tour.title} tour, step ${state.index + 1} of ${tour.steps.length}: ${copy.title}`}
          tabIndex={-1}
          style={!docked && !centered ? floatingStyles : undefined}
          className={clsx(
            "z-[71] rounded-2xl border border-border bg-surface p-4 text-ink shadow-2xl outline-none sm:p-5",
            !reduced && "animate-[tour-pop_240ms_var(--motion-out)_both]",
            centered && "fixed top-1/2 left-1/2 w-[min(26rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2",
            docked && !centered && (phone ? clsx("fixed inset-x-3", dockTop ? "top-3" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]") : "fixed right-6 bottom-6 w-[22rem]"),
            !docked && !centered && "w-[22rem] max-w-[calc(100vw-24px)]",
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5" aria-hidden>
              {tour.steps.map((_, i) => (
                <span key={i} className={clsx("h-1.5 rounded-full transition-[width,background-color] duration-260 ease-motion", i === state.index ? "w-4 bg-ink" : i < state.index ? "w-1.5 bg-ink-2/60" : "w-1.5 bg-border-strong")} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="num text-xs text-muted">{state.index + 1} / {tour.steps.length}</span>
              <button type="button" onClick={stopTour} className="-m-1.5 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close tour">
                <X className="size-4" />
              </button>
            </div>
          </div>
          <h2 className="text-[0.95rem] font-semibold tracking-tight">{copy.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{copy.body}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              {!last && (
                <button type="button" onClick={stopTour} className="text-sm text-muted hover:text-ink">Skip</button>
              )}
              {step.helpId && (
                <Link href={`/help/${step.helpId}`} onClick={stopTour} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">Learn more</Link>
              )}
            </div>
            <div className="flex items-center gap-2">
              {state.index > 0 && (
                <button type="button" onClick={() => go(-1)} className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm font-medium transition-[background-color,transform] duration-120 hover:bg-surface-2 active:scale-[0.98]">Back</button>
              )}
              <button ref={nextRef} type="button" onClick={() => go(1)} className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-ink transition-[opacity,transform] duration-120 hover:opacity-90 active:scale-[0.98]">
                {last ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes tour-fade{from{opacity:0}to{opacity:1}}@keyframes tour-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}`}</style>
    </div>,
    document.body,
  );
}
