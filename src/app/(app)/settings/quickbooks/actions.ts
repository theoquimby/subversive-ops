"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { friendlyQuickBooksError } from "@/server/integrations/quickbooks";
import {
  autoMatchSuppliers,
  clearQuickbooksProblems,
  disconnectQuickBooks,
  linkSupplier,
  QuickBooksNotConnectedError,
  refreshAccounts,
  refreshVendors,
  saveMapping,
  sendInvoiceToQuickBooks,
  sendPending,
  setQuickbooksEnvironment,
  testQuickBooksConnection,
  type MappingChange,
} from "@/server/services/quickbooks";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TestResult } from "../connections/actions";

const TEST_KEY = "connections.test.quickbooks";

const refresh = () => {
  revalidatePath("/settings/quickbooks");
  revalidatePath("/settings/connections");
  revalidatePath("/settings");
};

const message = (e: unknown) => (e instanceof QuickBooksNotConnectedError ? e.message : friendlyQuickBooksError(e));

async function remember(ok: boolean, text: string): Promise<TestResult> {
  const r: TestResult = { ok, message: text, at: new Date().toISOString() };
  const value = JSON.stringify(r);
  await db.setting.upsert({ where: { key: TEST_KEY }, create: { key: TEST_KEY, value }, update: { value } });
  return r;
}

/** Test button: reads CompanyInfo and says which company it reached. */
export async function testQuickBooks(): Promise<TestResult> {
  await requireUser("MANAGER");
  try {
    const r = await testQuickBooksConnection();
    refresh();
    return remember(true, `Working — connected to ${r.companyName}${r.environment === "sandbox" ? " (a test company)" : ""}.`);
  } catch (e) {
    if (e instanceof QuickBooksNotConnectedError) return { ok: false, message: e.message, at: new Date().toISOString() };
    return remember(false, message(e));
  }
}

export async function disconnectQuickBooksAction(): Promise<{ error?: string; note?: string }> {
  await requireUser("MANAGER");
  const r = await disconnectQuickBooks();
  await db.setting.deleteMany({ where: { key: TEST_KEY } });
  refresh();
  return r.revokeError ? { note: `Disconnected here. QuickBooks didn't confirm (${r.revokeError}) — you can also remove the app in QuickBooks under Settings → Apps.` } : {};
}

export async function setQuickBooksEnvironmentAction(environment: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = z.enum(["production", "sandbox"]).safeParse(environment);
  if (!v.success) return { error: "Pick Real company or Test company." };
  try {
    await setQuickbooksEnvironment(v.data);
  } catch (e) {
    return { error: (e as Error).message };
  }
  refresh();
  return {};
}

const accountId = z.string().regex(/^[\w-]{1,40}$/).nullable();
const changeSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("defaultAccountId"), value: accountId }),
  z.object({ field: z.literal("otherAccountId"), value: accountId }),
  z.object({ field: z.literal("category"), key: z.string().min(1).max(120), value: accountId }),
  z.object({ field: z.literal("supplier"), key: z.string().min(1).max(60), value: accountId }),
  z.object({ field: z.literal("autoSend"), value: z.boolean() }),
  z.object({ field: z.literal("sendFrom"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
]);

/** Save one choice from "Choose accounts". Empty string from a select means "use the default". */
export async function saveQuickBooksMapping(input: unknown): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const raw = input && typeof input === "object" && "value" in input && (input as { value: unknown }).value === "" ? { ...input, value: null } : input;
  const p = changeSchema.safeParse(raw);
  if (!p.success) return { error: "That choice couldn't be saved. Try again." };
  try {
    await saveMapping(p.data as MappingChange);
  } catch (e) {
    return { error: message(e) };
  }
  refresh();
  revalidatePath("/invoices");
  return {};
}

/** Re-read the chart of accounts and the vendor list from QuickBooks. */
export async function refreshQuickBooksLists(): Promise<{ error?: string; accounts?: number; vendors?: number }> {
  await requireUser("MANAGER");
  try {
    const [a, v] = await Promise.all([refreshAccounts(), refreshVendors()]);
    refresh();
    return { accounts: a.length, vendors: v.length };
  } catch (e) {
    return { error: message(e) };
  }
}

/** vendorId: a QuickBooks vendor id, "new" to create one, or "" to unlink. */
export async function linkSupplierToVendor(supplierId: string, vendorId: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const s = z.string().min(1).max(60).safeParse(supplierId);
  const v = z.union([z.literal("new"), z.literal(""), z.string().regex(/^[\w-]{1,40}$/)]).safeParse(vendorId);
  if (!s.success || !v.success) return { error: "That vendor couldn't be saved. Try again." };
  try {
    await linkSupplier(s.data, v.data === "" ? null : v.data);
  } catch (e) {
    return { error: message(e) };
  }
  refresh();
  return {};
}

export async function matchSuppliersToVendors(): Promise<{ error?: string; matched?: number }> {
  await requireUser("MANAGER");
  try {
    const r = await autoMatchSuppliers();
    refresh();
    return r;
  } catch (e) {
    return { error: message(e) };
  }
}

export async function sendInvoiceToQuickBooksAction(invoiceId: string): Promise<{ error?: string; message?: string }> {
  const me = await requireUser("MANAGER");
  const id = z.string().min(1).max(60).safeParse(invoiceId);
  if (!id.success) return { error: "That invoice is gone." };
  const r = await sendInvoiceToQuickBooks(id.data, me.name);
  revalidatePath(`/invoices/${id.data}`);
  revalidatePath("/invoices");
  revalidatePath("/settings/quickbooks");
  return r.ok ? { message: r.message } : { error: r.error };
}

/** "Send all waiting": a batch at a time; the page calls again while `remaining` > 0. */
export async function sendWaitingToQuickBooks(): Promise<{ error?: string; sent: number; failed: number; remaining: number }> {
  const me = await requireUser("MANAGER");
  try {
    const r = await sendPending(me.name);
    revalidatePath("/invoices");
    refresh();
    return { ...r, ...(r.firstError ? { error: r.firstError } : {}) };
  } catch (e) {
    return { error: message(e), sent: 0, failed: 0, remaining: 0 };
  }
}

export async function clearQuickBooksProblems() {
  await requireUser("MANAGER");
  await clearQuickbooksProblems();
  refresh();
}
