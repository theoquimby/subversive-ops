import "server-only";
import { randomUUID } from "node:crypto";
import { squareCall, type SquareClient } from "./square-http";

/**
 * Square Checkout API: a hosted payment link for a fixed amount ("quick pay").
 * POST /v2/online-checkout/payment-links with { idempotency_key, quick_pay:
 * { name, price_money: { amount (cents), currency }, location_id } } returns
 * { payment_link: { id, url, long_url, order_id } }.
 * https://developer.squareup.com/reference/square/checkout-api/create-payment-link
 *
 * Needs the ORDERS_WRITE and PAYMENTS_WRITE permissions. A connection made
 * with the read-only OAuth scopes gets a 403, which the caller turns into
 * plain words.
 */

export interface PaymentLink {
  id: string;
  url: string;
  orderId: string | null;
}

export async function createQuickPayLink(client: SquareClient, o: { name: string; amountCents: number; note?: string; idempotencyKey?: string }): Promise<PaymentLink> {
  const res = await squareCall<{ payment_link?: { id: string; url: string; long_url?: string; order_id?: string } }>(client, "/online-checkout/payment-links", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: o.idempotencyKey ?? randomUUID(),
      quick_pay: { name: o.name.slice(0, 255), price_money: { amount: Math.round(o.amountCents), currency: "USD" }, location_id: client.locationIds[0] },
      ...(o.note ? { payment_note: o.note.slice(0, 500) } : {}),
    }),
  });
  const l = res.payment_link;
  if (!l?.url) throw new Error("Square didn't return a link.");
  return { id: l.id, url: l.url, orderId: l.order_id ?? null };
}
