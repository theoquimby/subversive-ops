"use client";

import { useState } from "react";
import { Clock, Receipt, ShoppingCart, UtensilsCrossed, Users, type LucideIcon } from "lucide-react";
import { cx } from "@/components/ui";
import type { LabArea, Visual } from "@/domain/lab";
import { AREA_LABEL } from "@/domain/lab";
import { money } from "@/lib/format";

/**
 * The small graphics that sit beside each action's story. Deliberately plain:
 * one idea per picture (this hour vs the others, before vs after), ink marks,
 * status color only where it means something (the hour that's over, the bad
 * number), values written on the marks so nothing depends on hover.
 */

const whole = (n: number) => money(n, { whole: true });

export const AREA_ICON: Record<LabArea, LucideIcon> = { staffing: Users, menu: UtensilsCrossed, ordering: ShoppingCart, hours: Clock, costs: Receipt };
export const AREA_HUE: Record<LabArea, string> = { staffing: "var(--area-people)", menu: "var(--area-food)", ordering: "var(--area-food)", hours: "var(--area-today)", costs: "var(--area-numbers)" };

export function AreaChip({ area, className }: { area: LabArea; className?: string }) {
  const Icon = AREA_ICON[area];
  return (
    <span className={cx("inline-flex items-center gap-1 text-xs font-medium text-ink-2", className)}>
      <Icon className="size-3.5" strokeWidth={1.9} style={{ color: AREA_HUE[area] }} aria-hidden />
      {AREA_LABEL[area]}
    </span>
  );
}

/** 1–5 filled dots: calmer than stars, readable at a glance, with the words for screen readers. */
export function StarDots({ stars, size = "sm" }: { stars: number; size?: "sm" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={`${stars} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("rounded-full transition-colors duration-180", size === "lg" ? "size-2.5" : "size-[7px]", i <= stars ? "bg-ink" : "bg-border-strong")} />
      ))}
    </span>
  );
}

export function StoryVisual({ visual }: { visual: Visual | null }) {
  if (!visual) return null;
  if (visual.type === "hours") return <HoursVisual v={visual} />;
  if (visual.type === "compare") return <CompareVisual v={visual} />;
  if (visual.type === "week") return <WeekVisual rows={visual.rows} />;
  return null;
}

function HoursVisual({ v }: { v: Extract<Visual, { type: "hours" }> }) {
  const max = Math.max(1, ...v.rows.map((r) => r.sales));
  const [hover, setHover] = useState<number | null>(null);
  const h = hover == null ? null : v.rows[hover];
  return (
    <figure className="min-w-0">
      <div className="flex h-28 items-end gap-1" role="img" aria-label="Sales each hour of that day; the highlighted hours have more people than the sales need" onMouseLeave={() => setHover(null)}>
        {v.rows.map((r, i) => (
          <button
            key={r.label}
            type="button"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
            aria-label={`${r.label}: ${whole(r.sales)} sales, ${r.people} on, ${r.need} needed`}
          >
            <span className={cx("block w-full rounded-t-[5px] transition-[height,opacity] duration-260 ease-motion", r.flag ? "bg-warn" : "bg-ink/20")} style={{ height: `${Math.max(4, (r.sales / max) * 100)}%`, opacity: hover == null || hover === i ? 1 : 0.6 }} />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {v.rows.map((r) => (
          <span key={r.label} className={cx("min-w-0 flex-1 truncate text-center text-[10px]", r.flag ? "font-semibold text-ink" : "text-muted")}>{r.label.replace(/(am|pm)$/, "")}</span>
        ))}
      </div>
      <figcaption className="mt-2 min-h-[2.5rem] text-xs text-muted">
        {h ? (
          <>
            <span className="font-medium text-ink">{h.label}</span> · <span className="num">{whole(h.sales)}</span> in sales · <span className="num">{h.people}</span> on the clock, <span className="num">{h.need}</span> needed
          </>
        ) : (
          <>
            <span className="mr-1 inline-block size-2 rounded-sm bg-warn align-middle" /> more people on than the sales need. Bars are sales each hour.
          </>
        )}
      </figcaption>
    </figure>
  );
}

function CompareVisual({ v }: { v: Extract<Visual, { type: "compare" }> }) {
  const max = Math.max(1, ...v.rows.map((r) => Math.abs(r.value)));
  const fmt = (n: number) => (v.unit === "money" ? (Math.abs(n) < 50 ? money(n) : whole(n)) : `${n} h`);
  return (
    <figure className="flex min-w-0 flex-col gap-2.5" role="img" aria-label={v.rows.map((r) => `${r.label} ${fmt(r.value)}`).join(", ")}>
      {v.rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-ink-2">{r.label}</span>
            <span className={cx("num font-semibold", r.tone === "bad" ? "text-bad" : r.tone === "good" ? "text-good" : "text-ink")}>{fmt(r.value)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-2">
            <div className={cx("h-full rounded-full transition-[width] duration-260 ease-motion", r.tone === "bad" ? "bg-bad" : r.tone === "good" ? "bg-good" : "bg-ink/70")} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </figure>
  );
}

export function WeekVisual({ rows }: { rows: { label: string; value: number; sales?: number; labor?: number; flag?: boolean }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const hasNeg = rows.some((r) => r.value < 0);
  const [hover, setHover] = useState<number | null>(null);
  const h = hover == null ? null : rows[hover];
  return (
    <figure className="min-w-0">
      <div className={cx("flex gap-1.5", hasNeg ? "h-32" : "h-28")} role="img" aria-label="What each weekday leaves after food, drink and wages" onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <button key={r.label} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)} className="flex h-full min-w-0 flex-1 flex-col" aria-label={`${r.label}: ${whole(r.value)} left`}>
            <span className="flex flex-1 flex-col justify-end">
              {r.value >= 0 && <span className={cx("block w-full rounded-t-[5px] transition-[height] duration-260 ease-motion", r.flag ? "bg-warn" : "bg-ink/75")} style={{ height: `${Math.max(3, (r.value / max) * 100)}%`, opacity: hover == null || hover === i ? 1 : 0.55 }} />}
            </span>
            {hasNeg && (
              <span className="flex h-1/3 flex-col justify-start border-t border-border-strong">
                {r.value < 0 && <span className="block w-full rounded-b-[5px] bg-bad" style={{ height: `${Math.max(3, (-r.value / max) * 100)}%` }} />}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {rows.map((r) => (
          <span key={r.label} className="min-w-0 flex-1 text-center text-[11px] text-muted">{r.label}</span>
        ))}
      </div>
      <figcaption className="mt-2 min-h-[1.25rem] text-xs text-muted">
        {h ? (
          <>
            <span className="font-medium text-ink">{h.label}</span> leaves <span className="num font-medium text-ink">{whole(h.value)}</span>
            {h.sales != null && h.labor != null && <> from <span className="num">{whole(h.sales)}</span> sales after <span className="num">{whole(h.labor)}</span> wages</>}
          </>
        ) : (
          "What an average day leaves after food, drink and wages (before rent)."
        )}
      </figcaption>
    </figure>
  );
}
