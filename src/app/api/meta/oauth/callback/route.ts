import { timingSafeEqual } from "node:crypto";
import { friendlyMetaDenial } from "@/domain/metaData";
import { META_SETUP_HREF } from "@/domain/onlineChannels";
import { verifyOAuthState } from "@/domain/oauthState";
import { getSession } from "@/server/auth";
import { connectMeta, META_REDIRECT_PATH, metaStateKey, syncMeta } from "@/server/services/metaChannels";
import { publicOrigin } from "@/server/services/public-url";
import { after, NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATE_COOKIE = "so_meta_state";
const REDIRECT_COOKIE = "so_meta_redirect";

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Facebook sends the browser here after Continue (or Cancel) with `code` and
 * `state`. We check the state is ours (signed, recent, and the one this
 * browser started with), swap the code for a long-lived sign-in, find the
 * Page and its Instagram account, start the first sync in the background, and
 * redirect at once so the code never sits in the address bar.
 */
export async function GET(req: NextRequest) {
  const back = new URL(META_SETUP_HREF, req.url);
  const done = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    for (const c of [STATE_COOKIE, REDIRECT_COOKIE]) res.cookies.set(c, "", { path: "/api/meta/oauth", maxAge: 0 });
    return res;
  };
  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });

  const q = req.nextUrl.searchParams;
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const state = q.get("state") ?? "";
  if (!expected || !state || !sameState(expected, state) || !verifyOAuthState(metaStateKey(), state)) return done({ error: "That Facebook sign-in took too long or was opened in a different browser. Press Connect again." });
  if (q.get("error") || q.get("error_reason")) return done({ error: friendlyMetaDenial({ error: q.get("error"), reason: q.get("error_reason"), description: q.get("error_description") ?? q.get("error_message") }) });
  const code = q.get("code");
  if (!code) return done({ error: "Facebook didn't finish the sign-in. Press Connect again." });
  try {
    const redirectUri = req.cookies.get(REDIRECT_COOKIE)?.value || `${await publicOrigin()}${META_REDIRECT_PATH}`;
    const found = await connectMeta({ code, redirectUri, by: session.name });
    // The first numbers: a month of Instagram and the Page's history. The rest fills in overnight.
    after(() => syncMeta({ budgetMs: 40_000 }).then(() => undefined).catch(() => undefined));
    return done("error" in found ? { connected: "1", note: found.error.slice(0, 300) } : { connected: "1" });
  } catch (e) {
    return done({ error: (e as Error).message.slice(0, 300) });
  }
}
