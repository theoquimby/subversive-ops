import { addDays, toISODate } from "@/domain/dates";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";

/**
 * Public, read-only feed of upcoming events for the Subversive website.
 * Only guest-facing fields — never forecast impact or internal notes on
 * private bookings. Cached at the edge for 5 minutes.
 *
 *   GET /api/public/events?days=120
 */
export async function GET(req: Request) {
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 120));
  const today = businessToday();
  const rows = await db.event.findMany({
    where: {
      date: { gte: new Date(`${today}T00:00:00Z`), lt: new Date(`${addDays(today, days)}T00:00:00Z`) },
      kind: { notIn: ["PRIVATE"] },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, date: true, title: true, kind: true, startTime: true, endTime: true, notes: true },
  });
  const events = rows.map((e) => ({
    id: e.id,
    date: toISODate(e.date),
    title: e.title,
    kind: e.kind, // GAME | FESTIVAL | MUSIC | CLOSURE | HOLIDAY | OTHER
    closed: e.kind === "CLOSURE",
    startTime: e.startTime, // "19:30" local (America/New_York)
    endTime: e.endTime,
    description: e.notes ?? null,
  }));
  return Response.json(
    { timezone: "America/New_York", events },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600", "Access-Control-Allow-Origin": "*" } },
  );
}
