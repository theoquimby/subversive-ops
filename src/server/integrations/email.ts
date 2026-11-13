import "server-only";

/**
 * Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email).
 * Plain fetch, no SDK. The key and sender come from Settings → Connections
 * (or the RESEND_API_KEY / EMAIL_FROM environment variables). When they aren't
 * set every send is a no-op that returns `{ skipped }`, so callers can fall
 * back to copy/mailto.
 */

import { getSecrets } from "../services/secrets";
import { NO_NETWORK } from "./network";

const API = "https://api.resend.com";
export const EMAIL_NOT_SET_UP = "Email isn't set up yet";

export interface EmailAttachment {
  filename: string;
  /** Raw text or bytes; encoded to base64 here. */
  content: string | Uint8Array;
  contentType?: string;
}

export interface EmailMessage {
  to: string | string[];
  cc?: string[];
  replyTo?: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Resend tags (letters, numbers, _ and - only). */
  tags?: Record<string, string>;
  /** Makes retries safe: Resend drops a second send with the same key within 24 h. */
  idempotencyKey?: string;
}

export type SendResult = { ok: true; id: string } | { skipped: string } | { error: string };

async function emailConfig(): Promise<{ key: string; from: string } | null> {
  const s = await getSecrets(["RESEND_API_KEY", "EMAIL_FROM"] as const);
  return s.RESEND_API_KEY && s.EMAIL_FROM ? { key: s.RESEND_API_KEY, from: s.EMAIL_FROM } : null;
}

/** Whether email can be sent (key + sender saved in Settings → Connections, or set in the environment). */
export const emailReady = async () => (await emailConfig()) !== null;

/** The address part of the sender ("Subversive Ops <ops@x.com>" → "ops@x.com"). */
export const senderAddress = (from: string | null | undefined) => (from ? (/<([^>]+)>/.exec(from)?.[1] ?? from.trim()) : null);
export const emailFromAddress = async () => senderAddress((await getSecrets(["EMAIL_FROM"] as const)).EMAIL_FROM);

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export const isEmail = (s: string | null | undefined): s is string => !!s && EMAIL_RE.test(s.trim());

const b64 = (c: string | Uint8Array) => Buffer.from(typeof c === "string" ? Buffer.from(c, "utf8") : c).toString("base64");
const tagSafe = (s: string) => s.replace(/[^\w-]/g, "_").slice(0, 256);

/** `config` overrides the saved key/sender (used to test values before saving). */
export async function sendEmail(msg: EmailMessage, config?: { key: string; from: string }): Promise<SendResult> {
  const cfg = config ?? (await emailConfig());
  if (!cfg) return { skipped: EMAIL_NOT_SET_UP };
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map((s) => s.trim()).filter(Boolean);
  if (to.length === 0 || !to.every(isEmail)) return { error: "That email address doesn't look right." };
  const cc = (msg.cc ?? []).map((s) => s.trim()).filter(isEmail).filter((a) => !to.includes(a));

  const body = {
    from: cfg.from.trim(),
    to,
    ...(cc.length ? { cc } : {}),
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.attachments?.length
      ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: b64(a.content), ...(a.contentType ? { content_type: a.contentType } : {}) })) }
      : {}),
    ...(msg.tags ? { tags: Object.entries(msg.tags).map(([name, value]) => ({ name: tagSafe(name), value: tagSafe(value) })) } : {}),
  };

  try {
    const res = await fetch(`${API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key.trim()}`,
        "Content-Type": "application/json",
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !json.id) {
      console.error("resend: send failed", res.status, json);
      return { error: friendlyError(res.status, json.message) };
    }
    return { ok: true, id: json.id };
  } catch (e) {
    console.error("resend: request failed", e);
    return { error: NO_NETWORK("the email service (Resend)") };
  }
}

function friendlyError(status: number, message?: string) {
  if (status === 401) return "The email service didn't accept the saved key. Replace it in Settings → Connections → Email.";
  if (status === 403 && message && /domain/i.test(message)) return "The sending address's domain isn't verified yet. In Resend, open Domains and finish the DNS step (it can take up to an hour), then try again.";
  if (status === 403) return `The email service refused to send${message ? `: ${message}` : ""}. Check the sending address's domain is verified in Resend.`;
  if (status === 422 && message) return `The email service said: ${message}`;
  if (status === 429) return "Too many emails at once. Try again in a minute.";
  return message ? `Email didn't send: ${message}` : "Email didn't send. Try again in a minute.";
}

/** Resend's `last_event` for a sent email: sent, delivered, delivery_delayed, bounced, complained, opened, clicked… */
export type DeliveryEvent = "queued" | "scheduled" | "sent" | "delivered" | "delivery_delayed" | "bounced" | "complained" | "opened" | "clicked" | "canceled" | "failed";

export async function emailDeliveryStatus(id: string): Promise<DeliveryEvent | null> {
  const cfg = await emailConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${API}/emails/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${cfg.key.trim()}` },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { last_event?: DeliveryEvent };
    return json.last_event ?? null;
  } catch {
    return null;
  }
}
