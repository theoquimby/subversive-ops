"use server";

import { addDays } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { friendlySquareError } from "@/server/integrations/square-http";
import { syncLabor } from "@/server/services/labor";
import { currentPeriod } from "@/server/services/payroll";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Pull team, wages and timecards from Square for the whole pay period containing
 * `start` (one or two weeks, per the labor rules). Manually edited or approved cards are kept.
 */
export async function syncLaborPeriod(start: string): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  const p = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(start);
  if (!p.success) return { error: "Pick a pay period first." };
  try {
    const period = await currentPeriod(p.data);
    const r = await syncLabor(period.start, addDays(period.end, 1));
    if ("skipped" in r) return { error: r.skipped };
    revalidatePath("/labor");
    return { message: `Synced ${r.timecards} timecards${r.keptEdited ? ` (kept ${r.keptEdited} you edited)` : ""}.` };
  } catch (e) {
    return { error: friendlySquareError(e) };
  }
}
