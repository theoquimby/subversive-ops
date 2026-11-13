"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleDashed, CircleHelp, Eye } from "lucide-react";
import { cx } from "@/components/ui";
import type { Evidence, EvidenceChart } from "@/domain/analytics";
import { money, shortDate } from "@/lib/format";

/**
 * "Show me how": what a finding compared, in the owner's words. The verdict first, then the
 * numbers before and after (raw, then relative to how busy the place was, then the season), the
 * small chart, what was left out and why, the method in one sentence, and how sure we are — with
 * the likely range drawn so "−9% to +1%" reads as "could be nothing".
 */

const pctText = (x: number) => {
  const v = Math.round(x * 100);
  return v === 0 ? "0%" : `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
};

export function EvidenceView({ ev }: { ev: Evidence }) {
  const SureIcon = ev.verdict === "unclear" ? CircleHelp : ev.sure.startsWith("Pretty") ? CircleCheck : CircleDashed;
  return (
    <div className="flex flex-col gap-4 text-[0.85rem] leading-relaxed text-ink-2">
      {ev.summary && <p className="text-[0.92rem] leading-snug font-medium text-ink">{ev.summary}</p>}

      {ev.rows.length > 0 && <EvidenceTable rows={ev.rows} />}

      {ev.effect && <EffectBar effect={ev.effect} unclear={ev.verdict === "unclear"} />}

      {ev.chart && <EvidenceChartView chart={ev.chart} />}

      {ev.steps.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">Step by step</h4>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 marker:text-muted">
            {ev.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {ev.excluded.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">Left out</h4>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 marker:text-muted">
            {ev.excluded.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {ev.method && (
        <p>
          <span className="font-medium text-ink">How we worked it out: </span>
          {ev.method}
        </p>
      )}

      <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2">
        <SureIcon className={cx("mt-0.5 size-4 shrink-0", ev.verdict === "unclear" ? "text-muted" : "text-ink-2")} strokeWidth={1.9} aria-hidden />
        <span>
          <span className="font-medium text-ink">How sure are we? </span>
          {ev.sure}
        </span>
      </p>

      {ev.watch && (
        <p className="flex items-start gap-2">
          <Eye className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.9} aria-hidden />
          <span>
            <span className="font-medium text-ink">What would make it count: </span>
            {ev.watch}
          </span>
        </p>
      )}
    </div>
  );
}

function EvidenceTable({ rows }: { rows: Evidence["rows"] }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-1 gap-x-3 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <dt className={cx("min-w-0", r.strong ? "font-medium text-ink" : "text-ink-2")}>
            {r.label}
            {r.note && <span className="block text-xs text-muted">{r.note}</span>}
          </dt>
          <dd className="num flex flex-wrap items-baseline gap-x-2 text-ink sm:justify-end sm:text-right">
            {r.value != null ? (
              <span className={cx(r.strong && "font-semibold")}>{r.value}</span>
            ) : (
              <>
                <span className="text-ink-2">{r.before}</span>
                <span className="text-muted" aria-label="to">→</span>
                <span className={cx(r.strong && "font-semibold")}>{r.after}</span>
                {r.change && <span className={cx("text-xs font-medium", (r.changePct ?? 0) < -0.02 ? "text-bad" : (r.changePct ?? 0) > 0.02 ? "text-good" : "text-muted")}>({r.change})</span>}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The likely range on a number line with zero marked: a range that crosses zero reads as "could be nothing". */
function EffectBar({ effect, unclear }: { effect: NonNullable<Evidence["effect"]>; unclear: boolean }) {
  const lo = Math.min(effect.low, effect.mid, 0);
  const hi = Math.max(effect.high, effect.mid, 0);
  const pad = Math.max(0.05, (hi - lo) * 0.12);
  const a = lo - pad;
  const b = hi + pad;
  const x = (v: number) => ((v - a) / (b - a)) * 100;
  return (
    <figure className="min-w-0" aria-label={`${effect.label ?? "Effect"}: ${pctText(effect.mid)}, likely ${pctText(effect.low)} to ${pctText(effect.high)}`}>
      <figcaption className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
        <span>{effect.label ?? "The effect"}</span>
        <span className="num">
          <span className="font-semibold text-ink">{pctText(effect.mid)}</span> · likely {pctText(effect.low)} to {pctText(effect.high)}
        </span>
      </figcaption>
      <div className="relative h-7" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        <div className={cx("absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full", unclear ? "bg-ink/15" : effect.mid < 0 ? "bg-bad/30" : "bg-good/30")} style={{ left: `${x(effect.low)}%`, width: `${Math.max(1, x(effect.high) - x(effect.low))}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-ink-2" style={{ left: `${x(0)}%` }} />
        <span className="absolute -bottom-3.5 -translate-x-1/2 text-[10px] text-muted" style={{ left: `${x(0)}%` }}>no change</span>
        <div className={cx("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", unclear ? "bg-ink-2" : effect.mid < 0 ? "bg-bad" : "bg-good")} style={{ left: `${x(effect.mid)}%` }} />
      </div>
      <div className="h-3" />
    </figure>
  );
}

function EvidenceChartView({ chart }: { chart: EvidenceChart }) {
  if (chart.type === "series") return chart.points.length >= 2 ? <SeriesChart chart={chart} /> : null;
  if (chart.type === "compare") return <CompareBars chart={chart} />;
  return null;
}

function CompareBars({ chart }: { chart: Extract<EvidenceChart, { type: "compare" }> }) {
  const max = Math.max(1e-9, ...chart.rows.map((r) => Math.abs(r.value)));
  const fmt = (n: number) => (chart.unit === "money" ? money(n, { whole: Math.abs(n) >= 50 }) : chart.unit === "hours" ? `${n} h` : chart.unit === "people" ? `${n}` : `${n}`);
  return (
    <figure className="flex min-w-0 flex-col gap-2" role="img" aria-label={chart.rows.map((r) => `${r.label} ${fmt(r.value)}`).join(", ")}>
      {chart.rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-ink-2">{r.label}</span>
            <span className={cx("num font-semibold", r.tone === "bad" ? "text-bad" : r.tone === "good" ? "text-good" : "text-ink")}>{fmt(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2">
            <div className={cx("h-full rounded-full", r.tone === "bad" ? "bg-bad" : r.tone === "good" ? "bg-good" : "bg-ink/60")} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </figure>
  );
}

/** Week-by-week line (2px), last year's same weeks dashed and lighter, the change marked. */
function SeriesChart({ chart }: { chart: Extract<EvidenceChart, { type: "series" }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const pts = chart.points;
  const H = 132;
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 20;
  const ys = pts.flatMap((p) => (p.ref != null ? [p.y, p.ref] : [p.y]));
  const top = Math.max(1e-9, ...ys) * 1.1;
  const X = (i: number) => padL + (i / Math.max(1, pts.length - 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const line = (get: (p: (typeof pts)[number]) => number | undefined) =>
    pts
      .map((p, i) => [i, get(p)] as const)
      .filter(([, v]) => v != null)
      .map(([i, v], j) => `${j ? "L" : "M"}${X(i).toFixed(1)},${Y(v!).toFixed(1)}`)
      .join(" ");
  const mi = chart.marker ? pts.findIndex((p) => p.x >= chart.marker!) : -1;
  const fmt = (v: number) => (chart.unit === "money" ? money(v, { whole: true }) : v.toFixed(chart.unit === "per100" ? 1 : 0));
  const hasRef = pts.some((p) => p.ref != null);
  const h = hover == null ? null : pts[hover];
  return (
    <figure className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-ink" />{chart.label}</span>
        {hasRef && chart.refLabel && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-ink/35" />{chart.refLabel}</span>}
      </div>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${chart.label}: ${pts.map((p) => `${shortDate(p.x)} ${fmt(p.y)}`).join(", ")}`} className="block">
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={Y(top * t)} y2={Y(top * t)} className="stroke-border" strokeWidth={1} />
              <text x={padL - 4} y={Y(top * t) + 3} textAnchor="end" className="fill-muted text-[10px]">{fmt(top * t)}</text>
            </g>
          ))}
          {mi >= 0 && (
            <g>
              <line x1={X(mi)} x2={X(mi)} y1={padT - 4} y2={H - padB} className="stroke-ink-2" strokeWidth={1} strokeDasharray="3 3" />
              <text x={Math.min(W - padR, X(mi) + 4)} y={padT + 2} textAnchor={X(mi) > W - 90 ? "end" : "start"} className="fill-ink-2 text-[10px]">{chart.markerLabel ?? "Change"}</text>
            </g>
          )}
          {hasRef && <path d={line((p) => p.ref)} fill="none" className="stroke-ink/35" strokeWidth={1.5} strokeDasharray="4 3" />}
          <path d={line((p) => p.y)} fill="none" className="stroke-ink" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p, i) => (
            <circle key={p.x} cx={X(i)} cy={Y(p.y)} r={hover === i ? 3.5 : 2} className="fill-ink" />
          ))}
          {[0, pts.length - 1].map((i) => (
            <text key={i} x={X(i)} y={H - 5} textAnchor={i ? "end" : "start"} className="fill-muted text-[10px]">{shortDate(pts[i].x)}</text>
          ))}
          {pts.map((p, i) => (
            <rect key={`h${p.x}`} x={X(i) - (W - padL - padR) / Math.max(1, pts.length - 1) / 2} y={0} width={(W - padL - padR) / Math.max(1, pts.length - 1)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
      </div>
      <figcaption className="mt-1 min-h-[1.25rem] text-xs text-muted">
        {h ? (
          <>
            Week of <span className="font-medium text-ink">{shortDate(h.x)}</span>: <span className="num text-ink">{fmt(h.y)}</span>
            {h.ref != null && <> · last year <span className="num">{fmt(h.ref)}</span></>}
          </>
        ) : (
          "Tap a week for its numbers."
        )}
      </figcaption>
    </figure>
  );
}
