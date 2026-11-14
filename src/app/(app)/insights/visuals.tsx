"use client";

import { Clock, Receipt, ShoppingCart, UtensilsCrossed, Users, type LucideIcon } from "lucide-react";
import { cx } from "@/components/ui";
import type { LabArea } from "@/domain/lab";
import { AREA_LABEL } from "@/domain/lab";

/**
 * The small identity pieces every insight card wears: the area (icon in the
 * app's area hue — identity only, never status), and the 1–5 rating dots.
 */

export const AREA_ICON: Record<LabArea, LucideIcon> = { staffing: Users, menu: UtensilsCrossed, ordering: ShoppingCart, hours: Clock, costs: Receipt };
export const AREA_HUE: Record<LabArea, string> = { staffing: "var(--area-people)", menu: "var(--area-food)", ordering: "var(--area-food)", hours: "var(--area-today)", costs: "var(--area-numbers)" };

export function AreaChip({ area, className, pill }: { area: LabArea; className?: string; pill?: boolean }) {
  const Icon = AREA_ICON[area];
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 text-xs font-medium text-ink-2", pill && "h-7 rounded-full border border-border bg-surface px-2.5 shadow-[0_1px_1px_rgb(0_0_0/0.03)]", className)}
    >
      <Icon className="size-3.5" strokeWidth={1.9} style={{ color: AREA_HUE[area] }} aria-hidden />
      {AREA_LABEL[area]}
    </span>
  );
}

/** A soft square tile with the area's icon — the visual anchor of a list row. */
export function AreaTile({ area, className }: { area: LabArea; className?: string }) {
  const Icon = AREA_ICON[area];
  return (
    <span
      className={cx("grid size-10 shrink-0 place-items-center rounded-xl", className)}
      style={{ background: `color-mix(in oklab, ${AREA_HUE[area]} 11%, var(--surface))` }}
      aria-hidden
    >
      <Icon className="size-[18px]" strokeWidth={1.8} style={{ color: AREA_HUE[area] }} />
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
