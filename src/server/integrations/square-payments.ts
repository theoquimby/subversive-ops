import "server-only";
import { createHash } from "node:crypto";
import type { FeePayment, FeeRefund, SquareProcessingFee } from "@/domain/squareMoney";
import type { PaymentTip } from "@/domain/tipSources";
import { normalPostal, tallyProfiles, type PlacePayment, type ProfileTally } from "@/domain/places";
import { profilePlaces } from "./square-customers";
import { squareCall, SquareClient, SquareError } from "./square-http";

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

// ---- Can Square say where people come from? ---------------------------------------------------

interface RawPlacePayment {
  status?: string;
  customer_id?: string;
  buyer_email_address?: string;
  billing_address?: { postal_code?: string };
  shipping_address?: { postal_code?: string };
  card_details?: { entry_method?: string; card?: { billing_address?: { postal_code?: string } } };
}

export interface PlaceCheck {
  payments: number;
  /** Payments carrying a postal code anywhere Square might put one. */
  withPostal: number;
  /** Payments tied to a Square customer profile (which may hold an address), and ones with an email. */
  withCustomer: number;
  withEmail: number;
  /** The same counts by how the card was read (EMV, CONTACTLESS, SWIPED, KEYED, ON_FILE) or "no card". */
  byEntry: { entry: string; payments: number; withPostal: number }[];
  /** How many different postal codes turned up, and the commonest three-digit areas: enough to see if it's worth mapping. */
  distinctPostal: number;
  areas: { area: string; payments: number }[];
  /**
   * The same question asked of the Square profiles behind the payments. `denied` when the
   * connection hasn't been given the Customers permission yet.
   */
  profiles: { denied: true } | ({ denied: false } & ProfileTally);
}

/**
 * A count, and nothing else, of how many completed payments in [startISO, endISO)
 * carry a postal code. Square's reference lists `billing_address` on a payment
 * and on its card but doesn't say when either is filled in, so this asks the
 * payments themselves, and then the customer profiles they're tied to.
 * No code and no profile id is kept: only totals and three-digit areas leave here.
 */
export async function placeCheck(client: SquareClient, startISO: string, endISO: string): Promise<PlaceCheck> {
  const by = new Map<string, { payments: number; withPostal: number }>();
  const areas = new Map<string, number>();
  const codes = new Set<string>();
  const out = { payments: 0, withPostal: 0, withCustomer: 0, withEmail: 0 };
  const rows: PlacePayment[] = [];
  for (const locationId of client.locationIds) {
    let cursor: string | undefined;
    do {
      const q = new URLSearchParams({ begin_time: startISO, end_time: endISO, location_id: locationId, sort_order: "ASC", limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const page = await squareCall<{ payments?: RawPlacePayment[]; cursor?: string }>(client, `/payments?${q}`);
      for (const p of page.payments ?? []) {
        if (p.status !== "COMPLETED") continue;
        const postal = normalPostal(p.billing_address?.postal_code) ?? normalPostal(p.card_details?.card?.billing_address?.postal_code) ?? normalPostal(p.shipping_address?.postal_code);
        rows.push({ customerId: p.customer_id ?? null, postal });
        const entry = p.card_details ? (p.card_details.entry_method ?? "card, method not given") : "no card";
        const e = by.get(entry) ?? { payments: 0, withPostal: 0 };
        e.payments++;
        out.payments++;
        if (postal) {
          e.withPostal++;
          out.withPostal++;
          codes.add(postal);
          areas.set(postal.slice(0, 3), (areas.get(postal.slice(0, 3)) ?? 0) + 1);
        }
        if (p.customer_id) out.withCustomer++;
        if (p.buyer_email_address) out.withEmail++;
        by.set(entry, e);
      }
      cursor = page.cursor;
    } while (cursor);
  }
  let profiles: PlaceCheck["profiles"];
  try {
    const ids = [...new Set(rows.flatMap((r) => (r.customerId ? [r.customerId] : [])))];
    profiles = { denied: false, ...tallyProfiles(rows, ids.length ? await profilePlaces(client, ids) : new Map()) };
  } catch (e) {
    // 403: the connection was made before Ops asked for the Customers permission.
    if (!(e instanceof SquareError) || e.status !== 403) throw e;
    profiles = { denied: true };
  }
  return {
    ...out,
    byEntry: [...by].map(([entry, v]) => ({ entry, ...v })).sort((a, b) => b.payments - a.payments),
    distinctPostal: codes.size,
    areas: [...areas].map(([area, payments]) => ({ area, payments })).sort((a, b) => b.payments - a.payments).slice(0, 8),
    profiles,
  };
}
