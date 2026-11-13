import "server-only";
import type { PaymentTip } from "@/domain/tipSources";
import { squareCall, SquareClient } from "./square-http";

/**
 * Card tips per payment, for tip pooling: GET /v2/payments (scope
 * PAYMENTS_READ). `tip_money` is "the amount designated as a tip for the
 * seller's staff"; `team_member_id` is "the TeamMember associated with taking
 * the payment" (older payments may only carry the deprecated `employee_id`).
 */

interface RawPayment {
  id: string;
  created_at: string;
  status?: string;
  tip_money?: { amount?: number | null };
  team_member_id?: string;
  employee_id?: string;
}

/** Payments created in [startISO, endISO) at our locations (the API takes one location per call, 100 per page). */
export async function listPaymentTips(client: SquareClient, startISO: string, endISO: string): Promise<PaymentTip[]> {
  const out: PaymentTip[] = [];
  for (const locationId of client.locationIds) {
    let cursor: string | undefined;
    do {
      const q = new URLSearchParams({ begin_time: startISO, end_time: endISO, location_id: locationId, sort_order: "ASC", limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const page = await squareCall<{ payments?: RawPayment[]; cursor?: string }>(client, `/payments?${q}`);
      for (const p of page.payments ?? []) {
        // A payment right on end_time belongs to the next day; the caller drops days outside its window.
        out.push({ id: p.id, createdAt: p.created_at, status: p.status ?? "", tipCents: p.tip_money?.amount ?? 0, teamMemberId: p.team_member_id ?? p.employee_id ?? null });
      }
      cursor = page.cursor;
    } while (cursor);
  }
  return out;
}
