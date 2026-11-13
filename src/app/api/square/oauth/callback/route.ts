import { timingSafeEqual } from "node:crypto";
import { getSession } from "@/server/auth";
import { friendlySquareError } from "@/server/integrations/square-http";
import { connectWithOAuthCode, logSquareError } from "@/server/services/square";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "so_square_state";

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Square redirects here after the owner approves (or declines) access. */
export async function GET(req: NextRequest) {
  const back = new URL("/settings/square", req.url);
  const done = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/square/oauth", maxAge: 0 });
    return res;
  };

  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });

  const q = req.nextUrl.searchParams;
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const state = q.get("state") ?? "";
  if (!expected || !state || !sameState(expected, state)) {
    return done({ error: "That Square sign-in link expired or didn't come from this app. Try Connect again." });
  }
  const err = q.get("error");
  if (err) {
    const msg = err === "access_denied" ? "Square access wasn't granted." : q.get("error_description") || err;
    return done({ error: msg });
  }
  const code = q.get("code");
  if (!code) return done({ error: "Square didn't send an authorization code. Try Connect again." });

  try {
    const r = await connectWithOAuthCode(code);
    return done({ connected: r.merchantName });
  } catch (e) {
    const msg = friendlySquareError(e);
    await logSquareError("auth", `Connecting failed: ${msg}`).catch(() => undefined);
    return done({ error: msg });
  }
}
