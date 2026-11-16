import { PageHeader, Section } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { weekStartOf } from "@/domain/schedule";
import { requireUser } from "@/server/auth";
import { businessToday } from "@/server/services/sales";
import { announcementsForManagers, loadWeek } from "@/server/services/scheduling";
import { AnnouncementsManager } from "../team/announcements";
import { ScheduleBoard } from "./board";
import { CoversStrip } from "./covers-strip";
import { getAdjustments } from "@/server/services/planning";
import { getReasons } from "@/server/services/forecasting";

export const metadata = { title: "Schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireUser("MANAGER");
  const { week } = await searchParams;
  const today = businessToday();
  const thisWeek = weekStartOf(today);
  const monday = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStartOf(week) : thisWeek;
  const [data, notes, adjustments, reasons] = await Promise.all([loadWeek(monday), announcementsForManagers(), getAdjustments(), getReasons()]);
  // Manual forecast nudges for this week's days (events and weather adjust on their own).
  const nudges = Object.fromEntries(data.dates.map((d) => [d, { multiplier: adjustments.get(d) ?? null, reason: reasons[d] ?? null }]));
  return (
    <>
      <PageHeader help="schedule.page" title="Schedule" description="Build the week from the sales forecast, check it against labor rules, then publish it to the team." />
      <ScheduleBoard data={data} today={today} thisWeek={thisWeek} prevWeek={addDays(monday, -7)} nextWeek={addDays(monday, 7)} nudges={nudges} />
      <CoversStrip dates={data.dates} today={today} days={data.summary.days.map((d) => ({ date: d.date, sales: d.sales, hours: d.hours }))} opening={data.opening} />
      <Section help="team.announcements" title="Announcements" description="Short notes for the team. They show at the top of everyone's My shifts." className="mt-10">
        <AnnouncementsManager items={notes.live} scheduled={notes.scheduled} today={today} />
      </Section>
    </>
  );
}
