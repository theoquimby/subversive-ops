"use client";

import { money, pct } from "@/lib/format";
import { useEffect, useMemo, useRef, useState } from "react";

interface HourPoint {
  hour: number;
  sales: number;
  labor: number;
  laborHours: number;
  orders: number;
  scheduled: number;
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

/**
 * Sales (bars) vs actual labor cost (solid line) and scheduled labor cost
 * (dashed line) for each hour of one day. Same visual language as LineChart:
 * recessive grid, 2px line, hover tooltip. Two series, so two validated hues
 * (--series-1 sales, --series-2 labor) and a legend; scheduled stays muted.
 */
export function HourlyChart({ hours, height = 220, showScheduled = true }: { hours: HourPoint[]; height?: number; showScheduled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // Show the active part of the day (an hour either side of any sales or labor).
  const visible = useMemo(() => {
    const active = hours.filter((h) => h.sales > 0 || h.labor > 0 || h.scheduled > 0).map((h) => h.hour);
    const lo = active.length ? Math.max(0, Math.min(...active) - 1) : 10;
    const hi = active.length ? Math.min(23, Math.max(...active) + 1) : 22;
    return hours.filter((h) => h.hour >= lo && h.hour <= hi);
  }, [hours]);

  const H = height;
  const pad = { top: 12, right: 12, bottom: 24, left: 52 };
  const sched = showScheduled && visible.some((h) => h.scheduled > 0);
  const max = Math.max(1, ...visible.map((h) => Math.max(h.sales, h.labor, sched ? h.scheduled : 0))) * 1.15;
  const band = (W - pad.left - pad.right) / Math.max(1, visible.length);
  const x = (i: number) => pad.left + band * i + band / 2;
  const y = (v: number) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);
  const ticks = [0, 0.5, 1].map((t) => max * t);
  const path = (v: (h: HourPoint) => number) => visible.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v(h)).toFixed(1)}`).join(" ");
  const line = path((h) => h.labor);
  const schedLine = sched ? path((h) => h.scheduled) : null;
  const barW = Math.max(4, Math.min(28, band * 0.6));
  const hv = hover == null ? null : visible[hover];
  const labelEvery = band < 34 ? 2 : 1;

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-series-1/55" /> Sales</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-series-2" /> Actual labor</span>
        {sched && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="16" height="2" aria-hidden><line x1="0" x2="16" y1="1" y2="1" stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 3" /></svg> Scheduled
          </span>
        )}
      </div>
      <div className="relative" ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Sales and labor cost by hour" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{money(t, { whole: true })}</text>
            </g>
          ))}
          {visible.map((h, i) => (
            <g key={h.hour}>
              <rect x={x(i) - barW / 2} y={y(h.sales)} width={barW} height={Math.max(0, y(0) - y(h.sales))} rx={2} fill="var(--series-1)" fillOpacity={hover === i ? 0.75 : 0.55} className="transition-[fill-opacity] duration-120" />
              {i % labelEvery === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">{hourLabel(h.hour)}</text>}
            </g>
          ))}
          {schedLine && <path d={schedLine} fill="none" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />}
          <path d={line} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hv && <circle cx={x(hover!)} cy={y(hv.labor)} r={4.5} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />}
          {visible.map((h, i) => (
            <rect key={`hit-${h.hour}`} x={x(i) - band / 2} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
          ))}
        </svg>
        {hv && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-sm"
            style={{ left: `${Math.min(85, Math.max(15, (x(hover!) / W) * 100))}%` }}
          >
            <div className="text-muted">{hourLabel(hv.hour)}–{hourLabel((hv.hour + 1) % 24)}</div>
            <div className="num"><span className="text-muted">Sales</span> <span className="font-medium text-ink">{money(hv.sales)}</span>{hv.orders ? <span className="text-muted"> · {hv.orders} orders</span> : null}</div>
            <div className="num"><span className="text-muted">Labor</span> <span className="font-medium text-ink">{money(hv.labor)}</span>{hv.sales > 0 && <span className="text-muted"> · {pct(hv.labor / hv.sales, 0)}</span>}</div>
            {sched && <div className="num"><span className="text-muted">Scheduled</span> <span className="font-medium text-ink">{money(hv.scheduled)}</span>{hv.scheduled > 0 && Math.abs(hv.labor - hv.scheduled) >= 1 && <span className={hv.labor > hv.scheduled ? "text-bad" : "text-good"}> · {hv.labor > hv.scheduled ? "+" : "−"}{money(Math.abs(hv.labor - hv.scheduled))}</span>}</div>}
            {hv.orders > 0 && hv.laborHours > 0 && <div className="num"><span className="text-muted">Orders per labor hour</span> <span className="font-medium text-ink">{(hv.orders / hv.laborHours).toFixed(1)}</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}
