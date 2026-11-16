import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/session";
import { isQuoteToken } from "@/domain/privateEvents";
import { tokenFromPath, verifyDisplayToken } from "@/server/display-token";

// Staff only ever see the floor tools; everything else is manager-only.
const STAFF_PATHS = ["/my", "/count", "/waste", "/kegs", "/notes", "/prep", "/checklists", "/help", "/api/session"];
// Webhooks authenticate by signature inside the route.
const PUBLIC_PATHS = ["/login", "/api/cron", "/api/webhooks", "/api/public", "/sw.js", "/manifest.webmanifest", "/icons/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  // A client's private-event quote: public only with a well-formed random token (the page looks it up).
  if (pathname.startsWith("/quote/")) return isQuoteToken(pathname.slice("/quote/".length)) ? NextResponse.next() : new NextResponse("Not found", { status: 404 });
  // The brewery calendar feed for calendar apps (they can't sign in): public only with a well-formed token; the route checks it's the current one.
  if (pathname.startsWith("/api/brewery/calendar/")) return /^\/api\/brewery\/calendar\/[A-Za-z0-9_-]{20,64}(\.ics)?$/i.test(pathname) ? NextResponse.next() : new NextResponse("Not found", { status: 404 });
  // The tap list TV board: public only with a signed display token in the URL (the page checks it's the current one).
  if (pathname.startsWith("/display/taps/")) {
    const ok = await verifyDisplayToken(tokenFromPath(pathname), process.env.SESSION_SECRET ?? "");
    return ok ? NextResponse.next() : new NextResponse("Not found", { status: 404 });
  }
  // Layouts can't read the URL, so pass it along (used for the first-run redirect).
  const forward = () => {
    const h = new Headers(req.headers);
    h.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: h } });
  };

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET ?? "");
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (session.role === "STAFF" && !STAFF_PATHS.some((p) => pathname.startsWith(p))) {
    // The cookie may be older than a promotion to manager: check the current role
    // (the refresh route re-signs the cookie, then sends staff to /my as before).
    const url = req.nextUrl.clone();
    url.pathname = "/api/session/refresh";
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return forward();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$).*)"],
};
