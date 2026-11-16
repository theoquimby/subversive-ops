"use server";

import { MAX_BACKUP_BYTES } from "@/domain/brewImport";
import { requireUser } from "@/server/auth";
import { previewBrewManagerImport, runBrewManagerImport, type AnyImportPreview, type AnyImportResult, type AppImportOptions } from "@/server/services/brewImport";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/** The browser reads the file and sends what's in it; this checks its size again before anything else. */
function tooBig(json: unknown): string | null {
  let size: number;
  try {
    size = JSON.stringify(json ?? null).length;
  } catch {
    return "That file couldn't be read.";
  }
  return size > MAX_BACKUP_BYTES ? `That file is over ${Math.round(MAX_BACKUP_BYTES / 1_000_000)} MB, bigger than a Brew Manager file should be.` : null;
}

const optsSchema = z
  .object({
    includePast: z.boolean().default(false),
    picks: z.record(z.string().max(200), z.string().max(200)).default({}),
  })
  .default({ includePast: false, picks: {} });

function readOpts(raw: unknown): AppImportOptions | { error: string } {
  const p = optsSchema.safeParse(raw ?? undefined);
  if (!p.success || Object.keys(p.data.picks).length > 500) return { error: "Those choices couldn't be read. Reload the page and try again." };
  return p.data;
}

export async function previewBrewImportAction(json: unknown, opts?: unknown): Promise<{ error: string } | { preview: AnyImportPreview }> {
  await requireUser("MANAGER");
  const big = tooBig(json);
  if (big) return { error: big };
  const o = readOpts(opts);
  if ("error" in o) return o;
  return previewBrewManagerImport(json, o);
}

export async function runBrewImportAction(json: unknown, opts?: unknown): Promise<{ error: string } | { result: AnyImportResult }> {
  await requireUser("MANAGER");
  const big = tooBig(json);
  if (big) return { error: big };
  const o = readOpts(opts);
  if ("error" in o) return o;
  const res = await runBrewManagerImport(json, o);
  if ("result" in res) {
    for (const p of ["/brewery", "/brewery/recipes", "/brewery/batches", "/brewery/schedule", "/brewery/setup", "/brewery/brew", "/brewery/stock", "/brewery/ordering", "/brewery/costs", "/ingredients", "/kegs/demand"]) revalidatePath(p);
  }
  return res;
}
