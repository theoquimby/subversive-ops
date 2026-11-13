"use client";

/**
 * People scheduled vs people the forecast needs, hour by hour, for one day.
 * Bars = scheduled (--series-1), step line = needed (--series-2): two
 * validated hues with a legend. Short hours turn the bar amber (status warn);
 * hover/tap a column for the numbers.
 */

import { cx } from "@/components/ui";
import type { HourDemand } from "@/domain/schedule";
import { useState } from "react";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 || h === 24 ? "a" : "p"}`;

export function DemandChart({ rows }: { rows: HourDemand[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <div className="px-4 py-8 text-center text-sm text-muted">Closed, and nothing scheduled.</div>;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.need, r.have)));
  const W = 100 / rows.length;
  const H = 120;
  const y = (n: number) => H - (n / max) * (H - 8);
  const steps = rows.map((r, i) => `${i === 0 ? "M" : "L"}${i * W},${y(r.need)} L${(i + 1) * W},${y(r.need)}`).join(" ");
  const short = rows.filter((r) => r.have < r.need).length;
  const over = rows.filter((r) => r.have > r.need && r.need > 0).length;
  const sel = hover != null ? rows[hover] : null;
  return (
    <div className="px-4 pt-3 pb-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-series-1/55" /> Scheduled</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-series-2" /> Needed</span>
          {short > 0 && <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-warn" /> Short</span>}
        </span>
        <span className="num">
          {sel ? (
            <span className="text-ink">{hourLabel(sel.hour)}: {sel.have} on, {sel.need} needed</span>
          ) : (
            <>{short ? <span className="text-warn">{short} short hour{short === 1 ? "" : "s"}</span> : "Covered every hour"}{over ? ` · ${over} over` : ""}</>
          )}
        </span>
      </div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="block h-32 w-full" role="img" aria-label="People scheduled vs needed per hour">
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2="100" y1={H * f} y2={H * f} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {rows.map((r, i) => (
            <rect
              key={r.hour}
              x={i * W + W * 0.15}
              width={W * 0.7}
              y={y(r.have)}
              height={H - y(r.have)}
              rx="0.6"
              className={cx("transition-opacity duration-120", r.have < r.need ? "fill-warn" : "fill-series-1/55", hover === i && "opacity-80")}
            />
          ))}
          <path d={steps} fill="none" className="stroke-series-2" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="absolute inset-0 flex">
          {rows.map((r, i) => (
            <button key={r.hour} type="button" aria-label={`${hourLabel(r.hour)}: ${r.have} scheduled, ${r.need} needed`} className="h-full flex-1" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </div>
      </div>
      <div className="num mt-1 flex text-[10.5px] text-muted">
        {rows.map((r, i) => <span key={r.hour} className="flex-1 text-center">{i % (rows.length > 12 ? 2 : 1) === 0 ? hourLabel(r.hour) : ""}</span>)}
      </div>
    </div>
  );
}
