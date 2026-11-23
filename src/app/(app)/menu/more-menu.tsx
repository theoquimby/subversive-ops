"use client";

import { Popover } from "@/components/data-table";
import { cx } from "@/components/ui";
import { ChevronDown } from "lucide-react";
import Link from "next/link";

/** The page's lesser actions behind one "More" button, so New recipe stands alone as the main one. */
export function MoreMenu({ items }: { items: { href: string; label: string; count?: number; tour?: string }[] }) {
  return (
    <Popover
      label="More"
      placement="bottom-end"
      button={(open) => (
        <button type="button" className={cx("inline-flex h-10 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-ink transition-colors duration-120 hover:bg-surface-2", open && "bg-surface-2")}>
          More
          {items.some((i) => i.count) && <span className="num rounded-full bg-warn-bg px-1.5 text-xs text-warn">{items.reduce((s, i) => s + (i.count ?? 0), 0)}</span>}
          <ChevronDown aria-hidden className={cx("size-4 text-muted transition-transform duration-180", open && "rotate-180")} />
        </button>
      )}
    >
      {(close) => (
        <div className="p-1" role="menu">
          {items.map((i) => (
            <Link key={i.href} href={i.href} role="menuitem" data-tour={i.tour} onClick={close} className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2.5 text-ink transition-colors duration-75 hover:bg-surface-2">
              {i.label}
              {i.count ? <span className="num rounded-full bg-warn-bg px-1.5 text-xs text-warn">{i.count}</span> : null}
            </Link>
          ))}
        </div>
      )}
    </Popover>
  );
}
