"use client";

/**
 * Contextual help.
 *
 *   <HelpTip id="ordering.builder.onHand" />      a quiet "?" — hover (desktop) or tap (touch)
 *   <HelpZone id="menu.list" tour="menu.table">…  explains a whole section when help mode is on
 *   <HelpProvider userId={…} />                   once, in the app layout: "?" key, help-mode bar,
 *                                                 tour host, ?help=1 / ?tour=<id> URL commands
 *   <HelpButton />                                a help menu for the nav (help mode, tour, help center)
 *
 * Content comes from src/help/content.ts. Unknown ids render nothing.
 * Everything works without HelpProvider too (it mounts a minimal runtime on
 * first use), but the provider gives tours client-side navigation.
 */

import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
  type Placement,
} from "@floating-ui/react";
import { popoverTransition, useReducedMotion } from "./motion";
import clsx from "clsx";
import { BookOpen, CircleHelp, MousePointerClick, Route as RouteIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getHelp, helpForPath, type HelpEntry } from "@/help/content";
import { tourForPath } from "@/help/tours";
import { resumeTour, setTourNavigator, setTourUser, startTour, TourHost, useTour } from "./tour";

// ---- Help mode store ---------------------------------------------------------------

interface ModeState {
  on: boolean;
  /** The HelpZone instance currently explained (hovered, focused or tapped). */
  zone: string | null;
}

let mode: ModeState = { on: false, zone: null };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const setMode = (patch: Partial<ModeState>) => {
  mode = { ...mode, ...patch };
  listeners.forEach((l) => l());
};
const getMode = () => mode;
const offMode: ModeState = { on: false, zone: null };

export const setHelpMode = (on: boolean) => setMode({ on, zone: null });
export const toggleHelpMode = () => setHelpMode(!mode.on);
export const useHelpMode = () => useSyncExternalStore(subscribe, getMode, () => offMode).on;
const useModeState = () => useSyncExternalStore(subscribe, getMode, () => offMode);

// ---- Runtime (keys, bar, tour host) ----------------------------------------------------

let runtimes = 0;
let autoRuntime: { unmount: () => void } | null = null;

/** Mount a minimal runtime if the layout doesn't render <HelpProvider/>. */
function ensureRuntime() {
  if (typeof window === "undefined") return;
  setTimeout(async () => {
    if (runtimes > 0 || autoRuntime) return;
    const { createRoot } = await import("react-dom/client");
    if (runtimes > 0 || autoRuntime) return;
    const el = document.createElement("div");
    el.setAttribute("data-help-root", "");
    document.body.appendChild(el);
    const root = createRoot(el);
    root.render(<HelpRuntime />);
    autoRuntime = { unmount: () => { root.unmount(); el.remove(); } };
  }, 0);
}

function HelpRuntime() {
  const { on } = useModeState();
  const pathname = usePathname();
  // Pages without outlined sections still get help: the bar offers "About this page".
  const [zoneCount, setZoneCount] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  useEffect(() => {
    if (!on) { setAboutOpen(false); return; }
    const count = () => setZoneCount(document.querySelectorAll("[data-help-zone]").length);
    count();
    const t = setTimeout(count, 400); // sections can mount a moment later
    return () => clearTimeout(t);
  }, [on, pathname]);
  const pageHelp = on ? helpForPath(pathname) : [];

  useEffect(() => {
    runtimes++;
    resumeTour();
    return () => void runtimes--;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleHelpMode();
      } else if (e.key === "Escape" && mode.on) {
        if (mode.zone) setMode({ zone: null });
        else setHelpMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-help-mode", on);
  }, [on]);

  return (
    <>
      <TourHost />
      {on && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(3.25rem+env(safe-area-inset-top)+0.5rem)] z-[65] flex flex-col-reverse items-center gap-2 px-3 lg:top-4">
          {aboutOpen && pageHelp.length > 0 && (
            <div className="pointer-events-auto max-h-[50dvh] w-full max-w-md origin-bottom animate-scale-in overflow-y-auto rounded-xl border border-border bg-surface p-3.5 shadow-xl">
              {pageHelp.slice(0, 4).map((e, i) => (
                <div key={e.id} className={i ? "mt-3 border-t border-border pt-3" : ""}>
                  <HelpCard entry={e} onNavigate={() => setHelpMode(false)} />
                </div>
              ))}
            </div>
          )}
          <div role="status" className="pointer-events-auto flex animate-rise-in items-center gap-2 rounded-full border border-border bg-ink py-1.5 pr-1.5 pl-4 text-sm text-bg shadow-xl">
            <MousePointerClick className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
            <span>
              {zoneCount === 0 ? "Help mode" : <><span className="hidden sm:inline">Help mode — point at any outlined section</span><span className="sm:hidden">Tap any outlined section</span></>}
            </span>
            {pageHelp.length > 0 && (
              <button type="button" onClick={() => setAboutOpen((o) => !o)} aria-expanded={aboutOpen} className="h-8 rounded-full bg-bg/15 px-3 text-sm font-medium hover:bg-bg/25">
                {aboutOpen ? "Hide" : "About this page"}
              </button>
            )}
            <button type="button" onClick={() => setHelpMode(false)} className="h-8 rounded-full bg-bg/15 px-3 text-sm font-medium hover:bg-bg/25">Done</button>
          </div>
        </div>
      )}
    </>
  );
}

function UrlCommands() {
  const params = useSearchParams();
  const pathname = usePathname();
  useEffect(() => {
    const help = params.get("help");
    // /help?tour= is handled by the help center, which only starts tours the user's role may take.
    const tour = pathname === "/help" ? null : params.get("tour");
    if (!help && !tour) return;
    if (help) setHelpMode(help !== "0");
    const rest = new URLSearchParams(params);
    rest.delete("help");
    if (tour) rest.delete("tour");
    // Strip the command from the URL without a navigation (which would race the tour's own).
    window.history.replaceState(null, "", `${pathname}${rest.size ? `?${rest}` : ""}`);
    if (tour) startTour(tour);
  }, [params, pathname]);
  return null;
}

/**
 * Put once in the app layout. `userId` keys "tours finished" per person.
 * Handles the "?" key, the help-mode bar, the tour overlay, and the URL
 * commands `?help=1` (help mode on) and `?tour=<id>` (start a tour) on any page.
 */
export function HelpProvider({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    setTourUser(userId);
    setTourNavigator((href) => router.push(href));
    if (autoRuntime) {
      const r = autoRuntime;
      autoRuntime = null;
      setTimeout(() => r.unmount(), 0);
    }
    return () => setTourNavigator(null);
  }, [userId, router]);
  return (
    <>
      <HelpRuntime />
      <Suspense fallback={null}>
        <UrlCommands />
      </Suspense>
    </>
  );
}

// ---- Popover content ------------------------------------------------------------

function HelpCard({ entry, onNavigate }: { entry: HelpEntry; onNavigate?: () => void }) {
  return (
    <>
      <div className="text-[0.85rem] font-semibold text-ink">{entry.title}</div>
      <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-2">{entry.body}</p>
      <Link href={`/help/${entry.id}`} onClick={onNavigate} className="mt-2.5 inline-flex items-center gap-1 text-[0.8rem] font-medium text-ink underline-offset-2 hover:underline">
        Learn more <span aria-hidden>→</span>
      </Link>
    </>
  );
}

const popoverClass = "z-[66] w-72 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-surface p-3.5 text-left shadow-xl";

// ---- HelpTip ----------------------------------------------------------------------

/** A small "?" next to a label. Hover or focus shows the help; tap toggles it on touch. Esc closes. */
export function HelpTip({ id, placement = "top", className, label }: { id: string; placement?: Placement; className?: string; label?: string }) {
  const entry = getHelp(id);
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowRef })],
  });
  const reduced = useReducedMotion();
  const { isMounted, styles: motion } = useTransitionStyles(context, popoverTransition(reduced));
  const hover = useHover(context, { mouseOnly: true, delay: { open: 120, close: 80 }, handleClose: safePolygon() });
  const focus = useFocus(context);
  const click = useClick(context, { ignoreMouse: true });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role]);

  useEffect(() => ensureRuntime(), []);
  if (!entry) {
    if (process.env.NODE_ENV !== "production") console.warn(`HelpTip: no help entry "${id}"`);
    return null;
  }

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        aria-label={label ?? `Help: ${entry.title}`}
        className={clsx(
          "relative inline-grid size-4 shrink-0 place-items-center rounded-full align-[-0.15em] text-muted/80 transition-colors hover:text-ink focus-visible:text-ink",
          "after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']", // 40px-tall touch target; narrower sideways so it never widens a table
          open && "text-ink",
          className,
        )}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
      >
        <CircleHelp className="size-4" strokeWidth={1.75} />
      </button>
      {isMounted && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={{ ...floatingStyles, ...motion }} className={popoverClass} {...getFloatingProps()}>
            <FloatingArrow ref={arrowRef} context={context} className="fill-surface [&>path:first-of-type]:stroke-border" strokeWidth={1} />
            <HelpCard entry={entry} onNavigate={() => setOpen(false)} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

// ---- HelpZone --------------------------------------------------------------------

/**
 * Wraps a section. Normally invisible (just a div). In help mode it gets a
 * faint outline; hovering, focusing or tapping it shows its help, and taps
 * inside are swallowed so exploring never presses a button.
 * `tour` also sets `data-tour` so tours can target the same element.
 */
export function HelpZone({ id, tour, className, children }: { id: string; tour?: string; className?: string; children: ReactNode }) {
  const entry = getHelp(id);
  const key = useId();
  const { on, zone } = useModeState();
  const active = on && zone === key;
  const { refs, floatingStyles, context } = useFloating({
    open: active,
    onOpenChange: (o) => setMode({ zone: o ? key : null }),
    placement: "top-start",
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip({ padding: 8, fallbackPlacements: ["bottom-start", "top-end", "bottom-end"] }), shift({ padding: 8, crossAxis: true })],
  });
  const reduced = useReducedMotion();
  const { isMounted, styles: motion } = useTransitionStyles(context, popoverTransition(reduced));
  const dismiss = useDismiss(context, { enabled: active, outsidePress: (e) => !(e.target as Element)?.closest?.("[data-help-zone]") });
  const { getFloatingProps } = useInteractions([dismiss]);

  useEffect(() => ensureRuntime(), []);
  const helpable = on && !!entry;

  return (
    <div
      ref={refs.setReference}
      data-help-zone={id}
      data-tour={tour}
      tabIndex={helpable ? 0 : undefined}
      aria-describedby={active ? `${key}-help` : undefined}
      className={clsx(
        className,
        helpable && "relative rounded-xl outline-1 outline-offset-4 transition-[outline-color,background-color] duration-150",
        helpable && (active ? "bg-focus/[0.06] outline-2 outline-focus outline-solid" : "bg-focus/[0.025] outline-[1.5px] outline-focus/70 outline-dashed hover:bg-focus/[0.05]"),
      )}
      onPointerOver={helpable ? (e) => { if (e.pointerType === "mouse") { e.stopPropagation(); if (mode.zone !== key) setMode({ zone: key }); } } : undefined}
      onPointerLeave={helpable ? (e) => { if (e.pointerType === "mouse" && mode.zone === key) setMode({ zone: null }); } : undefined}
      onFocus={helpable ? (e) => { if (e.target === e.currentTarget) setMode({ zone: key }); } : undefined}
      onClickCapture={helpable ? (e) => {
        if (refs.floating.current?.contains(e.target as Node)) return; // "Learn more" inside the popover
        // A tap inside a nested zone belongs to that inner zone (its own capture handler runs next).
        if ((e.target as Element).closest?.("[data-help-zone]") !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        setMode({ zone: key });
      } : undefined}
    >
      {children}
      {isMounted && entry && (
        <FloatingPortal>
          <div ref={refs.setFloating} id={`${key}-help`} role="tooltip" style={{ ...floatingStyles, ...motion }} className={clsx(popoverClass, !active && "pointer-events-none")} {...getFloatingProps()}>
            <HelpCard entry={entry} onNavigate={() => setHelpMode(false)} />
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

// ---- HelpButton (for the nav / command bar area) ------------------------------------------

/** A quiet help menu: help mode, a tour of this page, the help center. */
export function HelpButton({ className, compact }: { className?: string; compact?: boolean }) {
  const pathname = usePathname();
  const tour = tourForPath(pathname);
  const { start } = useTour();
  const on = useHelpMode();
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: setOpen, placement: "bottom-start", transform: false, whileElementsMounted: autoUpdate, middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })] });
  const reduced = useReducedMotion();
  const { isMounted, styles: motion } = useTransitionStyles(context, popoverTransition(reduced));
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);
  useEffect(() => ensureRuntime(), []);

  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-2 transition-colors duration-75 hover:bg-surface-2 hover:text-ink";
  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        aria-label="Help"
        className={clsx(compact ? "rounded-md p-2.5 text-ink-2 hover:text-ink" : "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-surface-2/70 hover:text-ink", on && "text-focus", className)}
        {...getReferenceProps()}
      >
        <CircleHelp className={compact ? "size-5" : "size-4 opacity-80"} strokeWidth={1.75} />
        {!compact && "Help"}
      </button>
      {isMounted && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={{ ...floatingStyles, ...motion }} className="z-[66] w-64 rounded-xl border border-border bg-surface p-1.5 shadow-xl" {...getFloatingProps()}>
            <button type="button" role="menuitem" className={item} onClick={() => { toggleHelpMode(); setOpen(false); }}>
              <MousePointerClick className="size-4" strokeWidth={1.75} />
              <span className="flex-1">{on ? "Turn off help mode" : "Help mode"}</span>
              <kbd className="rounded border border-border px-1 text-[10px] text-muted">?</kbd>
            </button>
            {tour && (
              <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); start(tour.id); }}>
                <RouteIcon className="size-4" strokeWidth={1.75} />
                <span className="flex-1">Tour this page</span>
              </button>
            )}
            <Link role="menuitem" href="/help" className={item} onClick={() => setOpen(false)}>
              <BookOpen className="size-4" strokeWidth={1.75} />
              <span className="flex-1">Help center</span>
            </Link>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
