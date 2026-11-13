"use server";

import { requireUser } from "@/server/auth";
import { squareConfigured } from "@/server/env";
import { setAdjustment } from "@/server/services/planning";
import { backfillSales, dailySync } from "@/server/services/sales";
import { revalidatePath } from "next/cache";

export async function syncNow(): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  if (!squareConfigured()) return { error: "Add the Square access token and location ID first." };
  try {
    const r = await dailySync();
    revalidatePath("/", "layout");
    return { message: "catalog" in r ? `Synced ${r.orderLines} sold items, ${r.catalog} catalog entries.` : r.skipped };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function backfill(days: number): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  if (!squareConfigured()) return { error: "Add the Square access token and location ID first." };
  try {
    const n = await backfillSales(Math.min(Math.max(days, 7), 400));
    revalidatePath("/", "layout");
    return { message: `Imported ${n} sold items from the last ${days} days.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}


export async function saveAdjustment(date: string, form: FormData) {
  await requireUser("MANAGER");
  const pct = Number(form.get("pct"));
  await setAdjustment(date, Number.isFinite(pct) ? 1 + pct / 100 : null);
  revalidatePath("/sales");
}
