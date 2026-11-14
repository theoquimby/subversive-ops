"use client";

import { useMemo } from "react";
import { cx } from "@/components/ui";
import type { Chart } from "@/domain/analytics";
import { roundTop } from "./graphics";
import { Key, niceTicks, SrTable, Takeaway, Tip, TipLabel, TipValue, tickMoney, useActive, useWidth, whole } from "./kit";

/**
 * The Lab tiles' charts. One idea each, the accent hue for the thing the
 * answer is about and neutral grey for context, hairline solid grid, direct
 * labels where they fit, a tooltip on every mark (tap on phones, focus on
 * keyboards) and a hidden table twin for screen readers.
 */

/** Plain names for the menu boxes (the classic names mean nothing to most owners). */
export const MENU_CLASS: Record<string, string> = { Star: "Star", Workhorse: "Crowd-pleaser", Puzzle: "Hidden gem", Dog: "Rethink" };

const day = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });

// ---- Menu matrix -----------------------------------------------------------------------

export function QuadrantChart({ chart }: { chart: Extract<Chart, { type: "quadrant" }> }) {
  const { ref, w } = useWidth();
  const { active, setActive } = useActive<number>();
  const H = Math.round(Math.min(300, Math.max(220, w * 0.62)));
  const pad = { t: 10, r: 10, b: 26, l: 10 };
  const pts = chart.points;
  const maxX = Math.max(2, ...pts.map((p) => p.x)) * 1.08;
  const ext = Math.max(1, ...pts.map((p) => Math.abs(p.y))) * 1.2;
  const sx = (x: number) => pad.l + (x / maxX) * (w - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y + ext) / (2 * ext)) * (H - pad.t - pad.b);
  const h = active == null ? null : pts[active];
  // Label the items furthest from the middle (the ones worth a decision), and keep labels apart.
  const labelled = useMemo(() => {
    const order = pts.map((p, i) => ({ i, d: Math.hypot((p.x - 1) / maxX, p.y / ext) })).sort((a, b) => b.d - a.d);
    // Obstacles: every dot, and the four corner names.
    const placed: { x: number; y: number; w: number }[] = [
      ...pts.map((p) => ({ x: sx(p.x) - 6, y: sy(p.y) + 4, w: 12 })),
      { x: pad.l, y: pad.t + 15, w: 90 }, { x: w - pad.r - 50, y: pad.t + 15, w: 50 }, { x: pad.l, y: H - pad.b - 8, w: 60 }, { x: w - pad.r - 110, y: H - pad.b - 8, w: 110 },
    ];
    const out = new Map<number, { x: number; y: number; anchor: "start" | "end" }>();
    for (const { i } of order) {
      if (out.size >= (w < 420 ? 5 : 8)) break;
      const p = pts[i];
      const text = p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label;
      const tw = text.length * 6.1;
      const y = sy(p.y) + 4;
      const prefer = sx(p.x) < w * 0.6;
      for (const right of [prefer, !prefer]) {
        const x = sx(p.x) + (right ? 8 : -8);
        const box = { x: right ? x : x - tw, y, w: tw };
        if (box.x < pad.l + 2 || box.x + box.w > w - pad.r - 2) continue;
        if (placed.some((q) => Math.abs(q.y - box.y) < 13 && box.x < q.x + q.w && q.x < box.x + box.w)) continue;
        placed.push(box);
        out.set(i, { x, y, anchor: right ? "start" : "end" });
        break;
      }
    }
    return out;
  }, [pts, w, maxX, ext]); // eslint-disable-line react-hooks/exhaustive-deps
  const qx = sx(1);
  const qy = sy(0);
  return (
    <figure className="min-w-0" aria-label={`Menu items by how much they sell and earn. ${pts.length} items.`}>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          <rect x={qx} y={pad.t} width={w - pad.r - qx} height={qy - pad.t} rx={10} fill="var(--lab-accent-wash)" opacity={0.7} />
          <rect x={pad.l} y={pad.t} width={w - pad.l - pad.r} height={H - pad.t - pad.b} rx={10} fill="none" stroke="var(--lab-grid)" />
          <line x1={qx} x2={qx} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" />
          <line x1={pad.l} x2={w - pad.r} y1={qy} y2={qy} stroke="var(--border-strong)" />
          {[
            ["Hidden gems", pad.l + 8, pad.t + 15, "start"],
            ["Stars", w - pad.r - 8, pad.t + 15, "end"],
            ["Rethink", pad.l + 8, H - pad.b - 8, "start"],
            ["Crowd-pleasers", w - pad.r - 8, H - pad.b - 8, "end"],
          ].map(([t, x, y, a]) => (
            <text key={t as string} x={x as number} y={y as number} textAnchor={a as "start" | "end"} className="fill-muted text-[10.5px] font-medium tracking-wide uppercase">{t}</text>
          ))}
          <text x={w - pad.r} y={H - 7} textAnchor="end" className="fill-muted text-[10.5px]">sells more →</text>
          <text x={pad.l} y={H - 7} className="fill-muted text-[10.5px]">↑ earns more each</text>
          {pts.map((p, i) => (
            <circle key={p.label} cx={sx(p.x)} cy={sy(p.y)} r={active === i ? 6 : 4.5} fill={p.cls === "Star" ? "var(--lab-accent)" : p.cls === "Dog" ? "var(--lab-context)" : "var(--ink-2)"} stroke="var(--surface)" strokeWidth={2} className="lab-pop" style={{ animationDelay: `${Math.min(600, i * 25)}ms` }} />
          ))}
          {[...labelled].map(([i, l]) => (
            <text key={`l${i}`} x={l.x} y={l.y} textAnchor={l.anchor} className="fill-ink-2 text-[10.5px]">{pts[i].label.length > 18 ? `${pts[i].label.slice(0, 17)}…` : pts[i].label}</text>
          ))}
          {pts.map((p, i) => (
            <circle key={`h${p.label}`} cx={sx(p.x)} cy={sy(p.y)} r={13} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          ))}
        </svg>
        {h && (
          <Tip x={sx(h.x)} y={sy(h.y)} w={w}>
            <TipValue>{h.label}</TipValue>
            <TipLabel>{MENU_CLASS[h.cls] ?? h.cls} · sells {h.x.toFixed(1)}× a fair share · earns {h.y >= 0 ? "+" : "−"}${Math.abs(h.y).toFixed(2)} each vs your average</TipLabel>
          </Tip>
        )}
      </div>
      <SrTable caption="Menu items" head={["Item", "Group", "Sells vs a fair share", "Earns each vs average"]} rows={pts.map((p) => [p.label, MENU_CLASS[p.cls] ?? p.cls, `${p.x.toFixed(1)}×`, `${p.y >= 0 ? "+" : "−"}$${Math.abs(p.y).toFixed(2)}`])} />
    </figure>
  );
}

// ---- Forecast ribbon ----------------------------------------------------------------------

export function BandChart({ chart }: { chart: Extract<Chart, { type: "band" }> }) {
  const { ref, w } = useWidth();
  const { active, setActive } = useActive<number>();
  const H = 190;
  const pad = { t: 18, r: 8, b: 26, l: 44 };
  // Last week's actuals give the ribbon context — only where there's room for them.
  const hist = w >= 560 ? (chart.history ?? []).slice(-7).map((r) => ({ date: r.date, actual: r.actual })) : [];
  const rows = chart.rows;
  type Slot = { kind: "past"; date: string; actual: number } | { kind: "future"; date: string; mid: number; low: number; high: number; closed: boolean };
  const slots: Slot[] = [...hist.map((h) => ({ kind: "past" as const, ...h })), ...rows.map((r) => ({ kind: "future" as const, ...r }))];
  const open = rows.filter((r) => !r.closed);
  const ticks = niceTicks(0, Math.max(1, ...open.map((r) => r.high), ...hist.map((h) => h.actual)), 3);
  const top = ticks.at(-1)!;
  const step = (w - pad.l - pad.r) / Math.max(1, slots.length);
  const X = (i: number) => pad.l + step * (i + 0.5);
  const Y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  // Consecutive open days form one ribbon; a closed day breaks it.
  const runs: number[][] = [];
  slots.forEach((s, i) => {
    if (s.kind !== "future" || s.closed) return runs.push([]);
    if (!runs.length) runs.push([]);
    runs[runs.length - 1].push(i);
  });
  const fut = (i: number) => slots[i] as Extract<Slot, { kind: "future" }>;
  const firstFuture = hist.length;
  const h = active == null ? null : slots[active];
  const week = open.slice(0, 7);
  const wk = { mid: week.reduce((s, r) => s + r.mid, 0), low: week.reduce((s, r) => s + r.low, 0), high: week.reduce((s, r) => s + r.high, 0) };
  return (
    <figure className="min-w-0" aria-label={`Daily sales forecast for the next ${rows.length} days with likely ranges. Next 7 days about ${whole(wk.mid)}.`}>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {hist.length > 0 && <Key look="context-line">Last week, actual</Key>}
        <Key look="line">Most likely</Key>
        <Key look="wash">4 days in 5 land in here</Key>
      </figcaption>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "var(--border-strong)" : "var(--lab-grid)"} />
              <text x={pad.l - 7} y={Y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[10.5px]">{tickMoney(t)}</text>
            </g>
          ))}
          {hist.length > 0 && (
            <g>
              <line x1={X(firstFuture) - step / 2} x2={X(firstFuture) - step / 2} y1={pad.t - 10} y2={H - pad.b} stroke="var(--border-strong)" />
              <text x={X(firstFuture) - step / 2 + 5} y={pad.t - 4} className="fill-ink-2 text-[10.5px] font-medium">Today</text>
              <path d={hist.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p.actual)}`).join(" ")} fill="none" stroke="var(--lab-context)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {hist.map((p, i) => <circle key={p.date} cx={X(i)} cy={Y(p.actual)} r={3} fill="var(--lab-context)" stroke="var(--surface)" strokeWidth={1.5} />)}
            </g>
          )}
          {runs.filter((r) => r.length).map((r, k) =>
            r.length === 1 ? (
              <g key={k}>
                <rect x={X(r[0]) - Math.min(7, step * 0.3)} width={Math.min(14, step * 0.6)} y={Y(fut(r[0]).high)} height={Math.max(2, Y(fut(r[0]).low) - Y(fut(r[0]).high))} rx={5} fill="var(--lab-accent-wash)" stroke="var(--lab-accent-2)" strokeWidth={1} />
                <circle cx={X(r[0])} cy={Y(fut(r[0]).mid)} r={3.5} fill="var(--lab-accent)" stroke="var(--surface)" strokeWidth={1.5} />
              </g>
            ) : (
              <g key={k}>
                <path d={`${r.map((i, j) => `${j ? "L" : "M"}${X(i)},${Y(fut(i).high)}`).join(" ")} ${[...r].reverse().map((i) => `L${X(i)},${Y(fut(i).low)}`).join(" ")} Z`} fill="var(--lab-accent-wash)" className="lab-fade" />
                <path d={r.map((i, j) => `${j ? "L" : "M"}${X(i)},${Y(fut(i).high)}`).join(" ")} fill="none" stroke="var(--lab-accent-2)" strokeWidth={1} />
                <path d={r.map((i, j) => `${j ? "L" : "M"}${X(i)},${Y(fut(i).low)}`).join(" ")} fill="none" stroke="var(--lab-accent-2)" strokeWidth={1} />
                <path d={r.map((i, j) => `${j ? "L" : "M"}${X(i)},${Y(fut(i).mid)}`).join(" ")} pathLength={1} fill="none" stroke="var(--lab-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="lab-draw" />
              </g>
            ),
          )}
          {slots.map((s, i) =>
            s.kind === "future" && s.closed ? <text key={`c${s.date}`} x={X(i)} y={Y(0) - 6} textAnchor="middle" className="fill-muted text-[9.5px]">closed</text> : null,
          )}
          {slots.map((s, i) => {
            const every = Math.max(1, Math.ceil(30 / step));
            if ((i - firstFuture) % every !== 0) return null;
            return (
              <text key={`d${s.date}`} x={X(i)} y={H - 8} textAnchor="middle" className={cx("text-[10px]", s.kind === "past" ? "fill-muted" : "fill-ink-2")}>
                {day(s.date, { weekday: "narrow" })}
                <tspan className="num fill-muted"> {new Date(`${s.date}T00:00:00Z`).getUTCDate()}</tspan>
              </text>
            );
          })}
          {h && h.kind === "future" && !h.closed && <circle cx={X(active!)} cy={Y(h.mid)} r={4.5} fill="var(--lab-accent)" stroke="var(--surface)" strokeWidth={2} />}
          {h && <line x1={X(active!)} x2={X(active!)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-2)" strokeOpacity={0.5} />}
          {slots.map((s, i) => (
            <rect key={`h${s.date}`} x={X(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          ))}
        </svg>
        {h && (
          <Tip x={X(active!)} y={h.kind === "past" ? Y(h.actual) : h.closed ? Y(0) : Y(h.high)} w={w}>
            <TipValue>{h.kind === "past" ? whole(h.actual) : h.closed ? "Closed" : `${whole(h.low)}–${whole(h.high)}`}</TipValue>
            <TipLabel>{day(h.date, { weekday: "short", month: "short", day: "numeric" })}{h.kind === "past" ? " · actual" : !h.closed ? ` · most likely ${whole(h.mid)}` : ""}</TipLabel>
          </Tip>
        )}
      </div>
      <SrTable caption="Sales forecast" head={["Day", "Most likely", "Likely low", "Likely high"]} rows={rows.map((r) => [day(r.date, { weekday: "short", month: "short", day: "numeric" }), r.closed ? "Closed" : whole(r.mid), r.closed ? "" : whole(r.low), r.closed ? "" : whole(r.high)])} />
    </figure>
  );
}

// ---- Horizontal bars (prices with likely ranges; order changes; levers) -------------------------

export function BarsChart({ chart, highlightFirst = true }: { chart: Extract<Chart, { type: "bars" }>; highlightFirst?: boolean }) {
  const rows = chart.rows.slice(0, 6);
  const ranged = rows.some((r) => r.low != null && r.high != null);
  const max = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.high ?? 0))));
  const { active, bind, setActive } = useActive<number>();
  const x = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  return (
    <figure className="min-w-0" aria-label={rows.map((r) => `${r.label} ${whole(r.value)} a month${r.low != null && r.high != null ? `, likely ${whole(r.low)} to ${whole(r.high)}` : ""}`).join("; ")}>
      {ranged && (
        <figcaption className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-ink-2"><span className="inline-block size-2.5 rounded-full bg-[var(--lab-accent)]" />Best guess a month</span>
          <Key look="wash">Likely range</Key>
        </figcaption>
      )}
      <ul className="flex flex-col gap-1" onMouseLeave={() => setActive(null)}>
        {rows.map((r, i) => (
          <li key={r.label}>
            <button type="button" {...bind(i)} className={cx("grid w-full grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-xs transition-colors sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_4rem]", active === i && "bg-surface-2/70")} aria-label={`${r.label}: ${whole(r.value)} a month${r.low != null && r.high != null ? `, likely ${whole(r.low)} to ${whole(r.high)}` : ""}`}>
              <span className={cx("truncate", i === 0 && highlightFirst ? "font-medium text-ink" : "text-ink-2")}>{r.label}</span>
              <span className="relative h-3.5">
                {ranged ? (
                  <>
                    <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--lab-grid)]" />
                    {r.low != null && r.high != null && <span className="lab-grow-x absolute top-[2px] h-2.5 rounded-full bg-[var(--lab-accent-wash)] ring-1 ring-[var(--lab-accent-2)] ring-inset" style={{ left: x(r.low), width: `calc(${x(r.high)} - ${x(r.low)})`, animationDelay: `${i * 60}ms` }} />}
                    <span className={cx("lab-pop absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", i === 0 && highlightFirst ? "bg-[var(--lab-accent)]" : "bg-ink-2")} style={{ left: x(r.value), animationDelay: `${200 + i * 60}ms` }} />
                  </>
                ) : (
                  <span className={cx("lab-grow-x absolute inset-y-0 left-0 rounded-r-[4px]", i === 0 && highlightFirst ? "bg-[var(--lab-accent)]" : "bg-[var(--lab-context)]")} style={{ width: `max(3px, ${x(r.value)})`, animationDelay: `${i * 60}ms` }} />
                )}
              </span>
              <span className={cx("num text-right", i === 0 && highlightFirst ? "font-semibold text-ink" : "text-ink-2")}>{whole(r.value)}</span>
            </button>
          </li>
        ))}
      </ul>
      {active != null && rows[active].low != null && rows[active].high != null && (
        <p className="mt-1.5 px-1.5 text-xs text-muted" aria-live="polite"><span className="font-medium text-ink">{rows[active].label}</span>: likely <span className="num">{whole(rows[active].low!)}–{whole(rows[active].high!)}</span> a month</p>
      )}
    </figure>
  );
}

// ---- Staffing heatmap -------------------------------------------------------------------

export function HeatmapChart({ chart }: { chart: Extract<Chart, { type: "heatmap" }> }) {
  const { active, setActive, bind } = useActive<string>();
  const max = Math.max(1, ...chart.cells.map((c) => c.splh));
  const by = new Map(chart.cells.map((c) => [`${c.r}|${c.c}`, c]));
  const cur = active ? by.get(active) : null;
  const [ar, ac] = active ? active.split("|").map(Number) : [0, 0];
  const share = (v: number) => Math.round(14 + (v / max) * 76);
  return (
    <figure className="min-w-0" aria-label="Sales per labor hour by weekday and hour; cells marked + have more people on than the sales need, − fewer.">
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `2rem repeat(${chart.cols.length}, minmax(0, 1fr))` }}>
          <span />
          {chart.cols.map((c) => (
            <span key={c} className="truncate pb-0.5 text-center text-[10px] text-muted">{c.replace(/(am|pm)$/, (m) => m[0])}</span>
          ))}
          {chart.rows.map((r, ri) => (
            <div key={r} className="contents">
              <span className="self-center text-[11px] text-muted">{r}</span>
              {chart.cols.map((_, ci) => {
                const k = `${ri}|${ci}`;
                const c = by.get(k);
                if (!c) return <span key={k} className="aspect-square max-h-9 rounded-[6px] bg-[var(--lab-context-2)] opacity-60" />;
                const p = share(c.splh);
                return (
                  <button
                    key={k}
                    type="button"
                    {...bind(k)}
                    aria-label={`${r} ${chart.cols[ci]}: ${whole(c.splh)} of sales per labor hour, ${c.people} on the clock${c.flag ? `, ${c.flag === "over" ? "more people than needed" : "fewer people than needed"}` : ""}`}
                    className={cx("lab-fade relative grid aspect-square max-h-9 place-items-center rounded-[6px] text-[12px] leading-none font-semibold", active === k && "ring-2 ring-ink ring-offset-1 ring-offset-surface")}
                    style={{ background: `color-mix(in oklab, var(--series-1) ${p}%, var(--surface))`, color: p > 52 ? "#fff" : "var(--ink)", animationDelay: `${(ri + ci) * 25}ms`, boxShadow: c.flag === "over" ? "inset 0 0 0 2px var(--lab-hot)" : c.flag === "under" ? "inset 0 0 0 2px var(--ink)" : undefined }}
                  >
                    {c.flag === "over" ? "+" : c.flag === "under" ? "−" : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {cur && (
          <div className="pointer-events-none absolute z-20" style={{ left: `calc(2rem + (100% - 2rem) * ${(ac + 0.5) / chart.cols.length})`, top: `${(ar / chart.rows.length) * 100}%` }}>
            <Tip x={0} y={8} w={10000}>
              <TipValue>{whole(cur.splh)} per labor hour</TipValue>
              <TipLabel>{chart.rows[ar]} {chart.cols[ac]} · {whole(cur.sales)} sales · {cur.people} on{cur.flag === "over" ? " · more people than it needs" : cur.flag === "under" ? " · fewer than it needs" : ""}</TipLabel>
            </Tip>
          </div>
        )}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.72rem] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted">Sales per person</span>
          <span className="h-2 w-14 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--series-1) 14%, var(--surface)), var(--series-1))" }} />
          <span className="text-muted">busier</span>
        </span>
        <span className="inline-flex items-center gap-1.5"><span className="grid size-3.5 place-items-center rounded-[4px] text-[10px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--lab-hot)]">+</span>more people than needed</span>
        <span className="inline-flex items-center gap-1.5"><span className="grid size-3.5 place-items-center rounded-[4px] text-[10px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ink)]">−</span>fewer</span>
      </figcaption>
    </figure>
  );
}

// ---- Seasons ------------------------------------------------------------------------------

export function SeasonsChart({ chart }: { chart: Extract<Chart, { type: "seasons" }> }) {
  const { ref, w } = useWidth();
  const { active, setActive } = useActive<number>();
  const H = 170;
  const pad = { t: 20, b: 22, l: 4, r: 4 };
  const vals = chart.index.map((v) => v ?? 1);
  const lo = Math.min(0.4, ...vals) - 0.05;
  const hi = Math.max(1.6, ...vals) + 0.05;
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const band = (w - pad.l - pad.r) / 12;
  const bw = Math.min(24, band * 0.62);
  const busiest = vals.indexOf(Math.max(...vals));
  const slowest = vals.indexOf(Math.min(...vals));
  const thisYear = chart.years.at(-1);
  const h = active;
  return (
    <figure className="min-w-0" aria-label={`Each month against a typical month. Busiest ${chart.months[busiest]} at ${Math.round(vals[busiest] * 100)}%, slowest ${chart.months[slowest]} at ${Math.round(vals[slowest] * 100)}%.`}>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          <line x1={0} x2={w} y1={Y(1)} y2={Y(1)} stroke="var(--ink-2)" strokeWidth={1} />
          {chart.months.map((m, i) => {
            const v = chart.index[i];
            if (v == null) return null;
            const up = v >= 1;
            const x = pad.l + band * (i + 0.5) - bw / 2;
            const y = up ? Y(v) : Y(1);
            const hh = Math.max(2, Math.abs(Y(v) - Y(1)));
            const d = up ? roundTop(x, y, bw, hh, 4) : `M${x},${y} L${x + bw},${y} L${x + bw},${y + hh - 4} Q${x + bw},${y + hh} ${x + bw - 4},${y + hh} L${x + 4},${y + hh} Q${x},${y + hh} ${x},${y + hh - 4} Z`;
            return (
              <g key={m} opacity={active == null || active === i ? 1 : 0.5} className="lab-mark">
                <path d={d} fill={up ? "var(--lab-accent)" : "var(--lab-accent-2)"} className={up ? "lab-grow-y" : "lab-grow-down"} style={{ animationDelay: `${i * 35}ms` }} />
                {(i === busiest || i === slowest || active === i) && <text x={pad.l + band * (i + 0.5)} y={up ? Y(v) - 6 : Y(v) + 13} textAnchor="middle" className="num fill-ink text-[10.5px] font-semibold">{Math.round(v * 100)}%</text>}
              </g>
            );
          })}
          {chart.months.map((m, i) => (
            <text key={`m${m}`} x={pad.l + band * (i + 0.5)} y={H - 6} textAnchor="middle" className={cx("text-[10px]", i === busiest || i === slowest ? "fill-ink-2 font-medium" : "fill-muted")}>{w < 420 ? m[0] : m}</text>
          ))}
          {chart.months.map((m, i) => (
            <rect key={`h${m}`} x={pad.l + band * i} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          ))}
        </svg>
        {h != null && chart.index[h] != null && (
          <Tip x={pad.l + band * (h + 0.5)} y={Y(Math.max(1, chart.index[h]!))} w={w}>
            <TipValue>{Math.round(chart.index[h]! * 100)}% of a typical month</TipValue>
            <TipLabel>{chart.months[h]}{thisYear?.values[h] != null ? ` · ${thisYear.year}: ${whole(thisYear.values[h]!)} a day` : ""}</TipLabel>
          </Tip>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-ink-2"><span className="inline-block h-[2px] w-3.5 rounded bg-ink-2" />A typical month (100%)</span>
        <Key look="accent">Busier</Key>
        <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-ink-2"><span className="inline-block size-2.5 rounded-[3px] bg-[var(--lab-accent-2)]" />Quieter</span>
      </figcaption>
      <SrTable caption="Each month as a share of a typical month" head={["Month", "Share", ...chart.years.map((y) => `${y.year} a day`)]} rows={chart.months.map((m, i) => [m, chart.index[i] == null ? "" : `${Math.round(chart.index[i]! * 100)}%`, ...chart.years.map((y) => (y.values[i] == null ? "" : whole(y.values[i]!)))])} />
    </figure>
  );
}

// ---- Your week: what each day's sales turn into ---------------------------------------------

export function WeekChart({ rows }: { rows: { label: string; value: number; sales?: number; labor?: number; cogs?: number; flag?: boolean }[] }) {
  const { ref, w } = useWidth();
  const { active, setActive } = useActive<number>();
  const split = rows.every((r) => r.sales != null && r.labor != null && r.cogs != null);
  const H = 180;
  const pad = { t: 20, b: 4 };
  const top = Math.max(1, ...rows.map((r) => (split ? r.sales! : Math.max(0, r.value))));
  const lo = Math.min(0, ...rows.map((r) => r.value));
  const Y = (v: number) => pad.t + (1 - (v - lo) / (top - lo)) * (H - pad.t - pad.b);
  const band = w / rows.length;
  const bw = Math.min(28, band * 0.56);
  const best = rows.reduce((b, r, i) => (r.value > rows[b].value ? i : b), 0);
  const h = active == null ? null : rows[active];
  return (
    <figure className="min-w-0" aria-label={`What an average day leaves after food, drink and wages: ${rows.map((r) => `${r.label} ${whole(r.value)}`).join(", ")}.`}>
      {split && (
        <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Key look="accent">Left for you</Key>
          <Key look="context">Wages</Key>
          <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-ink-2"><span className="inline-block size-2.5 rounded-[3px] bg-[var(--lab-context-2)] ring-1 ring-[var(--lab-context)] ring-inset" />Food &amp; drink</span>
        </figcaption>
      )}
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--border-strong)" />
          {rows.map((r, i) => {
            const x = band * (i + 0.5) - bw / 2;
            const dim = active != null && active !== i ? 0.5 : 1;
            if (!split || r.value < 0) {
              return (
                <g key={r.label} opacity={dim} className="lab-mark">
                  <path d={r.value >= 0 ? roundTop(x, Y(r.value), bw, Y(0) - Y(r.value), 4) : `M${x},${Y(0)} h${bw} V${Y(r.value)} h${-bw} Z`} fill={r.value < 0 ? "var(--bad)" : r.flag ? "var(--lab-hot)" : "var(--lab-accent)"} className="lab-grow-y" />
                  <text x={band * (i + 0.5)} y={Y(Math.max(0, r.value)) - 6} textAnchor="middle" className="num fill-ink text-[11px] font-semibold">{tickMoney(r.value)}</text>
                </g>
              );
            }
            const segs = [
              { v: r.cogs!, fill: "var(--lab-context-2)" },
              { v: r.labor!, fill: "var(--lab-context)" },
              { v: Math.max(0, r.sales! - r.cogs! - r.labor!), fill: r.flag ? "var(--lab-hot)" : "var(--lab-accent)" },
            ];
            let acc = 0;
            return (
              <g key={r.label} opacity={dim} className="lab-mark">
                {segs.map((s, k) => {
                  const y0 = Y(acc);
                  acc += s.v;
                  const y1 = Y(acc);
                  const hgt = Math.max(0, y0 - y1 - (k < 2 ? 2 : 0));
                  return k === 2 ? <path key={k} d={roundTop(x, y1, bw, hgt, 4)} fill={s.fill} className="lab-grow-y" style={{ animationDelay: `${i * 50 + 120}ms` }} /> : <rect key={k} x={x} y={y1 + (k < 2 ? 2 : 0)} width={bw} height={hgt} fill={s.fill} className="lab-grow-y" style={{ animationDelay: `${i * 50}ms` }} />;
                })}
                <text x={band * (i + 0.5)} y={Y(r.sales!) - 6} textAnchor="middle" className={cx("num text-[11px]", i === best ? "fill-ink font-semibold" : "fill-ink-2 font-medium")}>{tickMoney(r.value)}</text>
              </g>
            );
          })}
          {rows.map((r, i) => (
            <rect key={`h${r.label}`} x={band * i} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          ))}
        </svg>
        <div className="mt-1 grid" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }} aria-hidden>
          {rows.map((r, i) => (
            <span key={r.label} className={cx("text-center text-[11px]", i === best ? "font-semibold text-ink" : "text-muted")}>{r.label}</span>
          ))}
        </div>
        {h && (
          <Tip x={band * (active! + 0.5)} y={Y(split ? h.sales! : Math.max(0, h.value))} w={w}>
            <TipValue>{whole(h.value)} left</TipValue>
            <TipLabel>{h.label}{h.sales != null && h.labor != null ? ` · ${whole(h.sales)} sales − ${whole(h.cogs ?? 0)} food & drink − ${whole(h.labor)} wages` : ""}</TipLabel>
          </Tip>
        )}
      </div>
      <SrTable caption="An average day" head={["Day", "Sales", "Food & drink", "Wages", "Left"]} rows={rows.map((r) => [r.label, r.sales != null ? whole(r.sales) : "", r.cogs != null ? whole(r.cogs) : "", r.labor != null ? whole(r.labor) : "", whole(r.value)])} />
      <Takeaway>The number on each bar is what an average day leaves before rent. Tap a day for the split.</Takeaway>
    </figure>
  );
}

// ---- Unusual days: expected vs what happened ---------------------------------------------------

type AnomalyItem = { date: string; metric: string; normal?: number; actual?: number; dollars?: number; text: string };

export function UnusualDays({ chart, details }: { chart: Extract<Chart, { type: "list" }>; details?: Record<string, unknown> }) {
  const items: AnomalyItem[] = ((details?.items as AnomalyItem[] | undefined) ?? chart.rows.map((r): AnomalyItem => ({ date: r.date, metric: r.metric, text: r.text }))).slice(0, 5);
  const max = Math.max(1, ...items.flatMap((i) => (i.metric === "sales" && i.normal != null && i.actual != null ? [i.normal, i.actual] : [])));
  return (
    <ul className="flex flex-col gap-3" aria-label="Unusual days">
      {items.map((it) => {
        const sales = it.metric === "sales" && it.normal != null && it.actual != null;
        const x = (v: number) => `${(v / max) * 100}%`;
        return (
          <li key={`${it.date}${it.metric}`} className="rounded-xl border border-border px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[0.82rem] font-medium text-ink">{day(it.date, { weekday: "long", month: "short", day: "numeric" })}</span>
              {sales && <span className="num text-xs font-medium text-ink-2">{it.actual! < it.normal! ? "−" : "+"}{whole(Math.abs(it.actual! - it.normal!))} vs expected</span>}
            </div>
            {sales ? (
              <div className="mt-3">
                <div className="relative h-4" role="img" aria-label={`Expected ${whole(it.normal!)}, actual ${whole(it.actual!)}`}>
                  <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                  <div className="lab-grow-x absolute top-1/2 h-[3px] -translate-y-1/2 rounded bg-[var(--lab-hot)]" style={{ left: x(Math.min(it.normal!, it.actual!)), width: `calc(${x(Math.max(it.normal!, it.actual!))} - ${x(Math.min(it.normal!, it.actual!))})` }} />
                  <div className="absolute top-1/2 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded bg-ink-2" style={{ left: x(it.normal!) }} />
                  <div className="lab-pop absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-[var(--lab-hot)]" style={{ left: x(it.actual!) }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-muted">
                  <span><span className="num font-semibold text-ink">{whole(it.actual!)}</span> actual</span>
                  <span>expected <span className="num text-ink-2">{whole(it.normal!)}</span></span>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-ink-2">{it.text.replace(/^[A-Z][a-z]+day [A-Z][a-z]{2} \d{1,2}: /, "")}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function InsightChart({ chart, details }: { chart: Chart | null; details?: Record<string, unknown> }) {
  if (!chart) return null;
  if (chart.type === "seasons") return <SeasonsChart chart={chart} />;
  if (chart.type === "week") return <WeekChart rows={chart.rows} />;
  if (chart.type === "quadrant") return <QuadrantChart chart={chart} />;
  if (chart.type === "band") return <BandChart chart={chart} />;
  if (chart.type === "bars") return chart.rows.length ? <BarsChart chart={chart} /> : null;
  if (chart.type === "heatmap") return <HeatmapChart chart={chart} />;
  if (chart.type === "list") return <UnusualDays chart={chart} details={details} />;
  return null;
}

