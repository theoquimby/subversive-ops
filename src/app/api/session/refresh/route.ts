import { NextResponse, type NextRequest } from "next/server";
import { refreshSessionCookie } from "@/server/auth";

export const dynamic = "force-dynamic";

// Staff can open only the floor tools (keep in step with STAFF_PATHS in middleware).
const STAFF_PATHS = ["/my", "/count", "/waste", "/kegs", "/notes", "/prep", "/checklists", "/help"];

/**
 * Re-signs the session cookie with the login's current role, then carries on to
 * `next` — or to the staff home when that page is for managers only. Reached
 * from the middleware (a staff cookie asking for a manager page) and the app
 * layout (the role or name changed since sign-in).
 */
export async function GET(req: NextRequest) {
  const session = await refreshSessionCookie();
  const raw = req.nextUrl.searchParams.get("next") ?? "/";
  // Only same-site paths: never bounce to another host.
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/api/session") ? raw : "/";
  const url = req.nextUrl.clone();
  url.search = "";
  if (!session) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  const allowed = session.role === "MANAGER" || STAFF_PATHS.some((p) => next.startsWith(p));
  return NextResponse.redirect(new URL(allowed ? next : "/my", req.nextUrl.origin));
}
