import "server-only";
import { createHash } from "node:crypto";
import type { FeePayment, FeeRefund, SquareProcessingFee } from "@/domain/squareMoney";
import type { PaymentTip } from "@/domain/tipSources";
import { squareCall, SquareClient } from "./square-http";

/**
 * Payments and refunds (scope PAYMENTS_READ for both: "Permissions:
 * PAYMENTS_READ" on GET /v2/payments and GET /v2/refunds).
 *
 * - Card tips per payment, for tip pooling: `tip_money` is "the amount
 *   designated as a tip for the seller's staff"; `team_member_id` is "the
 *   TeamMember associated with taking the payment" (older payments may only
 *   carry the deprecated `employee_id`).
 * - Card fees: `processing_fee` is "the processing fees and fee adjustments
 *   assessed by Square for this payment" (ProcessingFee: effective_at, type
 *   INITIAL | ADJUSTMENT, amount_money). Square says it may not be there right
 *   after the payment, so the nightly re-sync of the last 3 days fills it in.
 * - Refunds: PaymentRefund.processing_fee holds "processing fees and fee
 *   adjustments assessed by Square for this refund" (negative = returned).
 * - Who came back: `card_details.card.fingerprint` is "intended as a Square-assigned
 *   identifier, based on the card number, to identify the card across multiple
 *   locations within a single application". Only a one-way scramble of it leaves
 *   this file (`cardKey`); the fingerprint itself, the last four digits, the name
 *   and everything else about the card are never read or kept.
 */

type Money = { amount?: number | null };

interface RawPayment {
  id: string;
  created_at: string;
  status?: string;
  source_type?: string;
  total_money?: Money;
  amount_money?: Money;
  tip_money?: Money;
  card_details?: { card?: { fingerprint?: string } };
  team_member_id?: string;
  employee_id?: string;
  order_id?: string;
  processing_fee?: SquareProcessingFee[];
}

interface RawRefund {
  id: string;
  created_at: string;
  status?: string;
  processing_fee?: SquareProcessingFee[];
}

export interface SquarePayment extends PaymentTip, FeePayment {
  orderId: string | null;
  /** What was paid before the tip, in cents. */
  amountCents: number;
  /** A one-way scramble of Square's marker for the card; null for cash and anything without one. */
  cardKey: string | null;
}

/** The same card always gives the same key; the key can't be turned back into the marker or the card. */
export const cardKeyOf = (fingerprint: string | undefined | null): string | null => (fingerprint ? createHash("sha256").update(`guest:${fingerprint}`).digest("hex").slice(0, 24) : null);

/** Payments created in [startISO, endISO) at our locations (the API takes one location per call, 100 per page). */
export async function listPayments(client: SquareClient, startISO: string, endISO: string): Promise<SquarePayment[]> {
  const out: SquarePayment[] = [];
  for (const locationId of client.locationIds) {
    let cursor: string | undefined;
    do {
      const q = new URLSearchParams({ begin_time: startISO, end_time: endISO, location_id: locationId, sort_order: "ASC", limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const page = await squareCall<{ payments?: RawPayment[]; cursor?: string }>(client, `/payments?${q}`);
      for (const p of page.payments ?? []) {
        // A payment right on end_time belongs to the next day; the caller drops days outside its window.
        out.push({
          id: p.id,
          createdAt: p.created_at,
          status: p.status ?? "",
          tipCents: p.tip_money?.amount ?? 0,
          teamMemberId: p.team_member_id ?? p.employee_id ?? null,
          sourceType: p.source_type ?? null,
          totalCents: p.total_money?.amount ?? 0,
          fees: p.processing_fee ?? [],
          orderId: p.order_id ?? null,
          amountCents: p.amount_money?.amount ?? Math.max(0, (p.total_money?.amount ?? 0) - (p.tip_money?.amount ?? 0)),
          cardKey: cardKeyOf(p.card_details?.card?.fingerprint),
        });
      }
      cursor = page.cursor;
    } while (cursor);
  }
  return out;
}

/** Card tips only (kept for callers that need nothing else). */
export const listPaymentTips = (client: SquareClient, startISO: string, endISO: string): Promise<PaymentTip[]> => listPayments(client, startISO, endISO);

/** Refunds created in [startISO, endISO) at our locations (GET /v2/refunds, 100 per page). */
export async function listRefunds(client: SquareClient, startISO: string, endISO: string): Promise<FeeRefund[]> {
  const out: FeeRefund[] = [];
  for (const locationId of client.locationIds) {
    let cursor: string | undefined;
    do {
      const q = new URLSearchParams({ begin_time: startISO, end_time: endISO, location_id: locationId, sort_order: "ASC", limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const page = await squareCall<{ refunds?: RawRefund[]; cursor?: string }>(client, `/refunds?${q}`);
      for (const r of page.refunds ?? []) out.push({ id: r.id, createdAt: r.created_at, status: r.status ?? "", fees: r.processing_fee ?? [] });
      cursor = page.cursor;
    } while (cursor);
  }
  return out;
}
