"use server";

import { isSecretName, maskSecret, validateSecret, type SecretName } from "@/domain/secretFormats";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { testClaudeKey } from "@/server/integrations/claude";
import { isEmail, sendEmail } from "@/server/integrations/email";
import { findPlaces, type PlaceMatch } from "@/server/integrations/google-places";
import { friendlySquareError } from "@/server/integrations/square-http";
import { emailForUser } from "@/server/services/notify";
import { ensurePushKeys } from "@/server/services/push";
import { SETTING_PLACE_ID } from "@/server/services/reviews";
import { getSecret, getSecrets, removeSecret, setSecret } from "@/server/services/secrets";
import { SquareNotConnectedError, testSquareConnection } from "@/server/services/square";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export type ServiceId = "square" | "email" | "push" | "ai" | "google";
export interface TestResult {
  ok: boolean;
  message: string;
  at: string;
}

/** Keys that can be pasted. Phone-notification keys are made by the app, never pasted. */
const PASTABLE: ReadonlySet<SecretName> = new Set([
  "SQUARE_APPLICATION_ID",
  "SQUARE_APPLICATION_SECRET",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "ANTHROPIC_API_KEY",
  "GOOGLE_PLACES_API_KEY",
]);

const SETTING_PLACE_NAME = "reviews.googlePlaceName";
const testKey = (id: ServiceId) => `connections.test.${id}`;

const refresh = () => {
  revalidatePath("/settings/connections");
  revalidatePath("/settings");
  revalidatePath("/", "layout");
};

async function remember(id: ServiceId, ok: boolean, message: string): Promise<TestResult> {
  const r: TestResult = { ok, message, at: new Date().toISOString() };
  const value = JSON.stringify(r);
  await db.setting.upsert({ where: { key: testKey(id) }, create: { key: testKey(id), value }, update: { value } });
  return r;
}

async function forget(id: ServiceId) {
  await db.setting.deleteMany({ where: { key: testKey(id) } });
}

const serviceOf = (n: SecretName): ServiceId =>
  n.startsWith("SQUARE") ? "square" : n === "RESEND_API_KEY" || n === "EMAIL_FROM" ? "email" : n === "ANTHROPIC_API_KEY" ? "ai" : n === "GOOGLE_PLACES_API_KEY" ? "google" : "push";

/** Save a pasted key after checking it looks right. Returns only a masked hint, never the value. */
export async function saveKey(name: string, raw: string): Promise<{ error?: string; hint?: string }> {
  await requireUser("MANAGER");
  if (!isSecretName(name) || !PASTABLE.has(name)) return { error: "That setting can't be changed here." };
  if (typeof raw !== "string" || raw.length > 2000) return { error: "That's far too long to be a key. Copy just the key itself." };
  const v = validateSecret(name, raw);
  if (!v.ok) return { error: v.error };
  await setSecret(name, v.value);
  await forget(serviceOf(name));
  refresh();
  return { hint: name === "EMAIL_FROM" || name === "SQUARE_APPLICATION_ID" ? v.value : (maskSecret(v.value) ?? undefined) };
}

export async function removeKey(name: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  if (!isSecretName(name) || !PASTABLE.has(name)) return { error: "That setting can't be changed here." };
  await removeSecret(name);
  await forget(serviceOf(name));
  refresh();
  return {};
}

// ---- Tests -------------------------------------------------------------------------

export async function testSquare(): Promise<TestResult> {
  await requireUser("MANAGER");
  try {
    const r = await testSquareConnection();
    refresh();
    return remember("square", true, `Working — connected to ${r.merchantName}, with ${r.locations} location${r.locations === 1 ? "" : "s"} on the account.`);
  } catch (e) {
    if (e instanceof SquareNotConnectedError) return { ok: false, message: "Square isn't connected yet — finish Part 2 first.", at: new Date().toISOString() };
    return remember("square", false, friendlySquareError(e));
  }
}

export async function testEmail(to?: string): Promise<TestResult> {
  const me = await requireUser("MANAGER");
  const s = await getSecrets(["RESEND_API_KEY", "EMAIL_FROM"] as const);
  if (!s.RESEND_API_KEY) return { ok: false, message: "Paste the email service key first (step 3).", at: new Date().toISOString() };
  if (!s.EMAIL_FROM) return { ok: false, message: "Choose the sending address first (step 4).", at: new Date().toISOString() };
  const address = to?.trim() || (await emailForUser(me.userId));
  if (!isEmail(address)) return { ok: false, message: "Type the email address to send the test to.", at: new Date().toISOString() };
  const r = await sendEmail({
    to: address,
    subject: "Test email from Subversive Ops",
    text: `It works. Subversive Ops can now email orders to suppliers, schedules to staff and the weekly brief to managers.\n\nSent by ${me.name} from Settings → Connections.`,
    html: `<p><strong>It works.</strong></p><p>Subversive Ops can now email orders to suppliers, schedules to staff and the weekly brief to managers.</p><p style="color:#85837c">Sent by ${me.name.replace(/[<>&]/g, "")} from Settings → Connections.</p>`,
    tags: { kind: "connection-test" },
  });
  if ("ok" in r) return remember("email", true, `Sent a test email to ${address}. It should arrive within a minute — check spam if it doesn't.`);
  if ("skipped" in r) return { ok: false, message: "Email isn't set up yet — finish the steps above.", at: new Date().toISOString() };
  return remember("email", false, r.error);
}

export async function testAI(): Promise<TestResult> {
  await requireUser("MANAGER");
  if (!(await getSecret("ANTHROPIC_API_KEY"))) return { ok: false, message: "Paste a Claude key first (step 3).", at: new Date().toISOString() };
  const r = await testClaudeKey();
  return r.ok ? remember("ai", true, "Working — Claude answered. Invoice reading, review replies and Ask are on.") : remember("ai", false, r.error);
}

// ---- Google: find my business ------------------------------------------------------

export async function findBusiness(query: string): Promise<{ error?: string; places?: PlaceMatch[] }> {
  await requireUser("MANAGER");
  const q = z.string().trim().min(3).max(200).safeParse(query);
  if (!q.success) return { error: "Type your business name and town, e.g. “Subversive Plattsburgh”." };
  if (!(await getSecret("GOOGLE_PLACES_API_KEY"))) return { error: "Paste the Google key first (step 3)." };
  try {
    const places = await findPlaces(q.data);
    await remember("google", true, places.length ? "Working — Google answered the search." : "Google answered, but found nothing for that search.");
    if (!places.length) return { error: "Google didn't find anything for that. Try the name as it appears on Google Maps, plus the town." };
    return { places };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't search Google just now. Try again in a minute.";
    await remember("google", false, message);
    return { error: message };
  }
}

const pickSchema = z.object({ id: z.string().regex(/^[\w-]{10,300}$/), name: z.string().trim().min(1).max(200), address: z.string().trim().max(300) });

export async function pickBusiness(input: z.input<typeof pickSchema>): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = pickSchema.safeParse(input);
  if (!p.success) return { error: "That business couldn't be saved. Search again and pick it from the list." };
  const label = p.data.address ? `${p.data.name} · ${p.data.address}` : p.data.name;
  await db.$transaction([
    db.setting.upsert({ where: { key: SETTING_PLACE_ID }, create: { key: SETTING_PLACE_ID, value: p.data.id }, update: { value: p.data.id } }),
    db.setting.upsert({ where: { key: SETTING_PLACE_NAME }, create: { key: SETTING_PLACE_NAME, value: label }, update: { value: label } }),
  ]);
  refresh();
  revalidatePath("/reviews");
  return {};
}

export async function forgetBusiness(): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await db.setting.deleteMany({ where: { key: { in: [SETTING_PLACE_ID, SETTING_PLACE_NAME] } } });
  refresh();
  revalidatePath("/reviews");
  return {};
}

// ---- Phone notifications ----------------------------------------------------------

export async function turnOnPush(): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  try {
    await ensurePushKeys();
    refresh();
    return {};
  } catch (e) {
    console.error("turnOnPush", e);
    return { error: "Couldn't turn phone notifications on. Try again in a minute." };
  }
}
