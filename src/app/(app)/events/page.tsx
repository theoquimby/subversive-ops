import { HelpZone } from "@/components/help";
import { Card, cx, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { EVENT_KIND_LABEL, yearOf } from "@/domain/events";
import { requireUser } from "@/server/auth";
import { eventLearning, listEvents } from "@/server/services/events";
import { businessToday } from "@/server/services/sales";
import { ApplyLearned, EventRowView, EventsGrid, HolidayButtons, QuickAdd } from "./events-client";

export const metadata = { title: "Events" };

const PAST_DAYS = 120;

export default async function EventsPage() {
  await requireUser("MANAGER");
  const today = businessToday();
  const [upcoming, past, learning] = await Promise.all([
    listEvents(today, addDays(today, 400)),
    listEvents(addDays(today, -PAST_DAYS), today),
    eventLearning(),
  ]);
  const year = yearOf(today);
  const view = (e: (typeof upcoming)[number]): EventRowView => {
    const l = learning.lifts.get(e.id);
    return { id: e.id, date: e.date, title: e.title, kind: e.kind, startTime: e.startTime, endTime: e.endTime, impact: e.impact, notes: e.notes, lift: l ? { lift: l.lift, actual: l.actual, baseline: l.baseline } : null };
  };
  // A readable name for each learned series: the full title if there's only one, else the shared head ("Knicks").
  const titles = new Map<string, Set<string>>();
  for (const e of past) titles.set(e.series, (titles.get(e.series) ?? new Set()).add(e.title));
  const seriesName = (series: string) => {
    const t = [...(titles.get(series) ?? [])];
    if (t.length === 1) return t[0];
    const head = series.slice(series.indexOf(":") + 1);
    return `${head.charAt(0).toUpperCase()}${head.slice(1)}`;
  };
  const learned = [...learning.learned.values()].sort((a, b) => b.samples - a.samples || b.impact - a.impact);

  return (
    <>
      <PageHeader
        help="events.page"
        title="Events"
        description="Games, festivals, music, buyouts and closures. They move the sales forecast, and the upcoming list is what the website shows — keep titles and times tidy."
        actions={<HelpZone id="events.holidays"><HolidayButtons years={[year, year + 1]} /></HelpZone>}
      />

      <Section help="events.add" title="Add events" description="Pick as many dates as you need — every Knicks home game at once — or repeat weekly. Impact is how much busier than a normal day (+30%) or quieter (−20%).">
        <QuickAdd today={today} />
      </Section>

      <Section help="events.upcoming" title="Upcoming" description={upcoming.length ? `${upcoming.length} on the calendar` : undefined}>
        {upcoming.length === 0 ? (
          <EmptyState title="Nothing on the calendar">Add games, music nights and holidays above so the forecast and the website know about them.</EmptyState>
        ) : (
          <EventsGrid rows={upcoming.map(view)} grid="events-upcoming" />
        )}
      </Section>

      <Section help="events.learned" title="Learned impact" description="What past events actually did to sales, compared with the same weekday without an event. Apply it to set upcoming events of the same kind.">
        {learned.length === 0 ? (
          <Card className="p-5 text-sm text-muted">Once a few events have happened with sales history around them, their real effect shows up here.</Card>
        ) : (
          <Table sticky>
            <thead>
              <tr>
                <Th>Event</Th>
                <Th className="hidden sm:table-cell">Kind</Th>
                <Th align="right" className="hidden sm:table-cell">Learned</Th>
                <Th align="right" className="hidden sm:table-cell">From</Th>
                <Th align="right">Upcoming</Th>
              </tr>
            </thead>
            <tbody>
              {learned.map((l) => {
                const kind = l.series.split(":")[0] as keyof typeof EVENT_KIND_LABEL;
                const up = learning.upcoming.get(l.series);
                const p = Math.round((l.impact - 1) * 100);
                return (
                  <Tr key={l.series}>
                    <Td>
                      <div className="font-medium">
                        {seriesName(l.series)}
                        <span className={cx("num ml-1.5 sm:hidden", p > 0 ? "text-good" : p < 0 ? "text-warn" : "text-muted")}>{p > 0 ? "+" : p < 0 ? "−" : ""}{Math.abs(p)}%</span>
                      </div>
                      {(titles.get(l.series)?.size ?? 0) > 1 && <div className="max-w-44 truncate text-xs sm:max-w-80 text-muted">{[...titles.get(l.series)!].join(", ")}</div>}
                    </Td>
                    <Td className="hidden text-ink-2 sm:table-cell">{EVENT_KIND_LABEL[kind] ?? kind}</Td>
                    <Td align="right" className={cx("hidden sm:table-cell", p > 0 ? "text-good" : p < 0 ? "text-warn" : "")}>{p > 0 ? "+" : p < 0 ? "−" : ""}{Math.abs(p)}%</Td>
                    <Td align="right" className="hidden text-ink-2 sm:table-cell">{l.samples} event{l.samples === 1 ? "" : "s"}</Td>
                    <Td align="right">
                      {!up ? (
                        <span className="text-xs text-muted">none planned</span>
                      ) : up.differing === 0 ? (
                        <span className="text-xs text-muted">{up.count} already set</span>
                      ) : (
                        <ApplyLearned series={l.series} label={`Apply to ${up.differing}`} />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>

      <Section help="events.past" title="Past events" description={`Last ${PAST_DAYS} days. “vs usual” is sales that day against what the same weekday normally does.`}>
        {past.length === 0 ? (
          <Card className="p-5 text-sm text-muted">No past events yet.</Card>
        ) : (
          <EventsGrid rows={[...past].reverse().map(view)} grid="events-past" past />
        )}
      </Section>
    </>
  );
}
