import { metaAuthorizeUrl } from "@/domain/metaData";
import { META_SETUP_HREF } from "@/domain/onlineChannels";
import { signOAuthState } from "@/domain/oauthState";
import { getSession } from "@/server/auth";
import { META_REDIRECT_PATH, metaApp, metaStateKey } from "@/server/services/metaChannels";
import { publicOrigin } from "@/server/services/public-url";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "so_meta_state";
const REDIRECT_COOKIE = "so_meta_redirect";

/**
 * Manager-only: send the browser to Facebook's sign-in dialog, asking for the
 * read-only permissions in META_SCOPES. `?again=1` makes Facebook offer any
 * box that was unticked last time. The `state` is signed, and also kept in a
 * cookie so the callback can tell it came back to the same browser.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });
  const app = await metaApp();
  if (!app) {
    const back = new URL(META_SETUP_HREF, req.url);
    back.searchParams.set("error", "Paste the App ID and App secret first, then press Connect.");
    return NextResponse.redirect(back);
  }
  const redirectUri = `${await publicOrigin()}${META_REDIRECT_PATH}`;
  const state = signOAuthState(metaStateKey());
  const res = NextResponse.redirect(metaAuthorizeUrl({ appId: app.appId, redirectUri, state, rerequest: new URL(req.url).searchParams.get("again") === "1" }));
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api/meta/oauth", maxAge: 900 };
  res.cookies.set(STATE_COOKIE, state, cookie);
  // The token exchange must use exactly the redirect address the sign-in started with.
  res.cookies.set(REDIRECT_COOKIE, redirectUri, cookie);
  return res;
}
