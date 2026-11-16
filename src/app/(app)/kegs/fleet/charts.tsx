import { BUCKET_LABEL, BUCKETS, type Bucket, type MonthRow, type WeekPoint, type Went } from "@/domain/kegFleet";
import { shortDate } from "@/lib/format";

/**
 * The three fleet charts. Hand-built SVG in the house style: a recessive grid,
 * one hue for the thing being counted, greys for the rest, a tooltip on hover
 * and a hidden table of the same numbers for screen readers.
 */

const BUCKET_FILL: Record<Bucket, { fill: string; opacity: number }> = {
  full: { fill: "var(--area)", opacity: 0.85 },
  out: { fill: "var(--ink-2)", opacity: 0.7 },
  dirty: { fill: "var(--warn)", opacity: 0.55 },
  clean: { fill: "var(--border-strong)", opacity: 1 },
};

const WENT: { key: Went; label: string; fill: string; opacity: number }[] = [
  { key: "tapped", label: "Tapped here", fill: "var(--area)", opacity: 0.85 },
  { key: "out", label: "Sent out", fill: "var(--ink-2)", opacity: 0.7 },
  { key: "stock", label: "Still full", fill: "var(--border-strong)", opacity: 1 },
  { key: "none", label: "No scan", fill: "var(--warn)", opacity: 0.55 },
];

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string, withYear = true) => `${MONTH[Number(m.slice(5, 7)) - 1]}${withYear ? ` ${m.slice(0, 4)}` : ""}`;
const bbl = (gallons: number) => (gallons / 31).toFixed(1);
/** "Aug 17, 2022": the axis can span years, so the year is always shown. */
const dated = (d: string) => `${shortDate(d)}, ${d.slice(0, 4)}`;

/** Round a chart's top up to a tidy number so the grid lines read cleanly. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v) ?? 10;
  return step * pow;
}

export function Key({ items }: { items: { label: string; fill: string; opacity: number }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: i.fill, opacity: i.opacity }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export const BUCKET_KEY = BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], ...BUCKET_FILL[b] }));
export const WENT_KEY = WENT.map(({ label, fill, opacity }) => ({ label, fill, opacity }));

function Grid({ W, max, y, pad }: { W: number; max: number; y: (v: number) => number; pad: number }) {
  return (
    <>
      {[0, max / 2, max].map((t) => (
        <g key={t}>
          <line x1={pad} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={pad - 4} y={y(t) + 3} textAnchor="end" className="fill-muted text-[9px]">{Math.round(t)}</text>
        </g>
      ))}
    </>
  );
}

/** How many kegs were full, on tap or out, dirty and clean at the end of each week, stacked. */
export function FleetArea({ points }: { points: WeekPoint[] }) {
  const W = 640, H = 190, pad = 26, bottom = 18;
  const total = (p: WeekPoint) => p.full + p.out + p.dirty + p.clean;
  const max = niceMax(Math.max(1, ...points.map(total)));
  const n = points.length;
  const x = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad));
  const y = (v: number) => H - bottom - (v / max) * (H - bottom - 8);
  // Stack from the bottom: full, on tap or out, dirty, clean.
  const base = points.map(() => 0);
  const layers = BUCKETS.map((b) => {
    const lower = [...base];
    points.forEach((p, i) => (base[i] += p[b]));
    const upper = [...base];
    const top = upper.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const back = lower.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    return { b, d: `M${top.join("L")}L${back.join("L")}Z` };
  });
  const step = n <= 1 ? W - pad : (W - pad) / (n - 1);
  const marks = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label="Kegs full, on tap or out, dirty and clean at the end of each week">
        <Grid W={W} max={max} y={y} pad={pad} />
        {n > 1 && layers.map((l) => <path key={l.b} d={l.d} fill={BUCKET_FILL[l.b].fill} opacity={BUCKET_FILL[l.b].opacity} />)}
        {n === 1 && BUCKETS.reduce<{ el: React.ReactNode[]; at: number }>((acc, b) => {
          const v = points[0][b];
          acc.el.push(<rect key={b} x={pad} width={W - pad} y={y(acc.at + v)} height={Math.max(0, y(acc.at) - y(acc.at + v))} fill={BUCKET_FILL[b].fill} opacity={BUCKET_FILL[b].opacity} />);
          return { el: acc.el, at: acc.at + v };
        }, { el: [], at: 0 }).el}
        {points.map((p, i) => (
          <rect key={p.week} x={x(i) - step / 2} y={0} width={step} height={H - bottom} fill="transparent">
            <title>{`Week of ${dated(p.week)}: ${p.full} full, ${p.out} on tap or out, ${p.dirty} dirty, ${p.clean} clean`}</title>
          </rect>
        ))}
        {marks.map((i, k) => <text key={i} x={x(i)} y={H - 4} textAnchor={k === 0 ? "start" : k === marks.length - 1 ? "end" : "middle"} className="fill-muted text-[9px]">{dated(points[i].week)}</text>)}
      </svg>
      <table className="sr-only">
        <caption>Kegs by state at the end of each week</caption>
        <thead><tr><th>Week of</th>{BUCKETS.map((b) => <th key={b}>{BUCKET_LABEL[b]}</th>)}</tr></thead>
        <tbody>{points.map((p) => <tr key={p.week}><td>{dated(p.week)}</td>{BUCKETS.map((b) => <td key={b}>{p[b]}</td>)}</tr>)}</tbody>
      </table>
    </>
  );
}

/** Kegs filled each calendar month: last year as quiet bars, this year in the page hue beside them. */
export function FillBars({ thisYear, lastYear }: { thisYear: MonthRow[]; lastYear: MonthRow[] }) {
  const W = 640, H = 170, pad = 26, bottom = 18;
  const max = niceMax(Math.max(1, ...thisYear.map((r) => r.kegs), ...lastYear.map((r) => r.kegs)));
  const slot = (W - pad) / 12;
  const bw = Math.min(16, slot / 2 - 3);
  const y = (v: number) => H - bottom - (v / max) * (H - bottom - 8);
  const year = thisYear[0]?.month.slice(0, 4) ?? "";
  const prev = lastYear[0]?.month.slice(0, 4) ?? "";
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Kegs filled each month, ${year} against ${prev}`}>
        <Grid W={W} max={max} y={y} pad={pad} />
        {thisYear.map((r, i) => {
          const l = lastYear[i];
          const cx = pad + i * slot + slot / 2;
          return (
            <g key={r.month}>
              <title>{`${MONTH[i]}: ${r.kegs} kegs (${bbl(r.gallons)} bbl) in ${year}, ${l?.kegs ?? 0} (${bbl(l?.gallons ?? 0)} bbl) in ${prev}`}</title>
              <rect x={pad + i * slot} y={0} width={slot} height={H - bottom} fill="transparent" />
              <rect x={cx - bw - 1} y={y(l?.kegs ?? 0)} width={bw} height={Math.max(0, H - bottom - y(l?.kegs ?? 0))} rx={1.5} fill="var(--border-strong)" />
              <rect x={cx + 1} y={y(r.kegs)} width={bw} height={Math.max(0, H - bottom - y(r.kegs))} rx={1.5} fill="var(--area)" opacity={0.85} />
              <text x={cx} y={H - 4} textAnchor="middle" className="fill-muted text-[9px]">{MONTH[i]}</text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Kegs filled each month</caption>
        <thead><tr><th>Month</th><th>{year} kegs</th><th>{year} barrels</th><th>{prev} kegs</th><th>{prev} barrels</th></tr></thead>
        <tbody>{thisYear.map((r, i) => <tr key={r.month}><td>{MONTH[i]}</td><td>{r.kegs}</td><td>{bbl(r.gallons)}</td><td>{lastYear[i]?.kegs ?? 0}</td><td>{bbl(lastYear[i]?.gallons ?? 0)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

/** Each month's fills, stacked by where the beer went. "No scan" is the gap in the record. */
export function WentBars({ rows }: { rows: MonthRow[] }) {
  const W = 640, H = 170, pad = 26, bottom = 18;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.kegs)));
  const n = Math.max(rows.length, 1);
  const slot = (W - pad) / n;
  const bw = Math.max(2, Math.min(28, slot - 3));
  const y = (v: number) => H - bottom - (v / max) * (H - bottom - 8);
  // Up to a year or so: every month or two by name. Longer: just the years, at each January.
  const every = Math.ceil(n / 8);
  const label = (month: string, i: number) => (n > 14 ? (month.endsWith("-01") ? month.slice(0, 4) : null) : i % every === 0 ? monthLabel(month, i === 0 || month.endsWith("-01")) : null);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Fills each month, by where the beer went">
        <Grid W={W} max={max} y={y} pad={pad} />
        {rows.map((r, i) => {
          const cx = pad + i * slot + slot / 2;
          let at = 0;
          return (
            <g key={r.month}>
              <title>{`${monthLabel(r.month)}: ${r.kegs} fills — ${r.tapped} tapped here, ${r.out} sent out, ${r.stock} still full, ${r.none} with no scan`}</title>
              <rect x={pad + i * slot} y={0} width={slot} height={H - bottom} fill="transparent" />
              {WENT.map((w) => {
                const v = r[w.key];
                const el = v ? <rect key={w.key} x={cx - bw / 2} y={y(at + v)} width={bw} height={Math.max(0, y(at) - y(at + v))} fill={w.fill} opacity={w.opacity} /> : null;
                at += v;
                return el;
              })}
              {label(r.month, i) && <text x={cx} y={H - 4} textAnchor="middle" className="fill-muted text-[9px]">{label(r.month, i)}</text>}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Fills each month by where the beer went</caption>
        <thead><tr><th>Month</th><th>Fills</th>{WENT.map((w) => <th key={w.key}>{w.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.month}><td>{monthLabel(r.month)}</td><td>{r.kegs}</td>{WENT.map((w) => <td key={w.key}>{r[w.key]}</td>)}</tr>)}</tbody>
      </table>
    </>
  );
}
