import { HelpTip, HelpZone } from "@/components/help";
import { Card } from "@/components/ui";
import type { ISODate } from "@/domain/dates";
import { money } from "@/lib/format";
import { actualProductivity } from "@/server/services/covers";

/** Sales and covers per hour actually worked so far this period (timecards vs Square). */
export async function ProductivityLine({ start, end }: { start: ISODate; end: ISODate }) {
  if (end < start) return null;
  const p = await actualProductivity(start, end).catch(() => null);
  if (!p || p.laborHours <= 0) return null;
  return (
    <HelpZone id="labor.productivity" className="-mt-6 mb-10">
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-4 py-3 text-sm">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted">Per hour worked <HelpTip id="labor.productivity" /></span>
        <span><span className="num font-semibold">{p.salesPerLaborHour == null ? "—" : money(p.salesPerLaborHour, { whole: true })}</span> <span className="text-muted">sales</span></span>
        <span><span className="num font-semibold">{p.coversPerLaborHour == null ? "—" : p.coversPerLaborHour.toFixed(1)}</span> <span className="text-muted">covers</span></span>
        {p.perCover != null && <span><span className="num font-semibold">{money(p.perCover)}</span> <span className="text-muted">per cover</span></span>}
        {p.days === 0 && <span className="text-xs text-muted">No Square sales synced for these days yet.</span>}
      </Card>
    </HelpZone>
  );
}
