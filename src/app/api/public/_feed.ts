/**
 * Shared bits for the website feeds under /api/public: open CORS for reads, the
 * edge cache policy, and a JSON error that the website treats as "use your own file".
 */

export const READ_CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

/** Five minutes at the edge, an hour of stale-while-revalidate (the website caches 5 minutes too). */
export const FEED_CACHE = "public, s-maxage=300, stale-while-revalidate=3600";

export function feedJson(body: unknown) {
  return Response.json(body, { headers: { ...READ_CORS, "Cache-Control": FEED_CACHE } });
}

export function feedError(where: string, e: unknown) {
  console.error(`public feed ${where} failed`, e);
  return Response.json({ error: "This feed isn't available right now." }, { status: 503, headers: { ...READ_CORS, "Cache-Control": "no-store" } });
}

export function preflight() {
  return new Response(null, { status: 204, headers: { ...READ_CORS, "Access-Control-Max-Age": "86400" } });
}
