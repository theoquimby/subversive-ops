import { MAX_BODY_BYTES } from "@/domain/webAnalytics";
import { collect, websiteOrigins } from "@/server/services/webAnalytics";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * First-party analytics beacon from the public website. Cookieless: it sets
 * nothing and reads no cookies. Body: a tiny JSON string sent as text/plain
 * (navigator.sendBeacon or fetch keepalive), so browsers send it without a
 * CORS preflight. Always answers 204 — a bad or bot hit is dropped silently
 * so the website never sees an error.
 *
 *   POST /api/public/collect   {"n":"pageview","u":"https://…/menu","r":"https://www.google.com/","w":390}
 *
 * See docs/website-analytics.md for the contract.
 */
function cors(origin: string | null, allowed: string[]): Record<string, string> {
  const h: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = await websiteOrigins();
  const headers = cors(origin, allowed);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return new Response(null, { status: 204, headers });
  try {
    const body = (await req.text()).slice(0, MAX_BODY_BYTES + 1);
    const h = req.headers;
    await collect({
      body,
      ua: h.get("user-agent"),
      ip: (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim() || null,
      origin,
      acceptLanguage: h.get("accept-language"),
      purpose: h.get("sec-purpose") ?? h.get("purpose"),
      country: h.get("x-vercel-ip-country"),
      region: h.get("x-vercel-ip-country-region"),
      city: h.get("x-vercel-ip-city"),
    });
  } catch (e) {
    console.error("collect failed", (e as Error).message);
  }
  return new Response(null, { status: 204, headers });
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin"), await websiteOrigins()) });
}
