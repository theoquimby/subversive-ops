"use server";

import { requireUser } from "@/server/auth";
import { friendlySquareError } from "@/server/integrations/square-http";
import { isSquareConnected } from "@/server/services/square";
import { dailySync } from "@/server/services/square-sync";
import { parseImpactPct } from "@/domain/events";
import { setManualAdjustment } from "@/server/services/forecasting";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function syncNow(): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  if (!(await isSquareConnected())) return { error: "Connect Square first (Settings → Square)." };
  try {
    const r = await dailySync();
    revalidatePath("/", "layout");
    return { message: "catalog" in r ? `Synced ${r.orders} orders, ${r.catalog} catalog entries and ${r.timecards} timecards.` : r.skipped };
  } catch (e) {
    return { error: friendlySquareError(e) };
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
