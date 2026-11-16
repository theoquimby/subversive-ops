"use server";

/**
 * The Feedback button (every signed-in page, staff and managers): send a
 * note, and read back your own notes with their status and any reply.
 */

import { z } from "zod";
import { requireUser } from "@/server/auth";
import { createFeedback, myFeedback, type MyFeedback } from "@/server/services/feedback";

const Input = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  kind: z.string().max(20),
  body: z.string().max(20_000),
  path: z.string().max(2000).nullish(),
  pageTitle: z.string().max(500).nullish(),
  device: z.string().max(200).nullish(),
  appVersion: z.string().max(40).nullish(),
  // ≤ 1 MB photo as base64 is about 1.4 MB of text.
  photo: z.string().max(1_500_000).nullish(),
});

export async function sendFeedback(raw: unknown): Promise<{ error?: string }> {
  const me = await requireUser();
  const v = Input.safeParse(raw);
  if (!v.success) return { error: "Couldn't read that note. Reload the page and try again." };
  const r = await createFeedback(v.data, me);
  return "error" in r ? r : {};
}

export async function myFeedbackNotes(): Promise<{ notes: MyFeedback[] } | { error: string }> {
  const me = await requireUser();
  try {
    return { notes: await myFeedback(me.userId) };
  } catch (e) {
    console.error("feedback: listing my notes failed", e);
    return { error: "Couldn't load your notes just now." };
  }
}
