import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/session";
import { isQuoteToken } from "@/domain/privateEvents";
import { tokenFromPath, verifyDisplayToken } from "@/server/display-token";

// Staff only ever see the floor tools; everything else is manager-only.
const STAFF_PATHS = ["/my", "/count", "/waste", "/kegs", "/notes", "/prep", "/help"];
// Webhooks authenticate by signature inside the route.
const PUBLIC_PATHS = ["/login", "/api/cron", "/api/webhooks", "/api/public", "/sw.js", "/manifest.webmanifest", "/icons/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  // A client's private-event quote: public only with a well-formed random token (the page looks it up).
  if (pathname.startsWith("/quote/")) return isQuoteToken(pathname.slice("/quote/".length)) ? NextResponse.next() : new NextResponse("Not found", { status: 404 });
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
    const url = req.nextUrl.clone();
    url.pathname = "/my";
    return NextResponse.redirect(url);
  }
  return forward();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$).*)"],
};
