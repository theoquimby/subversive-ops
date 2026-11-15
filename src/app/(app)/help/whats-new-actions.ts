"use server";

import { z } from "zod";
import { requireUser } from "@/server/auth";
import { markWhatsNewSeen } from "@/server/services/whatsNew";
import { WHATS_NEW } from "@/help/whatsNew";

const KNOWN = new Set(WHATS_NEW.map((e) => e.id));

/** The What's new sheet was closed: these entries are no longer "new" for this person. */
export async function seenWhatsNew(ids: string[]): Promise<{ error?: string }> {
  const me = await requireUser();
  const v = z.array(z.string().max(120)).max(200).safeParse(ids);
  if (!v.success) return { error: "Couldn't save that." };
  await markWhatsNewSeen(me.userId, v.data.filter((id) => KNOWN.has(id)));
  return {};
}
