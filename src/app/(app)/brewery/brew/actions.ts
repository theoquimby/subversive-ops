"use server";

import type { BrewLog } from "@/domain/brewDay";
import { isGravityUnit } from "@/domain/gravity";
import { requireUser } from "@/server/auth";
import { finishBrewDay, packageFromBrewDay, saveBrewLog, setGravityUnit, startBrewDay } from "@/server/services/brewDay";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const id = z.string().min(1).max(64);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

const refresh = (batchId?: string) => {
  for (const p of ["/brewery", "/brewery/brew", "/brewery/schedule", "/brewery/batches"]) revalidatePath(p);
  if (batchId) {
    revalidatePath(`/brewery/brew/${batchId}`);
    revalidatePath(`/brewery/batches/${batchId}`);
  }
};

const startSchema = z.object({
  batchId: id.nullable().optional(),
  recipeId: id.nullable().optional(),
  beerId: id.nullable().optional(),
  tankId: id.nullable().optional(),
  bbl: z.number().finite().gt(0).max(1000).nullable().optional(),
});

/** Open a brew day (resuming one already going for the recipe). Returns where to go. */
export async function startBrewDayAction(input: z.input<typeof startSchema>): Promise<{ error?: string; batchId?: string }> {
  await requireUser("MANAGER");
  const p = startSchema.safeParse(input);
  if (!p.success) return { error: "Pick a recipe to brew." };
  const res = await startBrewDay(p.data);
  if ("error" in res) return res;
  refresh(res.batchId);
  return { batchId: res.batchId };
}

/** Autosave from the phone. The log is checked field by field on the server. */
export async function saveBrewLogAction(batchId: string, log: unknown): Promise<{ error?: string; log?: BrewLog; kept?: "sent" | "stored" }> {
  await requireUser("MANAGER");
  if (!id.safeParse(batchId).success) return { error: "That brew is gone." };
  try {
    if (JSON.stringify(log ?? null).length > 200_000) return { error: "That log is too big to save." };
  } catch {
    return { error: "That log couldn't be read." };
  }
  const res = await saveBrewLog(batchId, log);
  if ("error" in res) return res;
  return res;
}

const finishSchema = z.object({
  tankId: id.nullable(),
  brewedOn: isoDate,
  bbl: z.number().finite().gt(0, "How many barrels went into the fermenter?").max(1000).nullable(),
  og: z.number().finite().min(1, "That OG isn't a gravity.").max(1.2, "That OG isn't a gravity.").nullable(),
});

export async function finishBrewDayAction(batchId: string, input: z.input<typeof finishSchema>): Promise<{ error?: string; ok?: string }> {
  await requireUser("MANAGER");
  const p = finishSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  if (!p.data.tankId) return { error: "Pick the fermenter it went into." };
  const res = await finishBrewDay(batchId, p.data);
  refresh(batchId);
  return res;
}

export async function packageFromBrewDayAction(batchId: string, on: string): Promise<{ error?: string; ok?: string }> {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(on).success) return { error: "Pick the day it was packaged." };
  const res = await packageFromBrewDay(batchId, on);
  refresh(batchId);
  revalidatePath("/kegs");
  return res;
}

/** °Plato or SG, for the whole brewery. */
export async function setGravityUnitAction(unit: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  if (!isGravityUnit(unit)) return { error: "Pick °P or SG." };
  await setGravityUnit(unit);
  revalidatePath("/brewery", "layout");
  revalidatePath("/print/brew", "layout");
  return {};
}
