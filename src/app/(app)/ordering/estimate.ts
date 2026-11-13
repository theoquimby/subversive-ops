import "server-only";
import { db } from "@/server/db";

/**
 * Order lines don't always carry a unit price (drafts built before a price was
 * known, hand-added lines). Fill the gaps from each product's current price so
 * totals are an honest estimate instead of $0.00.
 */

export interface PricedLine {
  supplierProductId: string;
  qty: number;
  unitPrice: number | null;
}

export async function currentPrices(productIds: string[], today: string): Promise<Map<string, number>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.priceRecord.findMany({
    where: { supplierProductId: { in: ids }, effectiveDate: { lte: new Date(`${today}T00:00:00Z`) } },
    select: { supplierProductId: true, price: true },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
  });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.supplierProductId, r.price.toNumber()); // ascending → last wins
  return out;
}

export interface LinePrice {
  price: number | null;
  /** True when the price came from the current price list, not the order line. */
  estimated: boolean;
}

export const linePrice = (l: PricedLine, prices: Map<string, number>): LinePrice =>
  l.unitPrice != null ? { price: l.unitPrice, estimated: false } : { price: prices.get(l.supplierProductId) ?? null, estimated: prices.has(l.supplierProductId) };

export interface OrderTotal {
  total: number | null;
  /** Some lines priced from current prices. */
  estimated: boolean;
  /** Lines with no price at all (left out of the total). */
  unpriced: number;
  /** Total comes from a matched invoice. */
  invoiced: boolean;
}

export function orderTotal(lines: PricedLine[], prices: Map<string, number>, invoiceTotals: (number | null)[] = []): OrderTotal {
  const billed = invoiceTotals.filter((t): t is number => t != null);
  if (billed.length) return { total: billed.reduce((s, t) => s + t, 0), estimated: false, unpriced: 0, invoiced: true };
  let total = 0;
  let estimated = false;
  let unpriced = 0;
  let any = false;
  for (const l of lines) {
    const p = linePrice(l, prices);
    if (p.price == null) { unpriced++; continue; }
    any = true;
    estimated ||= p.estimated;
    total += l.qty * p.price;
  }
  return { total: any ? total : null, estimated, unpriced, invoiced: false };
}
