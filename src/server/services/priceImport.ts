import "server-only";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ISODate, parseISODate } from "@/domain/dates";
import { ColumnMapping, detectMapping, diffPrices, inferPackQty, packTextForUnit, ParsedRow, parseRows, PriceDiff } from "@/domain/priceSheet";
import { BaseUnit } from "@/domain/units";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { priceAsOf } from "./costing";

const MAX_BYTES = 10 * 1024 * 1024;

export interface SheetTable {
  name: string;
  headers: string[];
  records: Record<string, unknown>[];
}

/** Parse workbook bytes into one table per tab. Header row = first row with 2+ text cells (skips title blocks). */
export function parseWorkbook(bytes: Uint8Array): SheetTable[] {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((sheetName) => {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, blankrows: false, raw: true, defval: "" });
    const headerIdx = grid.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 2);
    if (headerIdx < 0) return { name: sheetName, headers: [], records: [] };
    const raw = (grid[headerIdx] as unknown[]).map((h) => String(h ?? "").trim());
    const headers = raw.map((h, i) => h || `Column ${i + 1}`);
    const records = grid
      .slice(headerIdx + 1)
      .map((row) => Object.fromEntries(headers.map((h, i) => [h, (row as unknown[])[i] ?? ""])))
      .filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
    return { name: sheetName, headers: headers.filter((_, i) => raw[i] || records.some((r) => String(r[headers[i]]).trim())), records };
  }).filter((t) => t.headers.length > 0);
}

export async function readTables(file: File): Promise<SheetTable[]> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const parsed = Papa.parse<Record<string, unknown>>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    return [{ name: file.name.replace(/\.csv$/i, ""), headers: parsed.meta.fields ?? [], records: parsed.data }];
  }
  if (/\.(xlsx|xls|ods)$/.test(name)) return parseWorkbook(new Uint8Array(await file.arrayBuffer()));
  throw new Error("Upload a .xlsx, .xls or .csv file.");
}

/** Read a CSV/XLSX upload (first table) — used by distributor price sheets. */
export async function readSheet(file: File): Promise<{ headers: string[]; records: Record<string, unknown>[] }> {
  const [first] = await readTables(file);
  return first ? { headers: first.headers, records: first.records } : { headers: [], records: [] };
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

  const current = await currentProducts(supplierId);
  const unitBySku = new Map(current.map((c) => [c.sku, c.purchaseUnit]));
  const { rows, errors } = parseRows(records, mapping as ColumnMapping, (sku) => unitBySku.get(sku));
  const diff = diffPrices(rows, current);
  return { headers, mapping, mappingComplete, rows, errors, diff };
}

async function currentProducts(supplierId: string) {
  const products = await db.supplierProduct.findMany({
    where: { supplierId, active: true },
    include: { prices: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1 } },
  });
  return products.map((p) => ({ sku: p.sku, description: p.description, purchaseUnit: p.purchaseUnit, currentPrice: p.prices[0]?.price.toNumber() ?? null }));
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
            product.packQtyBase ?? (product.ingredient ? inferPackQty(packTextForUnit(row.packText, product.purchaseUnit), product.ingredient.baseUnit as BaseUnit) : null);
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
