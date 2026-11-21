"use server";

import { requireUser } from "@/server/auth";
import { backfillGuestItems, backfillGuestPlaces, backfillGuests, computeGuestsQuietly } from "@/server/services/guests";
import { revalidatePath } from "next/cache";

/**
 * One stretch of loading past card visits from Square (about half a minute's
 * worth, newest weeks first). The button calls it again until `done`.
 */
export async function loadGuestHistory(): Promise<{ done: boolean; through: string | null; error?: string }> {
  await requireUser("MANAGER");
  // Card visits first (every year), then what each card ordered (the last two years).
  const visits = await backfillGuests(35_000);
  const r = visits.state?.finishedAt && !visits.error ? await backfillGuestItems(35_000) : visits;
  const done = !!visits.state?.finishedAt && r !== visits && !!r.state?.finishedAt;
  // Count again when it finishes or stops, so the page shows what's loaded so far.
  if (done || r.error) await computeGuestsQuietly();
  revalidatePath("/sales/customers");
  return { done, through: r.state?.next ?? null, error: r.error };
}

/**
 * One stretch of working out where cards come from (about half a minute of last
 * year's payments, newest first). The page calls it again until `done`.
 */
export async function loadGuestPlaces(): Promise<{ done: boolean; through: string | null; denied?: boolean; error?: string }> {
  await requireUser("MANAGER");
  const r = await backfillGuestPlaces(35_000);
  const done = !!r.state?.finishedAt;
  if (!r.denied) await computeGuestsQuietly();
  revalidatePath("/sales/customers");
  return { done, through: r.state?.next ?? null, denied: r.denied, error: r.error };
}

/** Count everything again from what's on file (after a stretch of loading). */
export async function recountGuests(): Promise<void> {
  await requireUser("MANAGER");
  await computeGuestsQuietly();
  revalidatePath("/sales/customers");
}
