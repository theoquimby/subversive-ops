"use client";

import { cx } from "@/components/ui";
import { useEffect, useRef, useState } from "react";

/*
 * A stacked column chart in the house style: thin columns from one baseline,
 * a 2px gap between parts, a recessive grid, and a line of detail on hover,
 * focus or tap. Colours come in as CSS values (usually variables set by the
 * page's own palette class), so each page keeps one colour per job.
 */

const GAP = 2;

function useWidth(min = 220) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [min]);
  return { ref, w };
}

export interface Col {
  key: string;
  label: string;
  /** A second line under the label, when there's room for one. */
  sub?: string;
  /** The column the story is about. */
  mark?: boolean;
  /** One value per series, bottom first. */
  parts: number[];
  /** A mark across the column at this value (where sales were, when the costs stacked past them). */
  tick?: number;
  /** The data for this column isn't in yet (not synced, not counted): drawn as an outline, never as zero. */
  missing?: boolean;
  tip: { title: string; rows: { color?: string; label: string; value: string; strong?: boolean }[] };
}

const compactMoney = (n: number) => (n >= 10_000 ? `$${Math.round(n / 1000)}K` : n >= 1_000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : `$${Math.round(n)}`);
const plain = (n: number) => Math.round(n).toLocaleString("en-US");

function niceTicks(max: number): number[] {
  const raw = Math.max(max, 1e-9) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) out.push(v);
  if (out.at(-1)! < max) out.push(out.at(-1)! + step);
  return out;
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}

/**
 * Columns split into who or what they're made of, with a line of detail on
 * hover or tap. The marked column sits on a soft band; a second label line
 * (a share, say) shows when the columns are wide enough to carry it.
 */
export function ColumnsChart({ cols, series, money = true, height = 200, ariaLabel, caption, className, tickLabel }: { cols: Col[]; series: { color: string; label: string }[]; money?: boolean; height?: number; ariaLabel: string; caption: string; className?: string; tickLabel?: string }) {
  const { ref, w: W } = useWidth(240);
  const [hover, setHover] = useState<number | null>(null);
  const fmt = money ? compactMoney : plain;
  const band0 = (W - 44) / Math.max(1, cols.length);
  const subs = cols.some((c) => c.sub) && band0 >= 46;
  const H = height + (subs ? 14 : 0);
  const pad = { top: 10, right: 4, bottom: subs ? 36 : 22, left: 40 };
  const max = Math.max(1, ...cols.filter((c) => !c.missing).map((c) => Math.max(c.tick ?? 0, c.parts.reduce((s, v) => s + Math.max(0, v), 0)))) * 1.06;
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const band = (W - pad.left - pad.right) / Math.max(1, cols.length);
  const barW = Math.max(5, Math.min(24, band * 0.62));
  const x = (i: number) => pad.left + band * i + band / 2;
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom);
  const labelEvery = Math.max(1, Math.ceil(Math.max(...cols.map((c) => c.label.length)) * 6.5 / band));
  const hv = hover == null ? null : cols[hover];

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
        {tickLabel && cols.some((c) => c.tick != null) && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded-full bg-ink" /> {tickLabel}
          </span>
        )}
      </div>
      <div className="relative" ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{fmt(t)}</text>
            </g>
          ))}
          {cols.map((c, i) => {
            const segs = c.parts.map((v, k) => ({ v: Math.max(0, v), color: series[k].color })).filter((s) => s.v > 0);
            let acc = 0;
            const last = segs.length - 1;
            return (
              <g key={c.key} opacity={hover == null || hover === i ? 1 : 0.55} className="transition-opacity duration-180">
                {c.mark && <rect x={x(i) - band / 2 + 1} y={pad.top - 6} width={band - 2} height={H - pad.top + 4} rx={6} fill="var(--surface-2)" />}
                {c.missing && <rect x={x(i) - barW / 2 + 0.5} y={y(top * 0.35)} width={barW - 1} height={y(0) - y(top * 0.35) - 0.5} rx={3} fill="none" stroke="var(--border-strong)" strokeDasharray="3 3" />}
                {!c.missing && segs.map((s, k) => {
                  const y0 = y(acc);
                  acc += s.v;
                  const y1 = y(acc);
                  const h = Math.max(0, y0 - y1 - (k < last ? GAP : 0));
                  return <path key={k} d={roundTop(x(i) - barW / 2, y1, barW, h, k === last ? Math.min(4, h) : 0)} fill={s.color} />;
                })}
                {c.tick != null && <line x1={x(i) - barW / 2 - 4} x2={x(i) + barW / 2 + 4} y1={y(c.tick)} y2={y(c.tick)} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />}
                {i % labelEvery === (cols.length - 1) % labelEvery && (
                  <text x={x(i)} y={H - (subs ? 20 : 6)} textAnchor="middle" className={cx("text-[11px]", c.mark ? "fill-ink font-medium" : "fill-muted")}>{c.label}</text>
                )}
                {subs && c.sub && (
                  <text x={x(i)} y={H - 6} textAnchor="middle" className={cx("num text-[11px]", c.mark ? "fill-ink font-semibold" : "fill-muted")}>{c.sub}</text>
                )}
              </g>
            );
          })}
          <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
          {cols.map((c, i) => (
            <rect
              key={`hit-${c.key}`}
              x={x(i) - band / 2}
              y={0}
              width={band}
              height={H}
              fill="transparent"
              tabIndex={0}
              aria-label={`${c.tip.title}: ${c.tip.rows.map((r) => `${r.label} ${r.value}`).join(", ")}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onTouchStart={() => setHover(i)}
              className="outline-none"
            />
          ))}
        </svg>
        {hv && (
          <div className="pointer-events-none absolute top-0 z-10 w-56 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-md" style={{ left: Math.min(Math.max(x(hover!), 116), W - 116) }}>
            <div className="mb-1 text-muted">{hv.tip.title}</div>
            {hv.tip.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3 py-0.5">
                <span className="inline-flex items-center gap-1.5 text-muted">
                  {r.color ? <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: r.color }} /> : <span className="w-3" />}
                  {r.label}
                </span>
                <span className={cx("num text-ink", r.strong ? "font-semibold" : "font-medium")}>{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sr-only">
        <table data-no-resize="">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th>{caption}</th>
              {series.map((s) => <th key={s.label}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.key}>
                <td>{c.tip.title}</td>
                {c.parts.map((v, k) => <td key={k}>{money ? `$${plain(v)}` : plain(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
