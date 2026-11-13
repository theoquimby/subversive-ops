"use client";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarCheck, CalendarRange, ChevronRight, CircleHelp, ClipboardList, Home, LayoutGrid, LogOut, MoreHorizontal, ScanLine, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { areaFor, areaStyle, isActive, MANAGER_NAV, STAFF_NAV, type Area, type NavGroup } from "@/lib/areas";
import { openCommandPalette } from "./command-palette";
import { HelpButton } from "./help";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionRole } from "@/server/session";

type NavItem = { href: string; label: string; icon: typeof LayoutGrid; area: Area };
type Group = NavGroup;

export function Nav({ role, name, logout }: { role: SessionRole; name: string; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const groups = role === "MANAGER" ? MANAGER_NAV : STAFF_NAV;
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
        <SidebarScroll pathname={pathname}>
          {groups.map((g, gi) => (
            <div key={gi} className="flex flex-col gap-px">
              {g.title && <div className="px-2.5 pt-1 pb-1 text-[11px] font-medium text-muted">{g.title}</div>}
              {g.items.map(({ href, label, icon: Icon, area }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    style={areaStyle(area)}
                    className={clsx(
                      "relative z-[1] flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-120 ease-motion",
                      active ? "font-medium text-ink" : "text-ink-2 hover:bg-surface-2/70 hover:text-ink",
                    )}
                  >
                    <Icon className={clsx("size-4 shrink-0 text-area transition-opacity duration-120", active ? "opacity-100" : "opacity-70")} strokeWidth={active ? 2 : 1.75} />
                    {label}
                  </Link>
                );
              })}
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
function SidebarScroll({ children, pathname }: { children: React.ReactNode; pathname: string }) {
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
  }, [pathname]);
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
// Staff pages all get a tab (Scan opens the keg scanner; Kegs is reached from it);
// More holds help and sign out (no repeated page tiles).
const STAFF_TABS: NavItem[] = [
  { href: "/my", label: "My shifts", icon: CalendarCheck, area: "people" },
  { href: "/count", label: "Count", icon: ClipboardList, area: "floor" },
  { href: "/waste", label: "Waste", icon: Trash2, area: "floor" },
  { href: "/kegs/scan", label: "Scan", icon: ScanLine, area: "floor" },
];

function MobileNav({ role, name, groups, logout, pathname }: { role: SessionRole; name: string; groups: Group[]; logout: () => Promise<void>; pathname: string }) {
  const [open, setOpen] = useState(false);
  const tabs = role === "MANAGER" ? MANAGER_TABS : STAFF_TABS;
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => isActive(pathname, i.href)) ?? (pathname.startsWith("/help") ? { label: "Help" } : null);
  const cols = tabs.length + 1;
  const activeTab = tabs.findIndex((t) => isActive(pathname, t.href));
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
          <Link href="/" className="flex min-w-0 items-center gap-2.5 px-2" aria-label="Home">
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
              <Link key={href} href={href} aria-current={isActive(pathname, href) ? "page" : undefined} style={areaStyle(area)} className={clsx("relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-180 active:scale-[0.97]", active ? "text-ink" : "text-muted active:text-ink-2")}>
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
              </section>
            ))}
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
