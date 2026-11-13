"use client";

/**
 * A slim 2px progress line at the top of the window for slow navigations.
 * It stays hidden unless a navigation takes longer than 120ms, creeps toward
 * 85% while waiting, then completes and fades when the new route commits.
 *
 * Starts: same-origin <a> clicks (Next <Link>), and `startRouteProgress()` for
 * programmatic router.push (the command bar calls it). Ends: the pathname or
 * search params change, or a 10s safety timeout.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion";

const START = "route-progress:start";
/** Call right before router.push() so slow programmatic navigations show progress too. */
export const startRouteProgress = (href?: string) => window.dispatchEvent(new CustomEvent(START, { detail: href }));

const DELAY = 120;
/** Route handlers that answer with a file download, not a page: no progress for those. */
const FILE_ROUTES = /^\/api\/|\/(payroll|csv|image)(\/|$)|^\/invoices\/exports\/(bills|sales)|^\/my\/documents\//;
const sameUrl = (href: string) => {
  const u = new URL(href, location.href);
  return u.pathname === location.pathname && u.search === location.search;
};

function Bar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const active = useRef(false);

  const clear = () => { timers.current.forEach((t) => clearTimeout(t)); timers.current = []; };
  const set = (scale: number, opacity: number, ms = 300) => {
    const el = ref.current;
    if (!el) return;
    el.style.transitionDuration = `${ms}ms, 200ms`;
    el.style.transform = `scaleX(${scale})`;
    el.style.opacity = String(opacity);
  };

  useEffect(() => {
    const start = (href?: string) => {
      if (href && sameUrl(href)) return;
      clear();
      active.current = true;
      timers.current.push(window.setTimeout(() => {
        if (!active.current) return;
        const reduced = prefersReducedMotion();
        set(0, 1, 0);
        // Next frame: creep to 85% over a few seconds (never "done" until it is).
        requestAnimationFrame(() => requestAnimationFrame(() => set(0.85, 1, reduced ? 0 : 4000)));
      }, DELAY));
      timers.current.push(window.setTimeout(() => finish(), 10000));
    };
    const onClick = (e: MouseEvent) => {
      // Next's <Link> always preventDefaults (it navigates client-side), so that can't be the test.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (document.documentElement.hasAttribute("data-help-mode")) return; // help mode swallows clicks
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || FILE_ROUTES.test(url.pathname)) return;
      start(url.href);
    };
    const onStart = (e: Event) => start((e as CustomEvent<string | undefined>).detail);
    document.addEventListener("click", onClick, true);
    window.addEventListener(START, onStart);
    return () => { document.removeEventListener("click", onClick, true); window.removeEventListener(START, onStart); clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    if (!active.current) return;
    active.current = false;
    clear();
    const el = ref.current;
    if (!el || el.style.opacity !== "1") { set(0, 0, 0); return; }
    set(1, 1, 200);
    timers.current.push(window.setTimeout(() => set(1, 0, 200), 200));
    timers.current.push(window.setTimeout(() => set(0, 0, 0), 420));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => finish(), [pathname, params]);

  return <div ref={ref} aria-hidden className="route-progress" style={{ transform: "scaleX(0)", opacity: 0 }} />;
}

export function RouteProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
