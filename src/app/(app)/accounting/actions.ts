"use server";

import { JOURNAL_ACCOUNT_KEYS } from "@/domain/salesJournal";
import { requireUser } from "@/server/auth";
import { saveSalesTaxSettings } from "@/server/services/monthEnd";
import { saveJournalSettings, sendJournalEntries, sendJournalEntry, type JournalChange } from "@/server/services/monthEndJournal";
import { QuickBooksNotConnectedError } from "@/server/services/quickbooks";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const done = () => revalidatePath("/accounting");
const message = (e: unknown) => (e instanceof QuickBooksNotConnectedError || e instanceof Error ? e.message : "Something went wrong. Try again.");

const taxInput = z.union([
  z.object({ field: z.literal("rate"), value: z.number().gt(0, "Enter a rate above 0%").lt(0.3, "That rate looks too high") }),
  z.object({ field: z.literal("filing"), value: z.enum(["quarterly", "monthly", "annual"]) }),
  z.object({ field: z.literal("quarterStartMonth"), value: z.number().int().min(1).max(12) }),
  z.object({ field: z.literal("jurisdiction"), value: z.string().trim().min(1, "Enter where the rate applies").max(80) }),
]);

/** Sales tax settings: rate, filing frequency, first month of a quarter, jurisdiction label. */
export async function saveTaxSetting(input: unknown): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = taxInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "That isn't a valid setting." };
  await saveSalesTaxSettings({ [p.data.field]: p.data.value });
  done();
  return {};
}

const journalInput = z.union([
  z.object({ field: z.literal("enabled"), value: z.boolean() }),
  z.object({ field: z.literal("mode"), value: z.enum(["daily", "monthly"]) }),
  z.object({ field: z.literal("sendFrom"), value: date.nullable() }),
  z.object({ field: z.literal("account"), key: z.enum(JOURNAL_ACCOUNT_KEYS), value: z.string().regex(/^[\w-]{1,40}$/).nullable() }),
  z.object({ field: z.literal("useSuggestions") }),
]);

/** Sales to QuickBooks: on/off, daily or monthly, start date, and one account choice at a time. */
export async function saveJournalSetting(input: unknown): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = journalInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "That isn't a valid setting." };
  try {
    await saveJournalSettings(p.data as JournalChange);
  } catch (e) {
    return { error: message(e) };
  }
  done();
  return {};
}

/** Send (or update) one sales entry. */
export async function sendJournal(key: string): Promise<{ error?: string; message?: string }> {
  const user = await requireUser("MANAGER");
  if (!z.string().max(20).safeParse(key).success) return { error: "That entry isn't one we know." };
  const r = await sendJournalEntry(key, user.name);
  done();
  return r.ok ? { message: r.message } : { error: r.error };
}

/** Send every ready entry in the period that's new or changed. */
export async function sendJournalPeriod(from: string, to: string): Promise<{ error?: string; message?: string; left?: number }> {
  const user = await requireUser("MANAGER");
  const p = z.object({ from: date, to: date }).safeParse({ from, to });
  if (!p.success) return { error: "Pick a period first." };
  try {
    const r = await sendJournalEntries(p.data, user.name);
    done();
    const parts = [r.sent ? `Sent ${r.sent}` : "", r.updated ? `updated ${r.updated}` : ""].filter(Boolean).join(", ");
    if (r.failed) return { error: `${parts ? `${parts}. ` : ""}${r.failed} didn't go: ${r.firstError}`, left: r.left };
    return { message: parts ? `${parts.replace(/^./, (c) => c.toUpperCase())}.` : "Nothing new to send.", left: r.left };
  } catch (e) {
    return { error: message(e) };
  }
}
