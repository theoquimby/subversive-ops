"use server";

import { requireUser } from "@/server/auth";
import { saveGuestsPerCheck } from "@/server/services/covers";
import { revalidatePath } from "next/cache";

/** Guests per Square check (covers = checks × this). */
export async function setGuestsPerCheck(raw: string): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0.5 || n > 8) return { error: "Between 0.5 and 8 guests per check." };
  await saveGuestsPerCheck(n);
  revalidatePath("/schedule");
  revalidatePath("/labor");
  revalidatePath("/brief");
}
