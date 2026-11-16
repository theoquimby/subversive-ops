import { Table, Td, Th, Tr, cx } from "@/components/ui";
import { completionRate, shiftLabel, type DayMark } from "@/domain/checklists";
import { WEEKDAYS, weekday } from "@/domain/dates";
import { pct, shortDate } from "@/lib/format";
import type { HistoryRow } from "@/server/services/checklists";

const MARK: Record<DayMark, { cls: string; label: string }> = {
  signed: { cls: "bg-good border-good", label: "Signed off" },
  done: { cls: "border-good bg-good-bg", label: "All ticked, not signed" },
  partial: { cls: "border-warn bg-warn-bg", label: "Partly done" },
  missed: { cls: "border-bad bg-bad-bg", label: "Nothing ticked" },
  off: { cls: "border-transparent", label: "Not scheduled" },
};

/** Lists × the last two weeks; phones see the last 7 days. */
export function HistoryGrid({ dates, rows, today }: { dates: string[]; rows: HistoryRow[]; today: string }) {
  const firstWeek = dates.length - 7;
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th className="sticky left-0 z-10 bg-surface">List</Th>
            {dates.map((d, i) => (
              <Th key={d} align="center" className={cx("px-1.5", i < firstWeek && "hidden sm:table-cell", d === today && "text-ink")}>
                <span className="block text-[0.7rem]">{WEEKDAYS[weekday(d)].slice(0, 2)}</span>
                <span className="num block">{Number(d.slice(8))}</span>
              </Th>
            ))}
            <Th align="right">Done</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rate = completionRate(r.marks.filter((m) => m.date < today).map((m) => m.mark));
            return (
              <Tr key={r.templateId}>
                <Td className="sticky left-0 z-10 bg-surface">
                  <div className="max-w-[9rem] truncate font-medium sm:max-w-none">{r.name}</div>
                  <div className="text-xs text-muted">{shiftLabel(r.shift)}</div>
                </Td>
                {r.marks.map((m, i) => {
                  const k = MARK[m.mark];
                  const title = `${shortDate(m.date)}: ${k.label}${m.mark !== "off" ? ` · ${m.done}/${m.total}` : ""}${m.by ? ` · ${m.by}` : ""}`;
                  return (
                    <Td key={m.date} align="center" className={cx("px-1.5", i < firstWeek && "hidden sm:table-cell")}>
                      <span title={title} aria-label={title} role="img" className={cx("mx-auto block size-4 rounded-full border-2", k.cls, m.mark === "off" && "after:block after:text-xs after:text-muted after:content-['·']", m.date === today && m.mark === "missed" && "border-dashed border-border-strong bg-transparent")} />
                    </Td>
                  );
                })}
                <Td align="right" className={cx(rate != null && rate < 0.8 && "text-warn")}>{pct(rate, 0)}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(["signed", "done", "partial", "missed"] as DayMark[]).map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5"><span className={cx("size-3 rounded-full border-2", MARK[m].cls)} aria-hidden />{MARK[m].label}</span>
        ))}
      </div>
    </>
  );
}
