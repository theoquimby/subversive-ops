import type { DeliveryMonth } from "@/domain/kegAccounts";
import { niceMax, Plot, W } from "../fleet/charts";
import { KEG_STATE_FILL } from "../keg-state";
import { bbl } from "./bits";

/**
 * Kegs delivered to one account each month. Drawn like the fleet charts
 * (kegs/fleet/charts.tsx): a recessive grid, the "out" keg-state colour, a
 * tooltip on hover and a hidden table of the same numbers for screen readers.
 */

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string, withYear = true) => `${MONTH[Number(m.slice(5, 7)) - 1]}${withYear ? ` ${m.slice(0, 4)}` : ""}`;

export function DeliveryBars({ rows, account }: { rows: DeliveryMonth[]; account: string }) {
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
  const said = (r: DeliveryMonth) => `${r.kegs} keg${r.kegs === 1 ? "" : "s"} delivered (${bbl(r.gallons)} bbl)`;
  return (
    <>
      <Plot height={H} max={max} ticks={ticks} ariaLabel={`Kegs delivered to ${account} each month`}>
        {rows.map((r, i) => {
          const cx = i * slot + slot / 2;
          return (
            <g key={r.month}>
              <title>{`${monthLabel(r.month)}: ${said(r)}`}</title>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {r.kegs > 0 && <rect x={cx - bw / 2} y={y(r.kegs)} width={bw} height={Math.max(0, H - y(r.kegs))} fill={KEG_STATE_FILL.out} />}
            </g>
          );
        })}
      </Plot>
      {/* A wrapper, not the table, is visually hidden: a table ignores the 1px width and would widen the page. */}
      <div className="sr-only"><table>
        <caption>Kegs delivered to {account} each month</caption>
        <thead><tr><th>Month</th><th>Kegs</th><th>Barrels</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.month}><td>{monthLabel(r.month)}</td><td>{r.kegs}</td><td>{bbl(r.gallons)}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}
