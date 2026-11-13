import type { WeekForecast } from "@/domain/beerDemand";
import { shortDate } from "@/lib/format";

/**
 * Pints a week: the last 26 weeks as quiet bars, the next 4 in the page hue
 * with their range as a whisker. Hover a bar for the number.
 */
export function WeeklyPints({ history, forecast }: { history: { week: string; pints: number }[]; forecast: WeekForecast[] }) {
  const thisWeek = forecast[0]?.week;
  const past = history.filter((h) => !thisWeek || h.week < thisWeek).slice(-26);
  const bars = [...past.map((h) => ({ week: h.week, v: h.pints, lo: null as number | null, hi: null as number | null, f: false })), ...forecast.map((f) => ({ week: f.week, v: f.mid, lo: f.low, hi: f.high, f: true }))];
  const max = Math.max(1, ...bars.map((b) => b.hi ?? b.v));
  const W = 600, H = 120, pad = 18, bw = (W - 4) / Math.max(bars.length, 1);
  const y = (v: number) => H - pad - (v / max) * (H - pad - 6);
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label="Pints a week, last 26 weeks and the next 4">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={W} y={y(t) - 2} textAnchor="end" className="fill-muted text-[9px]">{t}</text>
        </g>
      ))}
      {bars.map((b, i) => (
        <g key={b.week}>
          <title>{`${shortDate(b.week)}: ${b.f ? `about ${Math.round(b.lo ?? 0)}–${Math.round(b.hi ?? 0)} pints (forecast)` : `${Math.round(b.v)} pints`}`}</title>
          <rect x={2 + i * bw + 1} y={y(b.v)} width={Math.max(1, bw - 2)} height={Math.max(0, H - pad - y(b.v))} rx={1.5} fill={b.f ? "var(--area)" : "var(--border-strong)"} opacity={b.f ? 0.85 : 1} />
          {b.f && b.lo != null && b.hi != null && <line x1={2 + i * bw + bw / 2} x2={2 + i * bw + bw / 2} y1={y(b.hi)} y2={y(b.lo)} stroke="var(--ink)" strokeWidth={1.5} opacity={0.6} />}
        </g>
      ))}
      {past[0] && <text x={2} y={H - 4} className="fill-muted text-[9px]">{shortDate(past[0].week)}</text>}
      {thisWeek && <text x={2 + past.length * bw} y={H - 4} className="fill-muted text-[9px]">This week</text>}
    </svg>
  );
}

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Average pints per month across every year it sold. */
export function MonthBars({ months }: { months: (number | null)[] }) {
  const max = Math.max(1, ...months.map((m) => m ?? 0));
  return (
    <div className="flex h-12 items-end gap-0.5" aria-label="Average pints by month">
      {months.map((m, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-0.5" title={m == null ? "Not poured" : `${Math.round(m)} pints a ${["January","February","March","April","May","June","July","August","September","October","November","December"][i]} on average`}>
          <div className="w-full rounded-sm bg-area/60" style={{ height: `${m == null ? 0 : Math.max(2, (m / max) * 32)}px` }} />
          <span className="text-[9px] text-muted">{MONTHS[i]}</span>
        </div>
      ))}
    </div>
  );
}
