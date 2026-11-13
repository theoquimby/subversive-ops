import type { ISODate } from "@/domain/dates";
import { dayDate, money } from "@/lib/format";
import { BRAND, esc, footerText, h1, p, RenderedEmail, shell, small, table, textLines } from "../layout";

export interface PurchaseOrderEmail {
  supplierName: string;
  deliveryDate: ISODate;
  lines: { sku: string; description: string; qty: number; unit: string; unitPrice: number | null }[];
  notes?: string | null;
  senderName: string;
  /** Where supplier replies go (the manager), shown in the sign-off. */
  replyTo?: string | null;
  csvFilename: string;
  /** Delivery address and phone from Settings → Business, shown under the sign-off. */
  business?: { address?: string | null; phone?: string | null };
}

/** "Subversive · 123 Main St, Catskill, NY · (518) 555-0100" (falls back to the town). */
const businessLine = (b: PurchaseOrderEmail["business"]) => [BRAND, b?.address?.trim() || "Catskill, NY", b?.phone?.trim()].filter(Boolean).join(" · ");

const qtyStr = (n: number) => String(Number(n.toFixed(2)));

export const purchaseOrderSubject = (deliveryDate: ISODate) => `Order from ${BRAND} — delivery ${dayDate(deliveryDate)}`;

export function purchaseOrderEmail(o: PurchaseOrderEmail): RenderedEmail {
  const when = dayDate(o.deliveryDate);
  const subject = purchaseOrderSubject(o.deliveryDate);
  const priced = o.lines.some((l) => l.unitPrice != null);
  const total = o.lines.reduce((s, l) => s + l.qty * (l.unitPrice ?? 0), 0);
  const items = `${o.lines.length} item${o.lines.length === 1 ? "" : "s"}`;

  const rows = o.lines.map((l) => [
    `${esc(l.description)}<div style="color:#85837c;font-size:12px;margin-top:2px;">#${esc(l.sku)}</div>`,
    `<strong>${esc(qtyStr(l.qty))}</strong> ${esc(l.unit)}`,
    ...(priced ? [esc(money(l.unitPrice))] : []),
  ]);
  const cols = [{ label: "Item" }, { label: "Qty", align: "right" as const, nowrap: true }, ...(priced ? [{ label: "Our price", align: "right" as const, nowrap: true }] : [])];

  const html = shell({
    preheader: `${items} for delivery ${when}. CSV attached.`,
    body: [
      h1(`Order for ${when}`),
      p(`Hi ${esc(o.supplierName)} team — here's our order for delivery on <strong>${esc(when)}</strong>. The same list is attached as a CSV (${esc(o.csvFilename)}).`),
      table(cols, rows, priced ? ["Estimated total", "", esc(money(total))] : undefined),
      o.notes ? p(`<strong>Notes:</strong> ${esc(o.notes)}`) : "",
      p(`Please reply to this email if anything is short, substituted or the price has changed.`),
      p(`Thank you,<br>${esc(o.senderName)}<br>${esc(BRAND)}${o.replyTo ? ` · <a href="mailto:${esc(o.replyTo)}" style="color:#4a4843;">${esc(o.replyTo)}</a>` : ""}`),
      small(esc(businessLine(o.business))),
    ].join("\n"),
    footer: `Sent from ${esc(BRAND)}'s ordering system on behalf of ${esc(o.senderName)}.`,
  });

  const text = textLines(
    `Hi ${o.supplierName} team,`,
    "",
    `Here's our order for delivery on ${when} (${items}). The same list is attached as ${o.csvFilename}.`,
    "",
    ...o.lines.map((l) => `- ${qtyStr(l.qty)} ${l.unit} — ${l.description} (#${l.sku})${l.unitPrice != null ? ` @ ${money(l.unitPrice)}` : ""}`),
    priced ? `\nEstimated total: ${money(total)}` : null,
    o.notes ? `\nNotes: ${o.notes}` : null,
    "",
    "Please reply if anything is short, substituted or the price has changed.",
    "",
    "Thank you,",
    o.senderName,
    o.replyTo ? `${BRAND} · ${o.replyTo}` : BRAND,
    o.business?.address || o.business?.phone ? businessLine(o.business) : null,
    footerText(),
  );
  return { subject, html, text };
}
