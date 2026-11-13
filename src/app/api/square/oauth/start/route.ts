import { randomBytes } from "node:crypto";
import { getSession } from "@/server/auth";
import { authorizeUrl } from "@/server/integrations/square-auth";
import { squareAppCredentials, squareEnvironment } from "@/server/services/square";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OAUTH_STATE_COOKIE = "so_square_state";
const BACK_COOKIE = "so_square_back";
/** Where to land after Square: the page the button was pressed on. */
const BACK_PAGES = new Set(["/settings/square", "/settings/connections"]);

/** Manager-only: send the browser to Square's "Allow" screen with a one-time state. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });
  const asked = new URL(req.url).searchParams.get("back") ?? "";
  const backPath = BACK_PAGES.has(asked) ? asked : "/settings/square";
  const app = await squareAppCredentials();
  if (!app) {
    const back = new URL("/settings/connections", req.url);
    back.searchParams.set("open", "square");
    back.searchParams.set("error", "Finish Part 1 first: paste the Square app's Application ID and secret, then press Connect again.");
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(await squareEnvironment(), app.applicationId, state));
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api/square/oauth", maxAge: 600 };
  res.cookies.set(OAUTH_STATE_COOKIE, state, cookie);
  res.cookies.set(BACK_COOKIE, backPath, cookie);
  return res;
}
