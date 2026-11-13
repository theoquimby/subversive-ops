import { randomBytes } from "node:crypto";
import { qboAuthorizeUrl } from "@/domain/quickbooks";
import { getSession } from "@/server/auth";
import { isLocalOrigin, publicOrigin, QUICKBOOKS_REDIRECT_PATH } from "@/server/services/public-url";
import { quickbooksApp, quickbooksEnvironment } from "@/server/services/quickbooks";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "so_qbo_state";
const BACK_COOKIE = "so_qbo_back";
const REDIRECT_COOKIE = "so_qbo_redirect";
/** Where to land afterwards: the page the button was pressed on. */
const BACK_PAGES = new Set(["/settings/quickbooks", "/settings/connections"]);

/** Manager-only: send the browser to Intuit's sign-in and "Connect" screen with a one-time state. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });
  const asked = new URL(req.url).searchParams.get("back") ?? "";
  const backPath = BACK_PAGES.has(asked) ? asked : "/settings/quickbooks";
  const fail = (error: string) => {
    const back = new URL("/settings/connections", req.url);
    back.searchParams.set("open", "quickbooks");
    back.searchParams.set("error", error);
    return NextResponse.redirect(back);
  };
  const app = await quickbooksApp();
  if (!app) return fail("Finish Part 1 first: paste the QuickBooks Client ID and Client secret, then press Connect again.");
  const origin = await publicOrigin();
  const environment = await quickbooksEnvironment();
  // Intuit only sends production sign-ins back to an https address (localhost is allowed for sandbox).
  if (environment === "production" && isLocalOrigin(origin)) return fail("QuickBooks only connects to the live app's https:// address. Open the app at its usual address and press Connect there.");

  const redirectUri = `${origin}${QUICKBOOKS_REDIRECT_PATH}`;
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(qboAuthorizeUrl({ clientId: app.clientId, redirectUri, state }));
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api/quickbooks/oauth", maxAge: 900 };
  res.cookies.set(STATE_COOKIE, state, cookie);
  res.cookies.set(BACK_COOKIE, backPath, cookie);
  // The token exchange must use exactly the redirect address the sign-in started with.
  res.cookies.set(REDIRECT_COOKIE, redirectUri, cookie);
  return res;
}
