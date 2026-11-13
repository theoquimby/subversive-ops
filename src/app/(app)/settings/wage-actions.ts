"use server";

import { requireUser } from "@/server/auth";
import { markRulesReviewed, setWageAuto } from "@/server/services/labor-rules";
import { revalidatePath } from "next/cache";

const refresh = () => {
  revalidatePath("/settings", "layout");
  revalidatePath("/team");
  revalidatePath("/labor");
  revalidatePath("/schedule");
};

export async function toggleWageAuto(on: boolean): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await setWageAuto(on);
  refresh();
  return {};
}

export async function reviewRulesToday(): Promise<{ error?: string }> {
  const s = await requireUser("MANAGER");
  await markRulesReviewed(s.name);
  refresh();
  return {};
}
