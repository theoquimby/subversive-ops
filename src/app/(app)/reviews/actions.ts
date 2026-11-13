"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { analyzeReviews, importGoogleReviews, importPastedReviews, saveReviewSetting, SETTING_PLACE_ID, SETTING_TONE } from "@/server/services/reviews";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => {
  revalidatePath("/reviews");
  revalidatePath("/brief");
};

const pasteSchema = z.object({ text: z.string().min(1).max(200_000), source: z.enum(["GOOGLE", "YELP", "TRIPADVISOR", "MANUAL"]) });

export async function importPasted(input: z.infer<typeof pasteSchema>) {
  await requireUser("MANAGER");
  const v = pasteSchema.safeParse(input);
  if (!v.success) return { error: "Paste at least one review." };
  const res = await importPastedReviews(v.data.text, v.data.source);
  refresh();
  if (res.parsed === 0) return { error: "Couldn't find any reviews in that text. Separate reviews with a blank line." };
  return { added: res.added, skipped: res.skipped };
}

export async function importGoogle() {
  await requireUser("MANAGER");
  const res = await importGoogleReviews();
  refresh();
  return res;
}

export async function redraft(id: string) {
  await requireUser("MANAGER");
  await analyzeReviews([z.string().parse(id)]);
  refresh();
}

export async function saveReplyDraft(id: string, text: string) {
  await requireUser("MANAGER");
  const v = z.string().max(5000).safeParse(text);
  if (!v.success) return { error: "That reply is too long." };
  await db.review.update({ where: { id }, data: { replyDraft: v.data.trim() || null } });
  refresh();
}

export async function setReplied(id: string, replied: boolean) {
  await requireUser("MANAGER");
  await db.review.update({ where: { id }, data: { replied: z.boolean().parse(replied) } });
  refresh();
}

export async function deleteReview(id: string) {
  await requireUser("MANAGER");
  await db.review.delete({ where: { id } });
  await db.setting.deleteMany({ where: { key: `reviews.hint.${id}` } });
  refresh();
}

export async function saveSetting(field: "placeId" | "tone", raw: string) {
  await requireUser("MANAGER");
  const value = raw.trim();
  if (field === "placeId" && value && !/^[A-Za-z0-9_-]{10,}$/.test(value)) return { error: "That doesn't look like a Place ID (it starts with ChIJ…)" };
  if (value.length > 1000) return { error: "Keep it under 1,000 characters" };
  await saveReviewSetting(field === "placeId" ? SETTING_PLACE_ID : SETTING_TONE, value);
  refresh();
}
