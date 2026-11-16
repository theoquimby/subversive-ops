"use server";

import { parseISODate } from "@/domain/dates";
import { cleanUrl } from "@/domain/websiteContact";
import { isFinerKind, slugFor } from "@/domain/websiteEvents";
import { NOTICE_MAX, parseTypedTime } from "@/domain/websiteHours";
import { isFamily, isMenuTag, kebab } from "@/domain/websiteMenu";
import { isIsoDate, LINK_KEYS, WEEKDAYS, type LinkKey, type Weekday } from "@/domain/websiteSchema";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { pingWebsite, saveWebsiteSetting, sendPing, websiteSettings, type PingResult, type WebsiteTag } from "@/server/services/website";
import { revalidatePath } from "next/cache";

type R = { error?: string };

const done = (...tags: WebsiteTag[]): R => {
  revalidatePath("/website");
  pingWebsite(...tags);
  return {};
};

const dateOrNull = (raw: string): Date | null | undefined => {
  const v = raw.trim();
  if (!v) return null;
  return isIsoDate(v) ? parseISODate(v) : undefined;
};

// ---- Notice, hours, contact -----------------------------------------------------------

export async function saveNotice(input: { text: string; until: string | null }): Promise<R> {
  await requireUser("MANAGER");
  const text = String(input.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length > NOTICE_MAX) return { error: `Keep it under ${NOTICE_MAX} characters — it's one line on the website.` };
  const until = input.until ? String(input.until) : null;
  if (until && !isIsoDate(until)) return { error: "Pick the last day it shows." };
  if (until && until < businessToday()) return { error: "That day has passed. Pick today or later." };
  await saveWebsiteSetting("notice", text ? { text, until } : null);
  return done("site");
}

export async function saveExactTime(day: string, field: "open" | "close" | "kitchenClose", raw: string): Promise<R> {
  await requireUser("MANAGER");
  if (!(WEEKDAYS as readonly string[]).includes(day) || !["open", "close", "kitchenClose"].includes(field)) return { error: "Unknown day" };
  const t = parseTypedTime(String(raw ?? ""));
  if (t === undefined) return { error: "Type a time like 4:30pm or 16:30" };
  const s = await websiteSettings();
  const cur = { ...(s.exactHours[day as Weekday] ?? {}) };
  if (t) cur[field] = t;
  else delete cur[field];
  const next = { ...s.exactHours, [day]: cur };
  await saveWebsiteSetting("exactHours", next);
  return done("site");
}

export async function saveLink(key: string, raw: string): Promise<R> {
  await requireUser("MANAGER");
  if (!(LINK_KEYS as readonly string[]).includes(key)) return { error: "Unknown link" };
  const v = String(raw ?? "").trim();
  const url = v ? cleanUrl(v) : null;
  if (v && !url) return { error: "That isn't a web address" };
  const s = await websiteSettings();
  const links = { ...s.links };
  if (url) links[key as LinkKey] = url;
  else delete links[key as LinkKey];
  await saveWebsiteSetting("links", links);
  return done("site");
}

export async function savePhoneNote(raw: string): Promise<R> {
  await requireUser("MANAGER");
  const v = String(raw ?? "").trim();
  if (v.length > 120) return { error: "Keep it under 120 characters" };
  await saveWebsiteSetting("phoneNote", v || null);
  return done("site");
}

export async function setHolidaysClosed(on: boolean): Promise<R> {
  await requireUser("MANAGER");
  await saveWebsiteSetting("holidaysClosed", !!on);
  return done("events", "site");
}

export async function saveMenuNotices(raw: string): Promise<R> {
  await requireUser("MANAGER");
  const lines = String(raw ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 6) return { error: "Six lines at most" };
  if (lines.some((l) => l.length > 300)) return { error: "Keep each line under 300 characters" };
  await saveWebsiteSetting("menuNotices", lines);
  return done("menu");
}

// ---- Menu items -----------------------------------------------------------------------

const ITEM_FIELDS = ["onWebsite", "name", "description", "tags", "badge", "modifiers", "place", "section", "sort", "showPrice", "availableFrom", "availableUntil"] as const;
type ItemField = (typeof ITEM_FIELDS)[number];

export async function setMenuItemField(recipeId: string, field: ItemField, raw: string): Promise<R> {
  await requireUser("MANAGER");
  if (!ITEM_FIELDS.includes(field)) return { error: "Unknown field" };
  const recipe = await db.recipe.findUnique({ where: { id: String(recipeId) }, select: { id: true } });
  if (!recipe) return { error: "That item is gone" };
  const v = String(raw ?? "").trim();
  let data: Record<string, unknown>;
  switch (field) {
    case "onWebsite":
    case "showPrice":
      data = { [field]: v === "true" };
      break;
    case "name":
    case "badge":
      if (v.length > (field === "badge" ? 24 : 80)) return { error: field === "badge" ? "Badges are a word or two" : "Keep it under 80 characters" };
      data = { [field]: v || null };
      break;
    case "description":
    case "modifiers":
      if (v.length > 400) return { error: "Keep it under 400 characters" };
      data = { [field]: v || null };
      break;
    case "section":
      if (v.length > 60) return { error: "Keep the section name short" };
      if (v && !kebab(v)) return { error: "Use letters or numbers in the name" };
      data = { section: v || null };
      break;
    case "place":
      if (v && v !== "food" && v !== "drinks") return { error: "Food or drinks" };
      data = { place: v || null };
      break;
    case "sort": {
      const n = v ? Number(v) : 0;
      if (!Number.isInteger(n) || Math.abs(n) > 9999) return { error: "A whole number, like 1, 2, 3" };
      data = { sort: n };
      break;
    }
    case "tags": {
      const tags = v ? v.split(",").map((t) => t.trim()).filter(Boolean) : [];
      if (!tags.every(isMenuTag)) return { error: "Unknown tag" };
      data = { tags: [...new Set(tags)] };
      break;
    }
    case "availableFrom":
    case "availableUntil": {
      const d = dateOrNull(v);
      if (d === undefined) return { error: "Pick a date" };
      const other = await db.webMenuItem.findUnique({ where: { recipeId: recipe.id }, select: { availableFrom: true, availableUntil: true } });
      const from = field === "availableFrom" ? d : (other?.availableFrom ?? null);
      const until = field === "availableUntil" ? d : (other?.availableUntil ?? null);
      if (from && until && from > until) return { error: "It ends before it starts" };
      data = { [field]: d };
      break;
    }
  }
  await db.webMenuItem.upsert({ where: { recipeId: recipe.id }, create: { recipeId: recipe.id, ...data }, update: data });
  return done("menu");
}

/** Put several items on (or off) the website at once. */
export async function setManyOnWebsite(recipeIds: string[], on: boolean): Promise<R & { message?: string }> {
  await requireUser("MANAGER");
  const ids = (await db.recipe.findMany({ where: { id: { in: recipeIds.slice(0, 500).map(String) } }, select: { id: true } })).map((r) => r.id);
  await db.$transaction(ids.map((id) => db.webMenuItem.upsert({ where: { recipeId: id }, create: { recipeId: id, onWebsite: on }, update: { onWebsite: on } })));
  done("menu");
  return { message: `${ids.length} item${ids.length === 1 ? "" : "s"} ${on ? "on" : "off"} the website.` };
}

// ---- Sections -------------------------------------------------------------------------

const SECTION_FIELDS = ["title", "intro", "note", "modifiers", "sort", "availableFrom", "availableUntil"] as const;

export async function setSectionField(sectionId: string, fallbackTitle: string, place: string, field: (typeof SECTION_FIELDS)[number], raw: string): Promise<R> {
  await requireUser("MANAGER");
  const id = String(sectionId);
  if (!/^[a-z0-9-]{1,60}$/.test(id) || !SECTION_FIELDS.includes(field)) return { error: "Unknown section" };
  const v = String(raw ?? "").trim();
  let data: Record<string, unknown>;
  switch (field) {
    case "title":
      if (v.length > 60) return { error: "Keep it under 60 characters" };
      data = { title: v || String(fallbackTitle).slice(0, 60) };
      break;
    case "intro":
    case "note":
    case "modifiers":
      if (v.length > 400) return { error: "Keep it under 400 characters" };
      data = { [field]: v || null };
      break;
    case "sort": {
      const n = v ? Number(v) : 0;
      if (!Number.isInteger(n) || Math.abs(n) > 9999) return { error: "A whole number" };
      data = { sort: n };
      break;
    }
    case "availableFrom":
    case "availableUntil": {
      const d = dateOrNull(v);
      if (d === undefined) return { error: "Pick a date" };
      data = { [field]: d };
      break;
    }
  }
  await db.webMenuSection.upsert({ where: { id }, create: { id, title: String(fallbackTitle).slice(0, 60) || id, place: place === "drinks" ? "drinks" : "food", ...data }, update: data });
  return done("menu");
}

// ---- Beers ----------------------------------------------------------------------------

export async function setBeerWebField(beerId: string, field: "onWebsite" | "family" | "badge" | "hazy", raw: string): Promise<R> {
  await requireUser("MANAGER");
  const beer = await db.beer.findUnique({ where: { id: String(beerId) }, select: { id: true } });
  if (!beer) return { error: "That beer is gone" };
  const v = String(raw ?? "").trim();
  let data: Record<string, unknown>;
  switch (field) {
    case "onWebsite":
    case "hazy":
      data = { [field]: v === "true" };
      break;
    case "family":
      if (v && !isFamily(v)) return { error: "Pick a family" };
      data = { family: v || null };
      break;
    case "badge":
      if (v.length > 24) return { error: "Badges are a word or two" };
      data = { badge: v || null };
      break;
    default:
      return { error: "Unknown field" };
  }
  await db.webBeer.upsert({ where: { beerId: beer.id }, create: { beerId: beer.id, ...data }, update: data });
  return done("menu");
}

// ---- Events ---------------------------------------------------------------------------

const EVENT_FIELDS = ["hidden", "webKind", "closed", "imageAlt", "ticketUrl", "rsvpUrl", "priceLabel", "featured", "kitchenCloseOverride", "barCloseOverride", "slug"] as const;
type EventField = (typeof EVENT_FIELDS)[number];

/** The event's web row, made (with its slug) if it isn't there yet. */
async function webEventFor(eventId: string) {
  const e = await db.event.findUnique({ where: { id: eventId }, select: { id: true, date: true, title: true, kind: true } });
  if (!e || e.kind === "PRIVATE") return null;
  const have = await db.webEvent.findUnique({ where: { eventId: e.id } });
  if (have) return have;
  const date = e.date.toISOString().slice(0, 10);
  const taken = new Set((await db.webEvent.findMany({ where: { slug: { startsWith: date } }, select: { slug: true } })).map((w) => w.slug));
  return db.webEvent.create({ data: { eventId: e.id, slug: slugFor(date, e.title, taken) } });
}

export async function setEventWebField(eventId: string, field: EventField, raw: string): Promise<R> {
  await requireUser("MANAGER");
  if (!EVENT_FIELDS.includes(field)) return { error: "Unknown field" };
  const w = await webEventFor(String(eventId));
  if (!w) return { error: "That event isn't on the website" };
  const v = String(raw ?? "").trim();
  let data: Record<string, unknown>;
  switch (field) {
    case "hidden":
    case "featured":
      data = { [field]: v === "true" };
      break;
    case "webKind":
      if (v && !isFinerKind(v)) return { error: "Unknown kind" };
      data = { webKind: v || null };
      break;
    case "closed":
      data = { closed: v === "closed" ? true : v === "open" ? false : null };
      break;
    case "imageAlt":
      if (v.length > 200) return { error: "Keep it under 200 characters" };
      data = { imageAlt: v || null };
      break;
    case "priceLabel":
      if (v.length > 40) return { error: "Keep it short, like Free or $10 at the door" };
      data = { priceLabel: v || null };
      break;
    case "ticketUrl":
    case "rsvpUrl": {
      const u = v ? cleanUrl(v) : null;
      if (v && !u) return { error: "That isn't a web address" };
      data = { [field]: u };
      break;
    }
    case "kitchenCloseOverride":
    case "barCloseOverride": {
      const t = parseTypedTime(v);
      if (t === undefined) return { error: "Type a time like 8:15pm or 22:30" };
      data = { [field]: t };
      break;
    }
    case "slug": {
      const s = v.toLowerCase();
      if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,70}$/.test(s) || !isIsoDate(s.slice(0, 10))) return { error: "Start with the date, then words with dashes: 2026-11-21-knicks-night" };
      const clash = await db.webEvent.findUnique({ where: { slug: s } });
      if (clash && clash.eventId !== w.eventId) return { error: "Another event already uses that address" };
      data = { slug: s };
      break;
    }
  }
  await db.webEvent.update({ where: { eventId: w.eventId }, data });
  // Announcements that link to this event follow it to its new address.
  if (field === "slug" && data.slug !== w.slug) await db.webAnnouncement.updateMany({ where: { linkHref: `/events/${w.slug}` }, data: { linkHref: `/events/${String(data.slug)}` } });
  return done("events", "site");
}

const IMAGE_TYPES = ["image/jpeg", "image/webp", "image/png"];
const IMAGE_MAX = 1_500_000;

export async function uploadEventImage(form: FormData): Promise<R> {
  await requireUser("MANAGER");
  const eventId = String(form.get("eventId") ?? "");
  const file = form.get("file");
  const width = Number(form.get("width") ?? 0);
  const height = Number(form.get("height") ?? 0);
  if (!eventId || !(file instanceof File)) return { error: "Pick an image." };
  if (!IMAGE_TYPES.includes(file.type)) return { error: "Use a JPEG, PNG or WebP image." };
  if (file.size > IMAGE_MAX) return { error: "That image is too big. Under 1.5 MB, please." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(png && file.type === "image/png") && !(jpg && file.type === "image/jpeg") && !(webp && file.type === "image/webp")) return { error: "That file isn't a readable image." };
  const w = await webEventFor(eventId);
  if (!w) return { error: "That event isn't on the website" };
  const img = await db.webImage.create({ data: { mime: file.type, bytes, width: Number.isFinite(width) ? Math.round(width) : 0, height: Number.isFinite(height) ? Math.round(height) : 0 } });
  await db.webEvent.update({ where: { eventId: w.eventId }, data: { imageId: img.id } });
  // The old picture is no longer referenced by anything.
  if (w.imageId) await db.webImage.deleteMany({ where: { id: w.imageId } });
  return done("events");
}

export async function removeEventImage(eventId: string): Promise<R> {
  await requireUser("MANAGER");
  const w = await db.webEvent.findUnique({ where: { eventId: String(eventId) } });
  if (!w?.imageId) return {};
  await db.webEvent.update({ where: { eventId: w.eventId }, data: { imageId: null, imageAlt: null } });
  await db.webImage.deleteMany({ where: { id: w.imageId } });
  return done("events");
}

// ---- Inquiries, connection ----------------------------------------------------------

export async function markInquiriesSeen(ids: string[]): Promise<R> {
  await requireUser("MANAGER");
  await db.webInquiry.updateMany({ where: { id: { in: ids.slice(0, 200).map(String) }, seenAt: null }, data: { seenAt: new Date() } });
  revalidatePath("/website");
  return {};
}

export async function testWebsitePing(): Promise<PingResult> {
  await requireUser("MANAGER");
  const r = await sendPing(["events", "menu", "site"]);
  revalidatePath("/website");
  return r;
}

