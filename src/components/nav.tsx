"use client";

import clsx from "clsx";
import { BookOpen, ChartLine, ClipboardList, Carrot, FileUp, LayoutGrid, Scale, LogOut, Receipt, Search, Settings, ShoppingCart, Trash2 } from "lucide-react";
import { openCommandPalette } from "./command-palette";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionRole } from "@/server/session";

const MANAGER = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/menu", label: "Menu costs", icon: BookOpen },
  { href: "/variance", label: "Margin gap", icon: Scale },
  { href: "/ingredients", label: "Ingredients", icon: Carrot },
  { href: "/prices", label: "Prices", icon: Receipt },
  { href: "/ordering", label: "Ordering", icon: ShoppingCart },
  { href: "/sales", label: "Sales", icon: ChartLine },
  { href: "/count", label: "Counts", icon: ClipboardList },
  { href: "/waste", label: "Waste", icon: Trash2 },
  { href: "/import", label: "Import sheets", icon: FileUp },
  { href: "/settings", label: "Settings", icon: Settings },
];
const STAFF = [
  { href: "/count", label: "Count", icon: ClipboardList },
  { href: "/waste", label: "Waste", icon: Trash2 },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function Nav({ role, name, logout }: { role: SessionRole; name: string; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const items = role === "MANAGER" ? MANAGER : STAFF;
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
        <nav className="mt-4 flex flex-col gap-0.5">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
                isActive(pathname, href) ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2/70 hover:text-ink",
              )}
            >
              <Icon className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between border-t border-border px-2.5 pt-4">
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

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Brand />
          <div className="flex items-center">
            <button onClick={openCommandPalette} className="rounded-md p-2.5 text-ink-2 hover:text-ink" aria-label="Search">
              <Search className="size-5" strokeWidth={1.75} />
            </button>
            <form action={logout}>
              <button className="rounded-md p-2.5 text-muted hover:text-ink" title="Sign out">
                <LogOut className="size-4" strokeWidth={1.75} />
              </button>
            </form>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
          {items.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "shrink-0 rounded-full px-3 py-1.5 text-sm",
                isActive(pathname, href) ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </>
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
