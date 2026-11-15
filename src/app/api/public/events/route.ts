import { feedWindow } from "@/domain/websiteEvents";
import { publicOrigin } from "@/server/services/public-url";
import { eventsFeed } from "@/server/services/website";
import { feedError, feedJson, preflight } from "../_feed";

export const dynamic = "force-dynamic";

/**
 * Public, read-only feed of events for the Subversive website. Only
 * guest-facing fields — never forecast impact or private bookings — plus the
 * web fields set on Website → Events (slug, picture, links, price, late closes).
 * Cached at the edge for 5 minutes. Contract: docs/website-integration.md.
 *
 *   GET /api/public/events?days=120&pastDays=0
 */
export async function GET(req: Request) {
  try {
    const w = feedWindow(new URL(req.url).searchParams);
    return feedJson(await eventsFeed({ ...w, origin: await publicOrigin() }));
  } catch (e) {
    return feedError("events", e);
  }
}

export const OPTIONS = preflight;
