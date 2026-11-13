"use server";

import { SUGGESTED_QUESTIONS } from "@/domain/ask";
import { requireUser } from "@/server/auth";
import { ask, runAskTool, type AskResponse } from "@/server/services/ask";
import { businessToday } from "@/server/services/sales";
import { z } from "zod";

export async function askQuestion(q: string): Promise<AskResponse> {
  await requireUser("MANAGER");
  const p = z.string().trim().min(3).max(500).safeParse(q);
  if (!p.success) return { answer: null, results: [], mode: "rules", error: "Type a question — a few words is fine." };
  return ask(p.data);
}

/** The suggested-question buttons: same tools, no model involved. */
export async function runSuggested(index: number): Promise<AskResponse> {
  await requireUser("MANAGER");
  const s = SUGGESTED_QUESTIONS[index];
  if (!s) return { answer: null, results: [], mode: "rules", error: "Unknown question." };
  const r = s.route(businessToday());
  try {
    return { answer: null, results: [await runAskTool(r.tool, r.args)], mode: "rules" };
  } catch (e) {
    console.error("runSuggested failed", e);
    return { answer: null, results: [], mode: "rules", error: "That data couldn't be loaded just now." };
  }
}
