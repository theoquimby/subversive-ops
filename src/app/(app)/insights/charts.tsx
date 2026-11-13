"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import type { Chart } from "@/domain/analytics";
import { WeekVisual } from "./visuals";
import { money, shortDate } from "@/lib/format";

/**
 * Mini charts for the Insights cards. One series each (ink), recessive hairline
 * grid, hover/tap tooltip on every mark, text in text tokens. The heatmap is a
 * single-hue sequential scale with its own legend; flags carry a text marker,
 * never color alone.
 */

function useWidth(min = 260) {
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

function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), w - 70);
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-sm" style={{ left, top: Math.max(0, y - 8) }}>
      {children}
    </div>
  );
}

const whole = (n: number) => money(n, { whole: true });

/** Plain names for the menu boxes (the classic names mean nothing to most owners). */
export const MENU_CLASS: Record<string, string> = { Star: "Star", Workhorse: "Crowd-pleaser", Puzzle: "Hidden gem", Dog: "Rethink" };

// ---- Menu matrix -----------------------------------------------------------------------

export function QuadrantChart({ chart }: { chart: Extract<Chart, { type: "quadrant" }> }) {
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 190;
  const pad = { t: 14, r: 14, b: 22, l: 14 };
  const pts = chart.points;
  const maxX = Math.max(2, ...pts.map((p) => p.x)) * 1.08;
  const ext = Math.max(1, ...pts.map((p) => Math.abs(p.y))) * 1.25;
  const sx = (x: number) => pad.l + (x / maxX) * (w - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y + ext) / (2 * ext)) * (H - pad.t - pad.b);
  const h = hover == null ? null : pts[hover];
  // Keep labels from sitting on top of each other: push a label down when it lands within 13px of one already placed nearby.
  const placed: { x: number; y: number }[] = [];
  const labelY = pts.map((p) => {
    let y = sy(p.y) - 7;
    for (let k = 0; k < 4; k++) {
      const clash = placed.find((q) => Math.abs(q.x - sx(p.x)) < 120 && Math.abs(q.y - y) < 13);
      if (!clash) break;
      y = clash.y + 13;
    }
    placed.push({ x: sx(p.x), y });
    return y;
  });
  return (
    <div ref={ref} className="relative w-full min-w-0">
      <svg width={w} height={H} role="img" aria-label="Menu items by popularity and margin" className="block" onMouseLeave={() => setHover(null)}>
        <line x1={sx(1)} x2={sx(1)} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" />
        <line x1={pad.l} x2={w - pad.r} y1={sy(0)} y2={sy(0)} stroke="var(--border-strong)" />
        {[
          ["Hidden gems", pad.l + 2, pad.t + 10, "start"],
          ["Stars", w - pad.r - 2, pad.t + 10, "end"],
          ["Rethink", pad.l + 2, H - pad.b - 6, "start"],
          ["Crowd-pleasers", w - pad.r - 2, H - pad.b - 6, "end"],
        ].map(([t, x, y, a]) => (
          <text key={t as string} x={x as number} y={y as number} textAnchor={a as "start" | "end"} className="fill-muted text-[11px]">{t}</text>
        ))}
        <text x={sx(1)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">more popular →</text>
        {pts.map((p, i) => (
          <g key={p.label} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={14} fill="transparent" />
            <circle cx={sx(p.x)} cy={sy(p.y)} r={hover === i ? 6 : 4.5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
            <text x={sx(p.x) + (sx(p.x) > w * 0.7 ? -8 : 8)} y={labelY[i]} textAnchor={sx(p.x) > w * 0.7 ? "end" : "start"} className="fill-ink-2 text-[11px]">{p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}</text>
          </g>
        ))}
      </svg>
      {h && (
        <Tip x={sx(h.x)} y={sy(h.y)} w={w}>
          <div className="font-medium text-ink">{h.label}</div>
          <div className="text-muted">{MENU_CLASS[h.cls] ?? h.cls} · sells {h.x.toFixed(1)}× a fair share · earns {h.y >= 0 ? "+" : "−"}${Math.abs(h.y).toFixed(2)} vs average</div>
        </Tip>
      )}
    </div>
  );
}

// ---- Forecast band ----------------------------------------------------------------------

export function BandChart({ chart }: { chart: Extract<Chart, { type: "band" }> }) {
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 170;
  const pad = { t: 12, r: 10, b: 22, l: 50 };
  const rows = chart.rows;
  const open = rows.filter((r) => !r.closed);
  const unit = 500;
  const max = Math.ceil((Math.max(1, ...open.map((r) => r.high)) * 1.05) / unit) * unit;
  const min = Math.max(0, Math.floor((Math.min(...open.map((r) => r.low)) * 0.9) / unit) * unit);
  const step = (w - pad.l - pad.r) / Math.max(1, rows.length);
  const sx = (i: number) => pad.l + step * (i + 0.5);
  const sy = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const ticks = [min, (min + max) / 2, max];
  const h = hover == null ? null : rows[hover];
  return (
    <div ref={ref} className="relative w-full min-w-0">
      <svg width={w} height={H} role="img" aria-label="Daily sales forecast with 80% ranges" className="block" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--border)" />
            <text x={pad.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{whole(t)}</text>
          </g>
        ))}
        {rows.map((r, i) =>
          r.closed ? (
            <text key={r.date} x={sx(i)} y={sy(min) - 4} textAnchor="middle" className="fill-muted text-[10px]">–</text>
          ) : (
            <g key={r.date}>
              {/* the 80% range as a thin rounded bar, the middle as a tick */}
              <rect x={sx(i) - Math.min(7, step * 0.3)} width={Math.min(14, step * 0.6)} y={sy(r.high)} height={Math.max(2, sy(r.low) - sy(r.high))} rx={4} fill="var(--ink)" opacity={hover === i ? 0.28 : 0.14} />
              <line x1={sx(i) - Math.min(8, step * 0.34)} x2={sx(i) + Math.min(8, step * 0.34)} y1={sy(r.mid)} y2={sy(r.mid)} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
            </g>
          ),
        )}
        {rows.map((r, i) => (i % 2 === 0 || rows.length <= 8 ? <text key={`l${r.date}`} x={sx(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[10px]">{new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}{new Date(`${r.date}T00:00:00Z`).getUTCDate()}</text> : null))}
        {rows.map((r, i) => (
          <rect key={`h${r.date}`} x={sx(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {h && (
        <Tip x={sx(hover!)} y={h.closed ? sy(min) : sy(h.high)} w={w}>
          <div className="text-muted">{shortDate(h.date)}</div>
          <div className="num font-medium text-ink">{h.closed ? "Closed" : `${whole(h.low)}–${whole(h.high)}`}</div>
          {!h.closed && <div className="num text-muted">most likely {whole(h.mid)}</div>}
        </Tip>
      )}
    </div>
  );
}

// ---- Horizontal bars ---------------------------------------------------------------------

export function BarsChart({ chart }: { chart: Extract<Chart, { type: "bars" }> }) {
  const rows = chart.rows.slice(0, 6);
  const max = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.high ?? 0))));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-2" role="img" aria-label="Value of each option per month" onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <div key={r.label} className="relative grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
          <span className="truncate text-ink-2">{r.label}</span>
          <span className="relative h-2 rounded-full bg-surface-2">
            {r.low != null && r.high != null && <span className="absolute top-1/2 h-px -translate-y-1/2 bg-border-strong" style={{ left: `${(Math.max(0, r.low) / max) * 100}%`, width: `${((Math.max(0, r.high) - Math.max(0, r.low)) / max) * 100}%` }} />}
            <span className="absolute inset-y-0 left-0 rounded-full bg-ink transition-opacity" style={{ width: `${(Math.max(0, r.value) / max) * 100}%`, opacity: hover == null || hover === i ? 0.85 : 0.35 }} />
          </span>
          <span className="num w-16 text-right text-ink">{whole(r.value)}</span>
          {hover === i && r.low != null && r.high != null && (
            <span className="pointer-events-none absolute right-0 -top-6 z-10 rounded-md border border-border bg-surface px-2 py-0.5 text-xs shadow-sm"><span className="num">{whole(r.low)}–{whole(r.high)}</span> <span className="text-muted">likely range</span></span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- Staffing heatmap -------------------------------------------------------------------

export function HeatmapChart({ chart }: { chart: Extract<Chart, { type: "heatmap" }> }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...chart.cells.map((c) => c.splh));
  const by = new Map(chart.cells.map((c) => [`${c.r}|${c.c}`, c]));
  const cur = hover ? by.get(hover) : null;
  return (
    <div className="relative min-w-0">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[10px]" aria-label="Sales per labor hour by weekday and hour">
          <thead>
            <tr>
              <th />
              {chart.cols.map((c) => (
                <th key={c} className="px-0.5 font-normal text-muted">{c.replace("pm", "p").replace("am", "a")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((r, ri) => (
              <tr key={r}>
                <th className="pr-1 text-left font-normal text-muted">{r}</th>
                {chart.cols.map((_, ci) => {
                  const c = by.get(`${ri}|${ci}`);
                  const k = `${ri}|${ci}`;
                  return (
                    <td key={ci} className="p-0">
                      <button
                        type="button"
                        aria-label={c ? `${r} ${chart.cols[ci]}: ${whole(c.splh)} per labor hour${c.flag ? `, ${c.flag}-staffed` : ""}` : `${r} ${chart.cols[ci]}: no data`}
                        onMouseEnter={() => setHover(k)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(k)}
                        onBlur={() => setHover(null)}
                        onClick={() => setHover(k)}
                        className="grid size-6 place-items-center rounded-[4px] text-[10px] font-semibold sm:size-7"
                        style={{ background: c ? `color-mix(in oklab, var(--series-1) ${Math.round(12 + (c.splh / max) * 78)}%, var(--surface))` : "var(--surface-2)", color: c && c.splh / max > 0.55 ? "var(--surface)" : "var(--ink)", outline: c?.flag ? "2px solid var(--ink)" : undefined, outlineOffset: -2 }}
                      >
                        {c?.flag === "over" ? "+" : c?.flag === "under" ? "−" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-16 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--series-1) 12%, var(--surface)), var(--series-1))" }} />
          sales per labor hour (darker = busier per person)
        </span>
        <span><b className="text-ink">+</b> too many people · <b className="text-ink">−</b> too few</span>
      </div>
      {cur && (
        <div className="pointer-events-none absolute top-0 right-0 z-10 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm">
          <div className="num font-medium text-ink">{whole(cur.splh)} per labor hour</div>
          <div className="num text-muted">{whole(cur.sales)} sales · {cur.people} on the clock</div>
        </div>
      )}
    </div>
  );
}

// ---- Seasons ------------------------------------------------------------------------------

export function SeasonsChart({ chart }: { chart: Extract<Chart, { type: "seasons" }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1.2, ...chart.index.map((v) => v ?? 0));
  const thisYear = chart.years.at(-1);
  const h = hover == null ? null : hover;
  return (
    <figure className="min-w-0">
      <div className="relative flex h-28 items-end gap-1" role="img" aria-label="Each month as a share of a typical month" onMouseLeave={() => setHover(null)}>
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border-strong" style={{ bottom: `${(1 / max) * 100}%` }} aria-hidden />
        {chart.months.map((m, i) => {
          const v = chart.index[i];
          return (
            <button key={m} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)} className="flex h-full min-w-0 flex-1 flex-col justify-end" aria-label={`${m}: ${v == null ? "no data" : `${Math.round(v * 100)}% of a typical month`}`}>
              <span className={cx("block w-full rounded-t-[4px] transition-opacity", v != null && v < 0.85 ? "bg-ink/30" : "bg-ink/75")} style={{ height: `${v == null ? 2 : Math.max(3, (v / max) * 100)}%`, opacity: hover == null || hover === i ? 1 : 0.55 }} />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {chart.months.map((m) => (
          <span key={m} className="min-w-0 flex-1 text-center text-[10px] text-muted">{m[0]}</span>
        ))}
      </div>
      <figcaption className="mt-2 min-h-[1.25rem] text-xs text-muted">
        {h != null ? (
          <>
            <span className="font-medium text-ink">{chart.months[h]}</span>: <span className="num">{chart.index[h] == null ? "—" : `${Math.round((chart.index[h] ?? 0) * 100)}%`}</span> of a typical month
            {thisYear?.values[h] != null && <> · {thisYear.year}: <span className="num">{whole(thisYear.values[h]!)}</span> a day</>}
          </>
        ) : (
          "Each month against a typical one (dashed line). Fainter bars are the quiet months."
        )}
      </figcaption>
    </figure>
  );
}

export function InsightChart({ chart }: { chart: Chart | null }) {
  if (!chart) return null;
  if (chart.type === "seasons") return <SeasonsChart chart={chart} />;
  if (chart.type === "week") return <WeekVisual rows={chart.rows} />;
  if (chart.type === "quadrant") return <QuadrantChart chart={chart} />;
  if (chart.type === "band") return <BandChart chart={chart} />;
  if (chart.type === "bars") return chart.rows.length ? <BarsChart chart={chart} /> : null;
  if (chart.type === "heatmap") return <HeatmapChart chart={chart} />;
  if (chart.type === "list")
    return (
      <ul className="flex flex-col gap-1.5 text-sm">
        {chart.rows.map((r) => (
          <li key={`${r.date}${r.metric}`} className="flex gap-2"><span className="num w-14 shrink-0 text-muted">{shortDate(r.date)}</span><span className="text-ink-2">{r.text.replace(/^[A-Z][a-z]+day [A-Z][a-z]{2} \d{1,2}: /, "")}</span></li>
        ))}
      </ul>
    );
  return null;
}
