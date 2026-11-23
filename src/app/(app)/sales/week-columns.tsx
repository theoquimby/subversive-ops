import { ColumnsChart, type Col } from "@/components/columns-chart";
import { money, shortDate } from "@/lib/format";

const whole = (n: number) => money(n, { whole: true });

/**
 * The coming week as columns: each day's forecast, with a tick where a usual
 * day of that weekday would be. The busiest day sits on a soft band.
 */
export function WeekColumns({ days, mark }: { days: { date: string; label: string; forecast: number; usual: number | null; closed: boolean; why: string | null }[]; mark: string | null }) {
  const cols: Col[] = days.map((d) => ({
    key: d.date,
    label: d.label,
    sub: d.closed ? "Closed" : shortDate(d.date),
    mark: d.date === mark,
    parts: [d.forecast],
    tick: d.usual ?? undefined,
    tip: {
      title: `${d.label} ${shortDate(d.date)}${d.why ? ` · ${d.why}` : ""}`,
      rows: [
        { label: "Forecast", value: d.closed ? "Closed" : whole(d.forecast), strong: true },
        ...(d.usual != null ? [{ label: "A usual day", value: whole(d.usual) }] : []),
      ],
    },
  }));
  return (
    <ColumnsChart
      cols={cols}
      series={[{ color: "var(--money-sales)", label: "Forecast sales" }]}
      tickLabel="A usual day of that weekday"
      height={170}
      ariaLabel="Forecast sales for each of the next seven days, against a usual day of that weekday"
      caption="Day"
    />
  );
}
