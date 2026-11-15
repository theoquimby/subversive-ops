"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MORNING_HOURS } from "@/domain/morningBrief";
import { requireUser } from "@/server/auth";
import { saveMorningHour } from "@/server/services/morningBrief";

/** When the morning brief goes out (business-local hour). */
export async function setMorningHour(hour: number): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = z.number().int().refine((h) => (MORNING_HOURS as readonly number[]).includes(h)).safeParse(hour);
  if (!v.success) return { error: "Pick a time between 7 and 11am." };
  await saveMorningHour(v.data);
  revalidatePath("/brief");
  return {};
}
