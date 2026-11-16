import "server-only";
import { cache } from "react";
import { parseFocus, type Focus } from "@/domain/focus";
import { db } from "../db";

/**
 * "What I look after" per login (User.focus): what the Overview and the
 * briefs lead with. Empty = everything. See domain/focus.ts.
 */

/** A login's focus (once per request). */
export const userFocus = cache(async (userId: string): Promise<Focus[]> => {
  const u = await db.user.findUnique({ where: { id: userId }, select: { focus: true } });
  return parseFocus(u?.focus ?? []);
});

export async function setUserFocus(userId: string, focus: Focus[]): Promise<Focus[]> {
  const clean = parseFocus(focus);
  await db.user.update({ where: { id: userId }, data: { focus: clean } });
  return clean;
}

const promptKey = (userId: string) => `focus.prompt.dismissed.${userId}`;

/** Whether this manager said "Not now" to the Overview's "Pick what you look after" prompt. */
export async function focusPromptDismissed(userId: string): Promise<boolean> {
  return (await db.setting.findUnique({ where: { key: promptKey(userId) } })) != null;
}

export async function dismissFocusPrompt(userId: string) {
  const key = promptKey(userId);
  const value = new Date().toISOString();
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
