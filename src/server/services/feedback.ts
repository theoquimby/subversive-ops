import "server-only";
import { Prisma } from "@prisma/client";
import { asFeedbackStatus, parsePhotoDataUrl, validateFeedback, type FeedbackStatus } from "@/domain/feedback";
import { businessDateOf } from "@/lib/format";
import type { Session } from "../session";
import { db } from "../db";

/**
 * Feedback from the Feedback button on every page: sending it (once per id,
 * so the phone's offline queue can retry safely), a person's own notes with
 * any reply, the managers' inbox, and the count of new ones.
 */

export interface FeedbackInput {
  /** Made on the phone; a retry with the same id is applied once. */
  clientId: string;
  kind: string;
  body: string;
  path?: string | null;
  pageTitle?: string | null;
  device?: string | null;
  appVersion?: string | null;
  /** A data URL, already shrunk in the browser. */
  photo?: string | null;
}

const cut = (s: string | null | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);

export async function createFeedback(input: FeedbackInput, who: Pick<Session, "userId" | "name" | "role">): Promise<{ id: string } | { error: string }> {
  const v = validateFeedback({ kind: input.kind, body: input.body });
  if ("error" in v) return v;
  let photo: { mime: string; bytes: Uint8Array } | null = null;
  if (input.photo) {
    const p = parsePhotoDataUrl(input.photo);
    if ("error" in p) return p;
    photo = p;
  }
  const existing = await db.appFeedback.findUnique({ where: { id: input.clientId }, select: { id: true } });
  if (existing) return { id: existing.id };
  const user = await db.user.findUnique({ where: { id: who.userId }, select: { id: true } });
  const row = await db.appFeedback.create({
    data: {
      // The phone's id, so a retry after a dropped connection lands on the same note.
      id: input.clientId,
      userId: user?.id ?? null,
      userName: who.name,
      role: who.role,
      kind: v.kind,
      body: v.body,
      path: cut(input.path, 300),
      pageTitle: cut(input.pageTitle, 160),
      device: cut(input.device, 80),
      appVersion: cut(input.appVersion, 20),
      photoMime: photo?.mime ?? null,
      photo: photo ? Buffer.from(photo.bytes) : null,
    },
    select: { id: true },
  }).catch((e: unknown) => {
    // Two retries raced: the first one saved it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { id: input.clientId };
    throw e;
  });
  return row;
}

/** What one person sees of a note they sent. */
export interface MyFeedback {
  id: string;
  at: string;
  kind: string;
  body: string;
  pageTitle: string | null;
  path: string | null;
  status: FeedbackStatus;
  note: string | null;
  hasPhoto: boolean;
}

export async function myFeedback(userId: string, limit = 40): Promise<MyFeedback[]> {
  const rows = await db.appFeedback.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, createdAt: true, kind: true, body: true, pageTitle: true, path: true, status: true, note: true, photoMime: true },
  });
  return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), kind: r.kind, body: r.body, pageTitle: r.pageTitle, path: r.path, status: asFeedbackStatus(r.status), note: r.note, hasPhoto: !!r.photoMime }));
}

/** A row of the managers' inbox (no photo bytes; the drawer loads the photo by URL). */
export interface InboxFeedback extends MyFeedback {
  /** Business date, YYYY-MM-DD. */
  date: string;
  userId: string | null;
  userName: string | null;
  role: string | null;
  device: string | null;
  appVersion: string | null;
  updatedAt: string;
}

export async function feedbackInbox(): Promise<InboxFeedback[]> {
  const rows = await db.appFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { id: true, createdAt: true, updatedAt: true, userId: true, userName: true, role: true, kind: true, body: true, path: true, pageTitle: true, device: true, appVersion: true, status: true, note: true, photoMime: true },
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    date: businessDateOf(r.createdAt),
    updatedAt: r.updatedAt.toISOString(),
    userId: r.userId,
    userName: r.userName,
    role: r.role,
    kind: r.kind,
    body: r.body,
    path: r.path,
    pageTitle: r.pageTitle,
    device: r.device,
    appVersion: r.appVersion,
    status: asFeedbackStatus(r.status),
    note: r.note,
    hasPhoto: !!r.photoMime,
  }));
}

export const newFeedbackCount = () => db.appFeedback.count({ where: { status: "new" } });

export async function setFeedbackStatus(ids: string[], status: FeedbackStatus): Promise<number> {
  const r = await db.appFeedback.updateMany({ where: { id: { in: ids } }, data: { status } });
  return r.count;
}

export async function updateFeedback(id: string, patch: { status?: FeedbackStatus; note?: string | null }): Promise<boolean> {
  const r = await db.appFeedback.updateMany({
    where: { id },
    data: { ...(patch.status ? { status: patch.status } : {}), ...(patch.note !== undefined ? { note: patch.note?.trim() ? patch.note.trim().slice(0, 2000) : null } : {}) },
  });
  return r.count > 0;
}

export async function feedbackPhoto(id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const r = await db.appFeedback.findUnique({ where: { id }, select: { photo: true, photoMime: true } });
  if (!r?.photo || !r.photoMime) return null;
  return { mime: r.photoMime, bytes: new Uint8Array(r.photo) };
}
