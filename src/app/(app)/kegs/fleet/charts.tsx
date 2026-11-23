import { BUCKET_LABEL, BUCKETS, type MonthRow, type WeekPoint, type Went } from "@/domain/kegFleet";
import { shortDate } from "@/lib/format";
import type { ReactNode } from "react";
import { KEG_STATE_FILL, KEG_STATE_KEY } from "../keg-state";

/**
 * The fleet charts. Hand-built SVG in the house style: a recessive grid, one
 * colour per keg state (keg-state.tsx) and a tooltip on hover. The axis words
 * are HTML beside the drawing, so they stay 11px however wide the chart is.
 */

/** Where the beer from each fill went, in the keg-state colours: tapped is on tap, sent out is out, still full is full. */
const WENT: { key: Went; label: string; fill: string; missing?: boolean }[] = [
  { key: "tapped", label: "Tapped here", fill: KEG_STATE_FILL.tap },
  { key: "out", label: "Sent out", fill: KEG_STATE_FILL.out },
  { key: "stock", label: "Still full", fill: KEG_STATE_FILL.full },
  { key: "none", label: "No scan: not known", fill: "none", missing: true },
];

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string, withYear = true) => `${MONTH[Number(m.slice(5, 7)) - 1]}${withYear ? ` ${m.slice(0, 4)}` : ""}`;
const bbl = (gallons: number) => (gallons / 31).toFixed(1);
/** "Aug 17, 2022": the axis can span years, so the year is always shown. */
const dated = (d: string) => `${shortDate(d)}, ${d.slice(0, 4)}`;

/** Round a chart's top up to a tidy number so the grid lines read cleanly. */
export function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v) ?? 10;
  return step * pow;
}

export interface KeyItem { label: string; fill: string; missing?: boolean }

/** A dashed outline: a part of the record that isn't there. */
const HATCH_ID = "keg-missing";
function Hatch() {
  return (
    <defs>
      <pattern id={HATCH_ID} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1={0} y1={0} x2={0} y2={5} stroke="var(--muted)" strokeWidth={1.4} />
      </pattern>
    </defs>
  );
}

export function Key({ items }: { items: KeyItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          {i.missing ? (
            <span aria-hidden className="inline-block size-2.5 rounded-sm border border-dashed border-muted" />
          ) : (
            <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: i.fill }} />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export const BUCKET_KEY: KeyItem[] = KEG_STATE_KEY;
export const WENT_KEY: KeyItem[] = WENT.map(({ label, fill, missing }) => ({ label, fill, missing }));

export const W = 640;

/** The plot with its axis: gridlines and marks drawn in SVG, the numbers and dates as 11px text around it. */
export function Plot({ height, max, ticks, children, ariaLabel, className }: { height: number; max: number; ticks: { at: number; text: string; align?: "start" | "middle" | "end" }[]; children: ReactNode; ariaLabel: string; className?: string }) {
  const y = (v: number) => height - (v / max) * height;
  return (
    <div className={className}>
      <div className="relative mt-2 ml-8" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={ariaLabel}>
          <Hatch />
          {[0, max / 2, max].map((t) => <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          {children}
        </svg>
        {[0, max / 2, max].map((t) => (
          <span key={t} aria-hidden className="num absolute -left-8 w-6.5 -translate-y-1/2 text-right text-[11px] leading-none text-muted" style={{ top: `${(1 - t / max) * 100}%` }}>{Math.round(t)}</span>
        ))}
      </div>
      <div aria-hidden className="relative mt-1.5 ml-8 h-4 text-[11px] leading-4 text-muted">
        {ticks.map((t) => (
          <span key={`${t.at}-${t.text}`} className={`absolute whitespace-nowrap ${t.align === "start" ? "" : t.align === "end" ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${(t.at / W) * 100}%` }}>{t.text}</span>
        ))}
      </div>
    </div>
  );
}

/** How many kegs were in each state at the end of each week, stacked. */
export function FleetArea({ points, compact }: { points: WeekPoint[]; compact?: boolean }) {
  const H = compact ? 120 : 170;
  const total = (p: WeekPoint) => BUCKETS.reduce((s, b) => s + p[b], 0);
  const max = niceMax(Math.max(1, ...points.map(total)));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * H;
  // Stack from the bottom: full, on tap, out, dirty, clean.
  const base = points.map(() => 0);
  const layers = BUCKETS.map((b) => {
    const lower = [...base];
    points.forEach((p, i) => (base[i] += p[b]));
    const upper = [...base];
    const top = upper.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const back = lower.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    return { b, d: `M${top.join("L")}L${back.join("L")}Z` };
  });
  const step = n <= 1 ? W : W / (n - 1);
  const marks = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
  return (
    <>
      <Plot
        height={H}
        max={max}
        ariaLabel="Kegs full, on tap, out, dirty and clean at the end of each week"
        ticks={marks.map((i, k) => ({ at: x(i), text: dated(points[i].week), align: k === 0 ? "start" : k === marks.length - 1 ? "end" : "middle" }))}
      >
        {n > 1 && layers.map((l) => <path key={l.b} d={l.d} fill={KEG_STATE_FILL[l.b]} />)}
        {n === 1 && BUCKETS.reduce<{ el: ReactNode[]; at: number }>((acc, b) => {
          const v = points[0][b];
          acc.el.push(<rect key={b} x={0} width={W} y={y(acc.at + v)} height={Math.max(0, y(acc.at) - y(acc.at + v))} fill={KEG_STATE_FILL[b]} />);
          return { el: acc.el, at: acc.at + v };
        }, { el: [], at: 0 }).el}
        {points.map((p, i) => (
          <rect key={p.week} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent">
            <title>{`Week of ${dated(p.week)}: ${BUCKETS.map((b) => `${p[b]} ${BUCKET_LABEL[b].toLowerCase()}`).join(", ")}`}</title>
          </rect>
        ))}
      </Plot>
      {/* A wrapper, not the table, is visually hidden: a table ignores the 1px width and would widen the page. */}
      <div className="sr-only"><table>
        <caption>Kegs by state at the end of each week</caption>
        <thead><tr><th>Week of</th>{BUCKETS.map((b) => <th key={b}>{BUCKET_LABEL[b]}</th>)}</tr></thead>
        <tbody>{points.map((p) => <tr key={p.week}><td>{dated(p.week)}</td>{BUCKETS.map((b) => <td key={b}>{p[b]}</td>)}</tr>)}</tbody>
      </table></div>
    </>
  );
}

/** Kegs filled each calendar month: last year as quiet bars, this year in the full-keg colour beside them. */
export function FillBars({ thisYear, lastYear }: { thisYear: MonthRow[]; lastYear: MonthRow[] }) {
  const H = 150;
  const max = niceMax(Math.max(1, ...thisYear.map((r) => r.kegs), ...lastYear.map((r) => r.kegs)));
  const slot = W / 12;
  const bw = Math.min(16, slot / 2 - 3);
  const y = (v: number) => H - (v / max) * H;
  const year = thisYear[0]?.month.slice(0, 4) ?? "";
  const prev = lastYear[0]?.month.slice(0, 4) ?? "";
  return (
    <>
      <Plot height={H} max={max} ariaLabel={`Kegs filled each month, ${year} against ${prev}`} ticks={MONTH.map((m, i) => ({ at: i * slot + slot / 2, text: i % 2 === 0 ? m : "" })).filter((t) => t.text)}>
        {thisYear.map((r, i) => {
          const l = lastYear[i];
          const cx = i * slot + slot / 2;
          return (
            <g key={r.month}>
              <title>{`${MONTH[i]}: ${r.kegs} kegs (${bbl(r.gallons)} bbl) in ${year}, ${l?.kegs ?? 0} (${bbl(l?.gallons ?? 0)} bbl) in ${prev}`}</title>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              <rect x={cx - bw - 1} y={y(l?.kegs ?? 0)} width={bw} height={Math.max(0, H - y(l?.kegs ?? 0))} fill="var(--border-strong)" />
              <rect x={cx + 1} y={y(r.kegs)} width={bw} height={Math.max(0, H - y(r.kegs))} fill={KEG_STATE_FILL.full} />
            </g>
          );
        })}
      </Plot>
      {/* A wrapper, not the table, is visually hidden: a table ignores the 1px width and would widen the page. */}
      <div className="sr-only"><table>
        <caption>Kegs filled each month</caption>
        <thead><tr><th>Month</th><th>{year} kegs</th><th>{year} barrels</th><th>{prev} kegs</th><th>{prev} barrels</th></tr></thead>
        <tbody>{thisYear.map((r, i) => <tr key={r.month}><td>{MONTH[i]}</td><td>{r.kegs}</td><td>{bbl(r.gallons)}</td><td>{lastYear[i]?.kegs ?? 0}</td><td>{bbl(lastYear[i]?.gallons ?? 0)}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}

/** Each month's fills, stacked by where the beer went. "No scan" is the gap in the record, drawn hatched: it isn't a place. */
export function WentBars({ rows }: { rows: MonthRow[] }) {
  const H = 150;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.kegs)));
  const n = Math.max(rows.length, 1);
  const slot = W / n;
  const bw = Math.max(2, Math.min(28, slot - 3));
  const y = (v: number) => H - (v / max) * H;
  // Up to a year or so: every month or two by name. Longer: just the years, at each January.
  const every = Math.ceil(n / 6);
  const label = (month: string, i: number) => (n > 14 ? (month.endsWith("-01") ? month.slice(0, 4) : null) : i % every === 0 ? monthLabel(month, i === 0 || month.endsWith("-01")) : null);
  const ticks = rows.flatMap((r, i) => {
    const t = label(r.month, i);
    return t ? [{ at: i * slot + slot / 2, text: t, align: i === 0 ? ("start" as const) : ("middle" as const) }] : [];
  });
  return (
    <>
      <Plot height={H} max={max} ariaLabel="Fills each month, by where the beer went" ticks={ticks}>
        {rows.map((r, i) => {
          const cx = i * slot + slot / 2;
          let at = 0;
          return (
            <g key={r.month}>
              <title>{`${monthLabel(r.month)}: ${r.kegs} fills. ${r.tapped} tapped here, ${r.out} sent out, ${r.stock} still full, ${r.none} with no scan`}</title>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {WENT.map((w) => {
                const v = r[w.key];
                const el = v ? <rect key={w.key} x={cx - bw / 2} y={y(at + v)} width={bw} height={Math.max(0, y(at) - y(at + v))} fill={w.missing ? `url(#${HATCH_ID})` : w.fill} /> : null;
                at += v;
                return el;
              })}
            </g>
          );
        })}
      </Plot>
      {/* A wrapper, not the table, is visually hidden: a table ignores the 1px width and would widen the page. */}
      <div className="sr-only"><table>
        <caption>Fills each month by where the beer went</caption>
        <thead><tr><th>Month</th><th>Fills</th>{WENT.map((w) => <th key={w.key}>{w.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.month}><td>{monthLabel(r.month)}</td><td>{r.kegs}</td>{WENT.map((w) => <td key={w.key}>{r[w.key]}</td>)}</tr>)}</tbody>
      </table></div>
    </>
  );
}
