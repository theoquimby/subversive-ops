import { addDays, toISODate } from "@/domain/dates";
import { isEmptyPage, pageSummary, parseStoredPage } from "@/domain/websiteEventPage";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { websiteSettings } from "@/server/services/website";
import { EventsTab, type WebEventRow } from "./events-client";

export const metadata = { title: "Website · Events" };

const PAST_DAYS = 90;

export default async function WebsiteEventsPage({ searchParams }: { searchParams: Promise<{ past?: string }> }) {
  await requireUser("MANAGER");
  const past = (await searchParams).past === "1";
  const today = businessToday();
  const from = past ? addDays(today, -PAST_DAYS) : today;
  const rows = await db.event.findMany({
    where: { date: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${addDays(today, 180)}T00:00:00Z`) }, kind: { notIn: ["PRIVATE"] } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, date: true, title: true, kind: true, startTime: true, endTime: true, notes: true },
  });
  const [webs, s] = await Promise.all([db.webEvent.findMany({ where: { eventId: { in: rows.map((r) => r.id) } } }), websiteSettings()]);
  const byId = new Map(webs.map((w) => [w.eventId, w]));
  const view: WebEventRow[] = rows.map((e) => {
    const w = byId.get(e.id);
    return {
      id: e.id,
      date: toISODate(e.date),
      title: e.title,
      kind: e.kind,
      startTime: e.startTime,
      endTime: e.endTime,
      notes: e.notes,
      past: toISODate(e.date) < today,
      slug: w?.slug ?? null,
      hidden: w?.hidden ?? false,
      webKind: w?.webKind ?? null,
      closed: w?.closed ?? null,
      imageUrl: w?.imageId ? `/api/public/images/${w.imageId}` : null,
      imageAlt: w?.imageAlt ?? null,
      ticketUrl: w?.ticketUrl ?? null,
      rsvpUrl: w?.rsvpUrl ?? null,
      priceLabel: w?.priceLabel ?? null,
      featured: w?.featured ?? false,
      kitchenCloseOverride: w?.kitchenCloseOverride ?? null,
      barCloseOverride: w?.barCloseOverride ?? null,
      page: pageSummary(parseStoredPage(w?.page ?? null), !!w?.heroImageId),
      hasPage: !!w && (!!w.heroImageId || !isEmptyPage(parseStoredPage(w.page))),
    };
  });
  return <EventsTab rows={view} past={past} holidaysClosed={s.holidaysClosed} />;
}
