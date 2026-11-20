"use client";

import { cx } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import { VIZ_VARS } from "../viz-vars";

/*
 * Profit by day charts. Colours are the P&L's own, one per job: food & drink
 * cost violet, wages pink, card fees teal, what's left blue (--viz-*, see
 * ../story-charts). A day or an hour that lost money is the "bad" status
 * colour, and always says so in words beside it.
 */

function useWidth(min = 240) {
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

const dollars = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const compact = (n: number) => {
  const a = Math.abs(n);
  return `${n < 0 ? "−" : ""}${a >= 10_000 ? `$${Math.round(a / 1000)}K` : a >= 1_000 ? `$${(a / 1000).toFixed(1).replace(/\.0$/, "")}K` : `$${Math.round(a)}`}`;
};

/** Round ticks across a range that may cross zero. */
function ticksAcross(lo: number, hi: number, want = 4): number[] {
  const raw = Math.max(hi - lo, 1e-9) / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.abs(v) < step / 1000 ? 0 : v);
  return out;
}

// ---- Every open day, as a dot ------------------------------------------------------------------

export interface StripRow {
  key: string;
  name: string;
  /** A typical day's left-over, and how many of the days lost money. */
  mean: number;
  lost: number;
  days: { date: string; label: string; sales: number; left: number }[];
}

/**
 * One row per weekday, one dot per open day, placed by what the day left after
 * food, drink, wages and card fees. Dots left of the zero line lost money. The
 * dark tick is the weekday's average; the grey line is a day's share of rent.
 */
export function DayStrip({ rows, fixed, recent = 0 }: { rows: StripRow[]; fixed: number | null; recent?: number }) {
  const { ref, w: W } = useWidth(260);
  const [hover, setHover] = useState<{ row: number; i: number } | null>(null);
  const all = rows.flatMap((r) => r.days.map((d) => d.left)).sort((a, b) => a - b);
  if (!all.length) return null;
  // The odd record day or disaster is pinned to the edge so it doesn't squash everything else.
  const q = (p: number) => all[Math.min(all.length - 1, Math.max(0, Math.round(p * (all.length - 1))))];
  const lo = Math.min(0, q(0.01));
  const hi = Math.max(fixed ?? 0, q(0.99), 1);
  const ticks = ticksAcross(lo, hi);
  const min = Math.min(lo, ticks[0]);
  const max = Math.max(hi, ticks[ticks.length - 1]);
  const ROW = 38;
  const pad = { top: 20, right: 62, bottom: 22, left: 40 };
  const H = pad.top + rows.length * ROW + pad.bottom;
  const x = (v: number) => pad.left + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (W - pad.left - pad.right);
  const yRow = (r: number) => pad.top + r * ROW + ROW / 2;
  const hv = hover ? rows[hover.row].days[hover.i] : null;

  return (
    <div className={VIZ_VARS}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: "var(--viz-profit)" }} /> A day that paid for itself</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-full bg-bad" /> A day that lost money</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-ink" /> The weekday&apos;s average</span>
        {recent > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-full border-[1.5px] border-ink" /> Ringed: its last {recent}</span>}
      </div>
      <div className="relative" ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`What each open day left, by weekday. ${rows.map((r) => `${r.name}: ${dollars(r.mean)} on average, ${r.lost} of ${r.days.length} lost money`).join(". ")}.`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={pad.top} y2={H - pad.bottom} stroke={t === 0 ? "var(--border-strong)" : "var(--border)"} strokeWidth={1} />
              <text x={x(t)} y={H - 6} textAnchor="middle" className={cx("num text-[11px]", t === 0 ? "fill-ink-2" : "fill-muted")}>{compact(t)}</text>
            </g>
          ))}
          {fixed != null && fixed > min && fixed < max && (
            <g>
              <line x1={x(fixed)} x2={x(fixed)} y1={pad.top - 4} y2={H - pad.bottom} stroke="var(--muted)" strokeWidth={1} />
              <text x={x(fixed)} y={10} textAnchor="middle" className="fill-muted text-[11px]">a day&apos;s share of rent</text>
            </g>
          )}
          <text x={W} y={10} textAnchor="end" className="fill-muted text-[11px]">average</text>
          {rows.map((r, ri) => (
            <g key={r.key}>
              <text x={0} y={yRow(ri)} dy="0.34em" className="fill-ink-2 text-[11px] font-medium">{r.name.slice(0, 3)}</text>
              {r.days.map((d, i) => {
                const on = hover?.row === ri && hover.i === i;
                const late = recent > 0 && i >= r.days.length - recent;
                return (
                  <circle
                    key={d.date}
                    cx={x(d.left)}
                    cy={yRow(ri) + ((((i * 37) % 11) - 5) * 2.2)}
                    r={on ? 5.5 : 4}
                    fill={d.left < 0 ? "var(--bad)" : "var(--viz-profit)"}
                    fillOpacity={on || late ? 1 : 0.55}
                    stroke={late && !on ? "var(--ink)" : "var(--surface)"}
                    strokeWidth={on ? 2 : late ? 1.25 : 0.75}
                    onMouseEnter={() => setHover({ row: ri, i })}
                    onTouchStart={() => setHover({ row: ri, i })}
                  />
                );
              })}
              <line x1={x(r.mean)} x2={x(r.mean)} y1={yRow(ri) - 14} y2={yRow(ri) + 14} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
              <text x={W} y={yRow(ri)} dy="0.34em" textAnchor="end" className={cx("num text-xs font-semibold", r.mean < 0 ? "fill-bad" : "fill-ink")}>{dollars(r.mean)}</text>
            </g>
          ))}
        </svg>
        {hv && hover && (
          <div className="pointer-events-none absolute z-10 w-44 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-md" style={{ left: Math.min(Math.max(x(hv.left), 92), W - 92), top: Math.max(0, yRow(hover.row) - 74) }}>
            <div className="mb-1 text-muted">{hv.label}</div>
            <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Sales</span><span className="num font-medium text-ink">{dollars(hv.sales)}</span></div>
            <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">{hv.left < 0 ? "Lost" : "Left over"}</span><span className={cx("num font-semibold", hv.left < 0 ? "text-bad" : "text-ink")}>{dollars(Math.abs(hv.left))}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Hour by hour ------------------------------------------------------------------------------

export interface HourDay {
  key: string;
  name: string;
  hours: { hour: number; label: string; sales: number; kept: number; labor: number; trading: boolean }[];
}

/**
 * A typical day of one weekday, hour by hour: what the hour's sales leave
 * after food, drink and card fees, next to the wages on the clock. An hour
 * where wages are the taller bar loses money, and sits on a soft band.
 */
export function HourBars({ days, initial }: { days: HourDay[]; initial: string }) {
  const { ref, w: W } = useWidth(260);
  const [pick, setPick] = useState(initial);
  const [hover, setHover] = useState<number | null>(null);
  const day = days.find((d) => d.key === pick) ?? days[0];
  if (!day) return null;
  const H = 210;
  const pad = { top: 10, right: 4, bottom: 22, left: 40 };
  const top = Math.max(1, ...day.hours.map((h) => Math.max(h.kept, h.labor))) * 1.08;
  const ticks = ticksAcross(0, top, 3);
  const max = Math.max(top, ticks[ticks.length - 1]);
  const band = (W - pad.left - pad.right) / Math.max(1, day.hours.length);
  const bar = Math.max(4, Math.min(14, band * 0.3));
  const x = (i: number) => pad.left + band * i + band / 2;
  const y = (v: number) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);
  const labelEvery = Math.max(1, Math.ceil(30 / band));
  const col = (cx0: number, v: number, fill: string) => {
    const h = Math.max(0, y(0) - y(v));
    const r = Math.min(4, h, bar / 2);
    return h <= 0 ? null : <path d={`M${cx0},${y(0)}V${y(v) + r}Q${cx0},${y(v)} ${cx0 + r},${y(v)}H${cx0 + bar - r}Q${cx0 + bar},${y(v)} ${cx0 + bar},${y(v) + r}V${y(0)}z`} fill={fill} />;
  };
  const hv = hover == null ? null : day.hours[hover];

  return (
    <div className={VIZ_VARS}>
      {days.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="group" aria-label="Weekday">
          {days.map((d) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={d.key === day.key}
              onClick={() => {
                setPick(d.key);
                setHover(null);
              }}
              className={cx("min-h-8 rounded-md px-2.5 text-sm transition-colors duration-120", d.key === day.key ? "bg-primary font-medium text-primary-ink" : "text-ink-2 hover:bg-surface-2")}
            >
              {d.name.slice(0, 3)}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: "var(--viz-profit)" }} /> What the hour&apos;s sales leave after food and drink</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: "var(--viz-labor)" }} /> Wages on the clock</span>
      </div>
      <div className="relative" ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`A typical ${day.name}, hour by hour: what sales leave against wages on the clock`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{compact(t)}</text>
            </g>
          ))}
          {day.hours.map((h, i) => {
            const losing = h.trading && h.labor > h.kept;
            return (
              <g key={h.hour} opacity={hover == null || hover === i ? 1 : 0.55} className="transition-opacity duration-180">
                {losing && <rect x={x(i) - band / 2 + 1} y={pad.top - 6} width={band - 2} height={H - pad.top + 4} rx={6} fill="var(--surface-2)" />}
                {col(x(i) - bar - 1, h.kept, "var(--viz-profit)")}
                {col(x(i) + 1, h.labor, "var(--viz-labor)")}
                {i % labelEvery === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" className={cx("text-[11px]", losing ? "fill-ink font-medium" : "fill-muted")}>{h.label}</text>}
              </g>
            );
          })}
          <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
          {day.hours.map((h, i) => (
            <rect
              key={`hit-${h.hour}`}
              x={x(i) - band / 2}
              y={0}
              width={band}
              height={H}
              fill="transparent"
              tabIndex={0}
              aria-label={`${h.label}: sales ${dollars(h.sales)}, leaving ${dollars(h.kept)} after food and drink, wages ${dollars(h.labor)}`}
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
            <div className="mb-1 text-muted">{day.name}, from {hv.label}</div>
            <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Sales</span><span className="num font-medium text-ink">{dollars(hv.sales)}</span></div>
            <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Left after food and drink</span><span className="num font-medium text-ink">{dollars(hv.kept)}</span></div>
            <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Wages on the clock</span><span className="num font-medium text-ink">{dollars(hv.labor)}</span></div>
            <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">{hv.kept - hv.labor < 0 ? "Lost" : "Left over"}</span><span className={cx("num font-semibold", hv.kept - hv.labor < 0 ? "text-bad" : "text-ink")}>{dollars(Math.abs(hv.kept - hv.labor))}</span></div>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        {day.hours.some((h) => h.trading && h.labor > h.kept) ? "Shaded hours cost more in wages than their sales leave." : `No trading hour on a ${day.name} costs more in wages than its sales leave.`} Hours before the first sale and after the last are setting up and closing down.
      </p>
      <div className="sr-only">
        <table data-no-resize="">
          <caption>A typical {day.name}, hour by hour</caption>
          <thead><tr><th>Hour</th><th>Sales</th><th>Left after food and drink</th><th>Wages</th></tr></thead>
          <tbody>
            {day.hours.map((h) => (
              <tr key={h.hour}><td>{h.label}</td><td>{dollars(h.sales)}</td><td>{dollars(h.kept)}</td><td>{dollars(h.labor)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
