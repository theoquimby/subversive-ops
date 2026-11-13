import { verifySquareSignature } from "@/domain/squareSecurity";
import { webhookStream, webhookTimestamp } from "@/domain/squareSync";
import { env } from "@/server/env";
import { logSquareError } from "@/server/services/square";
import { businessDateOf, processPending, queueSquareWork } from "@/server/services/square-sync";
import { after } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The URL Square signed: the configured one, else this request's public URL. */
function notificationUrl(req: Request) {
  if (env.SQUARE_WEBHOOK_URL) return env.SQUARE_WEBHOOK_URL;
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
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
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) return new Response("Webhooks are not configured", { status: 503 });
  const raw = await req.text();
  if (!verifySquareSignature(env.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl(req), raw, req.headers.get("x-square-hmacsha256-signature"))) {
    return new Response("Invalid signature", { status: 401 });
  }
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
