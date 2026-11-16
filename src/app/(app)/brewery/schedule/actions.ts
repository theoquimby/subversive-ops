"use server";

import { requireUser } from "@/server/auth";
import { regenerateCalendarToken } from "@/server/services/breweryWrite";
import { revalidatePath } from "next/cache";

/** A new calendar address: the old one stops working (calendars subscribed to it go quiet). */
export async function regenerateCalendarAction(): Promise<{ ok: string }> {
  await requireUser("MANAGER");
  await regenerateCalendarToken();
  revalidatePath("/brewery/schedule");
  return { ok: "New calendar address made. Add it to your calendar again; the old one no longer works." };
}
