import "server-only";

/**
 * Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email).
 * Plain fetch, no SDK. When RESEND_API_KEY / EMAIL_FROM aren't set every send is a
 * no-op that returns `{ skipped }`, so callers can fall back to copy/mailto.
 */

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

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());

/** The address part of EMAIL_FROM ("Subversive Ops <ops@x.com>" → "ops@x.com"). */
export const emailFromAddress = () => /<([^>]+)>/.exec(process.env.EMAIL_FROM ?? "")?.[1] ?? process.env.EMAIL_FROM?.trim() ?? null;

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export const isEmail = (s: string | null | undefined): s is string => !!s && EMAIL_RE.test(s.trim());

const b64 = (c: string | Uint8Array) => Buffer.from(typeof c === "string" ? Buffer.from(c, "utf8") : c).toString("base64");
const tagSafe = (s: string) => s.replace(/[^\w-]/g, "_").slice(0, 256);

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (!emailConfigured()) return { skipped: EMAIL_NOT_SET_UP };
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map((s) => s.trim()).filter(Boolean);
  if (to.length === 0 || !to.every(isEmail)) return { error: "That email address doesn't look right." };
  const cc = (msg.cc ?? []).map((s) => s.trim()).filter(isEmail).filter((a) => !to.includes(a));

  const body = {
    from: process.env.EMAIL_FROM!.trim(),
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
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
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
    return { error: "Couldn't reach the email service. Try again in a minute." };
  }
}

function friendlyError(status: number, message?: string) {
  if (status === 401 || status === 403) return "The email service rejected our key — check RESEND_API_KEY and that the sending domain is verified.";
  if (status === 422 && message) return `The email service said: ${message}`;
  if (status === 429) return "Too many emails at once. Try again in a minute.";
  return message ? `Email didn't send: ${message}` : "Email didn't send. Try again in a minute.";
}

/** Resend's `last_event` for a sent email: sent, delivered, delivery_delayed, bounced, complained, opened, clicked… */
export type DeliveryEvent = "queued" | "scheduled" | "sent" | "delivered" | "delivery_delayed" | "bounced" | "complained" | "opened" | "clicked" | "canceled" | "failed";

export async function emailDeliveryStatus(id: string): Promise<DeliveryEvent | null> {
  if (!emailConfigured()) return null;
  try {
    const res = await fetch(`${API}/emails/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}` },
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
