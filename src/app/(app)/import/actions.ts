"use server";

import { detectTable, parsePastedTable, type Mapping, type RawTable, type TableKind } from "@/domain/bulkImport";
import { requireUser } from "@/server/auth";
import { applyImport, fetchGoogleSheet, planImport, type ApplyResult, type TableSpec } from "@/server/services/bulkImport";
import { readTables } from "@/server/services/priceImport";
import type { ImportPlan } from "@/domain/bulkImport";
import { revalidatePath } from "next/cache";

export interface DetectedTable { table: RawTable; kind: TableKind; mapping: Mapping }

const withDetection = (tables: RawTable[]): DetectedTable[] => tables.filter((t) => t.rows.length > 0).map((t) => ({ table: t, ...detectTable(t) }));

export async function readSource(form: FormData): Promise<{ error?: string; tables?: DetectedTable[] }> {
  await requireUser("MANAGER");
  try {
    const file = form.get("file");
    const paste = String(form.get("paste") ?? "");
    const link = String(form.get("link") ?? "").trim();
    if (file instanceof File && file.size > 0) {
      const tables = await readTables(file);
      return { tables: withDetection(tables.map((t) => ({ name: t.name, headers: t.headers, rows: t.records }))) };
    }
    if (paste.trim()) return { tables: withDetection([parsePastedTable(paste, String(form.get("pasteName") || "Pasted table"))]) };
    if (link) return { tables: withDetection(await fetchGoogleSheet(link)) };
    return { error: "Add a file, paste some cells, or a Google Sheets link." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function previewPlan(specs: TableSpec[]): Promise<ImportPlan> {
  await requireUser("MANAGER");
  return planImport(specs.filter((s) => s.kind !== "skip"));
}

export async function runImport(specs: TableSpec[]): Promise<ApplyResult> {
  await requireUser("MANAGER");
  const r = await applyImport(specs.filter((s) => s.kind !== "skip"));
  revalidatePath("/", "layout");
  return r;
}
