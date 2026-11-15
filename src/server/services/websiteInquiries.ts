import "server-only";
import { createHmac } from "node:crypto";
import { toISODate } from "@/domain/dates";
import { EVENT_TYPE_LABEL } from "@/domain/privateEvents";
import { inquiryNotes, withinLimit, type CleanInquiry } from "@/domain/websiteInquiry";
import { db } from "../db";
import { websiteInquiryEmail, websiteInquirySummary } from "../email/templates/website-inquiry";
import { appUrl, inBackground, notify, type Recipient } from "./notify";
import { createInquiry } from "./privateEvents";

/**
 * Inquiries from the website's private-event form. Each one becomes a
 * PrivateEvent at INQUIRY (so it's on the pipeline with everything else) and a
 * WebInquiry row (the inbox on Website, and per-sender rate limits). Managers are
 * told by email/push per their notification settings.
 */

/** A sender's IP, hashed with the app secret: enough to rate-limit, never stored raw. */
export const hashIp = (ip: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "ops").update(`inquiry:${ip}`).digest("base64url").slice(0, 32);

export async function inquiryAllowed(ipHash: string, now = new Date()): Promise<boolean> {
  const [hour, day] = await Promise.all([
    db.webInquiry.count({ where: { ipHash, createdAt: { gte: new Date(now.getTime() - 3600_000) } } }),
    db.webInquiry.count({ where: { ipHash, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
  ]);
  return withinLimit(hour, day);
}

export async function receiveInquiry(i: CleanInquiry, ipHash: string): Promise<{ id: string; privateEventId: string }> {
  const privateEventId = await createInquiry({
    clientName: i.name,
    clientEmail: i.email,
    clientPhone: i.phone,
    date: i.date,
    headcount: i.guests ?? 0,
    type: i.type,
    notes: inquiryNotes(i),
  });
  const row = await db.webInquiry.create({
    data: { privateEventId, name: i.name, email: i.email, phone: i.phone, date: i.date ? new Date(`${i.date}T00:00:00Z`) : null, guests: i.guests, type: i.typeText ?? EVENT_TYPE_LABEL[i.type], message: i.message, ipHash },
  });
  inBackground(() => notifyInquiry(row.id));
  return { id: row.id, privateEventId };
}

async function managers(): Promise<Recipient[]> {
  const users = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true, name: true } });
  const emps = await db.employee.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, email: true } });
  return users.map((u) => ({ userId: u.id, name: u.name, email: emps.find((e) => e.userId === u.id)?.email ?? null }));
}

export async function notifyInquiry(id: string) {
  try {
    const r = await db.webInquiry.findUnique({ where: { id } });
    if (!r) return;
    const inquiry = { from: r.name, email: r.email, phone: r.phone, date: r.date ? toISODate(r.date) : null, guests: r.guests, type: r.type, message: r.message, privateEventId: r.privateEventId };
    const s = websiteInquirySummary(inquiry);
    const base = appUrl();
    await notify(
      "inquiries",
      (await managers()).map((m) => ({ to: m, email: websiteInquiryEmail({ name: m.name, inquiry, baseUrl: base }), push: { title: s.title, body: s.body, url: r.privateEventId ? `/events/private/${r.privateEventId}` : "/website/inquiries", tag: `inquiry-${r.id}` } })),
    );
  } catch (e) {
    console.error("website inquiry: notifying managers failed", e);
  }
}

export interface InquiryRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  date: string | null;
  guests: number | null;
  type: string | null;
  message: string | null;
  createdAt: string;
  seen: boolean;
  privateEventId: string | null;
  stage: string | null;
}

export async function listInquiries(limit = 100): Promise<InquiryRow[]> {
  const rows = await db.webInquiry.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const pe = await db.privateEvent.findMany({ where: { id: { in: rows.map((r) => r.privateEventId).filter((x): x is string => !!x) } }, select: { id: true, stage: true } });
  const stage = new Map(pe.map((p) => [p.id, p.stage]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    date: r.date ? toISODate(r.date) : null,
    guests: r.guests,
    type: r.type,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    seen: !!r.seenAt,
    // A booking deleted from the pipeline leaves the inquiry here without a link.
    privateEventId: r.privateEventId && stage.has(r.privateEventId) ? r.privateEventId : null,
    stage: r.privateEventId ? (stage.get(r.privateEventId) ?? null) : null,
  }));
}
