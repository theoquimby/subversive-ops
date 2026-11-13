"use server";

import { requireUser } from "@/server/auth";
import { EVENT_KEYS, eventsFor, NOTIFY_EVENTS, type NotifyEvent, type NotifyPrefs } from "@/server/email/prefs";
import { emailConfigured, isEmail } from "@/server/integrations/email";
import { emailForUser, loadPrefs, savePrefs, sendTestNotification } from "@/server/services/notify";
import { deviceLabel, listSubscriptions, pushConfigured, removeSubscription, saveSubscription, subscriptionSchema, vapidPublicKey } from "@/server/services/push";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

// These actions are used from /settings/notifications (managers) and the PushToggle card on /my (staff),
// so they only require a signed-in user and only ever touch that user's own settings.

export interface PushConfig {
  vapidPublicKey: string | null;
  pushReady: boolean;
  emailReady: boolean;
  email: string | null;
  events: { key: NotifyEvent; label: string; hint: string; email: boolean; push: boolean }[];
  devices: number;
}

export async function pushConfig(): Promise<PushConfig> {
  const s = await requireUser();
  const [prefs, email, subs] = await Promise.all([loadPrefs(s.userId), emailForUser(s.userId), listSubscriptions(s.userId)]);
  return {
    vapidPublicKey: vapidPublicKey(),
    pushReady: pushConfigured(),
    emailReady: emailConfigured(),
    email,
    events: eventsFor(s.role).map((k) => ({ key: k, label: NOTIFY_EVENTS[k].label, hint: NOTIFY_EVENTS[k].hint, ...prefs.events[k] })),
    devices: subs.length,
  };
}

export async function savePushSubscription(input: unknown): Promise<{ error?: string }> {
  const s = await requireUser();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: "That browser sent a subscription we couldn't read." };
  await saveSubscription(s.userId, parsed.data, deviceLabel((await headers()).get("user-agent")));
  revalidatePath("/settings/notifications");
  return {};
}

export async function removePushSubscription(endpoint: string): Promise<{ error?: string }> {
  const s = await requireUser();
  await removeSubscription(s.userId, z.string().max(2000).parse(endpoint));
  revalidatePath("/settings/notifications");
  return {};
}

const prefSchema = z.object({ event: z.enum(EVENT_KEYS as [NotifyEvent, ...NotifyEvent[]]), channel: z.enum(["email", "push"]), on: z.boolean() });

export async function setNotifyPref(input: z.infer<typeof prefSchema>): Promise<{ error?: string }> {
  const s = await requireUser();
  const v = prefSchema.safeParse(input);
  if (!v.success) return { error: "Couldn't save that." };
  if (!eventsFor(s.role).includes(v.data.event)) return { error: "That one's for managers." };
  const prefs = await loadPrefs(s.userId);
  const next: NotifyPrefs = { ...prefs, events: { ...prefs.events, [v.data.event]: { ...prefs.events[v.data.event], [v.data.channel]: v.data.on } } };
  await savePrefs(s.userId, next);
  revalidatePath("/settings/notifications");
  return {};
}

export async function setNotifyEmail(raw: string): Promise<{ error?: string; email?: string | null }> {
  const s = await requireUser();
  const email = raw.trim();
  if (email && !isEmail(email)) return { error: "That email address doesn't look right." };
  const prefs = await loadPrefs(s.userId);
  await savePrefs(s.userId, { ...prefs, email: email || null });
  revalidatePath("/settings/notifications");
  return { email: await emailForUser(s.userId) };
}

export async function sendTestPush(): Promise<{ error?: string; ok?: string }> {
  const s = await requireUser();
  const r = await sendTestNotification(s.userId, s.name);
  if ("skipped" in r) return { error: r.skipped === "No devices" ? "Turn notifications on for this device first." : r.skipped };
  if (r.sent === 0) return { error: "Your device didn't accept it. Turn notifications off and on again." };
  return { ok: `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` };
}
