"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FEEDBACK_STATUSES, feedbackStatusLabel, type FeedbackStatus } from "@/domain/feedback";
import { requireUser } from "@/server/auth";
import { setFeedbackStatus, updateFeedback } from "@/server/services/feedback";

const Status = z.enum(FEEDBACK_STATUSES.map((s) => s.value) as [FeedbackStatus, ...FeedbackStatus[]]);
const Ids = z.array(z.string().min(1).max(64)).min(1).max(2000);

const refresh = () => {
  revalidatePath("/settings", "layout");
  revalidatePath("/brief");
};

/** Bulk: the selected notes get one status. */
export async function setStatusFor(ids: string[], status: string): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  const i = Ids.safeParse(ids);
  const s = Status.safeParse(status);
  if (!i.success || !s.success) return { error: "Couldn't change those." };
  const n = await setFeedbackStatus(i.data, s.data);
  refresh();
  return { message: `${n} marked ${feedbackStatusLabel(s.data).toLowerCase()}.` };
}

/** The drawer: a note's status and the reply its sender sees. */
export async function saveFeedback(id: string, patch: { status?: string; note?: string | null }): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = z.object({ id: z.string().min(1).max(64), status: Status.optional(), note: z.string().max(2000).nullable().optional() }).safeParse({ id, ...patch });
  if (!v.success) return { error: v.error.issues.some((x) => x.path[0] === "note") ? "Keep the reply under 2,000 characters." : "Couldn't save that." };
  const ok = await updateFeedback(v.data.id, { status: v.data.status, note: v.data.note });
  if (!ok) return { error: "That note is gone." };
  refresh();
  return {};
}
