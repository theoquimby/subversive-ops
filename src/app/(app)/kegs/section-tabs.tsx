"use client";

import { cx } from "@/components/ui";
import { activeChild, activeTab, KEG_SECTIONS } from "@/lib/areas";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The tab strip for whichever keg section the page is in (Analytics,
 * Wholesale, Manage). The menu lists the sections; the pages inside one are
 * tabs here, so the menu stays short. Sections with a single page show nothing.
 * On a phone the strip scrolls sideways inside itself; the page never does.
 */
export function KegSectionTabs() {
  const pathname = usePathname();
  const section = KEG_SECTIONS.find((s) => s.href === activeChild(pathname, KEG_SECTIONS));
  const tabs = section?.tabs;
  if (!section || !tabs || tabs.length < 2) return null;
  const active = activeTab(pathname, tabs);
  return (
    <nav aria-label={`Kegs, ${section.label}`} className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" data-tour="kegs.tabs">
      <div className="flex min-w-max items-center gap-5 border-b border-border">
        <span className="inline-flex items-center gap-1.5 pr-1 text-sm font-semibold text-ink">
          <section.icon className="size-4 text-area" strokeWidth={1.9} />
          {section.label}
        </span>
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active === t.href ? "page" : undefined}
            className={cx("-mb-px inline-flex h-11 items-center border-b-2 px-0.5 text-sm font-medium whitespace-nowrap transition-colors sm:h-10", active === t.href ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
