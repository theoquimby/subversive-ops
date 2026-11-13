"use server";

import { parseISODate } from "@/domain/dates";
import { parsePastedLines, pickOrder, suggestSupplier } from "@/domain/invoiceMatch";
import { requireUser } from "@/server/auth";
import { CLAUDE_NOT_SET_UP } from "@/server/integrations/claude";
import { checkInvoiceMath, expandReceiptText, knownStore, LINE_KINDS, looksLikeReceipt, type LineKind } from "@/domain/invoiceAutopilot";
import { db } from "@/server/db";
import { approvalNeedsNote } from "@/domain/invoiceHistory";
import { sendCreditRequest } from "@/server/email/outbound";
import { saveAccount, saveTaxRate } from "@/server/services/accounting";
import {
  addPage,
  alertedKey,
  applyInvoicePrices,
  applyLinkSuggestion,
  linkSuggestions,
  MAX_PAGES,
  readerReady,
  setPricesOnApprove,
  approve,
  candidateOrders,
  createInvoice,
  exactDuplicate,
  extractInvoice,
  MAX_FILE_BYTES,
  recordEvent,
  rematch,
  reopen,
  setAutoApprove,
  TOLERANCE_KEYS,
} from "@/server/services/invoices";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

async function readUpload(form: FormData): Promise<{ bytes: Uint8Array; type: string } | { error: string } | null> {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return null;
  return checkFile(f);
}

async function checkFile(f: File): Promise<{ bytes: Uint8Array; type: string } | { error: string }> {
  if (f.size > MAX_FILE_BYTES) return { error: "That file is over 8 MB. Try a photo instead of a scan, or split the PDF." };
  if (!ACCEPTED.includes(f.type)) return { error: "Upload a photo (JPEG/PNG) or a PDF." };
  return { bytes: new Uint8Array(await f.arrayBuffer()), type: f.type };
}

const modeSchema = z.enum(["auto", "invoice", "receipt"]).catch("auto");

/**
 * Read every page of one invoice (or a store receipt) with Claude in a single
 * request, check its math, and suggest the supplier and order.
 */
export async function readInvoice(form: FormData) {
  await requireUser("MANAGER");
  if (!(await readerReady())) return { error: CLAUDE_NOT_SET_UP };
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose a photo or PDF first." };
  if (files.length > MAX_PAGES) return { error: `Up to ${MAX_PAGES} pages at a time.` };
  const pages = [];
  for (const f of files) {
    const up = await checkFile(f);
    if ("error" in up) return up;
    pages.push(up);
  }
  const mode = modeSchema.parse(form.get("mode") ?? "auto");
  const r = await extractInvoice(pages, mode);
  if (!r.ok) return { error: r.error };
  const d = r.data;
  const receipt = mode === "receipt" || (mode === "auto" && looksLikeReceipt({ documentType: d.documentType, supplierName: d.supplierName }));
  const storeName = knownStore(d.supplierName);
  const suppliers = await db.supplier.findMany({ where: { active: true }, select: { id: true, name: true } });
  const supplier = (storeName && suppliers.find((s) => s.name.toLowerCase() === storeName.toLowerCase())) || suggestSupplier(storeName ?? d.supplierName, suppliers) || suggestSupplier(d.supplierName, suppliers);
  const iso = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const date = iso(d.invoiceDate);
  const order = supplier && !receipt ? pickOrder(await candidateOrders(), supplier.id, date) : null;
  const lines = d.lines.map((l) => {
    const tidy = receipt ? expandReceiptText(l.description) : null;
    return {
      kind: l.kind as LineKind,
      sku: l.sku ?? tidy?.sku ?? null,
      description: tidy?.text || l.description,
      packText: l.packText,
      orderedQty: l.qtyOrdered,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    };
  });
  // Tax becomes its own line so the lines always add up to what's paid.
  if (d.tax && Math.abs(d.tax) >= 0.005) lines.push({ kind: "tax", sku: null, description: "Sales tax", packText: null, orderedQty: null, qty: 1, unitPrice: d.tax, lineTotal: d.tax });
  const math = checkInvoiceMath({ lines, subtotal: d.subtotal, total: d.total });
  return {
    data: {
      receipt,
      supplierName: storeName ?? d.supplierName,
      invoiceNumber: d.invoiceNumber,
      invoiceDate: date,
      dueDate: iso(d.dueDate),
      total: d.total,
      paymentMethod: d.paymentMethod,
      supplierId: supplier?.id ?? null,
      orderId: order?.id ?? null,
      pages: pages.length,
      lines,
      issues: math.issues.map((i) => ({ kind: i.kind, lineIndex: i.lineIndex ?? null, message: i.message })),
    },
  };
}

const lineSchema = z.object({
  sku: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(300),
  qty: z.number().finite(),
  unitPrice: z.number().finite(),
  kind: z.enum(LINE_KINDS).optional(),
  packText: z.string().trim().max(60).nullable().optional(),
  orderedQty: z.number().finite().nullable().optional(),
});
const createSchema = z.object({
  supplierId: z.string().min(1, "Choose a supplier."),
  orderId: z.string().nullable(),
  invoiceNumber: z.string().trim().max(60).nullable(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the invoice date."),
  total: z.number().finite().nullable(),
  lines: z.array(lineSchema).max(500),
  extractedBy: z.enum(["claude", "manual"]),
  kind: z.enum(["invoice", "receipt"]).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paymentMethod: z.string().trim().max(60).nullable().optional(),
});

/**
 * Save a new invoice with page 1 (`file`). With `more=1` it returns the id
 * instead of redirecting, so the browser can send the other pages one by one
 * (each request stays well under the hosting upload limit).
 */
export async function saveNewInvoice(form: FormData): Promise<{ error: string; duplicateId?: string } | { id: string } | undefined> {
  await requireUser("MANAGER");
  let input: z.infer<typeof createSchema>;
  try {
    const parsed = createSchema.safeParse(JSON.parse(String(form.get("data") ?? "{}")));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
    input = parsed.data;
  } catch {
    return { error: "Check the form." };
  }
  const up = await readUpload(form);
  if (up && "error" in up) return up;
  const invoiceNumber = input.invoiceNumber || null;
  const dupe = await exactDuplicate(input.supplierId, invoiceNumber);
  if (dupe) return { error: `Invoice ${invoiceNumber} from this supplier is already in.`, duplicateId: dupe.id };
  const lines = input.lines.filter((l) => l.description || l.sku || l.qty || l.unitPrice).map((l) => ({ ...l, description: l.description || l.sku || "Item" }));
  const id = await createInvoice({ ...input, invoiceNumber, lines, image: up, orderId: input.kind === "receipt" ? null : input.orderId || null });
  revalidatePath("/invoices");
  if (form.get("more") === "1") return { id };
  redirect(`/invoices/${id}`);
}

/** Add one more page (photo or PDF) to an invoice. */
export async function addInvoicePage(id: string, form: FormData): Promise<{ error?: string; page?: number }> {
  await requireUser("MANAGER");
  const up = await readUpload(form);
  if (!up) return { error: "Choose a photo or PDF first." };
  if ("error" in up) return up;
  const r = await addPage(id, up);
  revalidatePath(`/invoices/${id}`);
  return typeof r === "number" ? { page: r } : r;
}

/** Remove an extra page (2, 3…). */
export async function removeInvoicePage(id: string, position: number) {
  await requireUser("MANAGER");
  await db.invoicePage.deleteMany({ where: { invoiceId: id, position: z.number().int().min(2).parse(position) } });
  revalidatePath(`/invoices/${id}`);
}

// ---- Detail page edits ------------------------------------------------------------------

async function editable(id: string) {
  const inv = await db.invoice.findUnique({ where: { id }, select: { status: true } });
  if (!inv) return { error: "That invoice is gone." };
  if (inv.status === "APPROVED") return { error: "Reopen the invoice to change it." };
  return null;
}

const after = async (id: string) => {
  await rematch(id);
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
};

const lineField = z.discriminatedUnion("field", [
  z.object({ field: z.literal("sku"), value: z.string().trim().max(60) }),
  z.object({ field: z.literal("description"), value: z.string().trim().max(300) }),
  z.object({ field: z.literal("qty"), value: z.coerce.number().finite() }),
  z.object({ field: z.literal("unitPrice"), value: z.coerce.number().finite() }),
  z.object({ field: z.literal("product"), value: z.string() }),
  z.object({ field: z.literal("kind"), value: z.enum(LINE_KINDS) }),
]);

export async function updateLine(lineId: string, input: { field: string; value: string }) {
  await requireUser("MANAGER");
  const v = lineField.safeParse(input);
  if (!v.success) return { error: "That doesn't look right." };
  const line = await db.invoiceLine.findUnique({ where: { id: lineId }, select: { invoiceId: true } });
  if (!line) return { error: "That line is gone." };
  const blocked = await editable(line.invoiceId);
  if (blocked) return blocked;
  const p = v.data;
  const data: Prisma.InvoiceLineUncheckedUpdateInput =
    p.field === "sku" ? { sku: p.value || null, supplierProductId: null } // re-map from the new code
    : p.field === "description" ? { description: p.value }
    : p.field === "qty" ? { qty: new Prisma.Decimal(p.value) }
    : p.field === "unitPrice" ? { unitPrice: new Prisma.Decimal(p.value.toFixed(2)) }
    : p.field === "kind" ? { kind: p.value, ...(p.value === "item" ? {} : { supplierProductId: null }) }
    : { supplierProductId: p.value || null };
  await db.invoiceLine.update({ where: { id: lineId }, data });
  await after(line.invoiceId);
}

export async function addLines(invoiceId: string, pasted?: string) {
  await requireUser("MANAGER");
  const blocked = await editable(invoiceId);
  if (blocked) return blocked;
  const rows = pasted ? parsePastedLines(pasted) : [{ sku: null, description: "", qty: 1, unitPrice: 0 }];
  if (!rows.length) return { error: "Nothing to add from that paste." };
  await db.invoiceLine.createMany({
    data: rows.map((r) => ({ invoiceId, sku: r.sku || null, description: r.description, qty: new Prisma.Decimal(r.qty), unitPrice: new Prisma.Decimal(r.unitPrice.toFixed(2)) })),
  });
  await after(invoiceId);
  return { added: rows.length };
}

export async function deleteLine(lineId: string) {
  await requireUser("MANAGER");
  const line = await db.invoiceLine.findUnique({ where: { id: lineId }, select: { invoiceId: true } });
  if (!line) return;
  const blocked = await editable(line.invoiceId);
  if (blocked) return blocked;
  await db.invoiceLine.delete({ where: { id: lineId } });
  await after(line.invoiceId);
}

const headerField = z.discriminatedUnion("field", [
  z.object({ field: z.literal("invoiceNumber"), value: z.string().trim().max(60) }),
  z.object({ field: z.literal("invoiceDate"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ field: z.literal("dueDate"), value: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/) }),
  z.object({ field: z.literal("total"), value: z.string().trim() }),
  z.object({ field: z.literal("orderId"), value: z.string() }),
  z.object({ field: z.literal("notes"), value: z.string().max(2000) }),
]);

export async function updateHeader(id: string, input: { field: string; value: string }) {
  await requireUser("MANAGER");
  const v = headerField.safeParse(input);
  if (!v.success) return { error: "That doesn't look right." };
  const p = v.data;
  if (p.field !== "notes") {
    const blocked = await editable(id);
    if (blocked) return blocked;
  }
  let data: Prisma.InvoiceUncheckedUpdateInput;
  if (p.field === "invoiceNumber") {
    const inv = await db.invoice.findUniqueOrThrow({ where: { id }, select: { supplierId: true } });
    const dupe = p.value ? await exactDuplicate(inv.supplierId, p.value) : null;
    if (dupe && dupe.id !== id) return { error: `Invoice ${p.value} from this supplier is already in.` };
    data = { invoiceNumber: p.value || null };
  } else if (p.field === "invoiceDate") data = { invoiceDate: parseISODate(p.value) };
  else if (p.field === "dueDate") data = { dueDate: p.value ? parseISODate(p.value) : null };
  else if (p.field === "total") {
    const n = p.value === "" ? null : Number(p.value.replace(/[$,]/g, ""));
    if (n != null && !Number.isFinite(n)) return { error: "Enter an amount." };
    data = { total: n == null ? null : new Prisma.Decimal(n.toFixed(2)) };
  } else if (p.field === "orderId") data = { orderId: p.value || null };
  else data = { notes: p.value || null };
  await db.invoice.update({ where: { id }, data });
  await after(id);
}

// ---- Approve / prices / delete ---------------------------------------------------------

const noteSchema = z.string().trim().max(500);

export async function approveInvoice(id: string, note?: string) {
  const user = await requireUser("MANAGER");
  const n = noteSchema.safeParse(note ?? "");
  if (!n.success) return { error: "Keep the note under 500 characters." };
  const inv = await db.invoice.findUnique({ where: { id }, select: { status: true } });
  if (!inv) return { error: "That invoice is gone." };
  if (approvalNeedsNote(inv.status) && !n.data) return { error: "Add a short note on why it's OK to approve with open issues." };
  await approve(id, user.name, n.data || null);
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
}

export async function reopenInvoice(id: string, note?: string) {
  const user = await requireUser("MANAGER");
  const n = noteSchema.safeParse(note ?? "");
  await reopen(id, user.name, n.success ? n.data || null : null);
  await after(id);
}

export async function saveAutoApprove(on: boolean) {
  await requireUser("MANAGER");
  await setAutoApprove(z.boolean().parse(on));
  if (on) {
    // Catch invoices that already qualify.
    const open = await db.invoice.findMany({ where: { status: "MATCHED" }, select: { id: true } });
    for (const i of open) await rematch(i.id);
  }
  revalidatePath("/invoices");
}

/** Email the credit request to the supplier (copy/mailto stay available on the sheet). */
export async function sendCredit(id: string, to: string, copyMe: boolean): Promise<{ error?: string; ok?: string }> {
  const user = await requireUser("MANAGER");
  const addr = z.string().trim().max(200).safeParse(to);
  if (!addr.success) return { error: "That email address doesn't look right." };
  const r = await sendCreditRequest({ invoiceId: id, to: addr.data, copyMe: Boolean(copyMe), by: { userId: user.userId, name: user.name } });
  if ("skipped" in r) return { error: "Email isn't set up yet — copy the text or open it in your email app instead." };
  if ("error" in r) return { error: r.error };
  // Remember the supplier's address for next time.
  const inv = await db.invoice.findUnique({ where: { id }, select: { supplierId: true, supplier: { select: { email: true } } } });
  if (inv && !inv.supplier.email) await db.supplier.update({ where: { id: inv.supplierId }, data: { email: r.to } });
  await recordEvent(id, { by: user.name, action: "credit-requested", note: `Emailed to ${r.to}${r.cc.length ? ` (copy to ${r.cc.join(", ")})` : ""}` });
  revalidatePath(`/invoices/${id}`);
  return { ok: `Sent to ${r.to}` };
}

/** Record (or re-apply) the invoice's prices in costing now. Approving does this automatically unless it's turned off. */
export async function updatePrices(id: string) {
  const user = await requireUser("MANAGER");
  const updated = await applyInvoicePrices(id, user.name);
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/prices");
  revalidatePath("/menu");
  return { updated };
}

/** Settings → Money: record prices in costing when an invoice is approved. */
export async function savePricesOnApprove(on: boolean) {
  await requireUser("MANAGER");
  await setPricesOnApprove(z.boolean().parse(on));
  revalidatePath("/invoices");
}

// ---- Linking lines to products --------------------------------------------------------------

/**
 * Accept the autopilot's suggestion for one line (or, with `ingredientId`,
 * create the product for a different ingredient; "" = a new ingredient).
 */
export async function acceptLinkSuggestion(invoiceId: string, lineId: string, ingredientId?: string | null): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const blocked = await editable(invoiceId);
  if (blocked) return blocked;
  const { suggestions } = await linkSuggestions(invoiceId);
  const s = suggestions.find((x) => x.lineId === lineId);
  if (!s) return { error: "That line is already linked." };
  await applyLinkSuggestion(lineId, s.suggestion, ingredientId === undefined ? {} : { ingredientId: z.string().max(64).nullable().parse(ingredientId) });
  await after(invoiceId);
  revalidatePath("/prices");
  return {};
}

/** Accept every suggestion on the invoice at once. */
export async function acceptAllLinkSuggestions(invoiceId: string, ingredientChoices: Record<string, string> = {}): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  const blocked = await editable(invoiceId);
  if (blocked) return blocked;
  const choices = z.record(z.string().max(64), z.string().max(64)).safeParse(ingredientChoices);
  if (!choices.success) return { error: "That doesn't look right." };
  const { suggestions } = await linkSuggestions(invoiceId);
  let linked = 0;
  let created = 0;
  for (const s of suggestions) {
    if (s.suggestion.kind === "skip") continue;
    const choice = choices.data[s.lineId];
    await applyLinkSuggestion(s.lineId, s.suggestion, choice === undefined ? {} : { ingredientId: choice || null });
    if (s.suggestion.kind === "create") created++;
    else linked++;
  }
  await after(invoiceId);
  revalidatePath("/prices");
  revalidatePath("/ingredients");
  const parts = [linked && `linked ${linked} line${linked === 1 ? "" : "s"}`, created && `added ${created} new product${created === 1 ? "" : "s"}`].filter(Boolean);
  return { message: parts.length ? `Done: ${parts.join(", ")}.` : "Nothing left to link." };
}

export async function deleteInvoice(id: string) {
  await requireUser("MANAGER");
  await db.invoice.delete({ where: { id } });
  await db.setting.deleteMany({ where: { key: { in: [`invoices.history.${id}`, alertedKey(id), `invoice.credit.${id}`] } } });
  revalidatePath("/invoices");
  redirect("/invoices");
}

export async function saveTolerance(kind: "price" | "qty", value: string) {
  await requireUser("MANAGER");
  const n = Number(value.replace(/[$,]/g, ""));
  if (value === "" || !Number.isFinite(n) || n < 0) return { error: "Enter zero or more." };
  await db.setting.upsert({ where: { key: TOLERANCE_KEYS[kind] }, create: { key: TOLERANCE_KEYS[kind], value: String(n) }, update: { value: String(n) } });
  const open = await db.invoice.findMany({ where: { status: { not: "APPROVED" } }, select: { id: true } });
  for (const i of open) await rematch(i.id);
  revalidatePath("/invoices");
}

export async function attachFile(id: string, form: FormData) {
  await requireUser("MANAGER");
  const up = await readUpload(form);
  if (!up) return { error: "Choose a photo or PDF first." };
  if ("error" in up) return up;
  await db.invoice.update({ where: { id }, data: { image: Buffer.from(up.bytes), imageType: up.type } });
  revalidatePath(`/invoices/${id}`);
}

// ---- Accounting export settings ---------------------------------------------------------

const accountField = z.union([
  z.enum(["billsDefault", "billsOther", "salesDefault", "salesTax", "tips", "clearing", "termsDays"]),
  z.object({ bills: z.string().min(1).max(80) }),
  z.object({ sales: z.string().min(1).max(80) }),
]);

export async function saveAccountField(field: z.infer<typeof accountField>, value: string) {
  await requireUser("MANAGER");
  const f = accountField.safeParse(field);
  const v = z.string().trim().max(120).safeParse(value);
  if (!f.success || !v.success) return { error: "That doesn't look right." };
  if (f.data === "termsDays") {
    const n = Number(v.data);
    if (!Number.isInteger(n) || n < 0 || n > 365) return { error: "Enter whole days, 0–365." };
  }
  await saveAccount(f.data, v.data);
  revalidatePath("/invoices/exports");
}

export async function saveSalesTaxRate(value: string) {
  await requireUser("MANAGER");
  const raw = value.trim().replace(/%$/, "");
  if (raw === "") {
    await saveTaxRate(null);
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n >= 50) return { error: "Enter a percent like 8." };
    await saveTaxRate(n === 0 ? null : n / 100);
  }
  revalidatePath("/invoices/exports");
}

/** Add a supplier from the invoice form (a store run, a new distributor). Reuses one with the same name. */
export async function quickAddSupplier(rawName: string): Promise<{ error?: string; supplier?: { id: string; name: string } }> {
  await requireUser("MANAGER");
  const name = String(rawName ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) return { error: "Type the supplier's name." };
  const existing = await db.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true, active: true } });
  if (existing) {
    if (!existing.active) await db.supplier.update({ where: { id: existing.id }, data: { active: true } });
    return { supplier: { id: existing.id, name: existing.name } };
  }
  const supplier = await db.supplier.create({ data: { name, kind: "DISTRIBUTOR", leadTimeDays: 0, deliveryDays: [] }, select: { id: true, name: true } });
  revalidatePath("/settings");
  revalidatePath("/ordering");
  revalidatePath("/invoices");
  return { supplier };
}

/** Approve several clean (matched) invoices at once. Ones with open issues need a note, one by one. */
export async function approveMatched(ids: string[]): Promise<{ error?: string; message?: string }> {
  const user = await requireUser("MANAGER");
  const p = z.array(z.string().min(1).max(64)).min(1).max(500).safeParse(ids);
  if (!p.success) return { error: "Pick at least one invoice." };
  const clean = await db.invoice.findMany({ where: { id: { in: p.data }, status: "MATCHED" }, select: { id: true } });
  for (const inv of clean) await approve(inv.id, user.name, null);
  revalidatePath("/invoices");
  const skipped = p.data.length - clean.length;
  if (!clean.length) return { error: "None of those are matched. Invoices with issues are approved one by one, with a note." };
  return { message: `Approved ${clean.length} invoice${clean.length === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped: not a clean match.` : ""}` };
}
