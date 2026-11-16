import { breweryCalendarIcs, calendarTokenMatches } from "@/server/services/brewery";

export const dynamic = "force-dynamic";

/**
 * The brewery calendar feed for calendar apps (Google, Apple, Outlook):
 * brew days, dry hops, transfers, packaging and release days as all-day
 * events, last month to six months on.
 *
 *   GET /api/brewery/calendar/<token>.ics   (the ".ics" is optional)
 *
 * Calendar apps can't sign in, so the long random token in the address is
 * the key: the middleware lets well-formed addresses through, and anything
 * without the current token (Setting brewery.calendarToken) is a 404. A new
 * token on the schedule page retires the old address.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = String(token).replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t) || !(await calendarTokenMatches(t))) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(await breweryCalendarIcs(), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="subversive-brewery.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
