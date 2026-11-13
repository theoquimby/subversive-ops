import { money } from "@/lib/format";
import { BRAND, esc, footerText, h1, p, RenderedEmail, shell, table, textLines } from "../layout";

export interface CreditRequestEmail {
  supplierName: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  items: { description: string; sku: string | null; kind: "short" | "overcharge"; detail: string; amount: number }[];
  senderName: string;
  replyTo?: string | null;
}

export function creditRequestEmail(c: CreditRequestEmail): RenderedEmail {
  const total = Math.round(c.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const ref = c.invoiceNumber ? `invoice ${c.invoiceNumber}` : `your invoice dated ${c.invoiceDate}`;
  const subject = `Credit request — ${c.invoiceNumber ? `invoice ${c.invoiceNumber}` : c.invoiceDate}`;
  const kind = (k: string) => (k === "short" ? "Short" : "Price");

  const html = shell({
    preheader: `${money(total)} across ${c.items.length} line${c.items.length === 1 ? "" : "s"} on ${ref}.`,
    body: [
      h1(`Credit request: ${money(total)}`),
      p(`Hi ${esc(c.supplierName)} team — thanks for the delivery. When we checked ${esc(ref)} (${esc(c.invoiceDate)}) against what we ordered and received, a few lines didn't line up:`),
      table(
        [{ label: "Item" }, { label: "Issue" }, { label: "Credit", align: "right", nowrap: true }],
        c.items.map((i) => [
          `${esc(i.description)}${i.sku ? `<div style="color:#85837c;font-size:12px;margin-top:2px;">#${esc(i.sku)}</div>` : ""}`,
          `<strong>${kind(i.kind)}</strong><div style="color:#85837c;font-size:12px;margin-top:2px;">${esc(i.detail)}</div>`,
          esc(money(i.amount)),
        ]),
        ["Total", "", esc(money(total))],
      ),
      p("Could you send a credit memo for this amount, or apply it to our next invoice? Happy to send photos or the delivery slip if that helps."),
      p(`Thank you,<br>${esc(c.senderName)}<br>${esc(BRAND)}${c.replyTo ? ` · <a href="mailto:${esc(c.replyTo)}" style="color:#4a4843;">${esc(c.replyTo)}</a>` : ""}`),
    ].join("\n"),
    footer: `Sent from ${esc(BRAND)}'s invoicing system on behalf of ${esc(c.senderName)}.`,
  });

  const text = textLines(
    `Hi ${c.supplierName} team,`,
    "",
    `Thanks for the delivery. When we checked ${ref} (${c.invoiceDate}) against what we ordered and received, a few lines didn't line up:`,
    "",
    ...c.items.map((i) => `- ${i.description}${i.sku ? ` (#${i.sku})` : ""}: ${i.kind === "short" ? "short" : "price"} — ${i.detail}: ${money(i.amount)}`),
    "",
    `Total credit requested: ${money(total)}`,
    "",
    "Could you send a credit memo for this amount, or apply it to our next invoice? Happy to send photos or the delivery slip if that helps.",
    "",
    "Thank you,",
    c.senderName,
    c.replyTo ? `${BRAND} · ${c.replyTo}` : BRAND,
    footerText(),
  );
  return { subject, html, text };
}
