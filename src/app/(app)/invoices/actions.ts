"use server";

import { parseISODate } from "@/domain/dates";
import { parsePastedLines, pickOrder, suggestSupplier } from "@/domain/invoiceMatch";
import { requireUser } from "@/server/auth";
import { claudeReady, CLAUDE_NOT_SET_UP } from "@/server/integrations/claude";
import { db } from "@/server/db";
import { approvalNeedsNote } from "@/domain/invoiceHistory";
import { sendCreditRequest } from "@/server/email/outbound";
import { saveAccount, saveTaxRate } from "@/server/services/accounting";
import {
  alertedKey,
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
  updatePricesFromInvoice,
} from "@/server/services/invoices";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

async function readUpload(form: FormData): Promise<{ bytes: Uint8Array; type: string } | { error: string } | null> {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_FILE_BYTES) return { error: "That file is over 8 MB. Try a photo instead of a scan, or split the PDF." };
  if (!ACCEPTED.includes(f.type)) return { error: "Upload a photo (JPEG/PNG) or a PDF." };
  return { bytes: new Uint8Array(await f.arrayBuffer()), type: f.type };
}

/** Read an invoice photo/PDF with Claude and suggest the supplier and order. */
export async function readInvoice(form: FormData) {
  await requireUser("MANAGER");
  if (!(await claudeReady())) return { error: CLAUDE_NOT_SET_UP };
  const up = await readUpload(form);
  if (!up) return { error: "Choose a photo or PDF first." };
  if ("error" in up) return up;
  const r = await extractInvoice(up.bytes, up.type);
  if (!r.ok) return { error: r.error };
  const suppliers = await db.supplier.findMany({ where: { active: true }, select: { id: true, name: true } });
  const supplier = suggestSupplier(r.data.supplierName, suppliers);
  const date = r.data.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(r.data.invoiceDate) ? r.data.invoiceDate : null;
  const order = supplier ? pickOrder(await candidateOrders(), supplier.id, date) : null;
  return {
    data: {
      ...r.data,
      invoiceDate: date,
      supplierId: supplier?.id ?? null,
      orderId: order?.id ?? null,
      lines: r.data.lines.map((l) => ({ sku: l.sku, description: l.description, qty: l.qty, unitPrice: l.unitPrice })),
    },
  };
}

const lineSchema = z.object({ sku: z.string().trim().max(60).nullable().optional(), description: z.string().trim().max(300), qty: z.number().finite(), unitPrice: z.number().finite() });
const createSchema = z.object({
  supplierId: z.string().min(1, "Choose a supplier."),
  orderId: z.string().nullable(),
  invoiceNumber: z.string().trim().max(60).nullable(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the invoice date."),
  total: z.number().finite().nullable(),
  lines: z.array(lineSchema).max(500),
  extractedBy: z.enum(["claude", "manual"]),
});

export async function saveNewInvoice(form: FormData) {
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
  const id = await createInvoice({ ...input, invoiceNumber, lines, image: up, orderId: input.orderId || null });
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
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

export async function updatePrices(id: string) {
  const user = await requireUser("MANAGER");
  const changes = await updatePricesFromInvoice(id);
  if (changes.length) await recordEvent(id, { by: user.name, action: "prices-updated", note: `${changes.length} price${changes.length === 1 ? "" : "s"} recorded` });
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/prices");
  revalidatePath("/menu");
  return { updated: changes.length };
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
