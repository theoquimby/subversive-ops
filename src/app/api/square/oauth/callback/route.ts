import { timingSafeEqual } from "node:crypto";
import { getSession } from "@/server/auth";
import { friendlySquareError } from "@/server/integrations/square-http";
import { connectWithOAuthCode, logSquareError } from "@/server/services/square";
import { NextRequest, NextResponse } from "next/server";
import { getBackfill, startBackfill } from "@/server/services/square-sync";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "so_square_state";
const BACK_COOKIE = "so_square_back";

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Square redirects here after the owner presses Allow (or declines). */
export async function GET(req: NextRequest) {
  const fromConnections = req.cookies.get(BACK_COOKIE)?.value === "/settings/connections";
  const back = new URL(fromConnections ? "/settings/connections" : "/settings/square", req.url);
  if (fromConnections) back.searchParams.set("open", "square");
  const done = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/square/oauth", maxAge: 0 });
    res.cookies.set(BACK_COOKIE, "", { path: "/api/square/oauth", maxAge: 0 });
    return res;
  };

  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });

  const q = req.nextUrl.searchParams;
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const state = q.get("state") ?? "";
  if (!expected || !state || !sameState(expected, state)) {
    return done({ error: "That Square sign-in took too long or was opened in a different browser. Press Connect with Square again." });
  }
  const err = q.get("error");
  if (err) {
    const msg = err === "access_denied" ? "Square wasn't connected because Allow wasn't pressed. Press Connect with Square to try again." : `Square said: ${q.get("error_description") || err}. Press Connect with Square to try again.`;
    return done({ error: msg });
  }
  const code = q.get("code");
  if (!code) return done({ error: "Square didn't finish the sign-in. Press Connect with Square again." });

  try {
    const r = await connectWithOAuthCode(code);
    // Start bringing in history straight away; the Square page carries it on.
    if (!(await getBackfill())) await startBackfill(6).catch(() => undefined);
    back.pathname = "/settings/square";
    back.searchParams.delete("open");
    return done({ connected: r.merchantName });
  } catch (e) {
    const msg = friendlySquareError(e);
    await logSquareError("auth", `Connecting failed: ${msg}`).catch(() => undefined);
    return done({ error: msg });
  }
}
