import { instagramPostsFeed } from "@/server/services/websiteInstagram";
import { feedError, preflight, READ_CORS } from "../_feed";

export const dynamic = "force-dynamic";

/**
 * The five latest Instagram posts, for the website's Instagram strip, from
 * what Ops already brings in from Instagram each night. An empty list until
 * Instagram is connected on Online → Instagram. Posts change once a night (or
 * on Sync now), so the edge keeps an answer for 30 minutes.
 * Contract: docs/website-integration.md.
 *
 *   GET /api/public/instagram
 *   → [{ id, caption, mediaType, mediaUrl, thumbnailUrl, permalink, timestamp }]
 */
export async function GET() {
  try {
    return Response.json(await instagramPostsFeed(), { headers: { ...READ_CORS, "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } });
  } catch (e) {
    return feedError("instagram", e);
  }
}

export const OPTIONS = preflight;
