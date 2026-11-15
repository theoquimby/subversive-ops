import { verifyDisplayToken } from "@/server/display-token";
import { isCurrentNonce, publicTapList } from "@/server/services/taps";

export const dynamic = "force-dynamic";

/** What the TV board polls every minute. 404 once the link is replaced in Kegs → Setup. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const nonce = await verifyDisplayToken(token, process.env.SESSION_SECRET ?? "");
  if (!(await isCurrentNonce(nonce))) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(await publicTapList(), { headers: { "Cache-Control": "no-store" } });
}
