"use server";

import { requireUser } from "@/server/auth";
import { squareConfigured } from "@/server/env";
import { parseImpactPct } from "@/domain/events";
import { setManualAdjustment } from "@/server/services/forecasting";
import { backfillSales, dailySync } from "@/server/services/sales";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function syncNow(): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  if (!squareConfigured()) return { error: "Add the Square access token and location ID first." };
  try {
    const r = await dailySync();
    revalidatePath("/", "layout");
    return { message: "catalog" in r ? `Synced ${r.orderLines} sold items, ${r.catalog} catalog entries.` : r.skipped };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function backfill(days: number): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  if (!squareConfigured()) return { error: "Add the Square access token and location ID first." };
  try {
    const n = await backfillSales(Math.min(Math.max(days, 7), 400));
    revalidatePath("/", "layout");
    return { message: `Imported ${n} sold items from the last ${days} days.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const adjustmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pct: z.string().max(10),
  reason: z.string().max(200),
});

/** Manual override for one day: "+15" / "-20" percent (empty clears) plus why. */
export async function saveAdjustment(input: z.input<typeof adjustmentSchema>): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = adjustmentSchema.safeParse(input);
  if (!p.success) return { error: "Check the adjustment." };
  const m = parseImpactPct(p.data.pct);
  if (m == null || m <= 0) return { error: "Enter a percent between −99 and +500, like +15 or −20." };
  await setManualAdjustment(p.data.date, m === 1 ? null : m, p.data.reason);
  revalidatePath("/sales");
  return {};
}
