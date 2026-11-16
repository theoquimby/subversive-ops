"use server";

import { checkAnnouncement, type AnnouncementField, type AnnouncementInput } from "@/domain/websiteAnnouncements";
import { requireUser } from "@/server/auth";
import { pingWebsite } from "@/server/services/website";
import { createAnnouncement, deleteAnnouncement, reorderAnnouncements, setAnnouncementActive, showAnnouncementAgain, updateAnnouncement } from "@/server/services/websiteAnnouncements";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = { error?: string; errors?: Partial<Record<AnnouncementField, string>> };

const inputSchema = z.object({ text: z.string().max(2000), tone: z.string().max(20), linkHref: z.string().max(2000), linkLabel: z.string().max(400), from: z.string().max(10), until: z.string().max(10) });

const done = (): R => {
  revalidatePath("/website/announcements");
  revalidatePath("/website");
  pingWebsite("site");
  return {};
};

function check(raw: AnnouncementInput) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, errors: { text: "Something in the form didn't come through. Try again." } };
  return checkAnnouncement(parsed.data);
}

export async function addAnnouncement(raw: AnnouncementInput): Promise<R> {
  await requireUser("MANAGER");
  const r = check(raw);
  if (!r.ok) return { errors: r.errors };
  await createAnnouncement(r.value);
  return done();
}

export async function editAnnouncement(id: string, raw: AnnouncementInput, showAgain: boolean): Promise<R> {
  await requireUser("MANAGER");
  const r = check(raw);
  if (!r.ok) return { errors: r.errors };
  if (!(await updateAnnouncement(String(id), r.value, !!showAgain))) return { error: "That announcement is gone." };
  return done();
}

export async function setAnnouncementOn(id: string, value: string): Promise<R> {
  await requireUser("MANAGER");
  if (!(await setAnnouncementActive(String(id), value === "on"))) return { error: "That announcement is gone." };
  return done();
}

export async function showAgain(id: string): Promise<R> {
  await requireUser("MANAGER");
  if (!(await showAnnouncementAgain(String(id)))) return { error: "That announcement is gone." };
  return done();
}

export async function removeAnnouncement(id: string): Promise<R> {
  await requireUser("MANAGER");
  await deleteAnnouncement(String(id));
  return done();
}

export async function orderAnnouncements(ids: string[]): Promise<R> {
  await requireUser("MANAGER");
  if (!Array.isArray(ids) || ids.length > 500) return { error: "Couldn't change the order." };
  await reorderAnnouncements(ids.map(String));
  return done();
}
