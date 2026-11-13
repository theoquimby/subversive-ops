import "server-only";
import { randomUUID } from "node:crypto";
import { SQUARE_WEBHOOK_EVENTS } from "@/domain/squareWebhooks";
import { squareRequest, SQUARE_VERSION, type SquareEnvironment } from "./square-http";

interface Subscription {
  id: string;
  notification_url?: string;
  signature_key?: string;
}

/**
 * Create (or repair) the app's webhook subscription so Square posts each sale
 * and clock-in to `url`, and return its signature key. Square only lets an
 * app's own access token manage its subscriptions, so this takes the token from
 * the developer Credentials page; the caller uses it once and doesn't keep it.
 */
export async function ensureWebhookSubscription(token: string, environment: SquareEnvironment, url: string): Promise<{ signatureKey: string; created: boolean }> {
  const authorization = `Bearer ${token}`;
  const list = await squareRequest<{ subscriptions?: Subscription[] }>(environment, "/v2/webhooks/subscriptions?include_disabled=true", { authorization });
  const existing = list.subscriptions?.find((s) => s.notification_url === url);
  if (existing) {
    await squareRequest(environment, `/v2/webhooks/subscriptions/${existing.id}`, {
      method: "PUT",
      authorization,
      body: JSON.stringify({ subscription: { enabled: true, event_types: SQUARE_WEBHOOK_EVENTS, notification_url: url } }),
    });
    const r = await squareRequest<{ signature_key?: string }>(environment, `/v2/webhooks/subscriptions/${existing.id}/signature-key`, {
      method: "POST",
      authorization,
      body: JSON.stringify({ idempotency_key: randomUUID() }),
    });
    if (!r.signature_key) throw new Error("Square didn't send back a signature key.");
    return { signatureKey: r.signature_key, created: false };
  }
  const r = await squareRequest<{ subscription?: Subscription }>(environment, "/v2/webhooks/subscriptions", {
    method: "POST",
    authorization,
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      subscription: { name: "Subversive Ops", enabled: true, event_types: SQUARE_WEBHOOK_EVENTS, notification_url: url, api_version: SQUARE_VERSION },
    }),
  });
  const key = r.subscription?.signature_key;
  if (!key) throw new Error("Square didn't send back a signature key.");
  return { signatureKey: key, created: true };
}
