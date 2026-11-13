import Link from "next/link";
import { HelpTip } from "@/components/help";
import { Card, Section } from "@/components/ui";
import { WEEKDAYS } from "@/domain/dates";
import { money, shortDate } from "@/lib/format";
import { forecastRanges } from "@/server/services/analytics";
import { BandChart } from "./charts";

const whole = (n: number) => money(n, { whole: true });

/**
 * Forecast ranges for the next `days` days ("Saturday $3,100–$3,600"), from the
 * statistical forecast on Insights. Drop-in for /sales (and the schedule or
 * ordering pages): `<ForecastRanges />`. Renders nothing before the first run.
 */
export async function ForecastRanges({ days = 7, title = "Likely range" }: { days?: number; title?: string }) {
  const f = await forecastRanges().catch(() => null);
  if (!f || !f.days.length) return null;
  const rows = f.days.slice(0, days);
  const open = rows.filter((d) => !d.closed);
  return (
    <Section
      help="insights.forecast.ranges"
      title={<span className="inline-flex items-center gap-1">{title} <HelpTip id="insights.forecast.ranges" /></span>}
      description={`80% ranges: 4 days in 5 land inside. ${f.compare}`}
      actions={<Link href="/insights#forecast" className="relative text-sm text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">How →</Link>}
    >
      <Card className="p-4">
        <BandChart chart={{ type: "band", rows, history: [] }} />
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {open.map((d) => (
            <li key={d.date} className="flex justify-between gap-2">
              <span className="text-muted">{WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()]} <span className="hidden sm:inline">{shortDate(d.date)}</span></span>
              <span className="num text-ink">{whole(d.low)}–{whole(d.high)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}
