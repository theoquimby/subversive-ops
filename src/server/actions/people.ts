"use server";

/** People actions staff can use too (on /my), plus the policy assistant shared by /my and /help. */

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { answerPolicyQuestion, documentScope, type PolicyAnswer } from "@/server/services/documents";
import { employeeForUser } from "@/server/services/scheduling";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function acknowledgeDocument(documentId: string): Promise<{ error?: string; ackedAt?: string }> {
  const s = await requireUser();
  const me = await employeeForUser(s.userId);
  if (!me) return { error: "Your login isn't linked to a team member yet. Ask a manager." };
  const doc = await db.document.findFirst({ where: { id: documentId, ...documentScope("STAFF") }, select: { id: true } });
  if (!doc) return { error: "That document isn't available any more." };
  const ack = await db.documentAck.upsert({ where: { documentId_employeeId: { documentId, employeeId: me.id } }, create: { documentId, employeeId: me.id }, update: {} });
  revalidatePath("/my");
  revalidatePath("/team");
  return { ackedAt: ack.ackedAt.toISOString() };
}

const question = z.string().trim().min(3).max(500);

export async function askPolicy(q: string): Promise<PolicyAnswer | { error: string }> {
  const s = await requireUser();
  const p = question.safeParse(q);
  if (!p.success) return { error: "Type a question (a few words is fine)." };
  return answerPolicyQuestion(p.data, s.role);
}
