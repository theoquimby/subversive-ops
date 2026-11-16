"use server";

import { MAX_BACKUP_BYTES, type ImportPreview } from "@/domain/brewImport";
import { requireUser } from "@/server/auth";
import { previewBrewManagerImport, runBrewManagerImport, type BrewImportResult } from "@/server/services/brewImport";
import { revalidatePath } from "next/cache";

/** The browser reads the file and sends what's in it; this checks its size again before anything else. */
function tooBig(json: unknown): string | null {
  let size: number;
  try {
    size = JSON.stringify(json ?? null).length;
  } catch {
    return "That file couldn't be read.";
  }
  return size > MAX_BACKUP_BYTES ? `That file is over ${Math.round(MAX_BACKUP_BYTES / 1_000_000)} MB, bigger than a Brew Manager backup should be.` : null;
}

export async function previewBrewImportAction(json: unknown): Promise<{ error: string } | { preview: ImportPreview }> {
  await requireUser("MANAGER");
  const big = tooBig(json);
  if (big) return { error: big };
  return previewBrewManagerImport(json);
}

export async function runBrewImportAction(json: unknown): Promise<{ error: string } | { result: BrewImportResult }> {
  await requireUser("MANAGER");
  const big = tooBig(json);
  if (big) return { error: big };
  const res = await runBrewManagerImport(json);
  if ("result" in res) {
    for (const p of ["/brewery", "/brewery/recipes", "/brewery/batches", "/brewery/schedule", "/brewery/setup", "/kegs/demand"]) revalidatePath(p);
  }
  return res;
}
