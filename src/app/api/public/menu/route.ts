import { menuFeed } from "@/server/services/website";
import { feedError, feedJson, preflight } from "../_feed";

export const dynamic = "force-dynamic";

/**
 * The website menu in the website's own shape (its src/lib/menu/schema.ts):
 * draft beer from the tap list, then recipes and add-ons marked "on website".
 * Never costs, recipes or suppliers. Contract: docs/website-integration.md.
 *
 *   GET /api/public/menu
 */
export async function GET() {
  try {
    return feedJson((await menuFeed()).menu);
  } catch (e) {
    return feedError("menu", e);
  }
}

export const OPTIONS = preflight;
