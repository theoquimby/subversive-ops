import { GridCell } from "@/components/grid";
import { HelpTip, HelpZone } from "@/components/help";
import { Card } from "@/components/ui";
import { productivity } from "@/domain/covers";
import { weekday, type ISODate } from "@/domain/dates";
import { hourLabel } from "@/domain/morningBrief";
import { money } from "@/lib/format";
import { actualCovers, coversForecast, getGuestsPerCheck } from "@/server/services/covers";
import { setGuestsPerCheck } from "./covers-actions";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Covers alongside sales for the week on the board: forecast guests per day,
 * the rush, and sales and covers per scheduled labor hour. Past days use what
 * Square actually rang.
 */
export async function CoversStrip({ dates, today, days, opening }: { dates: ISODate[]; today: ISODate; days: { date: ISODate; sales: number; hours: number }[]; opening: Record<number, [number, number]> }) {
  const [fc, actual, gpc] = await Promise.all([coversForecast(dates).catch(() => []), actualCovers(dates[0], dates[6]), getGuestsPerCheck()]);
  const rows = dates.map((d) => {
    const f = fc.find((x) => x.date === d);
    const a = d < today ? actual.get(d) : undefined;
    const s = days.find((x) => x.date === d);
    const sales = a?.sales ?? s?.sales ?? 0;
    const covers = a ? a.covers : f?.covers ?? null;
    return { date: d, actual: !!a, open: !!opening[weekday(d)], covers, peak: a ? null : f?.peak ?? null, p: productivity(sales, covers, s?.hours ?? 0) };
  });
  const weekCovers = rows.reduce((t, r) => t + (r.covers ?? 0), 0);
  const weekHours = days.reduce((t, d) => t + d.hours, 0);
  const weekSales = rows.reduce((t, r) => t + r.p.sales, 0);
  const wk = productivity(weekSales, rows.some((r) => r.covers != null) ? weekCovers : null, weekHours);
  return (
    <HelpZone id="schedule.covers" className="mt-8">
      <section aria-labelledby="covers-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 id="covers-h" className="flex items-center gap-1.5 text-[0.95rem] font-semibold">Covers &amp; labor productivity <HelpTip id="schedule.covers" /></h2>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Guests per check</span>
            <div className="w-16"><GridCell grid="covers" col="gpc" type="number" decimals={1} value={gpc} onSave={setGuestsPerCheck} ariaLabel="Guests per check" /></div>
          </div>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="border-b border-border px-3 py-2 text-left font-medium" />
                {rows.map((r) => <th key={r.date} className="border-b border-border px-2 py-2 text-right font-medium">{DAY[weekday(r.date)]}</th>)}
                <th className="border-b border-border px-3 py-2 text-right font-medium">Week</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-border px-3 py-2 text-xs text-muted">Covers</td>
                {rows.map((r) => <td key={r.date} className="num border-b border-border px-2 py-2 text-right">{!r.open && !r.actual ? <span className="text-muted">—</span> : r.covers == null ? <span className="text-muted">?</span> : <span className={r.actual ? "" : "text-ink-2"}>{Math.round(r.covers)}</span>}</td>)}
                <td className="num border-b border-border px-3 py-2 text-right font-medium">{wk.covers == null ? "—" : Math.round(wk.covers)}</td>
              </tr>
              <tr>
                <td className="border-b border-border px-3 py-2 text-xs text-muted">Rush</td>
                {rows.map((r) => <td key={r.date} className="border-b border-border px-2 py-2 text-right text-xs text-muted">{r.peak ? `${hourLabel(r.peak.from)}–${hourLabel(r.peak.to)}` : "—"}</td>)}
                <td className="border-b border-border px-3 py-2" />
              </tr>
              <tr>
                <td className="border-b border-border px-3 py-2 text-xs text-muted">Sales / labor hr</td>
                {rows.map((r) => <td key={r.date} className="num border-b border-border px-2 py-2 text-right">{r.p.salesPerLaborHour == null ? <span className="text-muted">—</span> : money(r.p.salesPerLaborHour, { whole: true })}</td>)}
                <td className="num border-b border-border px-3 py-2 text-right font-medium">{wk.salesPerLaborHour == null ? "—" : money(wk.salesPerLaborHour, { whole: true })}</td>
              </tr>
              <tr className="[&>td]:border-b-0">
                <td className="px-3 py-2 text-xs text-muted">Covers / labor hr</td>
                {rows.map((r) => <td key={r.date} className="num px-2 py-2 text-right">{r.p.coversPerLaborHour == null ? <span className="text-muted">—</span> : r.p.coversPerLaborHour.toFixed(1)}</td>)}
                <td className="num px-3 py-2 text-right font-medium">{wk.coversPerLaborHour == null ? "—" : wk.coversPerLaborHour.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <p className="mt-2 text-xs text-muted">Past days: what Square rang. Ahead: the forecast. Covers are Square checks × guests per check, since Square doesn&apos;t record party size. Per labor hour uses scheduled hours.</p>
      </section>
    </HelpZone>
  );
}
