"use client";

import { useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import { cx } from "@/components/ui";
import type { WatchItem } from "@/domain/lab";
import { EvidenceView } from "./evidence";
import { AreaChip } from "./visuals";

/**
 * Watching: things that looked like something on the raw numbers but don't hold up once we allow
 * for how busy you were, the weekday, the season and events — with what would make each count.
 * Never actions; they move to "Up next" by themselves if the numbers firm up.
 */
export function WatchList({ items }: { items: WatchItem[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 4);
  return (
    <>
      <ul className="flex flex-col gap-2">
        {shown.map((w) => (
          <WatchRow key={w.key} w={w} />
        ))}
      </ul>
      {items.length > 4 && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-2 flex h-11 w-full items-center justify-center gap-1 rounded-xl text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
          {all ? "Show fewer" : `Show ${items.length - 4} more`}
          <ChevronDown className={cx("size-4 transition-transform duration-180", all && "rotate-180")} strokeWidth={1.75} />
        </button>
      )}
    </>
  );
}

function WatchRow({ w }: { w: WatchItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="overflow-hidden rounded-xl border border-dashed border-border-strong bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <Eye className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <AreaChip area={w.area} />
            <span className="text-xs text-muted">Watching</span>
          </div>
          <div className="mt-1 text-[0.95rem] leading-snug font-medium text-ink">{w.title}</div>
          <p className="mt-0.5 text-sm text-ink-2">{w.summary}</p>
          {w.watch && <p className="mt-1 text-xs text-muted">{w.watch}</p>}
        </div>
        <ChevronDown className={cx("mt-1 size-4 shrink-0 text-muted transition-transform duration-180", open && "rotate-180")} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="animate-fade-in border-t border-border px-4 pt-3 pb-4">
          {w.evidence ? (
            <EvidenceView ev={{ ...w.evidence, summary: "" }} />
          ) : (
            <div className="text-[0.85rem] text-ink-2">{w.how.map((h, i) => <p key={i} className="mb-2">{h}</p>)}</div>
          )}
        </div>
      )}
    </li>
  );
}
