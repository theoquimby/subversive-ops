import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { claudeJSON, claudeReady, CLAUDE_NOT_SET_UP, fileBlock } from "../integrations/claude";
import type { SheetTable } from "./priceImport";

/**
 * A price sheet on paper (a photo) or as a PDF, read into the same table a
 * spreadsheet download gives — so it goes through the same preview, column
 * check and price-change review before anything is saved.
 */

export const PAPER_HEADERS = ["Item number", "Description", "Pack", "Unit", "Price"] as const;

const rowSchema = z.object({
  rows: z
    .array(
      z.object({
        itemNumber: z.string().nullable().describe("The supplier's item number / SKU / code, exactly as printed. null when the sheet has none."),
        description: z.string().describe("The product name as printed"),
        pack: z.string().nullable().describe("Pack size as printed, e.g. '6/#10', '4x5 lb', '50 lb'"),
        unit: z.string().nullable().describe("What the price is per, e.g. CS, EA, LB, BAG — as printed"),
        price: z.number().nullable().describe("The price in dollars for one unit; null when there is none or it is unreadable"),
      }),
    )
    .describe("Every priced product on the sheet, top to bottom"),
});

const SYSTEM = `You read supplier price sheets, order guides and price lists for a restaurant. Return every product line with a price.
- Copy item numbers and descriptions exactly as printed; don't invent item numbers.
- Skip headings, category titles, page numbers and lines with no price.
- If a line shows several prices (e.g. case and each), use the main case/unit price and put its unit in 'unit'.`;

// Previewing again (a column changed) must not read the same photo twice.
const cache = new Map<string, SheetTable>();

export const isPaperFile = (file: File) => file.type === "application/pdf" || file.type.startsWith("image/") || /\.(pdf|jpe?g|png|heic|webp)$/i.test(file.name);

/** A stand-in item number for a sheet that prints none, stable for the same description. */
export const paperItemNumber = (description: string) => `NO-SKU-${description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;

export async function readPaperPriceSheet(file: File): Promise<SheetTable> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = createHash("sha256").update(bytes).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : /\.png$/i.test(file.name) ? "image/png" : "image/jpeg");
  const block = fileBlock(bytes, type);
  if (!block) throw new Error("Upload a photo (JPEG or PNG) or a PDF of the price sheet. iPhone HEIC photos: share them as JPEG.");
  if (!(await claudeReady())) throw new Error(`Reading a photo or PDF needs AI. ${CLAUDE_NOT_SET_UP} Or upload the spreadsheet version.`);
  const r = await claudeJSON({ schema: rowSchema, system: SYSTEM, content: [block, "Read every priced product on this price sheet."], effort: "low" });
  if (!r.ok) throw new Error(r.error);
  const records = r.data.rows
    .filter((x) => x.description.trim() && x.price != null)
    .map((x) => ({
      [PAPER_HEADERS[0]]: x.itemNumber?.trim() || paperItemNumber(x.description),
      [PAPER_HEADERS[1]]: x.description.trim(),
      [PAPER_HEADERS[2]]: x.pack ?? "",
      [PAPER_HEADERS[3]]: x.unit ?? "",
      [PAPER_HEADERS[4]]: x.price,
    }));
  if (!records.length) throw new Error("Couldn't find any prices on that. Try a closer, straighter photo with the whole sheet in frame.");
  const table: SheetTable = { name: file.name, headers: [...PAPER_HEADERS], records };
  if (cache.size > 20) cache.delete(cache.keys().next().value!);
  cache.set(key, table);
  return table;
}
