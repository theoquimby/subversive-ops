import "server-only";
import { Prisma } from "@prisma/client";
import { toISODate } from "@/domain/dates";
import { imageSize } from "@/domain/imageSize";
import { heroProblem, isEmptyPage, parseStoredPage, type EventPageContent } from "@/domain/websiteEventPage";
import { slugFor } from "@/domain/websiteEvents";
import { db } from "../db";

/**
 * A featured event's own page on the website: the photo at the top (a
 * WebImage, served from /api/public/images/<id>) and the words in
 * WebEvent.page. Callers ping the website with the "events" tag after a save.
 */

/** The event's web row, made (with its slug) if it isn't there yet. null for a private or missing event. */
export async function webEventFor(eventId: string) {
  const e = await db.event.findUnique({ where: { id: eventId }, select: { id: true, date: true, title: true, kind: true } });
  if (!e || e.kind === "PRIVATE") return null;
  const have = await db.webEvent.findUnique({ where: { eventId: e.id } });
  if (have) return have;
  const date = toISODate(e.date);
  const taken = new Set((await db.webEvent.findMany({ where: { slug: { startsWith: date } }, select: { slug: true } })).map((w) => w.slug));
  return db.webEvent.upsert({ where: { eventId: e.id }, create: { eventId: e.id, slug: slugFor(date, e.title, taken) }, update: {} });
}

export interface EventPageEditor {
  eventId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  kind: string;
  slug: string;
  hidden: boolean;
  featured: boolean;
  heroUrl: string | null;
  heroAlt: string | null;
  heroSize: { width: number; height: number } | null;
  content: EventPageContent;
}

export async function eventPageEditor(eventId: string): Promise<EventPageEditor | null> {
  const e = await db.event.findUnique({ where: { id: eventId }, select: { id: true, date: true, title: true, kind: true, startTime: true, endTime: true, notes: true } });
  if (!e || e.kind === "PRIVATE") return null;
  const w = await webEventFor(e.id);
  if (!w) return null;
  const img = w.heroImageId ? await db.webImage.findUnique({ where: { id: w.heroImageId }, select: { width: true, height: true } }) : null;
  return {
    eventId: e.id,
    title: e.title,
    date: toISODate(e.date),
    startTime: e.startTime,
    endTime: e.endTime,
    notes: e.notes,
    kind: e.kind,
    slug: w.slug,
    hidden: w.hidden,
    featured: w.featured,
    heroUrl: w.heroImageId ? `/api/public/images/${w.heroImageId}` : null,
    heroAlt: w.heroAlt,
    heroSize: img && img.width && img.height ? { width: img.width, height: img.height } : null,
    content: parseStoredPage(w.page),
  };
}

export async function saveEventPageContent(eventId: string, content: EventPageContent, heroAlt: string | null): Promise<boolean> {
  const w = await webEventFor(eventId);
  if (!w) return false;
  const page = isEmptyPage(content) ? Prisma.DbNull : (content as unknown as Prisma.InputJsonValue);
  await db.webEvent.update({ where: { eventId: w.eventId }, data: { page, heroAlt } });
  return true;
}

const IMAGE_TYPES = ["image/jpeg", "image/webp", "image/png"];
export const HERO_MAX_BYTES = 1_500_000;

/** Check an uploaded photo for the top of the page (type, size, landscape and wide enough, read from the file itself) and store it. */
export async function setEventHero(eventId: string, file: File): Promise<{ error: string } | { ok: true }> {
  if (!IMAGE_TYPES.includes(file.type)) return { error: "Use a JPEG, PNG or WebP photo." };
  if (file.size > HERO_MAX_BYTES) return { error: "That photo is too big. Under 1.5 MB, please." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(png && file.type === "image/png") && !(jpg && file.type === "image/jpeg") && !(webp && file.type === "image/webp")) return { error: "That file isn't a readable photo." };
  const size = imageSize(bytes);
  const problem = heroProblem(size?.width ?? 0, size?.height ?? 0);
  if (problem) return { error: problem };
  const w = await webEventFor(eventId);
  if (!w) return { error: "That event isn't on the website." };
  const img = await db.webImage.create({ data: { mime: file.type, bytes, width: size!.width, height: size!.height } });
  await db.webEvent.update({ where: { eventId: w.eventId }, data: { heroImageId: img.id } });
  // The old photo is no longer used by anything.
  if (w.heroImageId) await db.webImage.deleteMany({ where: { id: w.heroImageId } });
  return { ok: true };
}

export async function removeEventHero(eventId: string): Promise<void> {
  const w = await db.webEvent.findUnique({ where: { eventId } });
  if (!w?.heroImageId) return;
  await db.webEvent.update({ where: { eventId: w.eventId }, data: { heroImageId: null } });
  await db.webImage.deleteMany({ where: { id: w.heroImageId } });
}
