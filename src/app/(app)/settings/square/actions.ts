"use server";

import { requireUser } from "@/server/auth";
import { friendlySquareError } from "@/server/integrations/square-http";
import { clearSquareSyncLog, connectWithToken, disconnectSquare, setSquareLocations, testSquareConnection } from "@/server/services/square";
import { backfillStep, BackfillState, clearBackfill, startBackfill } from "@/server/services/square-sync";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { error?: string; message?: string };

const refresh = () => {
  revalidatePath("/settings/square");
  revalidatePath("/", "layout");
};

const tokenSchema = z.object({
  token: z.string().trim().min(20, "That doesn't look like a Square access token — it should be a long string starting with EAAA.").max(500),
  environment: z.enum(["production", "sandbox"]),
});

/** Paste a personal access token: checked against Square before it's saved (encrypted). */
export async function pasteToken(input: z.input<typeof tokenSchema>): Promise<Result> {
  await requireUser("MANAGER");
  const p = tokenSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    const r = await connectWithToken(p.data.token, p.data.environment);
    refresh();
    return { message: `Connected to ${r.merchantName} (${r.locations} location${r.locations === 1 ? "" : "s"}).` };
  } catch (e) {
    return { error: friendlySquareError(e) };
  }
}

export async function disconnect(): Promise<Result> {
  await requireUser("MANAGER");
  const r = await disconnectSquare();
  refresh();
  return r.revokeError ? { message: `Disconnected here. Square couldn't confirm the revoke (${r.revokeError}) — you can also remove the app under Square Dashboard → Apps.` } : { message: "Disconnected." };
}

export async function testConnection(): Promise<Result> {
  await requireUser("MANAGER");
  try {
    const r = await testSquareConnection();
    refresh();
    return { message: `Working — ${r.merchantName}, ${r.locations} location${r.locations === 1 ? "" : "s"} on the account.` };
  } catch (e) {
    return { error: friendlySquareError(e) };
  }
}

export async function saveLocations(ids: string[]): Promise<Result> {
  await requireUser("MANAGER");
  const p = z.array(z.string().min(1).max(64)).max(50).safeParse(ids);
  if (!p.success) return { error: "Pick at least one location." };
  try {
    await setSquareLocations(p.data);
    refresh();
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function startImport(months: number): Promise<{ error?: string; state?: BackfillState }> {
  await requireUser("MANAGER");
  const m = z.union([z.literal(3), z.literal(6), z.literal(12)]).safeParse(months);
  if (!m.success) return { error: "Pick 3, 6 or 12 months." };
  return { state: await startBackfill(m.data) };
}

/** One server round trip of the import (about 25 seconds of work at most). */
export async function importStep(): Promise<{ error?: string; busy?: boolean; state?: BackfillState | null }> {
  await requireUser("MANAGER");
  try {
    const r = await backfillStep();
    if ("busy" in r) return { busy: true };
    if ("error" in r) return { error: r.error, state: r.state };
    if (r.state.phase === "done") refresh();
    return { state: r.state };
  } catch (e) {
    return { error: friendlySquareError(e) };
  }
}

export async function resetImport(): Promise<Result> {
  await requireUser("MANAGER");
  await clearBackfill();
  revalidatePath("/settings/square");
  return {};
}

export async function clearLog(): Promise<Result> {
  await requireUser("MANAGER");
  await clearSquareSyncLog();
  revalidatePath("/settings/square");
  return {};
}
