"use server";

import { validateSecret, type SecretName } from "@/domain/secretFormats";
import { requireUser } from "@/server/auth";
import { chooseGoogleTargets, disconnectGoogle, discover, syncGoogle } from "@/server/services/googleSearch";
import { removeSecret, setSecret } from "@/server/services/secrets";
import { refreshRollups, saveExtraOrigins } from "@/server/services/webAnalytics";
import { computeWebFindings } from "@/server/services/webInsights";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => {
  revalidatePath("/website/analytics");
  revalidatePath("/settings/connections/google");
  revalidatePath("/settings/connections");
};

const GOOGLE_KEYS: SecretName[] = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"];

export async function saveGoogleKey(name: string, raw: string): Promise<{ error?: string; hint?: string }> {
  await requireUser("MANAGER");
  const n = GOOGLE_KEYS.find((k) => k === name);
  if (!n) return { error: "Unknown field." };
  const v = validateSecret(n, z.string().max(500).parse(raw));
  if (!v.ok) return { error: v.error };
  await setSecret(n, v.value);
  refresh();
  return { hint: n === "GOOGLE_OAUTH_CLIENT_ID" ? v.value : `…${v.value.slice(-4)}` };
}

export async function removeGoogleKey(name: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const n = GOOGLE_KEYS.find((k) => k === name);
  if (!n) return { error: "Unknown field." };
  await removeSecret(n);
  refresh();
  return {};
}

export async function saveOrigins(list: string[]): Promise<{ error?: string; saved?: string[] }> {
  await requireUser("MANAGER");
  const parsed = z.array(z.string().max(200)).max(10).safeParse(list);
  if (!parsed.success) return { error: "Up to 10 addresses." };
  const saved = await saveExtraOrigins(parsed.data);
  refresh();
  return { saved };
}

export async function syncGoogleNow(): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  try {
    const r = await syncGoogle();
    refresh();
    if (r.skipped) return { error: r.errors[0] ?? "Google isn't connected yet." };
    return r.ok ? { message: "Synced with Google." } : { error: r.errors.join(" ") };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function findGoogleTargets(): Promise<{ error?: string; sites?: { siteUrl: string }[]; locations?: { name: string; title: string; address: string | null; placeId: string | null }[]; notes?: string[] }> {
  await requireUser("MANAGER");
  try {
    const r = await discover();
    refresh();
    return { sites: r.sites, locations: r.locations, notes: r.notes };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function chooseTargets(p: { siteUrl?: string | null; location?: string | null; locationTitle?: string | null; locationPlaceId?: string | null }): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const s = z.object({ siteUrl: z.string().max(300).nullable().optional(), location: z.string().regex(/^locations\/\d+$/).nullable().optional(), locationTitle: z.string().max(200).nullable().optional(), locationPlaceId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/).nullable().optional() }).safeParse(p);
  if (!s.success) return { error: "That choice isn't valid." };
  try {
    await chooseGoogleTargets(s.data);
    refresh();
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function disconnectGoogleAction(): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await disconnectGoogle();
  refresh();
  return {};
}

/** "Update now": rebuild today's numbers and the Insights findings. */
export async function refreshWebNumbers(): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await refreshRollups({ force: true });
  await computeWebFindings().catch(() => undefined);
  refresh();
  return {};
}
