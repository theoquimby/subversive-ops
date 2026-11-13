import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/session";

// Staff only ever see the floor tools; everything else is manager-only.
const STAFF_PATHS = ["/my", "/count", "/waste"];
const PUBLIC_PATHS = ["/login", "/api/cron"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET ?? "");
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (session.role === "STAFF" && !STAFF_PATHS.some((p) => pathname.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = "/my";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$).*)"],
};
