/**
 * Demo invoices: one clean match, one price increase, one short-shipped.
 * Uses the base demo's suppliers/products and its received Hudson Valley order;
 * adds two small received orders for the other two invoices. No photos —
 * the invoice page shows its placeholder. Safe to run twice (skips if present).
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { addDays, todayIn, toISODate, parseISODate } from "../../domain/dates";
import { matchInvoice, type CatalogProduct, type InvoiceLineInput, type OrderLineRef } from "../../domain/invoiceMatch";

const D = (n: number) => new Prisma.Decimal(n.toFixed(2));

export async function seedInvoices(db: PrismaClient): Promise<void> {
  if (await db.invoice.findFirst({ where: { invoiceNumber: { in: ["448210", "CB-1187", "449032"] } } })) return;
  const hvf = await db.supplier.findFirst({ where: { name: "Hudson Valley Foodservice" } });
  const bread = await db.supplier.findFirst({ where: { name: "Catskill Bread Co." } });
  if (!hvf || !bread) return;
  const today = todayIn(process.env.BUSINESS_TIMEZONE || "America/New_York");

  const products = await db.supplierProduct.findMany({
    where: { supplierId: { in: [hvf.id, bread.id] } },
    include: { prices: { orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] } },
  });
  const bySku = (sku: string) => products.find((p) => p.sku === sku);
  /** Price on record the day before `date` — what matching compares against. */
  const priceBefore = (id: string, date: string) => {
    const p = products.find((x) => x.id === id);
    let found: number | null = null;
    for (const r of p?.prices ?? []) if (toISODate(r.effectiveDate) < date) found = r.price.toNumber();
    return found;
  };
  const catalog = (supplierId: string, date: string): CatalogProduct[] =>
    products.filter((p) => p.supplierId === supplierId).map((p) => ({ id: p.id, sku: p.sku, description: p.description, currentPrice: priceBefore(p.id, date) }));

  async function makeInvoice(args: { supplierId: string; orderId: string; number: string; date: string; lines: InvoiceLineInput[] }) {
    const ol = await db.purchaseOrderLine.findMany({ where: { orderId: args.orderId } });
    const orderLines: OrderLineRef[] = ol.map((l) => ({ supplierProductId: l.supplierProductId, orderedQty: l.qty.toNumber(), receivedQty: l.receivedQty?.toNumber() ?? null, unitPrice: l.unitPrice?.toNumber() ?? null }));
    const total = Math.round(args.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * 100) / 100;
    const r = matchInvoice({ lines: args.lines, catalog: catalog(args.supplierId, args.date), orderLines, invoiceTotal: total });
    await db.invoice.create({
      data: {
        supplierId: args.supplierId, orderId: args.orderId, invoiceNumber: args.number, invoiceDate: parseISODate(args.date), total: D(total), status: r.status, extractedBy: "manual",
        createdAt: new Date(parseISODate(args.date).getTime() + 17 * 3600_000),
        lines: {
          create: r.lines.map((l) => ({
            supplierProductId: l.supplierProductId, sku: l.sku ?? null, description: l.description, qty: new Prisma.Decimal(l.qty), unitPrice: D(l.unitPrice),
            expectedQty: l.expectedQty == null ? null : D(l.expectedQty), expectedPrice: l.expectedPrice == null ? null : D(l.expectedPrice), status: l.status,
          })),
        },
      },
    });
  }

  // 1) Clean match — bills exactly what the base demo's received order brought in.
  const received = await db.purchaseOrder.findFirst({ where: { supplierId: hvf.id, status: "RECEIVED" }, orderBy: { deliveryDate: "asc" }, include: { lines: { include: { product: true } } } });
  if (received) {
    const date = toISODate(received.deliveryDate);
    await makeInvoice({
      supplierId: hvf.id, orderId: received.id, number: "448210", date,
      lines: received.lines.map((l) => ({
        sku: l.product.sku, description: l.product.description.toUpperCase(), qty: l.receivedQty?.toNumber() ?? l.qty.toNumber(),
        unitPrice: l.unitPrice?.toNumber() ?? priceBefore(l.supplierProductId, date) ?? 0,
      })),
    });
  }

  // 2) Price increase — Catskill Bread bumps the potato buns.
  const bun = bySku("CBC-BUN");
  const loaf = bySku("CBC-SD");
  if (bun && loaf) {
    const date = addDays(today, -4);
    const bunPrice = priceBefore(bun.id, date) ?? 7.8;
    const loafPrice = priceBefore(loaf.id, date) ?? 6.5;
    const po = await db.purchaseOrder.create({
      data: {
        supplierId: bread.id, status: "RECEIVED", deliveryDate: parseISODate(date), coverUntil: parseISODate(addDays(date, 2)), sentAt: parseISODate(addDays(date, -2)), receivedAt: new Date(parseISODate(date).getTime() + 14 * 3600_000), notes: "Demo order",
        lines: { create: [
          { supplierProductId: bun.id, suggestedQty: D(8), qty: D(8), unitPrice: D(bunPrice), receivedQty: D(8) },
          { supplierProductId: loaf.id, suggestedQty: D(6), qty: D(6), unitPrice: D(loafPrice), receivedQty: D(6) },
        ] },
      },
    });
    await makeInvoice({
      supplierId: bread.id, orderId: po.id, number: "CB-1187", date,
      lines: [
        { sku: "CBC-BUN", description: "Potato buns (dozen)", qty: 8, unitPrice: Math.round((bunPrice + 0.6) * 100) / 100 },
        { sku: "CBC-SD", description: "Country sourdough", qty: 6, unitPrice: loafPrice },
      ],
    });
  }

  // 3) Short-shipped — billed two cases of lettuce, one arrived.
  const lettuce = bySku("10450");
  const tomato = bySku("10512");
  const lemons = bySku("10301");
  if (lettuce && tomato && lemons) {
    const date = addDays(today, -1);
    const price = (id: string) => priceBefore(id, date) ?? 0;
    const po = await db.purchaseOrder.create({
      data: {
        supplierId: hvf.id, status: "RECEIVED", deliveryDate: parseISODate(date), coverUntil: parseISODate(addDays(date, 3)), sentAt: parseISODate(addDays(date, -1)), receivedAt: new Date(parseISODate(date).getTime() + 15 * 3600_000), notes: "Demo order",
        lines: { create: [
          { supplierProductId: lettuce.id, suggestedQty: D(2), qty: D(2), unitPrice: D(price(lettuce.id)), receivedQty: D(1) },
          { supplierProductId: tomato.id, suggestedQty: D(2), qty: D(2), unitPrice: D(price(tomato.id)), receivedQty: D(2) },
          { supplierProductId: lemons.id, suggestedQty: D(1), qty: D(1), unitPrice: D(price(lemons.id)), receivedQty: D(1) },
        ] },
      },
    });
    await makeInvoice({
      supplierId: hvf.id, orderId: po.id, number: "449032", date,
      lines: [
        { sku: "10450", description: "LETTUCE GREEN LEAF 24CT", qty: 2, unitPrice: price(lettuce.id) },
        { sku: "10512", description: "TOMATO 5X6 25LB", qty: 2, unitPrice: price(tomato.id) },
        { sku: "10301", description: "LEMONS 115CT", qty: 1, unitPrice: price(lemons.id) },
      ],
    });
  }
}
