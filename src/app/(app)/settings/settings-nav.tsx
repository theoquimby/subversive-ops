"use client";

import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS } from "./registry";

/** Desktop only: every Settings page, grouped by section, with the current one marked. */
export function SettingsNav() {
  const path = usePathname();
  const link = (href: string, label: string) => {
    const on = href === "/settings" ? path === "/settings" : path === href || path.startsWith(`${href}/`);
    return (
      <Link
        key={href}
        href={href}
        aria-current={on ? "page" : undefined}
        className={cn("block truncate rounded-md px-2.5 py-1.5 text-sm transition-colors duration-120", on ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink")}
      >
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="Settings sections" className="sticky top-8 hidden max-h-[calc(100dvh-4rem)] self-start overflow-y-auto pb-6 lg:block">
      {link("/settings", "All settings")}
      {SECTIONS.map((s) => (
        <div key={s.id} className="mt-4">
          <div className="px-2.5 pb-1 text-[0.7rem] font-medium tracking-wide text-muted uppercase">{s.title}</div>
          {s.pages.map((p) => link(p.href, p.label))}
        </div>
      ))}
    </nav>
  );
}
