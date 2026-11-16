"use server";

import { payPeriodFor } from "@/domain/payroll";
import { requireUser } from "@/server/auth";
import { getLaborRules } from "@/server/services/labor-rules";
import { markHandedOff } from "@/server/services/payrollHandoff";
import { revalidatePath } from "next/cache";

/** Mark a pay period as entered in the payroll provider (or undo it). */
export async function setHandedOff(start: string, done: boolean): Promise<{ error?: string; ok?: string }> {
  const me = await requireUser("MANAGER");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { error: "Pick a pay period." };
  const r = await markHandedOff(payPeriodFor(start, await getLaborRules()), me.name, done);
  revalidatePath("/labor", "layout");
  return r;
}
