import "server-only";
import { addDays, parseISODate, toISODate } from "@/domain/dates";
import { publicIdFor, type AnnouncementValue } from "@/domain/websiteAnnouncements";
import { db } from "../db";
import { businessToday } from "./sales";
import { ensureSlugs } from "./website";

/**
 * Website announcements (the band under the website's header): list, add,
 * edit, order, show again. Callers ping the website with the "site" tag after
 * a save. The staff Announcement model is a different thing and never read here.
 */

export interface AnnouncementRow {
  id: string;
  publicId: string;
  text: string;
  tone: string;
  linkHref: string | null;
  linkLabel: string | null;
  from: string | null;
  until: string | null;
  sort: number;
  active: boolean;
  updatedAt: string;
}

const day = (d: Date | null) => (d ? toISODate(d) : null);
const date = (s: string | null) => (s ? parseISODate(s) : null);

export async function listAnnouncements(): Promise<AnnouncementRow[]> {
  const rows = await db.webAnnouncement.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ id: r.id, publicId: r.publicId, text: r.text, tone: r.tone, linkHref: r.linkHref, linkLabel: r.linkLabel, from: day(r.from), until: day(r.until), sort: r.sort, active: r.active, updatedAt: r.updatedAt.toISOString() }));
}

async function takenIds(): Promise<Set<string>> {
  return new Set((await db.webAnnouncement.findMany({ select: { publicId: true } })).map((r) => r.publicId));
}

export async function createAnnouncement(v: AnnouncementValue): Promise<string> {
  const [taken, last] = await Promise.all([takenIds(), db.webAnnouncement.aggregate({ _max: { sort: true } })]);
  const row = await db.webAnnouncement.create({
    data: { publicId: publicIdFor(v.text, businessToday(), taken), text: v.text, tone: v.tone, linkHref: v.linkHref, linkLabel: v.linkLabel, from: date(v.from), until: date(v.until), sort: (last._max.sort ?? 0) + 1, active: true },
  });
  return row.id;
}

/**
 * Save an edit. The website id stays, so people who closed the line don't see
 * it again; `showAgain` gives it a new id so everyone does.
 */
export async function updateAnnouncement(id: string, v: AnnouncementValue, showAgain: boolean): Promise<boolean> {
  const cur = await db.webAnnouncement.findUnique({ where: { id } });
  if (!cur) return false;
  const publicId = showAgain ? publicIdFor(v.text, businessToday(), await takenIds()) : cur.publicId;
  await db.webAnnouncement.update({ where: { id }, data: { publicId, text: v.text, tone: v.tone, linkHref: v.linkHref, linkLabel: v.linkLabel, from: date(v.from), until: date(v.until) } });
  return true;
}

export async function showAnnouncementAgain(id: string): Promise<boolean> {
  const cur = await db.webAnnouncement.findUnique({ where: { id } });
  if (!cur) return false;
  await db.webAnnouncement.update({ where: { id }, data: { publicId: publicIdFor(cur.text, businessToday(), await takenIds()) } });
  return true;
}

export async function setAnnouncementActive(id: string, active: boolean): Promise<boolean> {
  const r = await db.webAnnouncement.updateMany({ where: { id }, data: { active } });
  return r.count > 0;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await db.webAnnouncement.deleteMany({ where: { id } });
}

/** Put them in this order (ids not listed keep their place after the listed ones). */
export async function reorderAnnouncements(ids: string[]): Promise<void> {
  const all = await db.webAnnouncement.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const known = new Set(all.map((r) => r.id));
  const order = [...ids.filter((id) => known.has(id)), ...all.map((r) => r.id).filter((id) => !ids.includes(id))];
  await db.$transaction(order.map((id, i) => db.webAnnouncement.update({ where: { id }, data: { sort: i + 1 } })));
}

export interface EventLinkOption {
  href: string;
  label: string;
  date: string;
  title: string;
}

/** Upcoming public events with their website address, for "link to an event". */
export async function eventLinkOptions(): Promise<EventLinkOption[]> {
  const today = businessToday();
  const events = await db.event.findMany({
    where: { date: { gte: new Date(`${today}T00:00:00Z`), lt: new Date(`${addDays(today, 400)}T00:00:00Z`) }, kind: { notIn: ["PRIVATE"] } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, date: true, title: true },
    take: 200,
  });
  await ensureSlugs(events);
  const webs = await db.webEvent.findMany({ where: { eventId: { in: events.map((e) => e.id) } }, select: { eventId: true, slug: true, hidden: true } });
  const byId = new Map(webs.map((w) => [w.eventId, w]));
  return events.flatMap((e) => {
    const w = byId.get(e.id);
    if (!w || w.hidden) return [];
    return [{ href: `/events/${w.slug}`, label: e.title, date: toISODate(e.date), title: e.title }];
  });
}
