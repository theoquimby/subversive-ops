"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FOCUS_IDS, type Focus } from "@/domain/focus";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { dismissFocusPrompt, setUserFocus } from "@/server/services/focus";

// "What I look after": your own on Settings → Notifications and the Overview prompt;
// anyone's from their panel on Team (managers only). It changes what the Overview and
// the briefs lead with, never what anyone may do.

const focusSchema = z.array(z.enum(FOCUS_IDS)).max(FOCUS_IDS.length);

const refresh = () => {
  revalidatePath("/");
  revalidatePath("/brief");
  revalidatePath("/settings/notifications");
  revalidatePath("/team");
};

export async function saveMyFocus(focus: Focus[]): Promise<{ error?: string; focus?: Focus[] }> {
  const s = await requireUser("MANAGER");
  const v = focusSchema.safeParse(focus);
  if (!v.success) return { error: "Couldn't save that." };
  const saved = await setUserFocus(s.userId, v.data);
  refresh();
  return { focus: saved };
}

export async function saveFocusFor(userId: string, focus: Focus[]): Promise<{ error?: string; focus?: Focus[] }> {
  await requireUser("MANAGER");
  const id = z.string().min(1).max(64).safeParse(userId);
  const v = focusSchema.safeParse(focus);
  if (!id.success || !v.success) return { error: "Couldn't save that." };
  const user = await db.user.findUnique({ where: { id: id.data }, select: { id: true } });
  if (!user) return { error: "That login no longer exists." };
  const saved = await setUserFocus(user.id, v.data);
  refresh();
  return { focus: saved };
}

export async function notNowFocus(): Promise<{ error?: string }> {
  const s = await requireUser("MANAGER");
  await dismissFocusPrompt(s.userId);
  revalidatePath("/");
  return {};
}
