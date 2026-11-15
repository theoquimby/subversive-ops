"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Hand-built SVG charts for website analytics, in the app's chart language:
 * 2px lines, ≤ 10px bars with a rounded data end, a recessive hairline grid,
 * one accent hue (--series-1) for "this period" and neutral grey for context,
 * a crosshair + tooltip on hover (tap on phones), and a hidden table twin for
 * screen readers. One axis per chart, always.
 */

const ACCENT = "var(--series-1)";
const CONTEXT = "color-mix(in oklab, var(--ink) 30%, var(--surface))";
const CONTEXT_SOFT = "color-mix(in oklab, var(--ink) 12%, var(--surface))";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useWidth(fallback = 340) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

const fmtDay = (iso: string, long = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(long ? { weekday: "short" } : {}) });
const fmtNum = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const fmtMoney = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`);

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= v) ?? v);
}

function Tip({ x, w, children }: { x: number; w: number; children: ReactNode }) {
  const half = 80;
  const left = Math.min(Math.max(x, half), Math.max(half, w - half));
  return (
    <div role="status" className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded-lg border border-border bg-surface/95 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-[0_6px_24px_-8px_rgb(0_0_0/0.25)] backdrop-blur-sm" style={{ left }}>
      {children}
    </div>
  );
}

function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>
        ))}
      </tbody>
    </table>
  );
}

/** Legend chip: a short line in the series' color, then the name in text color. */
export function Key({ dashed, children, color = ACCENT }: { dashed?: boolean; children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <svg width="16" height="6" aria-hidden className="shrink-0">
        <line x1="1" x2="15" y1="3" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />
      </svg>
      {children}
    </span>
  );
}

// ---- Trend: this period vs the one before -----------------------------------------------

export function TrendChart({ points, label, prevLabel, height = 200, money = false }: { points: { x: string; cur: number; prev?: number | null }[]; label: string; prevLabel?: string; height?: number; money?: boolean }) {
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const pad = { t: 10, r: 8, b: 22, l: 36 };
  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.cur, p.prev ?? 0))) * 1.05);
  const n = points.length;
  const sx = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r));
  const sy = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (get: (p: (typeof points)[number]) => number | null | undefined) =>
    points
      .map((p, i) => [i, get(p)] as const)
      .filter(([, v]) => v != null)
      .map(([i, v], k) => `${k ? "L" : "M"}${sx(i).toFixed(1)},${sy(v!).toFixed(1)}`)
      .join(" ");
  const area = `${path((p) => p.cur)} L${sx(n - 1).toFixed(1)},${sy(0)} L${sx(0).toFixed(1)},${sy(0)} Z`;
  const hasPrev = points.some((p) => p.prev != null && p.prev > 0);
  const fmt = money ? fmtMoney : fmtNum;
  const step = n > 1 ? (w - pad.l - pad.r) / (n - 1) : w;
  const h = hover == null ? null : points[hover];
  const ticks = [0, max / 2, max];
  // Thin out x labels: first, middle, last.
  const xl = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
  return (
    <figure className="min-w-0">
      <div ref={ref} className="relative w-full select-none" onMouseLeave={() => setHover(null)}>
        <svg width={w} height={H} className="block" aria-hidden>
          <defs>
            <linearGradient id="wa-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--series-1)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--border)" />
              <text x={pad.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[10.5px]">{fmt(t)}</text>
            </g>
          ))}
          {xl.map((i) => (
            <text key={i} x={sx(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-muted text-[10.5px]">{fmtDay(points[i].x)}</text>
          ))}
          {n > 1 && <path d={area} fill="url(#wa-area)" />}
          {hasPrev && <path d={path((p) => p.prev ?? null)} fill="none" stroke={CONTEXT} strokeWidth={1.5} strokeDasharray="3 3" strokeLinejoin="round" />}
          <path d={path((p) => p.cur)} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h && (
            <>
              <line x1={sx(hover!)} x2={sx(hover!)} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" />
              {h.prev != null && hasPrev && <circle cx={sx(hover!)} cy={sy(h.prev)} r={3.5} fill={CONTEXT} stroke="var(--surface)" strokeWidth={2} />}
              <circle cx={sx(hover!)} cy={sy(h.cur)} r={4.5} fill={ACCENT} stroke="var(--surface)" strokeWidth={2} />
            </>
          )}
          {points.map((p, i) => (
            <rect key={p.x} x={sx(i) - step / 2} y={0} width={Math.max(step, 4)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
        {h && (
          <Tip x={sx(hover!)} w={w}>
            <div className="text-muted">{fmtDay(h.x, true)}</div>
            <div className="num font-semibold text-ink">{money ? `$${Math.round(h.cur).toLocaleString("en-US")}` : Math.round(h.cur).toLocaleString("en-US")} <span className="font-normal text-muted">{label.toLowerCase()}</span></div>
            {hasPrev && h.prev != null && <div className="num text-muted">{Math.round(h.prev).toLocaleString("en-US")} the same day before</div>}
          </Tip>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Key>{label}</Key>
        {hasPrev && <Key dashed color={CONTEXT}>{prevLabel ?? "Previous period"}</Key>}
      </figcaption>
      <SrTable caption={label} head={["Day", label, ...(hasPrev ? ["Previous period"] : [])]} rows={points.map((p) => [p.x, p.cur, ...(hasPrev ? [p.prev ?? ""] : [])])} />
    </figure>
  );
}

// ---- Website actions and sales: two small multiples on one time axis ---------------------

export function LinkChart({ days, what }: { days: { x: string; sales: number | null; actions: number; event: boolean }[]; what: string }) {
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = days.length;
  const pad = { l: 40, r: 6 };
  const band = 74;
  const gap = 18;
  const H = band * 2 + gap + 50;
  const sMax = niceMax(Math.max(1, ...days.map((d) => d.sales ?? 0)));
  const aMax = niceMax(Math.max(1, ...days.map((d) => d.actions)));
  const bw = Math.max(1, (w - pad.l - pad.r) / Math.max(1, n));
  const x = (i: number) => pad.l + i * bw;
  const top1 = 14;
  const top2 = top1 + band + gap + 14;
  const d = hover == null ? null : days[hover];
  return (
    <figure className="min-w-0">
      <div ref={ref} className="relative w-full select-none" onMouseLeave={() => setHover(null)}>
        <svg width={w} height={H} className="block" aria-hidden>
          <text x={pad.l} y={top1 - 4} className="fill-muted text-[10.5px] font-medium">Square sales a day</text>
          <line x1={pad.l} x2={w - pad.r} y1={top1 + band} y2={top1 + band} stroke="var(--border)" />
          <text x={pad.l - 6} y={top1 + 6} dy="0.32em" textAnchor="end" className="num fill-muted text-[10.5px]">{fmtMoney(sMax)}</text>
          {days.map((v, i) =>
            v.sales ? <rect key={`s${v.x}`} x={x(i) + (bw > 3 ? 0.5 : 0)} y={top1 + band - (v.sales / sMax) * band} width={Math.max(0.8, bw - (bw > 3 ? 1 : 0))} height={(v.sales / sMax) * band} rx={bw > 4 ? 1.5 : 0} fill={hover === i ? "var(--ink-2)" : v.event ? CONTEXT_SOFT : CONTEXT} /> : null,
          )}
          <text x={pad.l} y={top2 - 4} className="fill-muted text-[10.5px] font-medium">{what[0].toUpperCase() + what.slice(1)} on the website</text>
          <line x1={pad.l} x2={w - pad.r} y1={top2 + band} y2={top2 + band} stroke="var(--border)" />
          <text x={pad.l - 6} y={top2 + 6} dy="0.32em" textAnchor="end" className="num fill-muted text-[10.5px]">{fmtNum(aMax)}</text>
          {days.map((v, i) => (v.actions ? <rect key={`a${v.x}`} x={x(i) + (bw > 3 ? 0.5 : 0)} y={top2 + band - (v.actions / aMax) * band} width={Math.max(0.8, bw - (bw > 3 ? 1 : 0))} height={(v.actions / aMax) * band} rx={bw > 4 ? 1.5 : 0} fill={ACCENT} opacity={hover == null || hover === i ? 1 : 0.55} /> : null))}
          {n > 1 && (
            <>
              <text x={pad.l} y={H - 4} className="fill-muted text-[10.5px]">{fmtDay(days[0].x)}</text>
              <text x={w - pad.r} y={H - 4} textAnchor="end" className="fill-muted text-[10.5px]">{fmtDay(days[n - 1].x)}</text>
            </>
          )}
          {days.map((v, i) => (
            <rect key={`h${v.x}`} x={x(i)} y={0} width={bw} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
        {d && (
          <Tip x={x(hover!) + bw / 2} w={w}>
            <div className="text-muted">{fmtDay(d.x, true)}{d.event ? " · event day (left out)" : ""}</div>
            <div className="num font-semibold text-ink">{d.sales ? `$${Math.round(d.sales).toLocaleString("en-US")} sales` : "Closed"}</div>
            <div className="num text-muted">{d.actions} {what}</div>
          </Tip>
        )}
      </div>
      <SrTable caption={`Square sales and ${what} by day`} head={["Day", "Sales", what]} rows={days.map((v) => [v.x, v.sales ?? 0, v.actions])} />
    </figure>
  );
}

// ---- Rate with its likely range, against the site-wide rate --------------------------------

export function RateRange({ rate, low, high, overall, max }: { rate: number | null; low: number | null; high: number | null; overall: number; max: number }) {
  if (rate == null) return <span className="text-muted">—</span>;
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="relative h-4 w-full min-w-24" role="img" aria-label={`${Math.round(rate * 100)}%, likely ${Math.round((low ?? rate) * 100)}–${Math.round((high ?? rate) * 100)}%`}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <div className="absolute top-0.5 bottom-0.5 w-px bg-ink-2/50" style={{ left: pos(overall) }} title="Whole site" />
      {low != null && high != null && <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})`, background: "color-mix(in oklab, var(--series-1) 35%, var(--surface))" }} />}
      <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface" style={{ left: pos(rate), background: ACCENT }} />
    </div>
  );
}

// ---- Share bars (server-safe markup, used in lists) --------------------------------------

export function ShareBar({ value, max, className }: { value: number; max: number; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full", className)} style={{ background: CONTEXT_SOFT }}>
      <div className="h-full rounded-full" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, background: ACCENT }} />
    </div>
  );
}
