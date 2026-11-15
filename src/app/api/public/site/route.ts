import { siteFeed } from "@/server/services/website";
import { feedError, feedJson, preflight } from "../_feed";

export const dynamic = "force-dynamic";

/**
 * Public site facts for the website: weekly hours with kitchen close (seasonal
 * hours applied), the guest notice, contact and links. Only what guests see.
 * Contract: docs/website-integration.md.
 *
 *   GET /api/public/site
 */
export async function GET() {
  try {
    return feedJson((await siteFeed()).feed);
  } catch (e) {
    return feedError("site", e);
  }
}

export const OPTIONS = preflight;
