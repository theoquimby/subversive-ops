import { publicTapList } from "@/server/services/taps";
import { publicOrigin } from "@/server/services/public-url";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

/**
 * Public, read-only tap list for the Subversive website. Guest-facing fields
 * only (tap, beer, style, ABV, IBU, description, prices per pour, badges,
 * coming soon) — never keg codes, exact amounts left or sales. Cached at the
 * edge for 60 seconds.
 *
 *   GET /api/public/taps
 */
export async function GET() {
  const list = await publicTapList(await publicOrigin());
  return Response.json(list, { headers: { ...CORS, "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}
