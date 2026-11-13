import "server-only";
import { addDays, ISODate, parseISODate, toISODate } from "@/domain/dates";
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
import { InvoiceStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db, num } from "../db";
import { claudeJSON, fileBlock } from "../integrations/claude";
import { priceAsOf } from "./costing";

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
    lines: inv.lines.map((l) => ({ sku: l.sku, description: l.description, qty: l.qty.toNumber(), unitPrice: l.unitPrice.toNumber(), supplierProductId: l.supplierProductId })),
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
  return r;
}

// ---- Create -----------------------------------------------------------------------

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function createInvoice(args: {
  supplierId: string;
  orderId: string | null;
  invoiceNumber: string | null;
  invoiceDate: ISODate;
  total: number | null;
  lines: InvoiceLineInput[];
  image: { bytes: Uint8Array; type: string } | null;
  extractedBy: "claude" | "manual";
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
      lines: {
        create: r.lines.map((l) => ({
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
  return inv.id;
}

/** Exact duplicate (same supplier + number) — the database refuses these. */
export async function exactDuplicate(supplierId: string, invoiceNumber: string | null) {
  if (!invoiceNumber) return null;
  return db.invoice.findUnique({ where: { supplierId_invoiceNumber: { supplierId, invoiceNumber } }, select: { id: true } });
}

// ---- Reading with Claude ---------------------------------------------------------------

const extractionSchema = z.object({
  supplierName: z.string().nullable().describe("The seller / vendor name printed on the invoice, not the customer."),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable().describe("Invoice date as YYYY-MM-DD."),
  total: z.number().nullable().describe("Amount due / invoice total in dollars."),
  lines: z.array(
    z.object({
      sku: z.string().nullable().describe("Item / product code as printed, or null."),
      description: z.string(),
      qty: z.number().describe("Quantity shipped and billed, in the invoice's units."),
      unitPrice: z.number().describe("Price per unit in dollars."),
      lineTotal: z.number().nullable(),
    }),
  ),
});
export type InvoiceExtraction = z.infer<typeof extractionSchema>;

const SYSTEM = `You read supplier invoices for a restaurant's back office. Extract exactly what is printed; never guess values that aren't there (use null).
- Lines are billed products only. Skip subtotals, tax, deposits summaries and page headers; include fees or surcharges as their own line with qty 1.
- qty is the quantity shipped/billed (not ordered, if both appear). If a line shows a weight-based price, qty is the billed weight.
- Dollar amounts are plain numbers (42.5, not "$42.50").`;

export async function extractInvoice(bytes: Uint8Array, mediaType: string) {
  const block = fileBlock(bytes, mediaType);
  if (!block) return { ok: false as const, error: "Upload a photo (JPEG/PNG) or a PDF." };
  return claudeJSON({ schema: extractionSchema, system: SYSTEM, content: [block, "Read this supplier invoice."], effort: "medium" });
}

// ---- Prices into costing -----------------------------------------------------------------

/** New PriceRecords (source IMPORT, effective invoice date) for every matched line whose price differs from the one on record. */
export async function updatePricesFromInvoice(invoiceId: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
  const date = toISODate(inv.invoiceDate);
  const ids = [...new Set(inv.lines.map((l) => l.supplierProductId).filter((x): x is string => Boolean(x)))];
  const products = await db.supplierProduct.findMany({
    where: { id: { in: ids } },
    include: { prices: { select: { price: true, effectiveDate: true }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] } },
  });
  const changes: { supplierProductId: string; from: number | null; to: number }[] = [];
  for (const p of products) {
    // The latest billed price for this product on the invoice wins.
    const line = inv.lines.filter((l) => l.supplierProductId === p.id && l.unitPrice.toNumber() > 0).at(-1);
    if (!line) continue;
    const current = priceAsOf(p.prices.map((r) => ({ date: toISODate(r.effectiveDate), price: r.price.toNumber() })), date);
    const to = line.unitPrice.toNumber();
    if (current == null || Math.abs(current - to) >= 0.005) changes.push({ supplierProductId: p.id, from: current, to });
  }
  if (changes.length) {
    await db.priceRecord.createMany({
      data: changes.map((c) => ({ supplierProductId: c.supplierProductId, price: new Prisma.Decimal(c.to.toFixed(2)), effectiveDate: parseISODate(date), source: "IMPORT" as const })),
    });
  }
  return changes;
}

/** How many matched lines would change a price on record (for the button label). */
export async function pendingPriceChanges(inv: { invoiceDate: Date; lines: { supplierProductId: string | null; unitPrice: Prisma.Decimal }[] }) {
  const date = toISODate(inv.invoiceDate);
  const ids = [...new Set(inv.lines.map((l) => l.supplierProductId).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return 0;
  const prices = await db.priceRecord.findMany({ where: { supplierProductId: { in: ids }, effectiveDate: { lte: parseISODate(date) } }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] });
  let n = 0;
  for (const id of ids) {
    const line = inv.lines.filter((l) => l.supplierProductId === id && l.unitPrice.toNumber() > 0).at(-1);
    if (!line) continue;
    const current = prices.filter((p) => p.supplierProductId === id).at(-1)?.price.toNumber() ?? null;
    if (current == null || Math.abs(current - line.unitPrice.toNumber()) >= 0.005) n++;
  }
  return n;
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

export async function listInvoices(filter: { status?: InvoiceStatus | "OPEN"; supplierId?: string }) {
  return db.invoice.findMany({
    where: {
      supplierId: filter.supplierId || undefined,
      status: filter.status === "OPEN" ? { not: "APPROVED" } : filter.status || undefined,
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    take: 200,
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
