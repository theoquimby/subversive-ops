"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMoney } from "@/domain/budgets";
import { requireUser } from "@/server/auth";
import { getFixedCosts, markFinding, refreshAnalytics, saveFixedCosts } from "@/server/services/analytics";

const revalidate = () => {
  for (const p of ["/insights", "/", "/brief", "/sales"]) revalidatePath(p);
};

/** Re-run every model now (takes a few seconds). */
export async function refreshInsights(): Promise<{ error?: string; seconds?: number }> {
  await requireUser("MANAGER");
  const r = await refreshAnalytics();
  revalidate();
  return "error" in r ? { error: `Couldn't update just now (${r.error}). Insights update overnight.` } : { seconds: Math.round(r.seconds) };
}

const finding = z.object({ key: z.string().min(1).max(200), kind: z.string().min(1).max(80), title: z.string().max(400), subject: z.string().max(200).nullish(), monthly: z.number().finite() });

/** Done / Not useful / Snooze (2 weeks) / undo on a finding. */
export async function markInsight(item: z.input<typeof finding>, verdict: "done" | "dismissed" | "snoozed" | "undo") {
  await requireUser("MANAGER");
  const f = finding.safeParse(item);
  const v = z.enum(["done", "dismissed", "snoozed", "undo"]).safeParse(verdict);
  if (!f.success || !v.success) return { error: "That couldn't be saved." };
  await markFinding(f.data, v.data);
  revalidate();
  return {};
}

const FIELDS = ["rent", "utilities", "insurance", "other"] as const;

/** One fixed monthly cost (rent, utilities, insurance, other), saved as you type. */
export async function saveFixedCost(field: (typeof FIELDS)[number], raw: string) {
  await requireUser("MANAGER");
  const f = z.enum(FIELDS).safeParse(field);
  if (!f.success) return { error: "Unknown field" };
  const v = parseMoney(raw);
  if (v === "invalid") return { error: "Enter a monthly amount, like 4500" };
  const cur = (await getFixedCosts()) ?? { rent: null, utilities: null, insurance: null, other: null };
  await saveFixedCosts({ ...cur, [f.data]: v });
  revalidatePath("/insights");
  return {};
}
