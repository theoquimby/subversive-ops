import { HelpZone } from "@/components/help";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { describeResult } from "@/domain/eventResults";
import { EVENT_KIND_LABEL, yearOf } from "@/domain/events";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { eventLearning, listEvents } from "@/server/services/events";
import { businessToday } from "@/server/services/sales";
import { ApplyLearned, EventRowView, EventsGrid, HolidayButtons, QuickAdd } from "./events-client";

export const metadata = { title: "Events" };

const PAST_DAYS = 120;
/** How far back events are scored (the same three years the service looks at). */
const RESULT_DAYS = 1095;

export default async function EventsPage() {
  await requireUser("MANAGER");
  const today = businessToday();
  const [upcoming, past, scored, learning] = await Promise.all([
    listEvents(today, addDays(today, 400)),
    listEvents(addDays(today, -PAST_DAYS), today),
    listEvents(addDays(today, -RESULT_DAYS), today),
    eventLearning(),
  ]);
  const year = yearOf(today);
  const view = (e: (typeof upcoming)[number]): EventRowView => {
    const l = learning.outcomes.get(e.id);
    return { id: e.id, date: e.date, title: e.title, kind: e.kind, startTime: e.startTime, endTime: e.endTime, impact: e.impact, notes: e.notes, privateEventId: e.privateEventId, lift: l ? { lift: l.lift == null ? null : 1 + l.lift, actual: l.actual, baseline: l.expected ?? 0 } : null };
  };
  // A readable name for each learned series: the full title if there's only one, else the shared head ("Knicks").
  const titles = new Map<string, Set<string>>();
  for (const e of scored) titles.set(e.series, (titles.get(e.series) ?? new Set()).add(e.title));
  const seriesName = (series: string) => {
    const t = [...(titles.get(series) ?? [])];
    if (t.length === 1) return t[0];
    const head = series.slice(series.indexOf(":") + 1);
    return `${head.charAt(0).toUpperCase()}${head.slice(1)}`;
  };
  const results = learning.series;
  const count = (v: string) => results.filter((r) => r.verdict === v).length;
  const settled = count("added") + count("cost");
  const summary = !results.length
    ? undefined
    : settled
      ? `${count("added") ? `${count("added")} added sales` : ""}${count("added") && count("cost") ? ", " : ""}${count("cost") ? `${count("cost")} cost sales` : ""}${results.length - settled ? `, ${results.length - settled} can't be told from chance yet` : ""}.`
      : `None of the ${results.length} can be told from chance yet. That's normal: a night's sales swing a lot on their own.`;
  const signedPct = (m: number) => `${m >= 1 ? "+" : "−"}${Math.round(Math.abs(m - 1) * 100)}%`;

  return (
    <>
      <PageHeader
        help="events.page"
        title="Events"
        description="Games, festivals, music, buyouts and closures. They move the sales forecast, and the upcoming list is what the website shows — keep titles and times tidy."
        actions={<><LinkButton href="/events/private" data-tour="events.private-link">Private events</LinkButton><HelpZone id="events.holidays"><HolidayButtons years={[year, year + 1]} /></HelpZone></>}
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

      <Section help="events.learned" title="Did it work?" description={summary ?? "Each thing you put on, against an ordinary day of that weekday at that time of year."}>
        {results.length === 0 ? (
          <Card className="p-5 text-sm text-ink-2">
            <p className="font-medium text-ink">Nothing to score yet.</p>
            <p className="mt-1">Add what you&apos;ve already run and it&apos;s scored straight away: pick the first night above, set “Weekly until” to today, and leave the impact blank if you don&apos;t know it. Past dates work. Trivia, music, a run club, a special: anything you&apos;d like to know the answer to.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-border">
            {results.map((r) => {
              const w = describeResult(r);
              const up = learning.upcoming.get(r.series);
              const kind = r.kind as keyof typeof EVENT_KIND_LABEL;
              return (
                <div key={r.series} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-[0.95rem] font-semibold text-ink">{seriesName(r.series)}</h3>
                    <Badge tone={w.tone}>{w.label}</Badge>
                    <span className="text-xs text-muted">
                      {EVENT_KIND_LABEL[kind] ?? r.kind} · {r.nights + r.skipped === 1 ? shortDate(r.first) : `${r.nights + r.skipped} nights, ${shortDate(r.first)} to ${shortDate(r.last)}`}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-2">{w.line}</p>
                  {w.next && <p className="mt-1.5 text-sm font-medium text-ink">{w.next}</p>}
                  {w.notes.length > 0 && <p className="mt-1.5 text-xs text-muted">{w.notes.join(" ")}</p>}
                  {r.impact != null && up && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {up.differing === 0 ? (
                        <span>{up.count} upcoming already set to {signedPct(r.impact)}.</span>
                      ) : (
                        <>
                          <ApplyLearned series={r.series} label={`Set ${up.differing} upcoming to ${signedPct(r.impact)}`} />
                          {r.verdict === "unclear" && <span>A cautious number: scaled back because it isn&apos;t settled.</span>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}
        {results.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            “Ordinary” is the last eight days of that weekday with nothing on, scaled by how your other days were doing at the time. A result is only called when the nights together clear what chance does about 19 times in 20. Sales only: host fees, prizes and staff aren&apos;t taken off.
          </p>
        )}
      </Section>

      <Section help="events.past" title="Past events" description={`Last ${PAST_DAYS} days. “vs usual” is sales that day against an ordinary day of that weekday at that time of year. One night alone proves little.`}>
        {past.length === 0 ? (
          <Card className="p-5 text-sm text-muted">No past events yet.</Card>
        ) : (
          <EventsGrid rows={[...past].reverse().map(view)} grid="events-past" past />
        )}
      </Section>
    </>
  );
}
