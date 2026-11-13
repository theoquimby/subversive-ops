"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, Sparkles, Wheat, BookOpen, ChevronRight, CircleHelp, Home, MoreHorizontal, X, CalendarCheck, CalendarDays, CalendarRange, HandCoins, Carrot, ChartLine, ClipboardList, Clock, FileCheck, FileUp, LayoutGrid, LogOut, MessageSquareText, Receipt, Scale, Search, Settings, ShoppingCart, Sunrise, Target, Trash2, TrendingUp, Users } from "lucide-react";
import { openCommandPalette } from "./command-palette";
import { HelpButton } from "./help";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionRole } from "@/server/session";

type NavItem = { href: string; label: string; icon: typeof LayoutGrid };

// Grouped so ~20 pages stay scannable. Order = how often Max uses them.
const MANAGER: { title?: string; items: NavItem[] }[] = [
  { items: [
    { href: "/", label: "Overview", icon: LayoutGrid },
    { href: "/brief", label: "Weekly brief", icon: Sunrise },
    { href: "/ask", label: "Ask", icon: Sparkles },
  ] },
  { title: "Food", items: [
    { href: "/menu", label: "Menu costs", icon: BookOpen },
    { href: "/variance", label: "Margin gap", icon: Scale },
    { href: "/ingredients", label: "Ingredients", icon: Carrot },
    { href: "/prices", label: "Prices", icon: Receipt },
    { href: "/ordering", label: "Ordering", icon: ShoppingCart },
    { href: "/invoices", label: "Invoices", icon: FileCheck },
    { href: "/menu/allergens", label: "Allergen chart", icon: Wheat },
  ] },
  { title: "People", items: [
    { href: "/schedule", label: "Schedule", icon: CalendarRange },
    { href: "/team", label: "Team", icon: Users },
    { href: "/team/documents", label: "Documents", icon: FolderOpen },
    { href: "/labor", label: "Timecards & payroll", icon: Clock },
    { href: "/tips", label: "Tips", icon: HandCoins },
    { href: "/my", label: "My shifts", icon: CalendarCheck },
  ] },
  { title: "Numbers", items: [
    { href: "/pnl", label: "P&L", icon: TrendingUp },
    { href: "/sales", label: "Sales & forecast", icon: ChartLine },
    { href: "/events", label: "Events", icon: CalendarDays },
    { href: "/budgets", label: "Budgets", icon: Target },
    { href: "/reviews", label: "Reviews", icon: MessageSquareText },
  ] },
  { title: "Floor", items: [
    { href: "/count", label: "Counts", icon: ClipboardList },
    { href: "/waste", label: "Waste", icon: Trash2 },
  ] },
  { title: "Setup", items: [
    { href: "/import", label: "Import sheets", icon: FileUp },
    { href: "/settings", label: "Settings", icon: Settings },
  ] },
];
const STAFF: { title?: string; items: NavItem[] }[] = [
  { items: [
    { href: "/my", label: "My shifts", icon: CalendarCheck },
    { href: "/count", label: "Count", icon: ClipboardList },
    { href: "/waste", label: "Waste", icon: Trash2 },
  ] },
];

const matches = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`));
const ALL_HREFS = [...MANAGER, ...STAFF].flatMap((g) => g.items.map((i) => i.href));
/** Active = the most specific nav item matching the path (so /menu/allergens lights "Allergen chart", not "Menu costs"). */
const isActive = (pathname: string, href: string) => matches(pathname, href) && !ALL_HREFS.some((h) => h.length > href.length && h.startsWith(href) && matches(pathname, h));

export function Nav({ role, name, logout }: { role: SessionRole; name: string; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const groups = role === "MANAGER" ? MANAGER : STAFF;
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
        <Brand />
        <button onClick={openCommandPalette} className="mt-6 flex h-9 items-center gap-2.5 rounded-lg border border-border px-2.5 text-sm text-muted hover:border-border-strong hover:text-ink">
          <Search className="size-4" strokeWidth={1.75} />
          Search or jump to…
          <kbd className="ml-auto rounded border border-border px-1 text-[10px]">⌘K</kbd>
        </button>
        <SidebarScroll>
          {groups.map((g, gi) => (
            <div key={gi} className="flex flex-col gap-px">
              {g.title && <div className="px-2.5 pt-1 pb-1 text-[11px] font-medium text-muted">{g.title}</div>}
              {g.items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
                    isActive(pathname, href) ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2/70 hover:text-ink",
                  )}
                >
                  <Icon className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
                  {label}
                </Link>
              ))}
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

/** Scrollable page list with a soft fade at the bottom while more items are below the fold. */
function SidebarScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
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
  return (
    <div className="relative mt-3 -mx-1 flex min-h-0 flex-1 flex-col">
      <nav ref={ref} aria-label="Pages" className="scroll-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2">
        {children}
      </nav>
      <div aria-hidden className={clsx("pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent transition-opacity duration-200", more ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2.5">
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-[0.8rem] font-bold text-primary-ink">S</span>
      <span className="text-[0.95rem] font-semibold tracking-tight">Subversive Ops</span>
    </Link>
  );
}

// ---- Mobile ---------------------------------------------------------------------

type Group = { title?: string; items: NavItem[] };

// The four things done most on a phone get a tab; everything else lives in More.
const MANAGER_TABS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/ordering", label: "Ordering", icon: ShoppingCart },
  { href: "/count", label: "Count", icon: ClipboardList },
  { href: "/schedule", label: "Schedule", icon: CalendarRange },
];
// Staff have three pages, so they all get a tab; More holds help and sign out
// (no repeated page tiles).
const STAFF_TABS: NavItem[] = [
  { href: "/my", label: "My shifts", icon: CalendarCheck },
  { href: "/count", label: "Count", icon: ClipboardList },
  { href: "/waste", label: "Waste", icon: Trash2 },
];

function MobileNav({ role, name, groups, logout, pathname }: { role: SessionRole; name: string; groups: Group[]; logout: () => Promise<void>; pathname: string }) {
  const [open, setOpen] = useState(false);
  const tabs = role === "MANAGER" ? MANAGER_TABS : STAFF_TABS;
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => isActive(pathname, i.href)) ?? (pathname.startsWith("/help") ? { label: "Help" } : null);
  const inTabs = tabs.some((t) => isActive(pathname, t.href));

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
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-[0.8rem] font-bold text-primary-ink">S</span>
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

      {/* Bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Main">
        <div className={clsx("grid h-[3.75rem]", tabs.length === 3 ? "grid-cols-4" : "grid-cols-5")}>
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={clsx("flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", active ? "text-ink" : "text-muted active:text-ink-2")}>
                <span className={clsx("grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-surface-2")}>
                  <Icon className="size-[1.2rem]" strokeWidth={active ? 2.1 : 1.75} />
                </span>
                {label}
              </Link>
            );
          })}
          <button onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog" className={clsx("flex flex-col items-center justify-center gap-1 text-[11px] font-medium", !inTabs || open ? "text-ink" : "text-muted")}>
            <span className={clsx("grid h-7 w-12 place-items-center rounded-full", (!inTabs || open) && "bg-surface-2")}>
              <MoreHorizontal className="size-[1.2rem]" strokeWidth={1.9} />
            </span>
            More
          </button>
        </div>
      </nav>

      {/* More sheet */}
      <div className={clsx("fixed inset-0 z-50 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!open} inert={!open}>
        <div className={clsx("absolute inset-0 bg-black/35 transition-opacity duration-300", open ? "opacity-100" : "opacity-0")} onClick={() => setOpen(false)} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={role === "MANAGER" ? "All pages" : "More"}
          className={clsx(
            "absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-[1.75rem] bg-bg shadow-2xl transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
            open ? "translate-y-0" : "translate-y-full",
          )}
        >
          <div className="flex items-center justify-between px-5 pt-3 pb-2">
            <div className="mx-auto h-1 w-10 rounded-full bg-border-strong" />
          </div>
          <div className="flex items-center gap-2 px-4 pb-3">
            <button onClick={() => { setOpen(false); openCommandPalette(); }} className="flex h-11 flex-1 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-[0.95rem] text-muted">
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
                  {g.items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(pathname, href);
                    return (
                      <Link key={href} href={href} className={clsx("flex h-[4.5rem] flex-col justify-between rounded-2xl border px-3 py-2.5 transition-colors active:scale-[0.98]", active ? "border-ink bg-primary text-primary-ink" : "border-border bg-surface text-ink active:bg-surface-2")}>
                        <Icon className="size-[1.1rem]" strokeWidth={1.75} />
                        <span className="truncate text-[0.8rem] leading-tight font-medium">{label}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
            <section className="mb-2 overflow-hidden rounded-2xl border border-border bg-surface">
              <Link href="/help" className="flex h-12 items-center gap-3 px-4 text-sm active:bg-surface-2">
                <CircleHelp className="size-4 text-ink-2" strokeWidth={1.75} /> Help & guided tours <ChevronRight className="ml-auto size-4 text-muted" />
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
