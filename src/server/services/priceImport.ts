import "server-only";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ISODate, parseISODate } from "@/domain/dates";
import { ColumnMapping, detectMapping, diffPrices, inferPackQty, ParsedRow, parseRows, PriceDiff } from "@/domain/priceSheet";
import { BaseUnit } from "@/domain/units";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { priceAsOf } from "./costing";

const MAX_BYTES = 10 * 1024 * 1024;

/** Read a CSV/XLSX upload into header + records (first sheet only). */
export async function readSheet(file: File): Promise<{ headers: string[]; records: Record<string, unknown>[] }> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const parsed = Papa.parse<Record<string, unknown>>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    return { headers: parsed.meta.fields ?? [], records: parsed.data };
  }
  if (/\.(xlsx|xls)$/.test(name)) {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // Some distributor exports put a title block above the header row — find the first row that looks like headers.
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: true });
    const headerIdx = grid.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3);
    if (headerIdx < 0) return { headers: [], records: [] };
    const headers = (grid[headerIdx] as unknown[]).map((h) => String(h ?? "").trim());
    const records = grid.slice(headerIdx + 1).map((row) => Object.fromEntries(headers.map((h, i) => [h, (row as unknown[])[i]])));
    return { headers: headers.filter(Boolean), records };
  }
  throw new Error("Upload a .csv or .xlsx file.");
}

export interface ImportPreview {
  headers: string[];
  mapping: Partial<ColumnMapping>;
  mappingComplete: boolean;
  rows: ParsedRow[];
  errors: { row: number; message: string }[];
  diff: PriceDiff | null;
}

export async function previewImport(supplierId: string, file: File, mappingOverride?: Partial<ColumnMapping>): Promise<ImportPreview> {
  const supplier = await db.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  const { headers, records } = await readSheet(file);
  const saved = (supplier.importMapping ?? {}) as Partial<ColumnMapping>;
  const savedValid = Object.values(saved).every((h) => !h || headers.includes(h));
  const mapping = { ...detectMapping(headers), ...(savedValid ? saved : {}), ...mappingOverride };
  const mappingComplete = Boolean(mapping.sku && mapping.description && mapping.price);
  if (!mappingComplete) return { headers, mapping, mappingComplete, rows: [], errors: [], diff: null };

  const { rows, errors } = parseRows(records, mapping as ColumnMapping);
  const diff = diffPrices(rows, await currentProducts(supplierId));
  return { headers, mapping, mappingComplete, rows, errors, diff };
}

async function currentProducts(supplierId: string) {
  const products = await db.supplierProduct.findMany({
    where: { supplierId, active: true },
    include: { prices: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1 } },
  });
  return products.map((p) => ({ sku: p.sku, description: p.description, currentPrice: p.prices[0]?.price.toNumber() ?? null }));
}

/**
 * Commit an import: upsert products, add a PriceRecord for every new or
 * changed price (never overwriting history), remember the column mapping.
 */
export async function commitImport(args: { supplierId: string; filename: string; effectiveDate: ISODate; mapping: ColumnMapping; rows: ParsedRow[] }) {
  const { supplierId, rows, effectiveDate } = args;
  const existing = await db.supplierProduct.findMany({
    where: { supplierId },
    include: { ingredient: { select: { baseUnit: true } }, prices: { select: { price: true, effectiveDate: true }, orderBy: { effectiveDate: "asc" } } },
  });
  const bySku = new Map(existing.map((p) => [p.sku, p]));

  return db.$transaction(
    async (tx) => {
      const imp = await tx.priceImport.create({
        data: { supplierId, filename: args.filename, effectiveDate: parseISODate(effectiveDate), rowCount: rows.length, newProducts: 0, priceChanges: 0 },
      });
      let newProducts = 0;
      let priceChanges = 0;
      for (const row of rows) {
        let product = bySku.get(row.sku);
        if (!product) {
          const created = await tx.supplierProduct.create({
            data: { supplierId, sku: row.sku, description: row.description, packText: row.packText, purchaseUnit: row.purchaseUnit },
          });
          product = { ...created, ingredient: null, prices: [] };
          newProducts++;
        } else {
          const packQtyBase =
            product.packQtyBase ?? (product.ingredient ? inferPackQty(row.packText, product.ingredient.baseUnit as BaseUnit) : null);
          await tx.supplierProduct.update({
            where: { id: product.id },
            data: { description: row.description, packText: row.packText, active: true, packQtyBase: packQtyBase == null ? undefined : packQtyBase },
          });
        }
        const history = product.prices.map((p) => ({ date: p.effectiveDate.toISOString().slice(0, 10), price: p.price.toNumber() }));
        const current = priceAsOf(history, effectiveDate);
        if (current == null || Math.abs(current - row.price) >= 0.005) {
          await tx.priceRecord.create({
            data: { supplierProductId: product.id, price: new Prisma.Decimal(row.price.toFixed(2)), effectiveDate: parseISODate(effectiveDate), source: "IMPORT", importId: imp.id },
          });
          if (current != null) priceChanges++;
        }
      }
      await tx.priceImport.update({ where: { id: imp.id }, data: { newProducts, priceChanges } });
      await tx.supplier.update({ where: { id: supplierId }, data: { importMapping: args.mapping as unknown as Prisma.InputJsonValue } });
      return { importId: imp.id, newProducts, priceChanges };
    },
    { timeout: 60_000 },
  );
}

/** Manual price entry (local suppliers, bar, one-offs). */
export async function recordManualPrice(supplierProductId: string, price: number, effectiveDate: ISODate) {
  return db.priceRecord.create({
    data: { supplierProductId, price: new Prisma.Decimal(price.toFixed(2)), effectiveDate: parseISODate(effectiveDate), source: "MANUAL" },
  });
}
