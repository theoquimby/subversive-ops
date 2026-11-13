"use server";

import type { ImportPlan } from "@/domain/kegImport";
import { parsePastedTable } from "@/domain/bulkImport";
import { requireUser } from "@/server/auth";
import { applyKegImport, discardUpload, jsonSources, parkSources, planFromUpload, readSourcesFromFile, reviewCounts, type ImportResult, type SourceInfo, type SpecChoice } from "@/server/services/kegImport";
import { revalidatePath } from "next/cache";

/** Add one file (or pasted cells / JSON) to an upload. Called once per file so each request stays small. */
export async function addImportFile(uploadId: string, form: FormData): Promise<{ sources: SourceInfo[] } | { error: string }> {
  await requireUser("MANAGER");
  try {
    const file = form.get("file");
    const paste = String(form.get("paste") ?? "").trim();
    if (file instanceof File && file.size > 0) return { sources: await parkSources(uploadId, await readSourcesFromFile(file)) };
    if (paste) {
      if (/^[[{]/.test(paste)) return { sources: await parkSources(uploadId, jsonSources(String(form.get("name") || "Pasted JSON"), JSON.parse(paste))) };
      const t = parsePastedTable(paste, String(form.get("name") || "Pasted table"));
      return { sources: await parkSources(uploadId, [{ name: t.name, records: t.rows }]) };
    }
    return { error: "Add a file or paste some cells." };
  } catch (e) {
    return { error: (e as Error).message || "Couldn't read that file." };
  }
}

export type ImportReview = { plan: Omit<ImportPlan, "events" | "kegs"> & { kegs: ImportPlan["kegs"]; eventCount: number; eventSample: ImportPlan["events"] }; counts: Awaited<ReturnType<typeof reviewCounts>> };

export async function reviewImport(uploadId: string, choices: SpecChoice[]): Promise<ImportReview | { error: string }> {
  await requireUser("MANAGER");
  const plan = await planFromUpload(uploadId, choices);
  if ("error" in plan) return plan;
  const counts = await reviewCounts(plan);
  const { events, kegs, ...rest } = plan;
  return { plan: { ...rest, kegs: kegs.slice(0, 200), eventCount: events.length, eventSample: events.slice(-8) }, counts };
}

export async function runKegImport(uploadId: string, choices: SpecChoice[]): Promise<ImportResult | { error: string }> {
  const me = await requireUser("MANAGER");
  const r = await applyKegImport(uploadId, choices, { userId: me.userId, name: me.name });
  revalidatePath("/kegs", "layout");
  return r;
}

export async function cancelImport(uploadId: string) {
  await requireUser("MANAGER");
  await discardUpload(uploadId);
}
