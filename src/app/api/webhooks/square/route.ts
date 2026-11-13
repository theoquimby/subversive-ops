import { verifySquareSignature } from "@/domain/squareSecurity";
import { webhookStream, webhookTimestamp } from "@/domain/squareSync";
import { env } from "@/server/env";
import { logSquareError, recordWebhookSeen, squareWebhookKey } from "@/server/services/square";
import { SQUARE_WEBHOOK_PATH } from "@/server/services/public-url";
import { businessDateOf, processPending, queueSquareWork } from "@/server/services/square-sync";
import { after } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The URLs Square may have signed: an explicit SQUARE_WEBHOOK_URL, the one
 * derived from APP_URL (what Settings → Connections shows to copy), and this
 * request's own public URL. A signature matching any of them is accepted.
 */
function notificationUrls(req: Request): string[] {
  const u = new URL(req.url);
  const proto = (req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "")).split(",")[0].trim();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host).split(",")[0].trim();
  const app = process.env.APP_URL?.trim().replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return [
    env.SQUARE_WEBHOOK_URL,
    app && `${app}${SQUARE_WEBHOOK_PATH}`,
    `${proto}://${host}${u.pathname}${u.search}`,
    vercel && `https://${vercel}${SQUARE_WEBHOOK_PATH}`,
  ].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
}

interface SquareEvent {
  type?: string;
  event_id?: string;
  created_at?: string;
  data?: { type?: string; id?: string; object?: Record<string, unknown> };
}

/**
 * Square webhook receiver. Verifies the HMAC signature, queues the affected
 * business date for a resync, answers 200 straight away and does the work
 * after the response (a short wait lets a burst of events collapse).
 */
export async function POST(req: Request) {
  const key = await squareWebhookKey();
  if (!key) return new Response("Instant updates aren't turned on (no signature key saved)", { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-square-hmacsha256-signature");
  if (!notificationUrls(req).some((url) => verifySquareSignature(key, url, raw, sig))) {
    return new Response("Invalid signature", { status: 401 });
  }
  await recordWebhookSeen().catch(() => undefined);
  let event: SquareEvent;
  try {
    event = JSON.parse(raw) as SquareEvent;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const type = event.type ?? "";
  const stream = webhookStream(type);
  if (!stream) return Response.json({ ok: true, ignored: type });

  try {
    if (stream === "catalog") await queueSquareWork({ catalog: true });
    else {
      const at = webhookTimestamp(event) ?? new Date().toISOString();
      const dates = [...new Set([businessDateOf(at), businessDateOf(new Date().toISOString())])];
      await queueSquareWork(stream === "sales" ? { sales: dates } : { labor: dates });
    }
  } catch (e) {
    await logSquareError("webhook", `Couldn't queue ${type}: ${(e as Error).message}`).catch(() => undefined);
    return new Response("Try again", { status: 500 });
  }
  // Failures are logged (and the work re-queued) inside processPending.
  after(() => processPending(4_000).catch(() => undefined));
  return Response.json({ ok: true });
}
