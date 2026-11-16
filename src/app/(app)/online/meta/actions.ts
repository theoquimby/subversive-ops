"use server";

import { validateSecret, type SecretName } from "@/domain/secretFormats";
import { requireUser } from "@/server/auth";
import { disconnectMeta, discoverMeta, syncMeta, type PageChoice } from "@/server/services/metaChannels";
import { removeSecret, setSecret } from "@/server/services/secrets";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => {
  for (const p of ["/online", "/online/meta", "/online/instagram", "/online/facebook", "/settings/connections"]) revalidatePath(p);
};

const META_KEYS: SecretName[] = ["META_APP_ID", "META_APP_SECRET"];

export async function saveMetaKey(name: string, raw: string): Promise<{ error?: string; hint?: string }> {
  await requireUser("MANAGER");
  const n = META_KEYS.find((k) => k === name);
  if (!n) return { error: "Unknown field." };
  const parsed = z.string().max(500).safeParse(raw);
  if (!parsed.success) return { error: "That's far too long to be a key. Copy just the key itself." };
  const v = validateSecret(n, parsed.data);
  if (!v.ok) return { error: v.error };
  await setSecret(n, v.value);
  refresh();
  return { hint: n === "META_APP_ID" ? v.value : `…${v.value.slice(-4)}` };
}

export async function removeMetaKey(name: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const n = META_KEYS.find((k) => k === name);
  if (!n) return { error: "Unknown field." };
  await removeSecret(n);
  refresh();
  return {};
}

/** "Find again": list the Pages this sign-in manages, and note anything in the way. */
export async function findMetaPages(): Promise<{ error?: string; pages?: PageChoice[]; pageId?: string | null; notes?: string[] }> {
  await requireUser("MANAGER");
  try {
    const r = await discoverMeta();
    refresh();
    return r;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function chooseMetaPage(pageId: string): Promise<{ error?: string; pages?: PageChoice[]; pageId?: string | null; notes?: string[] }> {
  await requireUser("MANAGER");
  const id = z.string().regex(/^\d{1,32}$/).safeParse(pageId);
  if (!id.success) return { error: "Pick a Page from the list." };
  try {
    const r = await discoverMeta(id.data);
    refresh();
    return r;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function syncMetaNow(): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  try {
    const r = await syncMeta({ budgetMs: 45_000 });
    refresh();
    if (r.skipped) return { error: r.errors[0] ?? "Instagram and Facebook aren't connected yet." };
    if (!r.ok) return { error: r.errors.join(" ") };
    return { message: ["Synced with Instagram and Facebook.", ...r.notes].join(" ") };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function disconnectMetaAction(): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await disconnectMeta();
  refresh();
  return {};
}
