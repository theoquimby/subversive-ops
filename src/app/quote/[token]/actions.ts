"use server";

import { isQuoteToken } from "@/domain/privateEvents";
import { acceptQuote } from "@/server/services/privateEvents";
import { revalidatePath } from "next/cache";

/** Public: the client accepts their quote. The random link is the only key, so it's checked first. */
export async function acceptQuoteAction(token: string, name: string): Promise<{ error?: string; ok?: true }> {
  if (!isQuoteToken(token)) return { error: "This link isn't valid." };
  const r = await acceptQuote(token, typeof name === "string" ? name : "");
  if (r.ok) {
    revalidatePath(`/quote/${token}`);
    revalidatePath("/events/private");
  }
  return r;
}
