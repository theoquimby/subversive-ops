"use client";

import { CircleCheck, CircleDashed, CircleHelp, Eye } from "lucide-react";
import { cx } from "@/components/ui";
import type { Evidence, EvidenceChart, EvidenceRow } from "@/domain/analytics";
import { shortDate } from "@/lib/format";
import { CompareBars, ExpectedActual, expectedOf, followOf, FollowSlope, numOf } from "./graphics";
import { Figure, Key, niceTicks, signedPct, SrTable, Tip, TipLabel, TipValue, useActive, useWidth, whole } from "./kit";

/**
 * "Show me how": a short, clear explanation rather than a table. The verdict
 * first, then the two or three numbers that matter as figures, what changed
 * (before → after, drawn), its own small chart, the likely range against "no
 * change", how we worked it out in a few steps, what was left out, and how
 * sure we are.
 */

export function EvidenceView({ ev, graphic }: { ev: Evidence; graphic?: string | null }) {
  const SureIcon = ev.verdict === "unclear" ? CircleHelp : ev.sure.startsWith("Pretty") ? CircleCheck : CircleDashed;
  const changes = ev.rows.filter((r) => r.before != null && r.after != null);
  const figures = ev.rows.filter((r) => r.value != null && r.strong).slice(0, 3);
  const others = ev.rows.filter((r) => r.value != null && !figures.includes(r));
  const follow = graphic !== "follow" ? followOf(ev) : null;
  const expected = graphic !== "expected" ? expectedOf(ev) : null;
  const [sureWord, ...sureRest] = ev.sure.split(":");
  return (
    <div className="lab flex max-w-[52rem] flex-col gap-6 text-[0.86rem] leading-relaxed text-ink-2">
      {ev.summary && <p className="max-w-[68ch] text-[0.98rem] leading-snug font-medium text-ink">{ev.summary}</p>}

      {figures.length > 0 && (
        <div className={cx("grid gap-2", figures.length >= 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
          {figures.map((r, i) => (
            <Figure key={i} label={r.label} value={<span className="num">{r.value}</span>} note={r.note} />
          ))}
        </div>
      )}

      {follow && (
        <Block title="Before and after the change">
          <FollowSlope f={follow} />
        </Block>
      )}

      {changes.length > 0 && (
        <Block title="What changed">
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {changes.map((r, i) => (
              <ChangeRow key={i} r={r} />
            ))}
          </ul>
        </Block>
      )}

      {ev.effect && <EffectStrip effect={ev.effect} unclear={ev.verdict === "unclear"} />}

      {ev.chart && graphic !== "slowdays" && <ChartBlock chart={ev.chart} expected={expected} skipExpected={graphic === "expected"} />}

      {others.length > 0 && (
        <Block title="The numbers">
          <dl className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {others.map((r, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-3.5 py-2.5">
                <dt className="min-w-0 text-ink-2">
                  {r.label}
                  {r.note && <span className="mt-0.5 block text-xs leading-snug text-muted">{r.note}</span>}
                </dt>
                <dd className="num max-w-[11rem] text-right font-medium text-ink sm:max-w-[16rem]">{r.value}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {ev.steps.length > 0 && (
        <Block title="How we worked it out">
          <ol className="flex flex-col gap-3">
            {ev.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5">
                <span className="num mt-[2px] grid size-5 place-items-center rounded-full bg-surface-2 text-[10.5px] font-semibold text-ink-2">{i + 1}</span>
                <span className="max-w-[68ch]">{s}</span>
              </li>
            ))}
          </ol>
          {ev.method && ev.method !== ev.steps[0] && <p className="mt-3 max-w-[68ch] text-xs text-muted">In one line: {ev.method}</p>}
        </Block>
      )}
      {!ev.steps.length && ev.method && (
        <Block title="How we worked it out">
          <p className="max-w-[68ch]">{ev.method}</p>
        </Block>
      )}

      {ev.excluded.length > 0 && (
        <Block title="Left out, so they can't skew it">
          <ul className="flex flex-wrap gap-1.5">
            {ev.excluded.map((s, i) => (
              <li key={i} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs leading-snug text-ink-2">{s}</li>
            ))}
          </ul>
        </Block>
      )}

      <div className="flex flex-col gap-2">
        <p className={cx("flex items-start gap-2.5 rounded-xl px-3.5 py-3", ev.verdict === "unclear" ? "bg-surface-2" : "bg-[var(--lab-accent-wash)]")}>
          <SureIcon className={cx("mt-0.5 size-4 shrink-0", ev.verdict === "unclear" ? "text-muted" : "text-[var(--lab-accent)]")} strokeWidth={1.9} aria-hidden />
          <span>
            <span className="font-semibold text-ink">{sureRest.length ? `${sureWord}.` : "How sure are we?"} </span>
            {sureRest.length ? capital(sureRest.join(":").trim()) : ev.sure}
          </span>
        </p>
        {ev.watch && (
          <p className="flex items-start gap-2.5 rounded-xl border border-dashed border-border-strong px-3.5 py-3">
            <Eye className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.9} aria-hidden />
            <span>
              <span className="font-semibold text-ink">What would make it count. </span>
              {ev.watch}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2.5 text-[0.7rem] font-medium tracking-[0.06em] text-muted uppercase">{title}</h4>
      {children}
    </section>
  );
}

/** Before → after as two dots on the row's own track, the change as words. */
function ChangeRow({ r }: { r: EvidenceRow }) {
  const b = numOf(r.before);
  const a = numOf(r.after);
  const max = Math.max(1e-9, Math.abs(b ?? 0), Math.abs(a ?? 0)) * 1.1;
  const x = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  const up = (r.changePct ?? 0) > 0.02;
  const down = (r.changePct ?? 0) < -0.02;
  return (
    <li className="px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cx("min-w-0", r.strong ? "font-medium text-ink" : "text-ink-2")}>{r.label}</span>
        {r.change && <span className={cx("num shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", up ? "bg-[var(--lab-accent-wash)] text-ink" : down ? "bg-[var(--lab-hot-wash)] text-ink" : "bg-surface-2 text-muted")}>{r.change}</span>}
      </div>
      {r.note && <div className="mt-0.5 text-xs leading-snug text-muted">{r.note}</div>}
      {b != null && a != null ? (
        <div className="mt-2.5 grid grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] items-center gap-2.5">
          <span className="num text-right text-xs text-muted">{r.before}</span>
          <div className="relative h-3" aria-hidden>
            <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            <div className={cx("lab-grow-x absolute top-1/2 h-[2px] -translate-y-1/2", r.strong ? "bg-[var(--lab-accent-2)]" : "bg-[var(--lab-context)]")} style={{ left: x(Math.min(a, b)), width: `calc(${x(Math.max(a, b))} - ${x(Math.min(a, b))})` }} />
            <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--lab-context)] bg-surface" style={{ left: x(b) }} />
            <div className={cx("lab-pop absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", r.strong ? "bg-[var(--lab-accent)]" : "bg-ink-2")} style={{ left: x(a) }} />
          </div>
          <span className={cx("num text-xs", r.strong ? "font-semibold text-ink" : "text-ink")}>{r.after}</span>
        </div>
      ) : (
        <div className="num mt-1 text-xs text-ink">{r.before} → {r.after}</div>
      )}
    </li>
  );
}

/** The likely range on a number line with "no change" marked: a range across zero reads as "could be nothing". */
function EffectStrip({ effect, unclear }: { effect: NonNullable<Evidence["effect"]>; unclear: boolean }) {
  const lo = Math.min(effect.low, effect.mid, 0);
  const hi = Math.max(effect.high, effect.mid, 0);
  const pad = Math.max(0.04, (hi - lo) * 0.1);
  const a = lo - pad;
  const b = hi + pad;
  const x = (v: number) => ((v - a) / (b - a)) * 100;
  const crosses = effect.low < 0 && effect.high > 0;
  const ticks = niceTicks(a, b, 4).filter((t) => t > a && t < b && Math.abs(x(t) - x(0)) > 14);
  return (
    <section className="min-w-0" aria-label={`${effect.label ?? "Effect"}: ${signedPct(effect.mid)}, likely ${signedPct(effect.low)} to ${signedPct(effect.high)}`}>
      <h4 className="mb-1 text-[0.7rem] font-medium tracking-[0.06em] text-muted uppercase">{effect.label ?? "The effect"}</h4>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
        <span className="num text-[1.35rem] font-semibold tracking-tight text-ink">{signedPct(effect.mid)}</span>
        <span className="num text-sm text-muted">likely {signedPct(effect.low)} to {signedPct(effect.high)}</span>
        <span className={cx("ml-auto rounded-full px-2 py-0.5 text-xs font-medium", crosses || unclear ? "bg-surface-2 text-ink-2" : "bg-[var(--lab-accent-wash)] text-ink")}>{crosses ? "Could be no change" : "Clear of zero"}</span>
      </div>
      <div className="relative h-9" aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="num absolute bottom-0 -translate-x-1/2 text-[10px] text-muted" style={{ left: `${x(t)}%` }}>{signedPct(t)}</span>
        ))}
        <div className="absolute inset-x-0 top-3 h-px bg-border" />
        <div className={cx("lab-grow-x absolute top-[7px] h-[10px] rounded-full", crosses || unclear ? "bg-[var(--lab-context-2)] ring-1 ring-[var(--lab-context)] ring-inset" : "bg-[var(--lab-accent-wash)] ring-1 ring-[var(--lab-accent-2)] ring-inset")} style={{ left: `${x(effect.low)}%`, width: `${Math.max(1, x(effect.high) - x(effect.low))}%` }} />
        <div className="absolute top-0 h-6 w-[2px] -translate-x-1/2 rounded bg-ink-2" style={{ left: `${x(0)}%` }} />
        <span className="absolute bottom-0 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap text-ink-2" style={{ left: `${x(0)}%` }}>no change</span>
        <div className={cx("lab-pop absolute top-3 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", crosses || unclear ? "bg-ink-2" : "bg-[var(--lab-accent)]")} style={{ left: `${x(effect.mid)}%`, animationDelay: "250ms" }} />
      </div>
      <p className="mt-1 text-xs text-muted">The bar is the likely range. If it crosses the dark line, the change could be nothing.</p>
    </section>
  );
}

function ChartBlock({ chart, expected, skipExpected }: { chart: EvidenceChart; expected: ReturnType<typeof expectedOf>; skipExpected?: boolean }) {
  if (chart.type === "series") return chart.points.length >= 2 ? <Block title="Week by week"><SeriesChart chart={chart} /></Block> : null;
  if (chart.type === "compare") {
    if (expected) return <Block title="Expected against what happened"><ExpectedActual e={expected} /></Block>;
    if (skipExpected) return null;
    return <Block title={chart.unit === "people" ? "People on, against what the hour needs" : "Side by side"}><CompareBars rows={chart.rows} unit={chart.unit} /></Block>;
  }
  return null;
}

/** Week-by-week line (2px, accent), last year's same weeks as a quieter grey line, the change marked, before/after averages as short rules. */
function SeriesChart({ chart }: { chart: Extract<EvidenceChart, { type: "series" }> }) {
  const { ref, w } = useWidth(320);
  const { active, setActive } = useActive<number>();
  const pts = chart.points;
  const H = 150;
  const pad = { l: 34, r: 10, t: 18, b: 22 };
  const ys = pts.flatMap((p) => (p.ref != null ? [p.y, p.ref] : [p.y]));
  const ticks = niceTicks(0, Math.max(1e-9, ...ys), 3);
  const top = ticks.at(-1)!;
  const X = (i: number) => pad.l + (i / Math.max(1, pts.length - 1)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const path = (get: (p: (typeof pts)[number]) => number | undefined) =>
    pts
      .map((p, i) => [i, get(p)] as const)
      .filter(([, v]) => v != null)
      .map(([i, v], j) => `${j ? "L" : "M"}${X(i).toFixed(1)},${Y(v!).toFixed(1)}`)
      .join(" ");
  const mi = chart.marker ? pts.findIndex((p) => p.x >= chart.marker!) : -1;
  const fmt = (v: number) => (chart.unit === "money" ? whole(v) : v.toFixed(chart.unit === "per100" ? (top < 10 ? 1 : 0) : 0));
  const hasRef = pts.some((p) => p.ref != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const mBefore = mi > 0 ? mean(pts.slice(0, mi).map((p) => p.y)) : null;
  const mAfter = mi >= 0 ? mean(pts.slice(mi).map((p) => p.y)) : null;
  const area = `${path((p) => p.y)} L${X(pts.length - 1)},${Y(0)} L${X(0)},${Y(0)} Z`;
  const step = (w - pad.l - pad.r) / Math.max(1, pts.length - 1);
  const h = active == null ? null : pts[active];
  return (
    <figure className="min-w-0" aria-label={`${chart.label}: ${pts.map((p) => `${shortDate(p.x)} ${fmt(p.y)}`).join(", ")}`}>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Key look="line">{chart.label}</Key>
        {hasRef && chart.refLabel && <Key look="context-line">{chart.refLabel}</Key>}
      </figcaption>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "var(--border-strong)" : "var(--lab-grid)"} strokeWidth={1} />
              <text x={pad.l - 6} y={Y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[10px]">{fmt(t)}</text>
            </g>
          ))}
          {mi >= 0 && (
            <g>
              <rect x={X(mi)} y={pad.t} width={Math.max(0, w - pad.r - X(mi))} height={H - pad.t - pad.b} fill="var(--lab-accent-wash)" opacity={0.55} />
              <line x1={X(mi)} x2={X(mi)} y1={pad.t - 8} y2={H - pad.b} stroke="var(--ink-2)" strokeWidth={1} />
              <text x={X(mi) + (X(mi) > w - 100 ? -5 : 5)} y={pad.t - 4} textAnchor={X(mi) > w - 100 ? "end" : "start"} className="fill-ink-2 text-[10.5px] font-medium">{chart.markerLabel ?? "Change"} {chart.marker ? shortDate(chart.marker) : ""}</text>
            </g>
          )}
          {hasRef && <path d={path((p) => p.ref)} fill="none" stroke="var(--lab-context)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          <path d={area} fill="var(--lab-accent)" opacity={0.08} className="lab-fade" />
          <path d={path((p) => p.y)} pathLength={1} fill="none" stroke="var(--lab-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="lab-draw" />
          {mBefore != null && mi > 0 && <line x1={X(0)} x2={X(mi - 1)} y1={Y(mBefore)} y2={Y(mBefore)} stroke="var(--ink)" strokeWidth={1.5} opacity={0.55} />}
          {mAfter != null && <line x1={X(mi)} x2={X(pts.length - 1)} y1={Y(mAfter)} y2={Y(mAfter)} stroke="var(--ink)" strokeWidth={1.5} opacity={0.55} />}
          {[0, pts.length - 1].map((i) => (
            <text key={i} x={X(i)} y={H - 5} textAnchor={i ? "end" : "start"} className="fill-muted text-[10px]">{shortDate(pts[i].x)}</text>
          ))}
          {h && (
            <g>
              <line x1={X(active!)} x2={X(active!)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-2)" strokeWidth={1} />
              <circle cx={X(active!)} cy={Y(h.y)} r={4} fill="var(--lab-accent)" stroke="var(--surface)" strokeWidth={2} />
              {h.ref != null && <circle cx={X(active!)} cy={Y(h.ref)} r={3.5} fill="var(--lab-context)" stroke="var(--surface)" strokeWidth={2} />}
            </g>
          )}
          {pts.map((p, i) => (
            <rect key={`h${p.x}`} x={X(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          ))}
        </svg>
        {h && (
          <Tip x={X(active!)} y={Y(Math.max(h.y, h.ref ?? 0))} w={w}>
            <TipValue>{fmt(h.y)}{h.ref != null && <span className="font-normal text-muted"> · last year {fmt(h.ref)}</span>}</TipValue>
            <TipLabel>Week of {shortDate(h.x)}</TipLabel>
          </Tip>
        )}
      </div>
      {mBefore != null && mAfter != null && <p className="mt-1.5 text-xs text-muted">The short dark rules are the averages before and after: <span className="num text-ink-2">{fmt(mBefore)}</span> → <span className="num text-ink-2">{fmt(mAfter)}</span>.</p>}
      <SrTable caption={chart.label} head={["Week of", "This year", ...(hasRef ? ["Last year"] : [])]} rows={pts.map((p) => [shortDate(p.x), fmt(p.y), ...(hasRef ? [p.ref != null ? fmt(p.ref) : ""] : [])])} />
    </figure>
  );
}
