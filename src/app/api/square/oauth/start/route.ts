import { randomBytes } from "node:crypto";
import { getSession } from "@/server/auth";
import { env, squareOAuthConfigured } from "@/server/env";
import { authorizeUrl } from "@/server/integrations/square-auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OAUTH_STATE_COOKIE = "so_square_state";

/** Manager-only: send the browser to Square's consent screen with a one-time state. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });
  const back = new URL("/settings/square", req.url);
  if (!squareOAuthConfigured()) {
    back.searchParams.set("error", "Connect with Square needs SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET set where the app is hosted.");
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(env.SQUARE_ENVIRONMENT, env.SQUARE_APPLICATION_ID, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/square/oauth",
    maxAge: 600,
  });
  return res;
}
