import { timingSafeEqual } from "node:crypto";
import { GOOGLE_HUB_HREF } from "@/domain/googleHub";
import { getSession } from "@/server/auth";
import { connectGoogle, GOOGLE_REDIRECT_PATH, syncGoogle } from "@/server/services/googleSearch";
import { publicOrigin } from "@/server/services/public-url";
import { after, NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATE_COOKIE = "so_google_state";
const REDIRECT_COOKIE = "so_google_redirect";

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Google sends the browser here after Allow (or Cancel) with `code` and
 * `state`. We swap the code for tokens, find the website's Search Console
 * property and the listing, start the first sync in the background, and
 * redirect at once so the code never sits in the address bar.
 */
export async function GET(req: NextRequest) {
  const back = new URL(GOOGLE_HUB_HREF, req.url);
  const done = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    for (const c of [STATE_COOKIE, REDIRECT_COOKIE]) res.cookies.set(c, "", { path: "/api/google/oauth", maxAge: 0 });
    return res;
  };
  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });

  const q = req.nextUrl.searchParams;
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const state = q.get("state") ?? "";
  if (!expected || !state || !sameState(expected, state)) return done({ error: "That Google sign-in took too long or was opened in a different browser. Press Connect Google again." });
  const err = q.get("error");
  if (err) return done({ error: err === "access_denied" ? "Google wasn't connected because Allow wasn't pressed. Press Connect Google to try again." : `Google said: ${err.slice(0, 120)}. Press Connect Google to try again.` });
  const code = q.get("code");
  if (!code) return done({ error: "Google didn't finish the sign-in. Press Connect Google again." });
  try {
    const redirectUri = req.cookies.get(REDIRECT_COOKIE)?.value || `${await publicOrigin()}${GOOGLE_REDIRECT_PATH}`;
    await connectGoogle({ code, redirectUri, by: session.name });
    after(() => syncGoogle().then(() => undefined).catch(() => undefined));
    return done({ connected: "1" });
  } catch (e) {
    return done({ error: (e as Error).message.slice(0, 300) });
  }
}
