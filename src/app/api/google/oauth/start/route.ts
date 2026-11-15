import { randomBytes } from "node:crypto";
import { googleAuthorizeUrl } from "@/domain/googleData";
import { getSession } from "@/server/auth";
import { GOOGLE_REDIRECT_PATH, googleApp } from "@/server/services/googleSearch";
import { publicOrigin } from "@/server/services/public-url";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "so_google_state";
const REDIRECT_COOKIE = "so_google_redirect";
const BACK = "/website/analytics/google";

/**
 * Manager-only: send the browser to Google's consent screen. Asks for
 * read-only Search Console access and, unless `?business=0`, Business
 * Profile (business.manage — Google's only scope for the Performance API).
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });
  const app = await googleApp();
  if (!app) {
    const back = new URL(BACK, req.url);
    back.searchParams.set("error", "Paste the Google Client ID and Client secret first, then press Connect Google.");
    return NextResponse.redirect(back);
  }
  const business = new URL(req.url).searchParams.get("business") !== "0";
  const redirectUri = `${await publicOrigin()}${GOOGLE_REDIRECT_PATH}`;
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(googleAuthorizeUrl({ clientId: app.clientId, redirectUri, state, business }));
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api/google/oauth", maxAge: 900 };
  res.cookies.set(STATE_COOKIE, state, cookie);
  // The token exchange must use exactly the redirect address the sign-in started with.
  res.cookies.set(REDIRECT_COOKIE, redirectUri, cookie);
  return res;
}
