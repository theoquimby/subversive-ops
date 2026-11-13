import "server-only";
import { addDays, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import {
  CatalogProduct,
  DEFAULT_TOLERANCE,
  findDuplicate,
  InvoiceLineInput,
  matchInvoice,
  MatchResult,
  OrderLineRef,
  Tolerance,
} from "@/domain/invoiceMatch";
import { appendEvent, canAutoApprove, InvoiceEvent, parseHistory } from "@/domain/invoiceHistory";
import { invoiceAlertDue } from "@/domain/alerts";
import { InvoiceStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db, num } from "../db";
import { claudeJSON, claudeReady, fileBlock } from "../integrations/claude";
import { priceAsOf } from "./costing";
import { env } from "../env";
import { planPriceRecords, receiveFromInvoice, shouldRecordPricesOnApprove, suggestLink, type LinkSuggestion } from "@/domain/invoiceAutopilot";
import { inferPackQty } from "@/domain/priceSheet";
import type { BaseUnit } from "@/domain/units";

// ---- Settings -------------------------------------------------------------------

export const TOLERANCE_KEYS = { price: "invoices.priceTolerance", qty: "invoices.qtyTolerance" } as const;

export async function loadTolerance(): Promise<Tolerance> {
  const rows = await db.setting.findMany({ where: { key: { in: Object.values(TOLERANCE_KEYS) } } });
  const get = (k: string, d: number) => {
    const v = Number(rows.find((r) => r.key === k)?.value);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return { price: get(TOLERANCE_KEYS.price, DEFAULT_TOLERANCE.price), qty: get(TOLERANCE_KEYS.qty, DEFAULT_TOLERANCE.qty) };
}

// ---- Matching ---------------------------------------------------------------------

/**
 * Supplier products with the price on record the day *before* the invoice
 * date — so prices recorded from this invoice don't hide its own increase.
 */
export async function catalogFor(supplierId: string, invoiceDate: ISODate): Promise<CatalogProduct[]> {
  const products = await db.supplierProduct.findMany({
    where: { supplierId },
    include: { prices: { select: { price: true, effectiveDate: true }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] } },
  });
  const asOf = addDays(invoiceDate, -1);
  return products
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map((p) => ({ id: p.id, sku: p.sku, description: p.description, currentPrice: priceAsOf(p.prices.map((r) => ({ date: toISODate(r.effectiveDate), price: r.price.toNumber() })), asOf) }));
}

async function orderLinesFor(orderId: string | null): Promise<OrderLineRef[] | null> {
  if (!orderId) return null;
  const lines = await db.purchaseOrderLine.findMany({ where: { orderId } });
  return lines.map((l) => ({ supplierProductId: l.supplierProductId, orderedQty: l.qty.toNumber(), receivedQty: num(l.receivedQty), unitPrice: num(l.unitPrice) }));
}

async function duplicateOf(inv: { id?: string; supplierId: string; invoiceNumber: string | null }) {
  if (!inv.invoiceNumber) return null;
  const others = await db.invoice.findMany({ where: { supplierId: inv.supplierId, invoiceNumber: { not: null } }, select: { id: true, invoiceNumber: true } });
  return findDuplicate(inv.invoiceNumber, others, inv.id);
}

/** Run the match for a set of lines without saving anything. */
export async function computeMatch(args: { id?: string; supplierId: string; orderId: string | null; invoiceNumber: string | null; invoiceDate: ISODate; total: number | null; lines: InvoiceLineInput[] }): Promise<MatchResult & { duplicate: { id: string; invoiceNumber: string | null } | null }> {
  const [catalog, orderLines, tolerance, duplicate] = await Promise.all([
    catalogFor(args.supplierId, args.invoiceDate),
    orderLinesFor(args.orderId),
    loadTolerance(),
    duplicateOf(args),
  ]);
  const r = matchInvoice({ lines: args.lines, catalog, orderLines, invoiceTotal: args.total, tolerance, forceReview: Boolean(duplicate) });
  return { ...r, duplicate };
}

const D = (n: number | null) => (n == null ? null : new Prisma.Decimal(n.toFixed(2)));

/** Re-run the three-way match for a saved invoice and store line + invoice status. Approved invoices keep their status. */
export async function rematch(invoiceId: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { orderBy: { id: "asc" } } } });
  const r = await computeMatch({
    id: inv.id,
    supplierId: inv.supplierId,
    orderId: inv.orderId,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: toISODate(inv.invoiceDate),
    total: num(inv.total),
    lines: inv.lines.map((l) => ({ sku: l.sku, description: l.description, qty: l.qty.toNumber(), unitPrice: l.unitPrice.toNumber(), supplierProductId: l.supplierProductId, kind: l.kind })),
  });
  await db.$transaction([
    ...inv.lines.map((l, i) =>
      db.invoiceLine.update({
        where: { id: l.id },
        data: { supplierProductId: r.lines[i].supplierProductId, expectedQty: D(r.lines[i].expectedQty), expectedPrice: D(r.lines[i].expectedPrice), status: r.lines[i].status },
      }),
    ),
    ...(inv.status === "APPROVED" ? [] : [db.invoice.update({ where: { id: inv.id }, data: { status: r.status } })]),
  ]);
  if (inv.status !== "APPROVED") {
    await maybeAutoApprove(inv.id);
    await alertIfIssue(inv.id);
  }
  return r;
}

// ---- Issue alerts (once per invoice per issue status) ------------------------------------

export const alertedKey = (invoiceId: string) => `invoices.alerted.${invoiceId}`;

/**
 * If the invoice now sits in PRICE_ISSUE / QTY_ISSUE / PRICE_AND_QTY and we haven't
 * alerted for that status yet, remember it and tell managers after the response.
 */
export async function alertIfIssue(invoiceId: string) {
  const [inv, last] = await Promise.all([
    db.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } }),
    db.setting.findUnique({ where: { key: alertedKey(invoiceId) } }),
  ]);
  if (!inv || !invoiceAlertDue(last?.value ?? null, inv.status)) return;
  const key = alertedKey(invoiceId);
  await db.setting.upsert({ where: { key }, create: { key, value: inv.status }, update: { value: inv.status } });
  // Imported lazily: notify.ts imports this module.
  const { inBackground, notifyInvoiceIssue } = await import("./notify");
  inBackground(() => notifyInvoiceIssue(invoiceId));
}

// ---- Approval history (append-only, one Setting per invoice) -------------------------------

const HISTORY_PREFIX = "invoices.history.";
export const AUTO_APPROVE_KEY = "invoices.autoApprove";

export async function loadHistory(invoiceId: string): Promise<InvoiceEvent[]> {
  const s = await db.setting.findUnique({ where: { key: `${HISTORY_PREFIX}${invoiceId}` } });
  return parseHistory(s?.value);
}

/** Append one event; earlier entries are never rewritten. */
export async function recordEvent(invoiceId: string, e: Omit<InvoiceEvent, "at"> & { at?: string }) {
  const key = `${HISTORY_PREFIX}${invoiceId}`;
  const history = appendEvent(await loadHistory(invoiceId), { ...e, at: e.at ?? new Date().toISOString() });
  const value = JSON.stringify(history);
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return history;
}

export async function autoApproveEnabled() {
  return (await db.setting.findUnique({ where: { key: AUTO_APPROVE_KEY } }))?.value === "true";
}

export async function setAutoApprove(on: boolean) {
  await db.setting.upsert({ where: { key: AUTO_APPROVE_KEY }, create: { key: AUTO_APPROVE_KEY, value: String(on) }, update: { value: String(on) } });
}

/** With auto-approve on, approve a clean three-way match straight away (approvedBy "auto"). */
export async function maybeAutoApprove(invoiceId: string): Promise<boolean> {
  if (!(await autoApproveEnabled())) return false;
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, status: true, supplierId: true, invoiceNumber: true, order: { select: { status: true } } } });
  if (!inv || inv.status === "APPROVED") return false;
  const [duplicate, history] = await Promise.all([duplicateOf(inv), loadHistory(inv.id)]);
  if (!canAutoApprove({ status: inv.status, orderStatus: inv.order?.status ?? null, duplicate: Boolean(duplicate), history })) return false;
  await db.invoice.update({ where: { id: inv.id }, data: { status: "APPROVED", approvedBy: "auto", approvedAt: new Date() } });
  await recordEvent(inv.id, { by: "auto", action: "auto-approved", status: inv.status, note: "Clean three-way match with a checked-in order." });
  await afterApproval(inv.id, "auto");
  return true;
}

/** Approve by hand. Anything but a clean match needs a note, which goes on the record. */
export async function approve(invoiceId: string, by: string, note: string | null) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } });
  if (inv.status === "APPROVED") return;
  await db.invoice.update({ where: { id: invoiceId }, data: { status: "APPROVED", approvedBy: by, approvedAt: new Date() } });
  await recordEvent(invoiceId, { by, action: "approved", status: inv.status, note: note ?? undefined });
  await afterApproval(invoiceId, by);
}

/**
 * After any approval: check in a sent order from the invoice's quantities, record
 * the prices in costing (unless turned off in Settings), then — with "send to
 * QuickBooks automatically" on — send the bill in the background.
 */
async function afterApproval(invoiceId: string, by: string) {
  try {
    const r = await receiveOrderFromInvoice(invoiceId, by);
    if (r.received) await rematch(invoiceId);
  } catch (e) {
    console.error("receiving the order from the invoice failed", e);
  }
  try {
    if (await pricesOnApproveEnabled()) await applyInvoicePrices(invoiceId, by);
  } catch (e) {
    console.error("recording invoice prices failed", e);
  }
  // Imported lazily: quickbooks.ts imports this module (for the invoice history).
  const [{ inBackground }, { autoSendApproved }] = await Promise.all([import("./notify"), import("./quickbooks")]);
  inBackground(() => autoSendApproved(invoiceId, by));
}

/** Reopen for changes. The approval stays in the history; only the status changes. */
export async function reopen(invoiceId: string, by: string, note: string | null) {
  await db.invoice.update({ where: { id: invoiceId }, data: { status: "NEEDS_REVIEW" } });
  await recordEvent(invoiceId, { by, action: "reopened", note: note ?? undefined });
}

// ---- Create -----------------------------------------------------------------------

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function createInvoice(args: {
  supplierId: string;
  orderId: string | null;
  invoiceNumber: string | null;
  invoiceDate: ISODate;
  total: number | null;
  lines: (InvoiceLineInput & { packText?: string | null; orderedQty?: number | null })[];
  image: { bytes: Uint8Array; type: string } | null;
  extractedBy: "claude" | "manual";
  kind?: "invoice" | "receipt";
  dueDate?: ISODate | null;
  paymentMethod?: string | null;
}) {
  const r = await computeMatch(args);
  const inv = await db.invoice.create({
    data: {
      supplierId: args.supplierId,
      orderId: args.orderId,
      invoiceNumber: args.invoiceNumber,
      invoiceDate: parseISODate(args.invoiceDate),
      total: D(args.total),
      status: r.status,
      image: args.image ? Buffer.from(args.image.bytes) : null,
      imageType: args.image?.type ?? null,
      extractedBy: args.extractedBy,
      kind: args.kind ?? "invoice",
      dueDate: args.dueDate ? parseISODate(args.dueDate) : null,
      paymentMethod: args.paymentMethod || null,
      lines: {
        create: r.lines.map((l, i) => ({
          kind: l.kind || "item",
          packText: args.lines[i]?.packText || null,
          orderedQty: args.lines[i]?.orderedQty == null ? null : new Prisma.Decimal(args.lines[i].orderedQty!),
          supplierProductId: l.supplierProductId,
          sku: l.sku || null,
          description: l.description,
          qty: new Prisma.Decimal(l.qty),
          unitPrice: new Prisma.Decimal(l.unitPrice.toFixed(2)),
          expectedQty: D(l.expectedQty),
          expectedPrice: D(l.expectedPrice),
          status: l.status,
        })),
      },
    },
  });
  await maybeAutoApprove(inv.id);
  await alertIfIssue(inv.id);
  return inv.id;
}

export const MAX_PAGES = 10;

/** Add the next page to an invoice: page 1 goes in Invoice.image, later ones in InvoicePage. Returns the page number. */
export async function addPage(invoiceId: string, page: { bytes: Uint8Array; type: string }): Promise<number | { error: string }> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { imageType: true, _count: { select: { pages: true } } } });
  if (!inv) return { error: "That invoice is gone." };
  if (!inv.imageType) {
    await db.invoice.update({ where: { id: invoiceId }, data: { image: Buffer.from(page.bytes), imageType: page.type } });
    return 1;
  }
  const count = 1 + inv._count.pages;
  if (count >= MAX_PAGES) return { error: `An invoice can have up to ${MAX_PAGES} pages.` };
  const last = await db.invoicePage.findFirst({ where: { invoiceId }, orderBy: { position: "desc" }, select: { position: true } });
  const position = Math.max(1, last?.position ?? 1) + 1;
  await db.invoicePage.create({ data: { invoiceId, position, bytes: Buffer.from(page.bytes), type: page.type } });
  return position;
}

/** Exact duplicate (same supplier + number) — the database refuses these. */
export async function exactDuplicate(supplierId: string, invoiceNumber: string | null) {
  if (!invoiceNumber) return null;
  return db.invoice.findUnique({ where: { supplierId_invoiceNumber: { supplierId, invoiceNumber } }, select: { id: true } });
}

// ---- Reading with Claude ---------------------------------------------------------------

const extractionSchema = z.object({
  documentType: z.enum(["invoice", "receipt"]).describe("\"receipt\" for a store / cash-register receipt (grocery store, Restaurant Depot, Costco); \"invoice\" for a supplier's bill or delivery invoice."),
  supplierName: z.string().nullable().describe("The seller / vendor / store name printed on the document, not the customer."),
  invoiceNumber: z.string().nullable().describe("Invoice number. For receipts, null unless a transaction / receipt number is clearly printed."),
  invoiceDate: z.string().nullable().describe("Invoice or purchase date as YYYY-MM-DD."),
  dueDate: z.string().nullable().describe("Payment due date as YYYY-MM-DD, if printed."),
  subtotal: z.number().nullable().describe("Subtotal before tax, if printed."),
  tax: z.number().nullable().describe("Total sales tax, if printed."),
  total: z.number().nullable().describe("Amount due / invoice total / receipt total in dollars."),
  paymentMethod: z.string().nullable().describe("Receipts: how it was paid as printed, e.g. \"cash\", \"Visa 1234\", \"debit\". Null if not shown."),
  lines: z.array(
    z.object({
      kind: z.enum(["item", "fee", "deposit", "credit"]).describe("item = a product; fee = delivery/fuel/surcharge; deposit = bottle, keg or container deposit; credit = a return or credit (negative)."),
      sku: z.string().nullable().describe("Item / product code as printed (or the receipt's long item code), or null."),
      description: z.string().describe("The item description exactly as printed (keep store abbreviations)."),
      packText: z.string().nullable().describe("Pack / size as printed, e.g. \"4/10 LB\", \"6/#10\", \"1 GAL\", or null."),
      unit: z.string().nullable().describe("Billing unit if printed: CS, EA, LB, BG…"),
      qtyOrdered: z.number().nullable().describe("Quantity ordered, only when printed separately from quantity shipped."),
      qty: z.number().describe("Quantity shipped and billed (or the weight for priced-by-weight items). Negative for credits/returns."),
      unitPrice: z.number().describe("Price per unit in dollars."),
      lineTotal: z.number().nullable().describe("The extended price printed for the line."),
    }),
  ),
});
export type InvoiceExtraction = z.infer<typeof extractionSchema>;

const SYSTEM = `You read supplier invoices and store receipts for a restaurant and brewery's back office. Extract exactly what is printed; never guess values that aren't there (use null).
- The pages are given in order and belong to ONE document: read every page, don't repeat lines that are carried over, and take totals from the last page.
- Lines are billed products, plus fees, deposits and credits as their own lines (kind). Skip subtotals, tax lines, payment lines, change due, savings summaries and page headers.
- qty is the quantity shipped/billed (not ordered, if both appear — put the ordered amount in qtyOrdered). For a weight-priced line, qty is the billed weight and unitPrice the price per pound.
- On receipts: a line "2 @ 3.99" means qty 2, unitPrice 3.99. A sale price or coupon right under an item lowers that item's price (use the price actually paid); a store-wide coupon is a credit line. Keep the store's abbreviated description as printed.
- Dollar amounts are plain numbers (42.5, not "$42.50").`;

/** One page to read: a photo or a PDF. */
export interface PageInput {
  bytes: Uint8Array;
  type: string;
}

/**
 * For trying the reading path without a Claude key (local dev and browser
 * tests only): INVOICE_READER_STUB=1 returns a sample invoice, =receipt a
 * sample store receipt, or a path to a JSON file in the extraction's shape.
 */
function stubReader(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  return process.env.INVOICE_READER_STUB || null;
}

/** Whether invoices can be read automatically (a Claude key, or the dev stub). */
export async function readerReady() {
  return Boolean(stubReader()) || claudeReady();
}

async function stubExtraction(kind: string, mode: "auto" | "invoice" | "receipt"): Promise<InvoiceExtraction> {
  if (kind !== "1" && kind !== "receipt" && kind !== "invoice") {
    const { readFile } = await import("node:fs/promises");
    return extractionSchema.parse(JSON.parse(await readFile(kind, "utf8")));
  }
  const { STUB_INVOICE, STUB_RECEIPT } = await import("./invoiceStub");
  return extractionSchema.parse(kind === "receipt" || mode === "receipt" ? STUB_RECEIPT : STUB_INVOICE);
}

export async function extractInvoice(pages: PageInput[], mode: "auto" | "invoice" | "receipt" = "auto", deps: { json?: typeof claudeJSON } = {}): Promise<{ ok: true; data: InvoiceExtraction } | { ok: false; error: string }> {
  if (!pages.length) return { ok: false, error: "Add a photo or PDF first." };
  const blocks = pages.map((p) => fileBlock(p.bytes, p.type));
  if (blocks.some((b) => !b)) return { ok: false, error: "Upload photos (JPEG/PNG) or a PDF." };
  const stub = stubReader();
  if (stub && !deps.json) return { ok: true, data: await stubExtraction(stub, mode) };
  const hint =
    mode === "receipt" ? "This is a store receipt from a grocery or supply run."
    : mode === "invoice" ? "This is a supplier invoice."
    : "Decide whether this is a supplier invoice or a store receipt.";
  const content = [
    ...blocks.flatMap((b, i) => (pages.length > 1 ? [`Page ${i + 1} of ${pages.length}:`, b!] : [b!])),
    `${hint} Read ${pages.length > 1 ? `all ${pages.length} pages` : "it"}.`,
  ];
  return (deps.json ?? claudeJSON)({ schema: extractionSchema, system: SYSTEM, content, effort: "medium" });
}

// ---- Prices into costing -----------------------------------------------------------------

export const PRICES_ON_APPROVE_KEY = "invoices.pricesOnApprove";

/** Approving an invoice records its prices in costing (default on). */
export async function pricesOnApproveEnabled() {
  return shouldRecordPricesOnApprove((await db.setting.findUnique({ where: { key: PRICES_ON_APPROVE_KEY } }))?.value);
}

export async function setPricesOnApprove(on: boolean) {
  await db.setting.upsert({ where: { key: PRICES_ON_APPROVE_KEY }, create: { key: PRICES_ON_APPROVE_KEY, value: String(on) }, update: { value: String(on) } });
}

/** New PriceRecords (source IMPORT, effective invoice date) for every linked item whose billed price differs from the one on record. */
export async function updatePricesFromInvoice(invoiceId: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { orderBy: { id: "asc" } } } });
  const date = toISODate(inv.invoiceDate);
  const ids = [...new Set(inv.lines.map((l) => l.supplierProductId).filter((x): x is string => Boolean(x)))];
  const products = await db.supplierProduct.findMany({
    where: { id: { in: ids } },
    include: { prices: { select: { price: true, effectiveDate: true }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] } },
  });
  const history = new Map(products.map((p) => [p.id, p.prices.map((r) => ({ date: toISODate(r.effectiveDate), price: r.price.toNumber() }))]));
  const changes = planPriceRecords(
    inv.lines.filter((l) => l.supplierProductId && history.has(l.supplierProductId)).map((l) => ({ supplierProductId: l.supplierProductId, unitPrice: l.unitPrice.toNumber(), qty: l.qty.toNumber(), kind: l.kind })),
    (id) => priceAsOf(history.get(id), date),
  );
  if (changes.length) {
    await db.priceRecord.createMany({
      data: changes.map((c) => ({ supplierProductId: c.supplierProductId, price: new Prisma.Decimal(c.to.toFixed(2)), effectiveDate: parseISODate(date), source: "IMPORT" as const })),
    });
  }
  return changes;
}

/** How many linked items would change a price on record (for the button label). */
export async function pendingPriceChanges(inv: { invoiceDate: Date; lines: { supplierProductId: string | null; unitPrice: Prisma.Decimal; qty?: Prisma.Decimal; kind?: string }[] }) {
  const date = toISODate(inv.invoiceDate);
  const ids = [...new Set(inv.lines.map((l) => l.supplierProductId).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return 0;
  const prices = await db.priceRecord.findMany({ where: { supplierProductId: { in: ids }, effectiveDate: { lte: parseISODate(date) } }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] });
  return planPriceRecords(
    inv.lines.map((l) => ({ supplierProductId: l.supplierProductId, unitPrice: l.unitPrice.toNumber(), qty: l.qty?.toNumber() ?? 1, kind: l.kind })),
    (id) => prices.filter((p) => p.supplierProductId === id).at(-1)?.price.toNumber() ?? null,
  ).length;
}

/** Record the invoice's prices and alert on spikes, noting it in the history. Returns how many changed. */
export async function applyInvoicePrices(invoiceId: string, by: string) {
  const changes = await updatePricesFromInvoice(invoiceId);
  if (changes.length) {
    await recordEvent(invoiceId, { by, action: "prices-updated", note: `${changes.length} price${changes.length === 1 ? "" : "s"} recorded in costing` });
    const { inBackground, alertPriceSpikes } = await import("./notify");
    inBackground(() => alertPriceSpikes());
  }
  return changes.length;
}

// ---- Received quantities -------------------------------------------------------------------

/**
 * A sent order that this invoice bills is checked in with the invoice's
 * quantities, so nobody types them twice. Shorts and extras go in the history.
 * Orders already checked in by hand are left as they are.
 */
export async function receiveOrderFromInvoice(invoiceId: string, by: string): Promise<{ received: boolean; shorts: number }> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { invoiceDate: true, orderId: true, order: { select: { status: true, sentAt: true } }, lines: { orderBy: { id: "asc" }, select: { supplierProductId: true, qty: true, kind: true, unitPrice: true, product: { select: { description: true, ingredient: { select: { name: true } } } } } } } });
  if (!inv?.orderId || inv.order?.status !== "SENT") return { received: false, shorts: 0 };
  const orderLines = await db.purchaseOrderLine.findMany({ where: { orderId: inv.orderId }, orderBy: { id: "asc" }, include: { product: { select: { description: true, purchaseUnit: true } } } });
  const r = receiveFromInvoice(
    orderLines.map((l) => ({ id: l.id, supplierProductId: l.supplierProductId, qty: l.qty.toNumber(), receivedQty: num(l.receivedQty) })),
    inv.lines.map((l) => ({ supplierProductId: l.supplierProductId, qty: l.qty.toNumber(), kind: l.kind })),
  );
  if (!r.updates.length) return { received: false, shorts: 0 };
  // Received at midday on the invoice date (as planning counts PO-less invoices), never in the future.
  const midday = new Date(zonedMidnightUTC(toISODate(inv.invoiceDate), env.BUSINESS_TIMEZONE).getTime() + 12 * 3600_000);
  const receivedAt = midday.getTime() > Date.now() ? new Date() : midday;
  await db.$transaction([
    ...r.updates.map((u) => db.purchaseOrderLine.update({ where: { id: u.orderLineId }, data: { receivedQty: new Prisma.Decimal(u.receivedQty) } })),
    // Billed but never ordered: it arrived, so it goes on the order as received (ordered 0).
    ...r.notOnOrder.map((x) => {
      const price = inv.lines.filter((l) => l.supplierProductId === x.supplierProductId).at(-1)?.unitPrice ?? null;
      return db.purchaseOrderLine.create({ data: { orderId: inv.orderId!, supplierProductId: x.supplierProductId, suggestedQty: new Prisma.Decimal(0), qty: new Prisma.Decimal(0), unitPrice: price, receivedQty: new Prisma.Decimal(x.shipped) } });
    }),
    db.purchaseOrder.update({ where: { id: inv.orderId }, data: { status: "RECEIVED", receivedAt, sentAt: inv.order.sentAt ?? receivedAt } }),
  ]);
  const billedName = (pid: string) => {
    const p = inv.lines.find((l) => l.supplierProductId === pid)?.product;
    return p?.ingredient?.name ?? p?.description ?? "an item";
  };
  const name = (pid: string) => orderLines.find((l) => l.supplierProductId === pid)?.product.description ?? "an item";
  const unit = (pid: string) => orderLines.find((l) => l.supplierProductId === pid)?.product.purchaseUnit ?? "";
  const q = (n: number) => String(Number(n.toFixed(2)));
  const notes = [
    ...r.shorts.map((s) => `${name(s.supplierProductId)} short ${q(s.ordered - s.shipped)} ${unit(s.supplierProductId)} (${q(s.shipped)} of ${q(s.ordered)})`),
    ...r.overs.map((s) => `${name(s.supplierProductId)} ${q(s.shipped - s.ordered)} extra`),
    ...r.notOnOrder.map((x) => `${billedName(x.supplierProductId)} wasn't ordered (${q(x.shipped)} added as received)`),
    ...(r.notOnInvoice.length ? [`${r.notOnInvoice.length} ordered item${r.notOnInvoice.length === 1 ? "" : "s"} not on the invoice`] : []),
  ];
  await recordEvent(invoiceId, { by, action: "order-received", note: notes.length ? `Checked in from the invoice. ${notes.join("; ")}.`.slice(0, 480) : "Checked in from the invoice: everything as ordered." });
  return { received: true, shorts: r.shorts.length };
}

// ---- Linking lines to products ---------------------------------------------------------------

export async function linkContext(supplierId: string) {
  const [products, ingredients] = await Promise.all([
    db.supplierProduct.findMany({ where: { supplierId }, select: { id: true, sku: true, description: true, active: true, ingredient: { select: { name: true } } } }),
    db.ingredient.findMany({ where: { active: true }, select: { id: true, name: true, baseUnit: true }, orderBy: { name: "asc" } }),
  ]);
  return { products: products.sort((a, b) => Number(b.active) - Number(a.active)), ingredients: ingredients.map((i) => ({ ...i, baseUnit: i.baseUnit as BaseUnit })) };
}

/** A suggestion for every unlinked item line of an invoice. */
export async function linkSuggestions(invoiceId: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { supplierId: true, kind: true, lines: { orderBy: { id: "asc" }, select: { id: true, sku: true, description: true, kind: true, packText: true, supplierProductId: true } } } });
  const ctx = await linkContext(inv.supplierId);
  const usedSkus = new Set(ctx.products.map((p) => p.sku.toLowerCase()));
  const out: { lineId: string; suggestion: LinkSuggestion }[] = [];
  for (const l of inv.lines) {
    if (l.supplierProductId || l.kind !== "item") continue;
    out.push({ lineId: l.id, suggestion: suggestLink(l, ctx.products, ctx.ingredients, { receipt: inv.kind === "receipt", usedSkus }) });
  }
  return { suggestions: out, ...ctx };
}

/**
 * Apply one suggestion: link to an existing product, or create the product
 * (and the ingredient, or link it to the chosen one) and link the line.
 * `ingredientId` overrides the suggested ingredient ("" = create a new one).
 */
export async function applyLinkSuggestion(lineId: string, s: LinkSuggestion, choice: { ingredientId?: string | null } = {}) {
  if (s.kind === "skip") return null;
  const line = await db.invoiceLine.findUniqueOrThrow({ where: { id: lineId }, select: { id: true, invoice: { select: { supplierId: true } } } });
  let productId: string;
  if (s.kind === "linked" || s.kind === "product") productId = s.productId;
  else {
    const p = s.plan;
    let ingredientId = choice.ingredientId === undefined ? p.ingredient?.id ?? "" : choice.ingredientId ?? "";
    let base: BaseUnit = p.newIngredient.baseUnit;
    if (ingredientId) {
      const ing = await db.ingredient.findUnique({ where: { id: ingredientId }, select: { id: true, baseUnit: true } });
      if (!ing) ingredientId = "";
      else base = ing.baseUnit as BaseUnit;
    }
    if (!ingredientId) {
      const name = p.newIngredient.name.slice(0, 80);
      const existing = await db.ingredient.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, baseUnit: true } });
      const ing = existing ?? (await db.ingredient.create({ data: { name, baseUnit: p.newIngredient.baseUnit }, select: { id: true, baseUnit: true } }));
      ingredientId = ing.id;
      base = ing.baseUnit as BaseUnit;
    }
    const pack = p.purchaseUnit === "lb" && base === "g" ? 453.5924 : inferPackQty(p.packText, base);
    const existing = await db.supplierProduct.findUnique({ where: { supplierId_sku: { supplierId: line.invoice.supplierId, sku: p.sku } }, select: { id: true } });
    const product =
      existing ??
      (await db.supplierProduct.create({
        data: {
          supplierId: line.invoice.supplierId,
          sku: p.sku,
          description: p.description,
          packText: p.packText,
          purchaseUnit: p.purchaseUnit,
          ingredientId,
          packQtyBase: pack == null ? undefined : new Prisma.Decimal(pack.toFixed(4)),
        },
        select: { id: true },
      }));
    await db.ingredient.updateMany({ where: { id: ingredientId, preferredProductId: null }, data: { preferredProductId: product.id } });
    productId = product.id;
  }
  await db.invoiceLine.update({ where: { id: lineId }, data: { supplierProductId: productId } });
  return productId;
}

// ---- Queries ---------------------------------------------------------------------

export const STATUS_META: Record<InvoiceStatus, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  NEEDS_REVIEW: { label: "Needs review", tone: "neutral" },
  MATCHED: { label: "Matched", tone: "good" },
  PRICE_ISSUE: { label: "Price issue", tone: "warn" },
  QTY_ISSUE: { label: "Qty issue", tone: "warn" },
  PRICE_AND_QTY: { label: "Price + qty", tone: "bad" },
  APPROVED: { label: "Approved", tone: "good" },
};

export async function listInvoices(filter: { status?: InvoiceStatus | "OPEN"; supplierId?: string; take?: number }) {
  return db.invoice.findMany({
    where: {
      supplierId: filter.supplierId || undefined,
      status: filter.status === "OPEN" ? { not: "APPROVED" } : filter.status || undefined,
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    take: filter.take ?? 200,
    select: {
      id: true, invoiceNumber: true, invoiceDate: true, total: true, status: true, supplierId: true, extractedBy: true,
      supplier: { select: { name: true } },
      order: { select: { id: true, deliveryDate: true } },
      lines: { select: { qty: true, unitPrice: true, expectedQty: true, expectedPrice: true, status: true } },
    },
  });
}

export async function loadInvoice(id: string) {
  return db.invoice.findUnique({
    where: { id },
    omit: { image: true },
    include: {
      supplier: true,
      order: { include: { lines: { include: { product: { select: { sku: true, description: true, purchaseUnit: true } } } } } },
      lines: { orderBy: { id: "asc" }, include: { product: { select: { id: true, sku: true, description: true, purchaseUnit: true, ingredient: { select: { name: true } } } } } },
    },
  });
}

/** Sent/received orders a new invoice could bill (newest first). */
export async function candidateOrders() {
  const orders = await db.purchaseOrder.findMany({
    where: { status: { in: ["SENT", "RECEIVED"] } },
    orderBy: { deliveryDate: "desc" },
    take: 100,
    select: { id: true, supplierId: true, status: true, deliveryDate: true, _count: { select: { invoices: true, lines: true } } },
  });
  return orders.map((o) => ({ id: o.id, supplierId: o.supplierId, status: o.status, deliveryDate: toISODate(o.deliveryDate), invoiced: o._count.invoices > 0, lineCount: o._count.lines }));
}
