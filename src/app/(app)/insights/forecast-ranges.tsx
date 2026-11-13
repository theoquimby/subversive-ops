import Link from "next/link";
import { HelpTip } from "@/components/help";
import { Card, Section } from "@/components/ui";
import { WEEKDAYS } from "@/domain/dates";
import { money, shortDate } from "@/lib/format";
import { forecastRanges } from "@/server/services/analytics";
import { BandChart } from "./charts";

const whole = (n: number) => money(n, { whole: true });

/**
 * The next `days` days as likely ranges ("Saturday $3,100–$3,600") from the
 * Insights Lab forecast. Drop-in for /sales (and the schedule or ordering
 * pages): `<ForecastRanges />`. Renders nothing before the first run.
 */
export async function ForecastRanges({ days = 7, title = "Likely range" }: { days?: number; title?: string }) {
  const f = await forecastRanges().catch(() => null);
  if (!f || !f.days.length) return null;
  const rows = f.days.slice(0, days);
  const open = rows.filter((d) => !d.closed);
  const mid = open.reduce((s, d) => s + d.mid, 0);
  const busiest = open.reduce<(typeof open)[number] | null>((b, d) => (!b || d.mid > b.mid ? d : b), null);
  const wd = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return (
    <Section
      help="insights.forecast.ranges"
      title={<span className="inline-flex items-center gap-1">{title} <HelpTip id="insights.forecast.ranges" /></span>}
      description={`4 days in 5 land inside the range. ${f.compare}`}
      actions={<Link href="/insights#lab-forecast" className="relative text-sm text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">How →</Link>}
    >
      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span className="num text-[1.5rem] font-semibold tracking-tight text-ink">{whole(mid)}</span>
            <span className="text-sm text-muted">likely over the next {rows.length} days</span>
          </div>
          {busiest && <span className="text-sm text-ink-2">Busiest: <span className="font-medium text-ink">{wd(busiest.date)}</span>, <span className="num">{whole(busiest.low)}–{whole(busiest.high)}</span></span>}
        </div>
        <BandChart chart={{ type: "band", rows, history: [] }} />
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
          {open.map((d) => (
            <li key={d.date} className="flex justify-between gap-2">
              <span className="text-muted">{wd(d.date).slice(0, 3)} <span className="hidden sm:inline">{shortDate(d.date)}</span></span>
              <span className="num text-ink">{whole(d.low)}–{whole(d.high)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}
