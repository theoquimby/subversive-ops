"use server";

import { requireUser } from "@/server/auth";
import { linkKegBatchToBrew, takeRecipeBeer } from "@/server/services/breweryWrite";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/** Kegs → Setup → Needs a look: the one-tap fixes that touch brews (beers, Square items and ABV use the existing actions). */

const id = z.string().min(1).max(64);

const refresh = () => {
  revalidatePath("/kegs", "layout");
  revalidatePath("/brewery", "layout");
};

/** Join a keg batch to the brew with the same code. */
export async function joinKegBatchAction(kegBatchId: string, brewId: string): Promise<{ error?: string; ok?: string }> {
  await requireUser("MANAGER");
  if (!id.safeParse(kegBatchId).success || !id.safeParse(brewId).success) return { error: "Can't save that." };
  const r = await linkKegBatchToBrew(kegBatchId, brewId);
  refresh();
  return r;
}

/** A brew saved with a different beer from its recipe's takes the recipe's beer. */
export async function takeRecipeBeerAction(brewId: string): Promise<{ error?: string; ok?: string }> {
  await requireUser("MANAGER");
  if (!id.safeParse(brewId).success) return { error: "Can't save that." };
  const r = await takeRecipeBeer(brewId);
  refresh();
  return r;
}
