/**
 * Invoice three-way match: invoice lines ↔ supplier products ↔ purchase order
 * (ordered / received quantities and prices). Pure — no DB, no I/O.
 */

import { fuzzyScore } from "./search";

export type LineStatus = "OK" | "PRICE" | "QTY" | "PRICE_QTY" | "UNMATCHED";
export type MatchStatus = "NEEDS_REVIEW" | "MATCHED" | "PRICE_ISSUE" | "QTY_ISSUE" | "PRICE_AND_QTY";

export interface Tolerance {
  /** Allowed unit-price difference in dollars. */
  price: number;
  /** Allowed quantity difference in purchase units. */
  qty: number;
}
export const DEFAULT_TOLERANCE: Tolerance = { price: 0.02, qty: 0 };

export interface CatalogProduct {
  id: string;
  sku: string;
  description: string;
  /** Price on record just before the invoice date (null if never priced). */
  currentPrice: number | null;
}

export interface OrderLineRef {
  supplierProductId: string;
  orderedQty: number;
  receivedQty: number | null;
  unitPrice: number | null;
}

export interface InvoiceLineInput {
  sku?: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  /** A product someone already picked by hand — kept as is. */
  supplierProductId?: string | null;
}

export interface MatchedLine extends InvoiceLineInput {
  supplierProductId: string | null;
  matchedBy: "sku" | "description" | "manual" | null;
  expectedQty: number | null;
  expectedPrice: number | null;
  status: LineStatus;
}

export interface MatchResult {
  lines: MatchedLine[];
  status: MatchStatus;
  /** Order lines nothing on the invoice matched (ordered but not billed). */
  notBilled: OrderLineRef[];
  linesTotal: number;
  /** Invoice total minus the sum of its lines (null when no total given). */
  totalGap: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- Product mapping ----------------------------------------------------------

const normSku = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^0+(?=\d)/, "");

const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9/.]+/g, " ").split(" ").filter((t) => t.length >= 2 || /\d/.test(t));

/**
 * How much of `query` (an invoice description, often abbreviated) shows up in
 * `text` (our product description), 0..1. Each query word must fuzzy-match a
 * single word of the text starting with the same character, in either direction
 * ("chkn" ~ "chicken", "boneless" ~ "bnls"); longer words weigh more.
 */
export function descriptionSimilarity(query: string, text: string): number {
  const q = tokens(query);
  const words = tokens(text);
  if (!q.length || !words.length) return 0;
  let hit = 0;
  let all = 0;
  for (const t of q) {
    all += t.length;
    if (words.some((w) => w[0] === t[0] && (fuzzyScore(t, w) != null || fuzzyScore(w, t) != null))) hit += t.length;
  }
  return hit / all;
}

export const DESCRIPTION_THRESHOLD = 0.6;

export function matchProduct(line: Pick<InvoiceLineInput, "sku" | "description" | "supplierProductId">, catalog: CatalogProduct[]): { id: string; by: MatchedLine["matchedBy"] } | null {
  if (line.supplierProductId && catalog.some((p) => p.id === line.supplierProductId)) return { id: line.supplierProductId, by: "manual" };
  const sku = normSku(line.sku);
  if (sku) {
    const p = catalog.find((c) => normSku(c.sku) === sku);
    if (p) return { id: p.id, by: "sku" };
  }
  let best: { id: string; s: number } | null = null;
  for (const p of catalog) {
    const s = descriptionSimilarity(line.description, p.description);
    if (s >= DESCRIPTION_THRESHOLD && (!best || s > best.s)) best = { id: p.id, s };
  }
  return best ? { id: best.id, by: "description" } : null;
}

// ---- Three-way match ------------------------------------------------------------

export function lineStatus(priceOff: boolean, qtyOff: boolean): LineStatus {
  return priceOff && qtyOff ? "PRICE_QTY" : priceOff ? "PRICE" : qtyOff ? "QTY" : "OK";
}

export function matchInvoice(args: {
  lines: InvoiceLineInput[];
  catalog: CatalogProduct[];
  /** Lines of the linked purchase order, or null when no order is linked. */
  orderLines: OrderLineRef[] | null;
  invoiceTotal?: number | null;
  tolerance?: Tolerance;
  /** e.g. a possible duplicate — forces a human look. */
  forceReview?: boolean;
}): MatchResult {
  const tol = args.tolerance ?? DEFAULT_TOLERANCE;
  const byId = new Map(args.catalog.map((p) => [p.id, p]));
  // Several order lines for the same product are summed.
  const order = new Map<string, OrderLineRef>();
  for (const l of args.orderLines ?? []) {
    const prev = order.get(l.supplierProductId);
    order.set(
      l.supplierProductId,
      prev
        ? { ...prev, orderedQty: prev.orderedQty + l.orderedQty, receivedQty: prev.receivedQty == null || l.receivedQty == null ? null : prev.receivedQty + l.receivedQty }
        : { ...l },
    );
  }
  // Remaining expected quantity per product, so a product billed on two lines is checked against the total.
  const remaining = new Map([...order].map(([id, l]) => [id, l.receivedQty ?? l.orderedQty]));
  const billed = new Set<string>();

  const matches = args.lines.map((line) => matchProduct(line, args.catalog));
  const lastIndex = new Map<string, number>();
  matches.forEach((m, i) => m && lastIndex.set(m.id, i));

  const lines: MatchedLine[] = args.lines.map((line, i) => {
    const m = matches[i];
    if (!m) return { ...line, supplierProductId: null, matchedBy: null, expectedQty: null, expectedPrice: null, status: "UNMATCHED" };
    billed.add(m.id);
    const ol = order.get(m.id);
    const expectedPrice = ol?.unitPrice ?? byId.get(m.id)?.currentPrice ?? null;
    let expectedQty: number | null = null;
    if (args.orderLines) {
      const left = remaining.get(m.id) ?? 0;
      // The last line for a product carries whatever is left over, so overbilling shows on it.
      expectedQty = round2(Math.max(0, lastIndex.get(m.id) === i ? left : Math.min(left, line.qty)));
      remaining.set(m.id, Math.max(0, left - line.qty));
    }
    const priceOff = expectedPrice != null && Math.abs(line.unitPrice - expectedPrice) > tol.price + 1e-9;
    const qtyOff = expectedQty != null && Math.abs(line.qty - expectedQty) > tol.qty + 1e-9;
    return { ...line, supplierProductId: m.id, matchedBy: m.by, expectedQty, expectedPrice, status: lineStatus(priceOff, qtyOff) };
  });

  const notBilled = [...order.values()].filter((l) => !billed.has(l.supplierProductId) && (l.receivedQty ?? l.orderedQty) > 0);
  const linesTotal = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const totalGap = args.invoiceTotal == null ? null : round2(args.invoiceTotal - linesTotal);

  const price = lines.some((l) => l.status === "PRICE" || l.status === "PRICE_QTY");
  const qtyIssue = lines.some((l) => l.status === "QTY" || l.status === "PRICE_QTY");
  let status: MatchStatus;
  if (args.forceReview || lines.length === 0 || lines.some((l) => l.status === "UNMATCHED") || (totalGap != null && Math.abs(totalGap) > 0.05)) status = "NEEDS_REVIEW";
  else status = price && qtyIssue ? "PRICE_AND_QTY" : price ? "PRICE_ISSUE" : qtyIssue ? "QTY_ISSUE" : "MATCHED";
  // Something ordered and received but missing from the bill is still a quantity question.
  if (status === "MATCHED" && notBilled.length) status = "QTY_ISSUE";
  return { lines, status, notBilled, linesTotal, totalGap };
}

// ---- Duplicates, suppliers, orders --------------------------------------------------

/** "INV-000123", "inv 123" and "123" are the same invoice number. */
export const normInvoiceNumber = (s: string | null | undefined) => normSku(s).replace(/^[a-z]+(?=\d)/, "").replace(/^0+(?=\d)/, "");

export function findDuplicate<T extends { id: string; invoiceNumber: string | null }>(number: string | null | undefined, others: T[], selfId?: string): T | null {
  const n = normInvoiceNumber(number);
  if (!n) return null;
  return others.find((o) => o.id !== selfId && normInvoiceNumber(o.invoiceNumber) === n) ?? null;
}

/** Best supplier for a name read off an invoice ("HUDSON VALLEY FOODSERVICE INC"). */
export function suggestSupplier<T extends { id: string; name: string }>(name: string | null | undefined, suppliers: T[]): T | null {
  if (!name?.trim()) return null;
  let best: { s: T; score: number } | null = null;
  for (const s of suppliers) {
    const score = Math.max(descriptionSimilarity(s.name, name), descriptionSimilarity(name, s.name) * 0.9);
    if (score >= 0.6 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

/** The order an invoice most likely bills: newest sent/received order for the supplier, preferring ones not yet invoiced. */
export function pickOrder<T extends { id: string; supplierId: string; status: string; deliveryDate: string; invoiced: boolean }>(orders: T[], supplierId: string, invoiceDate?: string | null): T | null {
  const eligible = orders
    .filter((o) => o.supplierId === supplierId && (o.status === "SENT" || o.status === "RECEIVED"))
    .filter((o) => !invoiceDate || o.deliveryDate <= invoiceDate || o.status === "SENT")
    .sort((a, b) => Number(a.invoiced) - Number(b.invoiced) || b.deliveryDate.localeCompare(a.deliveryDate));
  return eligible[0] ?? null;
}

// ---- Credit request ---------------------------------------------------------------

export interface CreditItem {
  description: string;
  sku: string | null;
  kind: "short" | "overcharge";
  detail: string;
  amount: number;
}

const fmt = (n: number) => `$${n.toFixed(2)}`;
const q = (n: number) => String(Number(n.toFixed(2)));

/** What we're owed: billed-but-not-received quantity and price overcharges. */
export function creditItems(lines: Pick<MatchedLine, "description" | "sku" | "qty" | "unitPrice" | "expectedQty" | "expectedPrice">[], tol: Tolerance = DEFAULT_TOLERANCE): CreditItem[] {
  const out: CreditItem[] = [];
  for (const l of lines) {
    const short = l.expectedQty != null && l.qty - l.expectedQty > tol.qty + 1e-9 ? l.qty - l.expectedQty : 0;
    if (short > 0) {
      out.push({ description: l.description, sku: l.sku ?? null, kind: "short", detail: `billed ${q(l.qty)}, received ${q(l.expectedQty!)}`, amount: round2(short * l.unitPrice) });
    }
    if (l.expectedPrice != null && l.unitPrice - l.expectedPrice > tol.price + 1e-9) {
      const paidQty = l.qty - short;
      if (paidQty > 0) {
        out.push({ description: l.description, sku: l.sku ?? null, kind: "overcharge", detail: `charged ${fmt(l.unitPrice)}, agreed ${fmt(l.expectedPrice)} × ${q(paidQty)}`, amount: round2((l.unitPrice - l.expectedPrice) * paidQty) });
      }
    }
  }
  return out;
}

export function creditRequestText(args: { supplierName: string; invoiceNumber: string | null; invoiceDate: string; items: CreditItem[]; senderName: string; business: string }): { subject: string; body: string; total: number } {
  const total = round2(args.items.reduce((s, i) => s + i.amount, 0));
  const ref = args.invoiceNumber ? `invoice ${args.invoiceNumber}` : `your invoice dated ${args.invoiceDate}`;
  const subject = `Credit request — ${args.invoiceNumber ? `invoice ${args.invoiceNumber}` : args.invoiceDate}`;
  const lines = args.items.map((i) => `- ${i.description}${i.sku ? ` (#${i.sku})` : ""}: ${i.kind === "short" ? "short" : "price"} — ${i.detail}: ${fmt(i.amount)}`);
  const body = [
    `Hi ${args.supplierName} team,`,
    "",
    `Thanks for the delivery. When we checked ${ref} (${args.invoiceDate}) against what we ordered and received, a few lines didn't line up:`,
    "",
    ...lines,
    "",
    `Total credit requested: ${fmt(total)}`,
    "",
    "Could you send a credit memo for this amount, or apply it to our next invoice? Happy to send photos or the delivery slip if that helps.",
    "",
    "Thank you,",
    args.senderName,
    args.business,
  ].join("\n");
  return { subject, body, total };
}

// ---- Pasting rows ------------------------------------------------------------------

const toNum = (s: string | undefined) => {
  if (s == null) return NaN;
  const t = s.replace(/[$,\s]/g, "");
  return t === "" ? NaN : Number(t);
};

/**
 * Rows pasted from a spreadsheet or a PDF's text: tab-separated
 * `sku, description, qty, unit price[, line total]` (the sku column is optional —
 * a first column that isn't code-like is read as the description). Header rows are skipped.
 */
export function parsePastedLines(text: string): InvoiceLineInput[] {
  const out: InvoiceLineInput[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const cells = raw.split("\t").map((c) => c.trim());
    if (cells.every((c) => !c)) continue;
    let sku: string | null = null;
    let rest = cells;
    const codeLike = cells[0] === "" || (/^[A-Za-z0-9-]{2,}$/.test(cells[0]) && /\d/.test(cells[0]));
    if (cells.length >= 4 && codeLike && Number.isNaN(toNum(cells[1]))) {
      sku = cells[0] || null;
      rest = cells.slice(1);
    }
    const description = rest[0] ?? "";
    let qty = toNum(rest[1]);
    let unitPrice = toNum(rest[2]);
    const lineTotal = toNum(rest[3]);
    if (!description || (Number.isNaN(qty) && Number.isNaN(unitPrice))) continue; // header or junk
    if (Number.isNaN(qty)) qty = 1;
    if (Number.isNaN(unitPrice)) unitPrice = !Number.isNaN(lineTotal) && qty ? round2(lineTotal / qty) : 0;
    out.push({ sku, description, qty, unitPrice });
  }
  return out;
}
