"use client";

import { cx } from "@/components/ui";
import { money, pct, shortDate } from "@/lib/format";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { VIZ_VARS } from "./viz-vars";

/*
 * P&L story charts. One colour per job, the global money tokens (globals.css),
 * the same on every page that draws money:
 *   sales              --money-sales (blue)
 *   food & drink cost  --money-goods (orange; an estimate is the same hue, hatched)
 *   labor              --money-wages (magenta, as on the hour-by-hour chart)
 *   card fees          --money-fees  (violet)
 *   what's kept        --money-kept  (ink: the bottom line, never a status colour)
 *   comps & discounts  grey, hatched (money that never came in)
 * The set is validated in globals.css. Values and labels stay in text tokens.
 */
export { VIZ_VARS };

/** A same-hue hatch for "estimated" (45°), over a lighter wash of that hue. */
const hatch = (color: string): CSSProperties => ({
  backgroundColor: `color-mix(in oklab, ${color} 28%, transparent)`,
  backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1.5px, transparent 1.5px 5px)`,
});

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

const whole = (n: number) => money(n, { whole: true });
const compact = (n: number) => (Math.abs(n) >= 10_000 ? `$${Math.round(n / 1000)}K` : Math.abs(n) >= 1_000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : whole(n));

export function Swatch({ kind }: { kind: "cogs" | "est" | "labor" | "profit" | "fixed" | "sales" | "fees" | "discounts" }) {
  const style: CSSProperties =
    kind === "est" ? hatch("var(--viz-cogs)") : kind === "discounts" ? hatch("var(--ink-2)") : { background: kind === "fixed" ? "var(--muted)" : kind === "sales" ? "var(--money-sales)" : `var(--viz-${kind})` };
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[3px]" style={style} />;
}

// ---- Sales → profit bridge -------------------------------------------------------------

export interface BridgeStep {
  key: "gross" | "discounts" | "sales" | "cogs" | "est" | "labor" | "fees" | "profit" | "fixed" | "after";
  label: ReactNode;
  /** Shown value (costs as positive amounts). */
  value: number;
  /** Bar start and end on the money axis. */
  from: number;
  to: number;
  /** A total (sales, profit) rather than a step. */
  total?: boolean;
  /** The figure isn't in (no timecards): no bar, a dash. */
  missing?: boolean;
  note?: ReactNode;
}

/**
 * A horizontal waterfall: sales, then each cost taken off, landing on profit.
 * One row per step with its name, a floating bar on a shared money axis and
 * the figure; on a phone the bar drops under the name. Every value is printed,
 * so nothing hides behind hover.
 */
export function BridgeChart({ steps, sales }: { steps: BridgeStep[]; sales: number }) {
  const lo = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(1, ...steps.map((s) => Math.max(s.from, s.to)));
  const span = hi - lo;
  const x = (v: number) => ((v - lo) / span) * 100;
  const zero = x(0);
  const color: Record<BridgeStep["key"], CSSProperties> = {
    gross: { background: "color-mix(in oklab, var(--money-sales) 45%, transparent)" },
    discounts: hatch("var(--ink-2)"),
    sales: { background: "var(--money-sales)" },
    cogs: { background: "var(--viz-cogs)" },
    est: hatch("var(--viz-cogs)"),
    labor: { background: "var(--viz-labor)" },
    fees: { background: "var(--viz-fees)" },
    profit: { background: "var(--viz-profit)" },
    fixed: { background: "var(--muted)" },
    after: { background: "var(--viz-profit)" },
  };
  return (
    <div className={cx("space-y-3.5 sm:space-y-2.5", VIZ_VARS)} role="list" aria-label="From sales to profit">
      {steps.map((s) => {
        const a = Math.min(s.from, s.to);
        const b = Math.max(s.from, s.to);
        const negative = s.total && s.to < 0;
        const share = sales > 0 ? s.value / sales : null;
        return (
          <div key={s.key} role="listitem" className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[9.5rem_1fr_6.5rem]">
            <div className={cx("min-w-0 truncate text-sm", s.total ? "font-medium text-ink" : "text-ink-2")}>{s.label}</div>
            <div className="relative col-span-2 h-3 sm:col-span-1 sm:col-start-2 sm:row-start-1">
              {/* zero line */}
              <div aria-hidden className="absolute inset-y-[-3px] w-px bg-border-strong" style={{ left: `${zero}%` }} />
              {!s.missing && <div
                aria-hidden
                className={cx("absolute inset-y-0 rounded-[4px] transition-[left,width] duration-260 ease-motion motion-reduce:transition-none", negative && "bg-bad!")}
                style={{ left: `${x(a)}%`, width: `max(2px, ${x(b) - x(a)}%)`, ...(negative ? {} : color[s.key]) }}
              />}
            </div>
            <div className="num col-start-2 row-start-1 text-right text-sm whitespace-nowrap sm:col-start-3">
              <span className={cx(s.total ? "font-semibold text-ink" : "text-ink-2", negative && "text-bad", s.missing && "text-muted")}>{s.missing ? "—" : s.total ? (s.to < 0 ? `−${whole(-s.to)}` : whole(s.to)) : `−${whole(s.value)}`}</span>
              {share != null && !s.missing && s.key !== "sales" && s.key !== "gross" && s.key !== "discounts" && <span className="ml-1.5 text-xs text-muted">{pct(Math.abs(s.total ? s.to : s.value) / sales, 0)}</span>}
            </div>
            {s.note && <div className="col-span-2 -mt-0.5 text-xs text-muted sm:col-span-1 sm:col-start-2">{s.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ---- Weekly trend --------------------------------------------------------------------------

export interface TrendPoint {
  weekStart: string;
  days: number;
  sales: number;
  cogs: number;
  cogsEstimate: number;
  labor: number;
  /** Card fees (0 before they were synced). */
  fees: number;
  profit: number;
  /** In the period on screen. */
  current: boolean;
}

/**
 * Each week's sales as one column, split into what it paid for: food & drink
 * cost (counted, then estimated), labor, and the profit left on top. The weeks
 * in the chosen period are full strength, the rest recede. A loss week ends
 * at its costs, with a tick where sales were.
 */
export function TrendChart({ weeks, height = 210 }: { weeks: TrendPoint[]; height?: number }) {
  const { ref, w: W } = useWidth(260);
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const pad = { top: 10, right: 4, bottom: 22, left: 40 };
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.sales, w.cogs + w.cogsEstimate + w.labor + w.fees))) * 1.08;
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const band = (W - pad.left - pad.right) / Math.max(1, weeks.length);
  const barW = Math.max(6, Math.min(24, band * 0.62));
  const x = (i: number) => pad.left + band * i + band / 2;
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom);
  const labelEvery = band < 40 ? 3 : band < 56 ? 2 : 1;
  const hv = hover == null ? null : weeks[hover];
  const gap = 2;

  return (
    <div className={VIZ_VARS}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><Swatch kind="cogs" /> Food &amp; drink cost</span>
        {weeks.some((w) => w.cogsEstimate > 0) && <span className="inline-flex items-center gap-1.5"><Swatch kind="est" /> Estimated cost</span>}
        <span className="inline-flex items-center gap-1.5"><Swatch kind="labor" /> Labor</span>
        {weeks.some((w) => w.fees > 0) && <span className="inline-flex items-center gap-1.5"><Swatch kind="fees" /> Card fees</span>}
        <span className="inline-flex items-center gap-1.5"><Swatch kind="profit" /> Kept</span>
      </div>
      <div className="relative" ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Weekly sales split into cost of goods, labor and profit" onMouseLeave={() => setHover(null)}>
          <defs>
            <pattern id="pnl-est" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="var(--viz-cogs)" fillOpacity={0.28} />
              <rect width="1.5" height="5" fill="var(--viz-cogs)" />
            </pattern>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{compact(t)}</text>
            </g>
          ))}
          {weeks.map((wk, i) => {
            const segs: { v: number; fill: string }[] = [
              { v: wk.cogs, fill: "var(--viz-cogs)" },
              { v: wk.cogsEstimate, fill: "url(#pnl-est)" },
              { v: wk.labor, fill: "var(--viz-labor)" },
              { v: wk.fees, fill: "var(--viz-fees)" },
              { v: Math.max(0, wk.profit), fill: "var(--viz-profit)" },
            ].filter((s) => s.v > 0);
            let acc = 0;
            const lastIdx = segs.length - 1;
            const op = hover == null || hover === i ? 1 : 0.6;
            return (
              <g key={wk.weekStart} opacity={op} className="transition-opacity duration-180">
                {wk.current && <rect x={x(i) - band / 2 + 1} y={pad.top - 6} width={band - 2} height={y(0) - pad.top + 6} rx={6} fill="var(--surface-2)" />}
                {segs.map((s, k) => {
                  const y0 = y(acc);
                  acc += s.v;
                  const y1 = y(acc);
                  const h = Math.max(0, y0 - y1 - (k < lastIdx ? gap : 0));
                  const r = k === lastIdx ? Math.min(4, h) : 0;
                  return <path key={k} d={roundTop(x(i) - barW / 2, y1 + (k < lastIdx ? 0 : 0), barW, h, r)} fill={s.fill} />;
                })}
                {wk.profit < 0 && <line x1={x(i) - barW / 2 - 3} x2={x(i) + barW / 2 + 3} y1={y(wk.sales)} y2={y(wk.sales)} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />}
                {i % labelEvery === (weeks.length - 1) % labelEvery && (
                  <text x={x(i)} y={H - 6} textAnchor="middle" className={cx("text-[11px]", wk.current ? "fill-ink font-medium" : "fill-muted")}>{shortDate(wk.weekStart)}</text>
                )}
              </g>
            );
          })}
          <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
          {weeks.map((wk, i) => (
            <rect
              key={`hit-${wk.weekStart}`}
              x={x(i) - band / 2}
              y={0}
              width={band}
              height={H}
              fill="transparent"
              tabIndex={0}
              aria-label={`Week of ${shortDate(wk.weekStart)}: sales ${whole(wk.sales)}${wk.fees > 0 ? `, card fees ${whole(wk.fees)}` : ""}, profit ${whole(wk.profit)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onTouchStart={() => setHover(i)}
              className="outline-none"
            />
          ))}
        </svg>
        {hv && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-56 -translate-x-1/2 rounded-lg whitespace-nowrap border border-border bg-surface px-2.5 py-2 text-xs shadow-md"
            style={{ left: Math.min(Math.max(x(hover!), 116), W - 116) }}
          >
            <div className="mb-1 text-muted">Week of {shortDate(hv.weekStart)}{hv.days < 7 ? ` · ${hv.days} day${hv.days === 1 ? "" : "s"}` : ""}</div>
            <TipRow label="Sales" value={whole(hv.sales)} strong />
            <TipRow swatch="cogs" label="Food & drink cost" value={whole(hv.cogs + hv.cogsEstimate)} hint={hv.cogsEstimate > 0 ? `${whole(hv.cogsEstimate)} est.` : undefined} />
            <TipRow swatch="labor" label="Labor" value={whole(hv.labor)} hint={hv.sales > 0 ? pct(hv.labor / hv.sales, 0) : undefined} />
            {hv.fees > 0 && <TipRow swatch="fees" label="Card fees" value={whole(hv.fees)} hint={hv.sales > 0 ? pct(hv.fees / hv.sales, 1) : undefined} />}
            <TipRow swatch="profit" label="Profit" value={hv.profit < 0 ? `−${whole(-hv.profit)}` : whole(hv.profit)} hint={hv.sales > 0 ? pct(hv.profit / hv.sales, 0) : undefined} strong />
          </div>
        )}
      </div>
      <div className="sr-only">
      <table data-no-resize="">
        <caption>Weekly sales, cost of goods, labor, card fees and profit</caption>
        <thead><tr><th>Week of</th><th>Sales</th><th>Cost of goods</th><th>Estimated cost</th><th>Labor</th><th>Card fees</th><th>Profit</th></tr></thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekStart}><td>{shortDate(w.weekStart)}</td><td>{whole(w.sales)}</td><td>{whole(w.cogs)}</td><td>{whole(w.cogsEstimate)}</td><td>{whole(w.labor)}</td><td>{whole(w.fees)}</td><td>{whole(w.profit)}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function TipRow({ label, value, hint, swatch, strong }: { label: string; value: string; hint?: string; swatch?: "cogs" | "labor" | "fees" | "profit"; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="inline-flex items-center gap-1.5 text-muted">
        {swatch ? <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: `var(--viz-${swatch})` }} /> : <span className="w-3" />}
        {label}
      </span>
      <span className="num">
        <span className={cx(strong ? "font-semibold text-ink" : "font-medium text-ink")}>{value}</span>
        {hint && <span className="ml-1 text-muted">{hint}</span>}
      </span>
    </div>
  );
}

/** Round clean ticks from 0 to just over `max` (3–4 lines). */
function niceTicks(max: number): number[] {
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) out.push(v);
  if (out.at(-1)! < max) out.push(out.at(-1)! + step);
  return out;
}

/** A column with only its top corners rounded (square at the baseline). */
function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}

// ---- Sales mix ---------------------------------------------------------------------------

export interface MixPart {
  key: string;
  label: string;
  value: number;
  /** CSS color, or "hatch" for a neutral hatched "not linked" block. */
  color: string;
  /** Text on the block: white or near-black by the fill's lightness. */
  ink: "light" | "dark";
}

/**
 * One whole split into its parts: a tall segmented bar with each share
 * printed inside where it fits, and a legend of names and amounts beneath.
 */
export function MixBar({ parts, ariaLabel }: { parts: MixPart[]; ariaLabel: string }) {
  const { ref, w } = useWidth(200);
  const [hover, setHover] = useState<string | null>(null);
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const shown = parts.filter((p) => p.value > 0);
  if (total <= 0) return null;
  const hv = shown.find((p) => p.key === hover) ?? null;
  return (
    <div>
      <div ref={ref} className="relative flex h-7 gap-[2px]" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {shown.map((p) => {
          const share = p.value / total;
          const px = share * w;
          const style: CSSProperties = p.color === "hatch" ? { backgroundColor: "var(--surface-2)", backgroundImage: "repeating-linear-gradient(135deg, var(--border-strong) 0 1.5px, transparent 1.5px 6px)" } : { background: p.color };
          return (
            <div
              key={p.key}
              className={cx("relative flex min-w-[3px] items-center rounded-[4px] px-2 transition-opacity duration-120", hover && hover !== p.key && "opacity-60")}
              style={{ flexGrow: share, flexBasis: 0, ...style }}
              onMouseEnter={() => setHover(p.key)}
              onTouchStart={() => setHover(p.key)}
            >
              {px >= 44 && <span className={cx("num text-xs font-medium", p.color === "hatch" ? "text-ink-2" : p.ink === "light" ? "text-white" : "text-[#1b1a18]")}>{pct(share, 0)}</span>}
            </div>
          );
        })}
        {hv && (
          <div className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-sm">
            <span className="num font-medium text-ink">{whole(hv.value)}</span> <span className="text-muted">{hv.label} · {pct(hv.value / total, 0)}</span>
          </div>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {shown.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={p.color === "hatch" ? { backgroundColor: "var(--surface-2)", backgroundImage: "repeating-linear-gradient(135deg, var(--border-strong) 0 1.5px, transparent 1.5px 4px)", boxShadow: "inset 0 0 0 1px var(--border-strong)" } : { background: p.color }} />
            {p.label} <span className="num text-ink-2">{whole(p.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
