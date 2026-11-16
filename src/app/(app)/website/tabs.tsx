"use client";

import { cx } from "@/components/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const WEBSITE_TABS = [
  { href: "/website", label: "Overview" },
  { href: "/website/hours", label: "Hours & notice" },
  { href: "/website/announcements", label: "Announcements" },
  { href: "/website/menu", label: "Menu" },
  { href: "/website/events", label: "Events" },
  { href: "/website/inquiries", label: "Inquiries" },
  { href: "/website/content", label: "Site content" },
  // Its own page (src/app/(app)/website/analytics), built by the analytics work; this layout gives it the header and tabs.
  { href: "/website/analytics", label: "Analytics" },
] as const;

const activeTab = (pathname: string) => [...WEBSITE_TABS].sort((a, b) => b.href.length - a.href.length).find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href ?? "/website";

/**
 * The Website hub's tab strip (rendered by website/layout.tsx for every page under
 * /website). On a phone the strip scrolls sideways inside itself; the page never does.
 */
export function WebsiteTabs({ newInquiries = 0 }: { newInquiries?: number; /** @deprecated the layout renders the tabs; active comes from the URL */ active?: string }) {
  const active = activeTab(usePathname());
  return (
    <nav aria-label="Website" className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" data-tour="website.tabs">
      <div className="flex min-w-max gap-5 border-b border-border">
        {WEBSITE_TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active === t.href ? "page" : undefined}
            className={cx("-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium whitespace-nowrap transition-colors sm:h-10", active === t.href ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
            {t.href === "/website/inquiries" && newInquiries > 0 && <span className="num rounded-md bg-warn-bg px-1.5 py-0.5 text-xs text-warn">{newInquiries} new</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}
