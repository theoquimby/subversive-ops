import { timingSafeEqual } from "node:crypto";
import { allowedOrigins, checkInquiry } from "@/domain/websiteInquiry";
import { businessToday } from "@/server/services/sales";
import { websiteConnection } from "@/server/services/website";
import { hashIp, inquiryAllowed, receiveInquiry } from "@/server/services/websiteInquiries";
import { recordConversion } from "@/server/services/webAnalytics";

export const dynamic = "force-dynamic";

/**
 * Private-event inquiries from the website form. Creates a PrivateEvent at
 * INQUIRY (Events → Private) and tells managers. JSON or form-encoded body:
 * name, email and/or phone, date, guests, type, message, and the empty
 * honeypot field `website`. Browsers may post only from the website's own
 * address (WEBSITE_URL); the website's server may post too, sending
 * x-revalidate-secret and the guest's IP as x-client-ip.
 * Contract: docs/website-integration.md.
 *
 *   POST /api/public/inquiry
 */

function cors(origin: string | null, allowed: string[]) {
  const h: Record<string, string> = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin", "Cache-Control": "no-store" };
  if (origin && allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const reply = (body: unknown, status: number, headers: Record<string, string>) => Response.json(body, { status, headers });

const sameSecret = (a: string | null, b: string | null) => {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

async function readBody(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return req.json();
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) return Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  throw new Error("unsupported body");
}

export async function OPTIONS(req: Request) {
  const { url } = await websiteConnection();
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: { ...cors(origin, allowedOrigins(url)), "Access-Control-Max-Age": "86400" } });
}

export async function POST(req: Request) {
  const { url, secret } = await websiteConnection();
  const allowed = allowedOrigins(url);
  const origin = req.headers.get("origin");
  const headers = cors(origin, allowed);
  const fromServer = sameSecret(req.headers.get("x-revalidate-secret"), secret);

  // Browsers always send Origin on a cross-site POST: only the website's own may post.
  if (origin && !fromServer && !allowed.includes(origin)) return reply({ ok: false, error: "Not allowed from this site." }, 403, headers);

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 20_000) return reply({ ok: false, error: "That's too long." }, 413, headers);

  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return reply({ ok: false, error: "Send the form as JSON or form fields." }, 400, headers);
  }

  const ip = (fromServer ? req.headers.get("x-client-ip") : null) ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
  const ipHash = hashIp(ip);

  const check = checkInquiry(body, businessToday());
  // A bot gets the same answer as a person, so it learns nothing.
  if (check.ok === "bot") return reply({ ok: true }, 200, headers);
  if (check.ok === false) return reply({ ok: false, error: check.error, field: check.field }, 400, headers);

  try {
    if (!(await inquiryAllowed(ipHash))) return reply({ ok: false, error: "We've got your earlier message. We'll be in touch soon." }, 429, { ...headers, "Retry-After": "3600" });
    const created = await receiveInquiry(check.value, ipHash);
    // Attribute the inquiry to the visit (and its source) it came from; never throws.
    await recordConversion("inquiry_submit", { privateEventId: created.privateEventId, headers: req.headers, path: "/private-events" });
    return reply({ ok: true }, 200, headers);
  } catch (e) {
    console.error("website inquiry failed", e);
    return reply({ ok: false, error: "Something went wrong. Please email or call us instead." }, 500, headers);
  }
}
