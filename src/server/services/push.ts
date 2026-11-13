import "server-only";
import { sendNotification, WebPushError } from "web-push";
import { z } from "zod";
import { db } from "../db";

/**
 * Web push (VAPID, no paid service). Subscriptions live in the Setting table as
 * JSON per user — key `push.<userId>` → StoredSubscription[] — so no schema change.
 */

export const PUSH_NOT_SET_UP = "Push notifications aren't set up yet";

export const subscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
export type PushSubscriptionInput = z.infer<typeof subscriptionSchema>;
export interface StoredSubscription extends PushSubscriptionInput {
  addedAt: string;
  /** "iPhone · Safari" — so people can tell devices apart. */
  device: string | null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path to open on tap, e.g. "/my". */
  url?: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

const key = (userId: string) => `push.${userId}`;

function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const fromAddr = /<([^>]+)>/.exec(process.env.EMAIL_FROM ?? "")?.[1];
  const subject = process.env.VAPID_SUBJECT?.trim() || (fromAddr ? `mailto:${fromAddr}` : "");
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export const pushConfigured = () => vapid() !== null;
/** Safe to send to the browser. */
export const vapidPublicKey = () => vapid()?.publicKey ?? null;

export async function listSubscriptions(userId: string): Promise<StoredSubscription[]> {
  const row = await db.setting.findUnique({ where: { key: key(userId) } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((s) => subscriptionSchema.safeParse(s).success) : [];
  } catch {
    return [];
  }
}

async function writeSubscriptions(userId: string, subs: StoredSubscription[]) {
  if (subs.length === 0) await db.setting.deleteMany({ where: { key: key(userId) } });
  else await db.setting.upsert({ where: { key: key(userId) }, create: { key: key(userId), value: JSON.stringify(subs) }, update: { value: JSON.stringify(subs) } });
}

export async function saveSubscription(userId: string, sub: PushSubscriptionInput, device: string | null) {
  const subs = (await listSubscriptions(userId)).filter((s) => s.endpoint !== sub.endpoint);
  // Keep the newest few devices; old browsers that never unsubscribed fall off.
  subs.unshift({ ...sub, addedAt: new Date().toISOString(), device });
  await writeSubscriptions(userId, subs.slice(0, 8));
}

export async function removeSubscription(userId: string, endpoint: string) {
  const subs = await listSubscriptions(userId);
  await writeSubscriptions(userId, subs.filter((s) => s.endpoint !== endpoint));
}

export type PushResult = { sent: number; removed: number } | { skipped: string };

/** Send to every device the user turned notifications on for. Dead subscriptions are dropped. */
export async function sendPush(userId: string, payload: PushPayload): Promise<PushResult> {
  const v = vapid();
  if (!v) return { skipped: PUSH_NOT_SET_UP };
  const subs = await listSubscriptions(userId);
  if (subs.length === 0) return { skipped: "No devices" };
  const body = JSON.stringify(payload);
  const dead = new Set<string>();
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { vapidDetails: v, TTL: 60 * 60 * 24, urgency: "normal", timeout: 10_000 });
        sent++;
      } catch (e) {
        const status = e instanceof WebPushError ? e.statusCode : (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.add(s.endpoint);
        else console.error("push: send failed", status, (e as Error).message);
      }
    }),
  );
  if (dead.size) {
    // Re-read so a device added meanwhile isn't lost.
    const fresh = await listSubscriptions(userId);
    await writeSubscriptions(userId, fresh.filter((s) => !dead.has(s.endpoint)));
  }
  return { sent, removed: dead.size };
}

/** "Mozilla/5.0 (iPhone; …) … Safari" → "iPhone · Safari". */
export function deviceLabel(ua: string | null): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return [os, browser].filter(Boolean).join(" · ") || null;
}
