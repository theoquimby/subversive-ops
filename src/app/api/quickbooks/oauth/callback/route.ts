import { timingSafeEqual } from "node:crypto";
import { getSession } from "@/server/auth";
import { friendlyQuickBooksError } from "@/server/integrations/quickbooks";
import { publicOrigin, QUICKBOOKS_REDIRECT_PATH } from "@/server/services/public-url";
import { connectQuickBooks, logProblem } from "@/server/services/quickbooks";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "so_qbo_state";
const BACK_COOKIE = "so_qbo_back";
const REDIRECT_COOKIE = "so_qbo_redirect";

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Intuit sends the browser here after "Connect" (or Cancel) with
 * `code`, `state` and `realmId` (the company that was picked). We swap the
 * code for tokens, then redirect at once so the code never sits in the address bar.
 */
export async function GET(req: NextRequest) {
  const fromConnections = req.cookies.get(BACK_COOKIE)?.value === "/settings/connections";
  const back = new URL(fromConnections ? "/settings/connections" : "/settings/quickbooks", req.url);
  if (fromConnections) back.searchParams.set("open", "quickbooks");
  const done = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    for (const c of [STATE_COOKIE, BACK_COOKIE, REDIRECT_COOKIE]) res.cookies.set(c, "", { path: "/api/quickbooks/oauth", maxAge: 0 });
    return res;
  };

  const session = await getSession();
  if (!session || session.role !== "MANAGER") return new Response("Managers only", { status: 403 });

  const q = req.nextUrl.searchParams;
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const state = q.get("state") ?? "";
  if (!expected || !state || !sameState(expected, state)) {
    return done({ error: "That QuickBooks sign-in took too long or was opened in a different browser. Press Connect to QuickBooks again." });
  }
  const err = q.get("error");
  if (err) {
    const msg = err === "access_denied" ? "QuickBooks wasn't connected because Connect wasn't pressed. Press Connect to QuickBooks to try again." : `QuickBooks said: ${(q.get("error_description") || err).slice(0, 200)}. Press Connect to QuickBooks to try again.`;
    return done({ error: msg });
  }
  const code = q.get("code");
  const realmId = q.get("realmId");
  if (!code || !realmId) return done({ error: "QuickBooks didn't finish the sign-in. Press Connect to QuickBooks again." });

  try {
    const redirectUri = req.cookies.get(REDIRECT_COOKIE)?.value || `${await publicOrigin()}${QUICKBOOKS_REDIRECT_PATH}`;
    const r = await connectQuickBooks({ code, realmId, redirectUri, by: session.name });
    if (fromConnections) back.hash = "qbo-accounts";
    return done({ connected: r.companyName });
  } catch (e) {
    const msg = friendlyQuickBooksError(e);
    await logProblem(`Connecting failed: ${msg}`).catch(() => undefined);
    return done({ error: msg });
  }
}
