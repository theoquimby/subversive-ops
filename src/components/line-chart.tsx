"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { money, qty, shortDate } from "@/lib/format";

const FORMATS = { money: (n: number) => money(n), number: (n: number) => qty(n, 1) };
/** Axis labels: whole dollars (or whole numbers) once the step between ticks is 1 or more. */
const TICK_FORMATS = {
  money: (n: number, step: number) => (step >= 1 ? money(n, { whole: true }) : money(n)),
  number: (n: number, step: number) => qty(n, step >= 1 ? 0 : 1),
};

/** A round step (1, 2, 2.5 or 5 times a power of ten) giving about `want` gaps across `span`. */
function niceStep(span: number, want = 3) {
  const raw = Math.max(span, 1e-9) / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
}

/**
 * Single-series line chart with crosshair + tooltip. One series, so no legend —
 * the section title names it. Recessive grid, 2px line, values in text tokens.
 */
export function LineChart({
  points,
  valueFormat = "money",
  height = 180,
  ariaLabel,
  domain,
}: {
  points: { x: string; y: number | null }[];
  /** Server components can't pass functions to client components, so formats are named. */
  valueFormat?: keyof typeof FORMATS;
  height?: number;
  ariaLabel: string;
  /** Fixed y-axis range (e.g. [1, 5] for star ratings); default fits the data. */
  domain?: [number, number];
}) {
  const id = useId();
  const format = FORMATS[valueFormat];
  const formatX = shortDate;
  const [hover, setHover] = useState<number | null>(null);
  // Render at the container's real pixel width so text stays 11px at any size.
  const ref = useRef<HTMLDivElement>(null);
  // Start small so the first render never stretches its container; the observer sizes it.
  const [W, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const H = height;

  const { path, scaleX, scaleY, ticks, step: tickStep, valid, pad } = useMemo(() => {
    const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.y != null) as { x: string; y: number; i: number }[];
    const ys = valid.map((p) => p.y);
    let min = Math.min(...ys);
    let max = Math.max(...ys);
    if (!isFinite(min)) [min, max] = [0, 1];
    const span = max - min || Math.max(Math.abs(max) * 0.1, 0.01);
    min = Math.max(0, min - span * 0.25);
    max = max + span * 0.25;
    let ticks: number[];
    let step: number;
    if (domain) {
      [min, max] = domain;
      ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);
      step = (max - min) / 2;
    } else {
      // Round ticks on a round range, so the axis reads $1,000 / $2,000 rather than $1,688.96.
      step = niceStep(max - min);
      min = Math.max(0, Math.floor(min / step) * step);
      max = Math.ceil(max / step) * step;
      ticks = [];
      for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(v);
    }
    // Room for the longest label, so a "$" never sits under the edge.
    const longest = Math.max(...ticks.map((t) => TICK_FORMATS[valueFormat](t, step).length));
    const pad = { top: 12, right: 12, bottom: 24, left: Math.max(40, Math.round(longest * 6.8) + 12) };
    const scaleX = (i: number) => pad.left + (i / Math.max(1, points.length - 1)) * (W - pad.left - pad.right);
    const scaleY = (v: number) => pad.top + (1 - (v - min) / (max - min)) * (H - pad.top - pad.bottom);
    const path = valid.map((p, k) => `${k ? "L" : "M"}${scaleX(p.i).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(" ");
    return { path, scaleX, scaleY, ticks, step, valid, pad };
  }, [points, W, H, domain, valueFormat]);

  if (valid.length < 2) return <div ref={ref} className="grid h-24 place-items-center text-sm text-muted">Not enough price history yet.</div>;

  const h = hover == null ? null : points[hover];
  const step = (W - pad.left - pad.right) / Math.max(1, points.length - 1);

  return (
    <div className="relative w-full min-w-0" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={scaleY(t)} y2={scaleY(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.left - 8} y={scaleY(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{TICK_FORMATS[valueFormat](t, tickStep)}</text>
          </g>
        ))}
        <text x={pad.left} y={H - 6} className="fill-muted text-[11px]">{formatX(points[0].x)}</text>
        <text x={W - pad.right} y={H - 6} textAnchor="end" className="fill-muted text-[11px]">{formatX(points.at(-1)!.x)}</text>
        <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && h.y != null && (
          <>
            <line x1={scaleX(hover!)} x2={scaleX(hover!)} y1={pad.top} y2={H - pad.bottom} stroke="var(--border-strong)" strokeWidth={1} />
            <circle cx={scaleX(hover!)} cy={scaleY(h.y)} r={4.5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
        {points.map((p, i) => (
          <rect key={`${id}-${i}`} x={scaleX(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && h.y != null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(scaleX(hover!) / W) * 100}%` }}
        >
          <div className="text-muted">{formatX(h.x)}</div>
          <div className="num font-medium text-ink">{format(h.y)}</div>
        </div>
      )}
    </div>
  );
}
