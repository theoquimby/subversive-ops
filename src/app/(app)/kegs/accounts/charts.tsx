import type { DeliveryMonth } from "@/domain/kegAccounts";
import { bbl } from "./bits";

/**
 * Kegs delivered to one account each month. Hand-built SVG in the same style as
 * the fleet charts (kegs/fleet/charts.tsx): a recessive grid, one hue, a tooltip
 * on hover and a hidden table of the same numbers for screen readers.
 */

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string, withYear = true) => `${MONTH[Number(m.slice(5, 7)) - 1]}${withYear ? ` ${m.slice(0, 4)}` : ""}`;

/** Round the chart's top up to a tidy number so the grid lines read cleanly. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v) ?? 10;
  return step * pow;
}

export function DeliveryBars({ rows, account }: { rows: DeliveryMonth[]; account: string }) {
  const W = 640, H = 170, pad = 26, bottom = 18;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.kegs)));
  const n = Math.max(rows.length, 1);
  const slot = (W - pad) / n;
  const bw = Math.max(2, Math.min(28, slot - 3));
  const y = (v: number) => H - bottom - (v / max) * (H - bottom - 8);
  // Up to a year or so: every month or two by name. Longer: just the years, at each January.
  const every = Math.ceil(n / 8);
  const label = (month: string, i: number) => (n > 14 ? (month.endsWith("-01") ? month.slice(0, 4) : null) : i % every === 0 ? monthLabel(month, i === 0 || month.endsWith("-01")) : null);
  const said = (r: DeliveryMonth) => `${r.kegs} keg${r.kegs === 1 ? "" : "s"} delivered (${bbl(r.gallons)} bbl)`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Kegs delivered to ${account} each month`}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad - 4} y={y(t) + 3} textAnchor="end" className="fill-muted text-[9px]">{Math.round(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = pad + i * slot + slot / 2;
          return (
            <g key={r.month}>
              <title>{`${monthLabel(r.month)}: ${said(r)}`}</title>
              <rect x={pad + i * slot} y={0} width={slot} height={H - bottom} fill="transparent" />
              {r.kegs > 0 && <rect x={cx - bw / 2} y={y(r.kegs)} width={bw} height={Math.max(0, H - bottom - y(r.kegs))} rx={1.5} fill="var(--area)" opacity={0.85} />}
              {label(r.month, i) && <text x={cx} y={H - 4} textAnchor="middle" className="fill-muted text-[9px]">{label(r.month, i)}</text>}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Kegs delivered to {account} each month</caption>
        <thead><tr><th>Month</th><th>Kegs</th><th>Barrels</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.month}><td>{monthLabel(r.month)}</td><td>{r.kegs}</td><td>{bbl(r.gallons)}</td></tr>)}</tbody>
      </table>
    </>
  );
}
