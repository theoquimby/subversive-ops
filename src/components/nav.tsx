"use client";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarCheck, CalendarRange, ChefHat, ChevronRight, CircleHelp, ClipboardList, Home, LayoutGrid, LogOut, MoreHorizontal, ScanLine, Search, ShoppingCart, Sun, X } from "lucide-react";
import { activeChild, areaFor, areaStyle, isActive, MANAGER_NAV, STAFF_NAV, type Area, type NavGroup, type NavItem as AreaNavItem } from "@/lib/areas";
import { openCommandPalette } from "./command-palette";
import { HelpButton } from "./help";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionRole } from "@/server/session";

type NavItem = { href: string; label: string; icon: typeof LayoutGrid; area: Area };
type Group = NavGroup;

const OPEN_KEY = "nav.open.v1";

/**
 * Which pop-open lists are open. A list opens by itself while you're inside
 * its area; opening or closing one by hand is remembered on this device.
 */
function useOpenLists() {
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
      if (v && typeof v === "object") setChosen(v as Record<string, boolean>);
    } catch { /* nothing saved */ }
  }, []);
  const toggle = (href: string, open: boolean) =>
    setChosen((cur) => {
      const next = { ...cur, [href]: open };
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  return { chosen, toggle };
}

/** One sidebar row. An item with pages of its own gets a chevron and, when open, its pages listed beneath it. */
function SideItem({ item, pathname, open, onToggle }: { item: AreaNavItem; pathname: string; open: boolean; onToggle: (open: boolean) => void }) {
  const { href, label, icon: Icon, area, children } = item;
  const active = isActive(pathname, href);
  const child = active && children ? activeChild(pathname, children) : null;
  // The sliding highlight sits on the most specific visible link: the sub-page when the list is open.
  const onChild = open && !!child;
  return (
    <div style={areaStyle(area)}>
      <div className="relative z-[1] flex items-center">
        <Link
          href={href}
          aria-current={active && !onChild ? "page" : undefined}
          className={clsx("flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-120 ease-motion", children && "pr-8", active ? "font-medium text-ink" : "text-ink-2 hover:bg-surface-2/70 hover:text-ink")}
        >
          <Icon className={clsx("size-4 shrink-0 text-area transition-opacity duration-120", active ? "opacity-100" : "opacity-70")} strokeWidth={active ? 2 : 1.75} />
          <span className="truncate">{label}</span>
        </Link>
        {children && (
          <button type="button" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${label} pages`} onClick={() => onToggle(!open)} className="absolute right-0 grid size-8 place-items-center rounded-lg text-muted transition-colors duration-120 hover:text-ink">
            <ChevronRight className={clsx("size-3.5 transition-transform duration-180 ease-motion", open && "rotate-90")} strokeWidth={2} />
          </button>
        )}
      </div>
      {children && open && (
        <div className="relative z-[1] mt-px mb-1 ml-[1.1rem] flex flex-col gap-px border-l border-border pl-2">
          {children.map((c) => {
            const on = child === c.href;
            return (
              <Link key={c.href} href={c.href} aria-current={on ? "page" : undefined} style={areaStyle(area)} className={clsx("flex h-7 items-center gap-2 rounded-md px-2 text-[0.8125rem] transition-colors duration-120 ease-motion", on ? "font-medium text-ink" : "text-ink-2 hover:bg-surface-2/70 hover:text-ink")}>
                <c.icon className={clsx("size-3.5 shrink-0 text-area transition-opacity duration-120", on ? "opacity-100" : "opacity-60")} strokeWidth={on ? 2 : 1.75} />
                <span className="truncate">{c.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Nav({ role, name, logout }: { role: SessionRole; name: string; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const groups = role === "MANAGER" ? MANAGER_NAV : STAFF_NAV;
  const { chosen, toggle } = useOpenLists();
  const isOpen = (href: string) => chosen[href] ?? isActive(pathname, href);
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
        <Brand />
        <button onClick={openCommandPalette} className="mt-6 flex h-9 items-center gap-2.5 rounded-lg border border-border px-2.5 text-sm text-muted transition-colors duration-120 hover:border-border-strong hover:text-ink">
          <Search className="size-4" strokeWidth={1.75} />
          Search or jump to…
          <kbd className="ml-auto rounded border border-border px-1 text-[10px]">⌘K</kbd>
        </button>
        <SidebarScroll pathname={pathname} layoutKey={groups.flatMap((g) => g.items).filter((i) => i.children && isOpen(i.href)).map((i) => i.href).join("|")}>
          {groups.map((g, gi) => (
            <div key={gi} className="flex flex-col gap-px">
              {g.title && <div className="px-2.5 pt-1 pb-1 text-[11px] font-medium text-muted">{g.title}</div>}
              {g.items.map((it) => <SideItem key={it.href} item={it} pathname={pathname} open={!!it.children && isOpen(it.href)} onToggle={(o) => toggle(it.href, o)} />)}
            </div>
          ))}
        </SidebarScroll>
        <HelpButton className="mb-2" />
        <div className="flex items-center justify-between border-t border-border px-2.5 pt-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="text-xs text-muted">{role === "MANAGER" ? "Manager" : "Staff"}</div>
          </div>
          <form action={logout}>
            <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" title="Sign out">
              <LogOut className="size-4" strokeWidth={1.75} />
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile: slim top bar + bottom tab bar + "More" sheet */}
      <MobileNav role={role} name={name} groups={groups} logout={logout} pathname={pathname} />
    </>
  );
}

/**
 * Scrollable page list with a soft fade at the bottom while more items are
 * below the fold. The active item's tinted background is one element that
 * slides between items (260ms, sheet easing) instead of blinking.
 */
function SidebarScroll({ children, pathname, layoutKey }: { children: React.ReactNode; pathname: string; layoutKey: string }) {
  const ref = useRef<HTMLElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, []);
  useLayoutEffect(() => {
    const nav = ref.current, p = pill.current;
    if (!nav || !p) return;
    const a = nav.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!a) { p.style.opacity = "0"; return; }
    // First placement (and coming back from "no active item") jumps; after that it slides.
    const slide = placed.current && p.style.opacity === "1";
    p.style.transition = slide ? "" : "none";
    p.style.transform = `translateY(${a.offsetTop}px)`;
    p.style.height = `${a.offsetHeight}px`;
    p.style.setProperty("--area", a.style.getPropertyValue("--area"));
    p.style.opacity = "1";
    if (!placed.current) {
      // Land with the active page in view (it can sit below the fold, e.g. P&L).
      const top = a.offsetTop, bottom = top + a.offsetHeight;
      if (bottom > nav.scrollTop + nav.clientHeight - 40 || top < nav.scrollTop) nav.scrollTop = top - nav.clientHeight / 2;
    }
    placed.current = true;
    // layoutKey: a list popping open or shut moves every row below it.
  }, [pathname, layoutKey]);
  return (
    <div className="relative mt-3 -mx-1 flex min-h-0 flex-1 flex-col">
      <nav ref={ref} aria-label="Pages" className="scroll-quiet relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2">
        <div ref={pill} aria-hidden className="pointer-events-none absolute inset-x-1 top-0 rounded-lg bg-area/10 opacity-0 transition-[transform,background-color,opacity] duration-260 ease-sheet" />
        {children}
      </nav>
      <div aria-hidden className={clsx("pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent transition-opacity duration-200", more ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

/** On a phone: the pages inside any area on this row that has its own, as a wrap of chips under the tiles. */
function SubPages({ items, pathname }: { items: AreaNavItem[]; pathname: string }) {
  const withPages = items.filter((i) => i.children);
  if (!withPages.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {withPages.map((i) => {
        const on = isActive(pathname, i.href) ? activeChild(pathname, i.children!) : null;
        return (
          <div key={i.href} style={areaStyle(i.area)} className="rounded-2xl border border-border bg-surface px-3 py-2.5">
            <div className="mb-1.5 text-[11px] font-semibold text-muted">{i.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {i.children!.map((c) => (
                <Link key={c.href} href={c.href} aria-current={on === c.href ? "page" : undefined} className={clsx("inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-[0.8rem] font-medium active:scale-[0.97]", on === c.href ? "border-area/35 bg-area/10 text-ink" : "border-border text-ink-2 active:bg-surface-2")}>
                  <c.icon className="size-3.5 text-area" strokeWidth={1.9} />
                  {c.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2.5">
      <BrandMark />
      <span className="text-[0.95rem] font-semibold tracking-tight">Subversive Ops</span>
    </Link>
  );
}

/** The "S" mark with a warm ember gradient — the one decorative accent in the chrome. */
function BrandMark() {
  return (
    <span className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-[linear-gradient(140deg,#f59e42_0%,#e2553f_55%,#c2367a_100%)] text-[0.8rem] font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]">
      S
    </span>
  );
}

// ---- Mobile ---------------------------------------------------------------------


// The four things done most on a phone get a tab; everything else lives in More.
const MANAGER_TABS: NavItem[] = [
  { href: "/", label: "Home", icon: Home, area: "today" },
  { href: "/ordering", label: "Ordering", icon: ShoppingCart, area: "food" },
  { href: "/count", label: "Count", icon: ClipboardList, area: "floor" },
  { href: "/schedule", label: "Schedule", icon: CalendarRange, area: "people" },
];
// Staff: their day, their shifts, and the two floor tools used every shift.
// Count, waste, kegs, notes and Me are one tap away on Today's quick actions
// and in More (as big tiles, so More is never a dead end).
const STAFF_TABS: NavItem[] = [
  { href: "/my", label: "Today", icon: Sun, area: "people" },
  { href: "/my/shifts", label: "Shifts", icon: CalendarCheck, area: "people" },
  { href: "/kegs/scan", label: "Scan", icon: ScanLine, area: "floor" },
  { href: "/prep", label: "Prep", icon: ChefHat, area: "floor" },
];

/** A tab is lit on its own page (and sub-pages); Scan also stays lit on /kegs/k/… — the keg you just scanned. */
const isTabActive = (pathname: string, href: string) => isActive(pathname, href) || (href === "/kegs/scan" && pathname.startsWith("/kegs/k/"));

function MobileNav({ role, name, groups, logout, pathname }: { role: SessionRole; name: string; groups: Group[]; logout: () => Promise<void>; pathname: string }) {
  const [open, setOpen] = useState(false);
  const tabs = role === "MANAGER" ? MANAGER_TABS : STAFF_TABS;
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => isActive(pathname, i.href)) ?? (pathname.startsWith("/help") ? { label: "Help" } : null);
  const cols = tabs.length + 1;
  // Most specific tab wins (/my/shifts lights Shifts, not Today).
  const activeTab = tabs.reduce((best, t, i) => (isTabActive(pathname, t.href) && (best < 0 || t.href.length > tabs[best].href.length) ? i : best), -1);
  const pillIndex = open || activeTab < 0 ? tabs.length : activeTab;
  const pillArea: Area = pillIndex < tabs.length ? tabs[pillIndex].area : areaFor(pathname);

  // Close the sheet on navigation; lock page scroll while it's open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
        <div className="flex h-13 items-center justify-between gap-2 pr-1.5 pl-2">
          <Link href={role === "MANAGER" ? "/" : "/my"} className="flex min-w-0 items-center gap-2.5 px-2" aria-label="Home">
            <BrandMark />
            <span className="truncate text-[0.95rem] font-semibold tracking-tight">{current?.label ?? "Subversive Ops"}</span>
          </Link>
          <div className="flex shrink-0 items-center">
            <HelpButton compact />
            <button onClick={openCommandPalette} className="grid size-11 place-items-center rounded-full text-ink-2 active:bg-surface-2" aria-label="Search">
              <Search className="size-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>

      {/* Bottom tab bar. One tinted pill slides between tabs (and onto More while the sheet is open). */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Main">
        <div className={clsx("relative grid h-[3.75rem]", cols === 4 ? "grid-cols-4" : "grid-cols-5")}>
          <div
            aria-hidden
            style={{ ...areaStyle(pillArea), width: `${100 / cols}%`, transform: `translateX(${pillIndex * 100}%)` }}
            className="pointer-events-none absolute inset-y-0 left-0 flex flex-col items-center justify-center gap-1 transition-transform duration-260 ease-sheet"
          >
            <span className="h-7 w-12 rounded-full bg-area/12 transition-colors duration-260" />
            <span className="invisible text-[11px] font-medium">·</span>
          </div>
          {tabs.map(({ href, label, icon: Icon, area }, i) => {
            const active = pillIndex === i;
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} style={areaStyle(area)} className={clsx("relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-180 active:scale-[0.97] motion-reduce:active:scale-100", active ? "text-ink" : "text-muted active:text-ink-2")}>
                <span className="grid h-7 w-12 place-items-center rounded-full">
                  <Icon className={clsx("size-[1.2rem] transition-colors duration-180", active && "text-area")} strokeWidth={active ? 2.1 : 1.75} />
                </span>
                {label}
              </Link>
            );
          })}
          <button onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog" style={areaStyle(pillArea)} className={clsx("relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-180 active:scale-[0.97]", pillIndex === tabs.length ? "text-ink" : "text-muted")}>
            <span className="grid h-7 w-12 place-items-center rounded-full">
              <MoreHorizontal className={clsx("size-[1.2rem] transition-colors duration-180", pillIndex === tabs.length && "text-area")} strokeWidth={1.9} />
            </span>
            More
          </button>
        </div>
      </nav>

      {/* More sheet */}
      <div className={clsx("fixed inset-0 z-50 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!open} inert={!open}>
        {/* Opens in 260ms on the sheet curve, closes a little faster (200ms); stays mounted so the exit is never cut off. */}
        <div className={clsx("absolute inset-0 bg-black/35 transition-opacity ease-motion", open ? "opacity-100 duration-260" : "opacity-0 duration-200")} onClick={() => setOpen(false)} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={role === "MANAGER" ? "All pages" : "More"}
          className={clsx(
            "absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-[1.75rem] bg-bg shadow-2xl transition-transform ease-sheet will-change-transform motion-reduce:transition-none",
            open ? "translate-y-0 duration-260" : "translate-y-full duration-200",
          )}
        >
          <div className="flex items-center justify-between px-5 pt-3 pb-2">
            <div className="mx-auto h-1 w-10 rounded-full bg-border-strong" />
          </div>
          <div className="flex items-center gap-2 px-4 pb-3">
            <button onClick={() => { setOpen(false); openCommandPalette(); }} className="flex h-11 flex-1 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-[0.95rem] text-muted transition-colors duration-120 active:bg-surface-2">
              <Search className="size-4" strokeWidth={1.75} /> Search or jump to…
            </button>
            <button onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-xl text-ink-2 active:bg-surface-2" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {role === "MANAGER" && groups.map((g, gi) => (
              <section key={gi} className="mb-5">
                {g.title && <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.title}</h3>}
                <div className="grid grid-cols-3 gap-2">
                  {g.items.map(({ href, label, icon: Icon, area }) => {
                    const active = isActive(pathname, href);
                    return (
                      <Link key={href} href={href} aria-current={active ? "page" : undefined} style={areaStyle(area)} className={clsx("flex h-[4.5rem] flex-col justify-between rounded-2xl border px-2.5 py-2 transition-[background-color,border-color,transform] duration-120 ease-motion active:scale-[0.97]", active ? "border-area/35 bg-area/10 text-ink" : "border-border bg-surface text-ink active:bg-surface-2")}>
                        <span className={clsx("grid size-7 place-items-center rounded-lg", active ? "bg-area text-bg" : "bg-area/10 text-area")}>
                          <Icon className="size-4" strokeWidth={1.9} />
                        </span>
                        <span className="line-clamp-2 text-[0.8rem] leading-tight font-medium">{label}</span>
                      </Link>
                    );
                  })}
                </div>
                <SubPages items={g.items} pathname={pathname} />
              </section>
            ))}
            {/* Staff: every page without a tab, as big tiles (the tabs stay in the bar). */}
            {role !== "MANAGER" && (
              <section className="mb-4">
                <div className="grid grid-cols-3 gap-2">
                  {all.filter((i) => !tabs.some((t) => t.href === i.href)).map(({ href, label, icon: Icon, area }) => {
                    const active = isActive(pathname, href);
                    return (
                      <Link key={href} href={href} aria-current={active ? "page" : undefined} style={areaStyle(area)} className={clsx("flex h-[5.25rem] flex-col justify-between rounded-2xl border px-3 py-2.5 transition-[background-color,border-color,transform] duration-120 ease-motion active:scale-[0.97] motion-reduce:active:scale-100", active ? "border-area/35 bg-area/10 text-ink" : "border-border bg-surface text-ink active:bg-surface-2")}>
                        <span className={clsx("grid size-8 place-items-center rounded-xl", active ? "bg-area text-bg" : "bg-area/10 text-area")}>
                          <Icon className="size-[1.1rem]" strokeWidth={1.9} aria-hidden />
                        </span>
                        <span className="line-clamp-2 text-[0.85rem] leading-tight font-medium">{label}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
            <section className="mb-2 overflow-hidden rounded-2xl border border-border bg-surface">
              <Link href="/help" style={areaStyle("assist")} className="flex h-12 items-center gap-3 px-3 text-sm transition-colors duration-120 active:bg-surface-2">
                <span className="grid size-7 place-items-center rounded-lg bg-area/10 text-area"><CircleHelp className="size-4" strokeWidth={1.9} /></span> Help & guided tours <ChevronRight className="ml-auto size-4 text-muted" />
              </Link>
              <div className="flex h-14 items-center justify-between border-t border-border px-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{name}</div>
                  <div className="text-xs text-muted">{role === "MANAGER" ? "Manager" : "Staff"}</div>
                </div>
                <form action={logout}>
                  <button className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-bad active:bg-bad-bg">
                    <LogOut className="size-4" strokeWidth={1.75} /> Sign out
                  </button>
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
