/**
 * Private-event inquiries from the website form (POST /api/public/inquiry):
 * checking what a stranger sent, spotting bots, and how many a sender may send.
 * Pure; the route does the I/O.
 */

import { z } from "zod";
import type { EventType } from "./privateEvents";
import { isIsoDate } from "./websiteSchema";

/** Form field that people never see; anything in it means a bot filled the form. */
export const HONEYPOT_FIELD = "website";

export const INQUIRY_LIMITS = { perHour: 3, perDay: 8 } as const;

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i;

const str = (max: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v == null ? "" : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()))
    .refine((v) => v.length <= max, `Keep it under ${max} characters`);

export const inquiryInput = z.object({
  name: str(120),
  email: str(200),
  phone: str(40),
  date: str(10),
  guests: str(6),
  type: str(60),
  message: str(2000),
  [HONEYPOT_FIELD]: str(500),
});

export type InquiryInput = z.input<typeof inquiryInput>;

export interface CleanInquiry {
  name: string;
  email: string | null;
  phone: string | null;
  date: string | null;
  guests: number | null;
  /** What the guest picked, as typed. */
  typeText: string | null;
  type: EventType;
  message: string | null;
}

export type InquiryCheck = { ok: true; value: CleanInquiry } | { ok: false; error: string; field?: string } | { ok: "bot" };

/** Free text from the form ("Birthday", "Rehearsal dinner") → a PrivateEvent type. */
export function inquiryType(raw: string | null | undefined): EventType {
  const s = (raw ?? "").toLowerCase();
  if (/wedding|reception/.test(s)) return "WEDDING";
  if (/rehears/.test(s)) return "REHEARSAL";
  if (/corporate|work|office|company|team|business/.test(s)) return "CORPORATE";
  if (/buy ?out|whole|exclusive/.test(s)) return "BUYOUT";
  if (/festival/.test(s)) return "FESTIVAL";
  if (/party|birthday|celebrat|shower|anniversary|graduat|retire|reunion|engage/.test(s)) return "PARTY";
  return s.trim() ? "OTHER" : "PARTY";
}

/** Check a website inquiry. `today` is the business date: past dates are refused. */
export function checkInquiry(body: unknown, today: string): InquiryCheck {
  const p = inquiryInput.safeParse(body ?? {});
  if (!p.success) {
    const i = p.error.issues[0];
    return { ok: false, error: i?.message ?? "Check the form.", field: i?.path.join(".") };
  }
  const v = p.data;
  if (v[HONEYPOT_FIELD]) return { ok: "bot" };
  if (!v.name) return { ok: false, error: "Add your name.", field: "name" };
  const email = v.email || null;
  if (email && !EMAIL.test(email)) return { ok: false, error: "Check the email address.", field: "email" };
  const digits = v.phone.replace(/\D/g, "");
  const phone = v.phone ? v.phone : null;
  if (phone && (digits.length < 7 || digits.length > 15)) return { ok: false, error: "Check the phone number.", field: "phone" };
  if (!email && !phone) return { ok: false, error: "Add an email or a phone number so we can reply.", field: "email" };
  let date: string | null = null;
  if (v.date) {
    if (!isIsoDate(v.date)) return { ok: false, error: "Pick a date.", field: "date" };
    if (v.date < today) return { ok: false, error: "That date has passed.", field: "date" };
    date = v.date;
  }
  let guests: number | null = null;
  if (v.guests) {
    const n = Number(v.guests);
    if (!Number.isInteger(n) || n < 1 || n > 2000) return { ok: false, error: "Guests is a number, like 40.", field: "guests" };
    guests = n;
  }
  // Links in a message from someone with no contact history are almost always spam.
  if ((v.message.match(/https?:\/\//g) ?? []).length > 2) return { ok: "bot" };
  return { ok: true, value: { name: v.name, email, phone, date, guests, typeText: v.type || null, type: inquiryType(v.type), message: v.message || null } };
}

/** Whether a sender with this many recent inquiries may send another. */
export function withinLimit(lastHour: number, lastDay: number): boolean {
  return lastHour < INQUIRY_LIMITS.perHour && lastDay < INQUIRY_LIMITS.perDay;
}

/** The note saved on the private event so the pipeline shows what the guest wrote. */
export function inquiryNotes(i: CleanInquiry): string {
  return [`From the website form${i.typeText ? ` · ${i.typeText}` : ""}.`, i.message].filter(Boolean).join("\n\n").slice(0, 2500);
}

/** Origins allowed to post the form: the website's own (from WEBSITE_URL) plus www/apex twins. */
export function allowedOrigins(websiteUrl: string | null | undefined): string[] {
  if (!websiteUrl) return [];
  try {
    const u = new URL(websiteUrl);
    const host = u.hostname;
    const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    return [...new Set([u.origin, `${u.protocol}//${twin}${u.port ? `:${u.port}` : ""}`])];
  } catch {
    return [];
  }
}
