"use server";

import { addDays } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { friendlySquareError } from "@/server/integrations/square-http";
import { syncLabor } from "@/server/services/labor";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/** Pull team, wages and timecards from Square for the week on screen. Manually edited or approved cards are kept. */
export async function syncLaborWeek(week: string): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  const p = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(week);
  if (!p.success) return { error: "Pick a week first." };
  try {
    const r = await syncLabor(p.data, addDays(p.data, 7));
    if ("skipped" in r) return { error: r.skipped };
    revalidatePath("/labor");
    return { message: `Synced ${r.timecards} timecards${r.keptEdited ? ` (kept ${r.keptEdited} you edited)` : ""}.` };
  } catch (e) {
    return { error: friendlySquareError(e) };
  }
}
