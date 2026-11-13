"use client";

/**
 * Area color plumbing. <AreaScope> (in the app layout) points `--area` at the
 * current page's area hue, so anything inside can use `text-area`,
 * `bg-area/10`, `from-area/50`… <AreaIcon> is the small tinted chip
 * PageHeader shows next to the title, using the page's nav icon.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { areaFor, areaStyle, navItemFor } from "@/lib/areas";
import { cn } from "@/lib/cn";

export function AreaScope({ children, className }: { children: ReactNode; className?: string }) {
  const pathname = usePathname();
  const area = areaFor(pathname);
  return (
    <div data-area={area} style={areaStyle(area)} className={className}>
      {children}
    </div>
  );
}

export function AreaIcon({ className }: { className?: string }) {
  const pathname = usePathname();
  const item = navItemFor(pathname);
  if (!item) return null;
  const Icon = item.icon;
  return (
    <span aria-hidden style={areaStyle(item.area)} className={cn("grid size-8 shrink-0 place-items-center rounded-[0.6rem] bg-area/10 text-area ring-1 ring-area/15 ring-inset", className)}>
      <Icon className="size-[1.05rem]" strokeWidth={1.9} />
    </span>
  );
}
