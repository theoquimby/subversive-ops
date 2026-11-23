"use client";

import { Numbers } from "@/components/chapter";
import { Table, Td, Th, Tr } from "@/components/ui";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Charts for the Online pages, hand-built SVG in the house style: a 2px line
 * or thin bars in the page's hue, the period before as a dashed grey line, a
 * recessive hairline grid, one axis per chart. Drawn at the container's real
 * width so the text stays readable on a phone. Hover (or tap) a point for its
 * numbers; the same numbers sit in a table behind "Day by day".
 *
 * Days a source hasn't sent yet are never drawn as zeros: the line stops at the
 * last day in, and the rest of the period is a hatched "Not in yet" band.
 */

const HUE = "var(--area)";
const CONTEXT = "color-mix(in oklab, var(--ink) 32%, var(--surface))";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useWidth(fallback = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(220, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

const day = (iso: string, weekday = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(weekday ? { weekday: "short" } : {}) });
/** A day ("Sat, Nov 14") or the week a point covers ("Nov 8 to Nov 14"). */
const when = (x: string, to: string, long = true) => (x === to ? day(x, long) : `${day(x)} to ${day(to)}`);
const full = (n: number) => Math.round(n).toLocaleString("en-US");
/** Axis labels: 750, 1.25k, 12k. Exact, so the middle grid line never shows a rounded-off number. */
const short = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(2)}k` : `${Math.round(n)}`);

/** The top of the axis: a tidy number just above the data whose half is tidy too (the middle grid line). */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const top = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].map((m) => Math.round(m * mag)).find((s) => s >= v) ?? v;
  // Single digits: an even top, so the halfway line is a whole number.
  return top % 2 ? top + 1 : top;
}

function Tip({ x, w, children }: { x: number; w: number; children: ReactNode }) {
  const half = 84;
  const left = Math.min(Math.max(x, half), Math.max(half, w - half));
  return (
    <div role="status" className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded-lg border border-border bg-surface/95 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-[0_6px_24px_-8px_rgb(0_0_0/0.25)] backdrop-blur-sm" style={{ left }}>
      {children}
    </div>
  );
}

/** The chart's numbers, folded away under it: a screen reader or a curious eye opens it, nobody else wades through it. */
function ChartNumbers({ weekly, caption, head, rows }: { weekly: boolean; caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <Numbers label={weekly ? "Week by week" : "Day by day"}>
      <Table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, j) => (
              <Th key={h} align={j === 0 ? "left" : "right"}>{h}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Tr key={i}>
              {r.map((c, j) => (
                <Td key={j} align={j === 0 ? "left" : "right"} className={j === 0 ? "text-ink-2" : "num text-ink"}>{c}</Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </Table>
    </Numbers>
  );
}

/** A diagonal hatch for the part of a chart whose days aren't in yet. */
function Hatch({ id }: { id: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="var(--border-strong)" strokeWidth="1.5" />
    </pattern>
  );
}

const NOT_IN = "Not in yet";

function LineKey({ dashed, color, children }: { dashed?: boolean; color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <svg width="16" height="6" aria-hidden className="shrink-0">
        <line x1="1" x2="15" y1="3" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />
      </svg>
      {children}
    </span>
  );
}

const Empty = () => <p className="py-6 text-sm text-muted">Nothing recorded in this period yet.</p>;

export interface TrendDatum {
  x: string;
  to: string;
  cur: number;
  prev: number | null;
  /** The source hasn't sent (all of) this point yet: not drawn, never a zero. */
  missing?: boolean;
}

/**
 * One measure over the period, with the same days (or weeks) of the period
 * before as a dashed line. `unit` finishes the tooltip's sentence: "312 visits".
 */
interface TrendProps {
  points: TrendDatum[];
  title: string;
  unit: string;
  period: string;
  height?: number;
  /** Off when several of these share one key above them (see TrendKey). */
  legend?: boolean;
  /** The line's colour: the channel it counts (see ./channel). */
  color?: string;
}

/** The key for a card of trends: the solid line is this period, the dashed one the period before. */
export function TrendKey({ period, color = HUE }: { period: string; color?: string }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <LineKey color={color}>This period</LineKey>
      <LineKey dashed color={CONTEXT}>The {period} before</LineKey>
    </div>
  );
}

// The chart measures its own container, so it only mounts when there is something to draw.
export const Trend = (p: TrendProps) => (p.points.length ? <TrendChart {...p} /> : <Empty />);

function TrendChart({ points, title, unit, period, height = 128, legend = true, color = HUE }: TrendProps) {
  const { ref, w } = useWidth();
  const hatch = useId();
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const H = height;
  const pad = { t: 8, r: 8, b: 20, l: 34 };
  const hasPrev = points.some((p) => p.prev != null);
  // Missing points only ever trail the period (the source stopped, or is still catching up).
  const firstMissing = points.findIndex((p) => p.missing);
  const inN = firstMissing < 0 ? n : firstMissing;
  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.missing ? 0 : p.cur, p.prev ?? 0))));
  const sx = (i: number) => pad.l + (n <= 1 ? (w - pad.l - pad.r) / 2 : (i / (n - 1)) * (w - pad.l - pad.r));
  const sy = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (get: (p: TrendDatum) => number | null) =>
    points
      .map((p, i) => [i, get(p)] as const)
      .filter(([, v]) => v != null)
      .map(([i, v], k) => `${k ? "L" : "M"}${sx(i).toFixed(1)},${sy(v!).toFixed(1)}`)
      .join(" ");
  const line = path((p) => (p.missing ? null : p.cur));
  const step = n > 1 ? (w - pad.l - pad.r) / (n - 1) : w - pad.l - pad.r;
  const marks = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
  const weekly = points.some((p) => p.x !== p.to);
  const h = hover == null ? null : points[hover];
  const bandX = inN === n ? null : inN === 0 ? pad.l : (sx(inN - 1) + sx(inN)) / 2;
  const inTotal = points.reduce((s, p) => s + (p.missing ? 0 : p.cur), 0);
  const label = `${title}, ${weekly ? "week by week" : "day by day"}: ${full(inTotal)} ${unit} from ${day(points[0].x)} to ${day(points[Math.max(0, inN - 1)].to)}${inN < n ? `; ${day(points[inN].x)} on isn't in yet` : ""}`;
  return (
    <figure className="min-w-0">
      <div ref={ref} className="relative w-full select-none" onMouseLeave={() => setHover(null)}>
        <svg width={w} height={H} className="block" role="img" aria-label={label}>
          <defs>
            <Hatch id={hatch} />
          </defs>
          {bandX != null && (
            <g>
              <rect x={bandX} y={pad.t} width={Math.max(0, w - pad.r - bandX)} height={H - pad.t - pad.b} fill={`url(#${hatch})`} opacity={0.6} />
              {w - pad.r - bandX > 56 && (
                <text x={(bandX + w - pad.r) / 2} y={pad.t + 14} textAnchor="middle" className="fill-muted text-[11px]">{NOT_IN}</text>
              )}
            </g>
          )}
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--border)" />
              <text x={pad.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{short(t)}</text>
            </g>
          ))}
          {marks.map((i, k) => (
            <text key={i} x={n === 1 ? sx(0) : sx(i)} y={H - 4} textAnchor={n === 1 ? "middle" : k === 0 ? "start" : k === marks.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]">{day(points[i].x)}</text>
          ))}
          {inN > 1 && <path d={`${line} L${sx(inN - 1).toFixed(1)},${sy(0)} L${sx(0).toFixed(1)},${sy(0)} Z`} fill={color} opacity={0.07} />}
          {hasPrev && n > 1 && <path d={path((p) => p.prev)} fill="none" stroke={CONTEXT} strokeWidth={1.5} strokeDasharray="3 3" strokeLinejoin="round" />}
          {inN > 1 ? <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : inN === 1 && <circle cx={sx(0)} cy={sy(points[0].cur)} r={4} fill={color} />}
          {h && (
            <>
              <line x1={sx(hover!)} x2={sx(hover!)} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" />
              {h.prev != null && <circle cx={sx(hover!)} cy={sy(h.prev)} r={3.5} fill={CONTEXT} stroke="var(--surface)" strokeWidth={2} />}
              {!h.missing && <circle cx={sx(hover!)} cy={sy(h.cur)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />}
            </>
          )}
          {points.map((p, i) => (
            <rect key={p.x} x={sx(i) - step / 2} y={0} width={Math.max(step, 6)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
        {h && (
          <Tip x={sx(hover!)} w={w}>
            <div className="text-muted">{when(h.x, h.to)}</div>
            {h.missing ? (
              <div className="font-medium text-ink-2">{weekly && h.cur > 0 ? `${full(h.cur)} ${unit} so far, not all in yet` : NOT_IN}</div>
            ) : (
              <div className="num font-semibold text-ink">{full(h.cur)} <span className="font-normal text-muted">{unit}</span></div>
            )}
            {h.prev != null && <div className="num text-muted">{full(h.prev)} the same {weekly ? "week" : "day"} before</div>}
          </Tip>
        )}
      </div>
      {hasPrev && legend && (
        <figcaption className="mt-1.5">
          <TrendKey period={period} color={color} />
        </figcaption>
      )}
      <ChartNumbers
        weekly={weekly}
        caption={title}
        head={[weekly ? "Week" : "Day", unit[0].toUpperCase() + unit.slice(1), ...(hasPrev ? [`The ${period} before`] : [])]}
        rows={points.map((p) => [when(p.x, p.to, false), p.missing ? <span className="text-muted">{NOT_IN}</span> : full(p.cur), ...(hasPrev ? [p.prev != null ? full(p.prev) : "—"] : [])])}
      />
    </figure>
  );
}

export interface StackSeries {
  label: string;
  fill: string;
  opacity: number;
}

/**
 * Thin stacked bars over time, one bar a day or a week: how a total splits
 * into a few named parts. The first series sits on the baseline.
 */
interface StackProps {
  points: { x: string; to: string; values: number[]; missing?: boolean }[];
  series: StackSeries[];
  title: string;
  unit: string;
  height?: number;
}

export const StackBars = (p: StackProps) => (p.points.length ? <StackChart {...p} /> : <Empty />);

function StackChart({ points, series, title, unit, height = 184 }: StackProps) {
  const { ref, w } = useWidth();
  const hatch = useId();
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const H = height;
  const pad = { t: 8, r: 6, b: 20, l: 34 };
  const total = (p: { values: number[] }) => p.values.reduce((s, v) => s + v, 0);
  const max = niceMax(Math.max(1, ...points.filter((p) => !p.missing).map(total)));
  const slot = (w - pad.l - pad.r) / n;
  const bw = Math.max(1, Math.min(20, slot * 0.72));
  const sy = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const cx = (i: number) => pad.l + i * slot + slot / 2;
  const marks = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
  const weekly = points.some((p) => p.x !== p.to);
  const h = hover == null ? null : points[hover];
  return (
    <figure className="min-w-0">
      <div ref={ref} className="relative w-full select-none" onMouseLeave={() => setHover(null)}>
        <svg width={w} height={H} className="block" role="img" aria-label={`${title}, ${weekly ? "week by week" : "day by day"}, from ${day(points[0].x)} to ${day(points[n - 1].to)}`}>
          <defs>
            <Hatch id={hatch} />
          </defs>
          {points.map((p, i) => p.missing && <rect key={`m${p.x}`} x={cx(i) - bw / 2} y={pad.t} width={bw} height={H - pad.t - pad.b} fill={`url(#${hatch})`} opacity={0.6} />)}
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--border)" />
              <text x={pad.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{short(t)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            let at = 0;
            return (
              <g key={p.x} opacity={hover == null || hover === i ? 1 : 0.55}>
                {p.values.map((v, k) => {
                  if (v <= 0 || p.missing) return null;
                  const y0 = sy(at);
                  const y1 = sy(at + v);
                  at += v;
                  // A hairline of surface between the parts, where the bar is tall enough to spare it.
                  const gap = k > 0 && y0 - y1 > 3 ? 1 : 0;
                  return <rect key={k} x={cx(i) - bw / 2} y={y1} width={bw} height={Math.max(0.5, y0 - y1 - gap)} rx={bw > 5 ? 1.5 : 0} fill={series[k]?.fill ?? HUE} opacity={series[k]?.opacity ?? 1} />;
                })}
              </g>
            );
          })}
          {marks.map((i, k) => (
            <text key={i} x={k === 0 ? pad.l : k === marks.length - 1 ? w - pad.r : cx(i)} y={H - 4} textAnchor={k === 0 ? "start" : k === marks.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]">{day(points[i].x)}</text>
          ))}
          {points.map((p, i) => (
            <rect key={p.x} x={pad.l + i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
        {h && (
          <Tip x={cx(hover!)} w={w}>
            <div className="text-muted">{when(h.x, h.to)}</div>
            {h.missing ? (
              <div className="font-medium text-ink-2">{NOT_IN}</div>
            ) : (
              <div className="num font-semibold text-ink">{full(total(h))} <span className="font-normal text-muted">{unit}</span></div>
            )}
            {!h.missing && series.map((s, k) => (
              <div key={s.label} className="num flex items-center gap-1.5 text-muted">
                <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: s.fill, opacity: s.opacity }} />
                {full(h.values[k] ?? 0)} {s.label.toLowerCase()}
              </div>
            ))}
          </Tip>
        )}
      </div>
      <figcaption className="mt-1.5">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => (
            <li key={s.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: s.fill, opacity: s.opacity }} />
              {s.label}
            </li>
          ))}
        </ul>
      </figcaption>
      <ChartNumbers
        weekly={weekly}
        caption={title}
        head={[weekly ? "Week" : "Day", ...series.map((s) => s.label), "Total"]}
        rows={points.map((p) => [when(p.x, p.to, false), ...(p.missing ? [...series.map(() => "—"), <span key="m" className="text-muted">{NOT_IN}</span>] : [...series.map((_, k) => full(p.values[k] ?? 0)), full(total(p))])])}
      />
    </figure>
  );
}
