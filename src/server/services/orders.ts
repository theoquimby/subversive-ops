import "server-only";
import { db } from "../db";

export const loadOrder = (id: string) =>
  db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: { include: { product: { include: { ingredient: { select: { name: true } } } } }, orderBy: { product: { description: "asc" } } },
    },
  });

export type LoadedOrder = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

/** Plain-text order suitable for pasting into an email or text message. */
export function orderAsText(o: LoadedOrder) {
  const date = o.deliveryDate.toISOString().slice(0, 10);
  const lines = o.lines.map((l) => `${l.qty.toNumber()} ${l.product.purchaseUnit} — ${l.product.description} (#${l.product.sku})`);
  return [`Order for delivery ${date}`, "", ...lines, "", "Thanks!"].join("\n");
}

export function orderAsCsv(o: LoadedOrder) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [["Item #", "Description", "Qty", "Unit", "Unit price"], ...o.lines.map((l) => [l.product.sku, l.product.description, l.qty.toNumber(), l.product.purchaseUnit, l.unitPrice?.toNumber() ?? ""])];
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}
