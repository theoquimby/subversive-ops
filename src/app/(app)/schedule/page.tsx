import { PageHeader } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { weekStartOf } from "@/domain/schedule";
import { requireUser } from "@/server/auth";
import { businessToday } from "@/server/services/sales";
import { loadWeek } from "@/server/services/scheduling";
import { ScheduleBoard } from "./board";

export const metadata = { title: "Schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireUser("MANAGER");
  const { week } = await searchParams;
  const today = businessToday();
  const thisWeek = weekStartOf(today);
  const monday = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStartOf(week) : thisWeek;
  const data = await loadWeek(monday);
  return (
    <>
      <PageHeader title="Schedule" description="Build the week from the sales forecast, check it against labor rules, then publish it to the team." />
      <ScheduleBoard data={data} today={today} thisWeek={thisWeek} prevWeek={addDays(monday, -7)} nextWeek={addDays(monday, 7)} />
    </>
  );
}
