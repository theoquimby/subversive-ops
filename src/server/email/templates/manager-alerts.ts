import { money, shortDate, signedPct } from "@/lib/format";
import { badge, BRAND, button, esc, footerText, h1, link, list, manageFooter, p, RenderedEmail, shell, textLines } from "../layout";

export interface PriceSpike {
  description: string;
  ingredient: string | null;
  supplier: string;
  oldPrice: number;
  newPrice: number;
  changePct: number;
  date: string;
}

export interface PriceSpikesEmail {
  name: string;
  moves: PriceSpike[];
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export function priceSpikesEmail(e: PriceSpikesEmail): RenderedEmail {
  const ups = [...e.moves].sort((a, b) => b.changePct - a.changePct);
  const n = ups.length;
  const top = ups[0];
  const subject = n === 1 && top ? `${top.ingredient ?? top.description} is up ${signedPct(top.changePct, 0)}` : `${n} prices jumped`;
  const url = link(e.baseUrl, "/prices");
  const html = shell({
    preheader: ups.slice(0, 3).map((m) => `${m.ingredient ?? m.description} ${signedPct(m.changePct, 0)}`).join(" · "),
    body: [
      h1(n === 1 ? "A price jumped" : `${n} prices jumped`),
      p(`Hi ${esc(first(e.name))} — these went up enough to move your plate costs. Worth a look before the next order.`),
      list(ups.slice(0, 12).map((m) => ({
        title: m.ingredient ?? m.description,
        detail: `${m.supplier} · ${money(m.oldPrice)} → ${money(m.newPrice)} · ${shortDate(m.date)}`,
        value: `<span style="color:#b42318;">${esc(signedPct(m.changePct))}</span>`,
      }))),
      n > 12 ? p(`And ${n - 12} more.`, true) : "",
      button(url, "Review prices"),
    ].join("\n"),
    footer: manageFooter(e.baseUrl),
  });
  const text = textLines(
    `Hi ${first(e.name)},`,
    "",
    "These prices went up enough to move your plate costs:",
    "",
    ...ups.map((m) => `- ${m.ingredient ?? m.description} (${m.supplier}): ${money(m.oldPrice)} → ${money(m.newPrice)}, ${signedPct(m.changePct)}`),
    "",
    `Review: ${url}`,
    footerText(`${BRAND} price alerts`),
  );
  return { subject, html, text };
}

export interface InvoiceIssueEmail {
  name: string;
  invoiceId: string;
  supplierName: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  statusLabel: string;
  total: number | null;
  /** Flagged lines (price/qty differences). */
  issues: { description: string; detail: string }[];
  creditTotal: number | null;
  baseUrl: string;
}

export function invoiceIssueEmail(e: InvoiceIssueEmail): RenderedEmail {
  const ref = e.invoiceNumber ? `#${e.invoiceNumber}` : shortDate(e.invoiceDate);
  const subject = `${e.supplierName} invoice ${ref}: ${e.statusLabel.toLowerCase()}`;
  const url = link(e.baseUrl, `/invoices/${e.invoiceId}`);
  const html = shell({
    preheader: `${e.issues.length} line${e.issues.length === 1 ? "" : "s"} don't match the order${e.creditTotal ? ` · ${money(e.creditTotal)} credit to request` : ""}.`,
    body: [
      `<div style="margin-bottom:10px;">${badge(e.statusLabel, "warn")}</div>`,
      h1(`${e.supplierName} invoice ${ref}`),
      p(`Hi ${esc(first(e.name))} — ${e.issues.length} line${e.issues.length === 1 ? " doesn't" : "s don't"} match what was ordered or received${e.total != null ? ` on this ${esc(money(e.total))} invoice` : ""}.${e.creditTotal ? ` You may be owed <strong>${esc(money(e.creditTotal))}</strong>.` : ""}`),
      e.issues.length ? list(e.issues.slice(0, 10).map((i) => ({ title: i.description, detail: i.detail }))) : "",
      button(url, "Review invoice"),
    ].join("\n"),
    footer: manageFooter(e.baseUrl),
  });
  const text = textLines(
    `Hi ${first(e.name)},`,
    "",
    `${e.supplierName} invoice ${ref} (${e.statusLabel}): ${e.issues.length} line(s) don't match.${e.creditTotal ? ` Credit to request: ${money(e.creditTotal)}.` : ""}`,
    "",
    ...e.issues.map((i) => `- ${i.description}: ${i.detail}`),
    "",
    `Review: ${url}`,
    footerText(`${BRAND} invoices`),
  );
  return { subject, html, text };
}
