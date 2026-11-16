/**
 * The public website's feed contracts, mirrored from the website repo
 * (theoquimby/subversive-website) so Ops can check its own output before it
 * leaves: every public feed parses its JSON with these schemas in tests and at
 * runtime (a bad row is dropped and logged, never served).
 *
 *   menu   ← website src/lib/menu/schema.ts (menuSchema, every object strict)
 *   events ← website src/lib/events/schema.ts (envelope + eventSchema)
 *   site   ← the fields of website src/lib/site/schema.ts that Ops owns
 *            (hours, contact, links) plus the notice from docs/ops-feed-requests.md
 *
 * Keep these in step with the website: a change there is a change here.
 * Pure (zod only), safe in the browser.
 */

import { z } from "zod";

export const SITE_TIMEZONE = "America/New_York" as const;

// ---- Shared atoms (website src/lib/time/ny.ts) ---------------------------------------

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A real calendar date "YYYY-MM-DD" (Feb 30 is not). */
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** "HH:mm", 24 h, 00:00–23:59. */
export const isHHmm = (s: string) => HH_MM.test(s);

const isoDate = z.string().refine(isIsoDate, "expected a real YYYY-MM-DD date");
const hhmm = z.string().refine(isHHmm, "expected HH:mm (24 h)");

// ---- Menu (website src/lib/menu/schema.ts) -------------------------------------------

export const MENU_TAGS = ["vegetarian", "vegan", "kid-friendly", "dog-friendly"] as const;
export type MenuTag = (typeof MENU_TAGS)[number];

const weekday = z.enum(WEEKDAYS);
const tag = z.enum(MENU_TAGS);
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "expected #RRGGBB");
const price = z.number().nonnegative();
const text = z.string().optional();

const windowShape = {
  seasonal: z.boolean().optional(),
  availableFrom: isoDate.optional(),
  availableUntil: isoDate.optional(),
};

const ordered = (w: { availableFrom?: string; availableUntil?: string }) => !(w.availableFrom && w.availableUntil && w.availableFrom > w.availableUntil);
const orderedMessage = { message: "availableFrom is after availableUntil" };

const availability = z.strictObject({
  days: z.array(weekday).min(1),
  label: z.string().min(1),
  title: z.string().min(1).optional(),
});

const itemBase = {
  ...windowShape,
  name: z.string().min(1),
  description: text,
  modifiers: z.string().optional(),
  tags: z.array(tag).optional(),
  badge: z.string().optional(),
  availability: availability.optional(),
};

export const beerItemSchema = z
  .strictObject({
    ...itemBase,
    style: z.string().min(1),
    abv: z.number().positive().max(20),
    prices: z.strictObject({ half: price, full: price }),
    color: hex,
    hazy: z.boolean().optional(),
  })
  .refine(ordered, orderedMessage);

export const plainItemSchema = z
  .strictObject({
    ...itemBase,
    price: price.optional(),
    producer: z.string().optional(),
    origin: z.string().optional(),
    verifyPrice: z.boolean().optional(),
  })
  .refine(ordered, orderedMessage);

const group = z
  .strictObject({
    ...windowShape,
    title: z.string().min(1),
    note: z.string().optional(),
    items: z.array(z.union([beerItemSchema, plainItemSchema])),
  })
  .refine(ordered, orderedMessage);

const sectionId = z.string().regex(/^[a-z0-9-]+$/);

const drinkSection = z
  .strictObject({
    ...windowShape,
    id: sectionId,
    title: z.string().min(1),
    note: z.string().optional(),
    groups: z.array(group),
  })
  .refine(ordered, orderedMessage);

const foodSection = z
  .strictObject({
    ...windowShape,
    id: sectionId,
    title: z.string().min(1),
    intro: z.string().optional(),
    modifiers: z.string().optional(),
    note: z.string().optional(),
    items: z.array(plainItemSchema),
  })
  .refine(ordered, orderedMessage);

export const menuSchema = z.strictObject({
  _meta: z.strictObject({
    source: z.string(),
    verify: z.array(z.string()),
    pourSizes: z.strictObject({ half: z.string(), full: z.string() }),
    updated: isoDate,
  }),
  drinks: z.array(drinkSection),
  food: z.array(foodSection),
  notices: z.array(z.string()),
});

export type WebMenu = z.infer<typeof menuSchema>;
export type WebBeerItem = z.infer<typeof beerItemSchema>;
export type WebPlainItem = z.infer<typeof plainItemSchema>;
export type WebMenuGroup = z.infer<typeof group>;
export type WebDrinkSection = z.infer<typeof drinkSection>;
export type WebFoodSection = z.infer<typeof foodSection>;

// ---- Events (website src/lib/events/schema.ts) ---------------------------------------
// The website's reader is tolerant (bad events are dropped). Ops checks its own output
// strictly: what the website would keep, with nothing it would silently discard.

/** Kinds the website understands; TRIVIA and MOVIE are read as OTHER + kindRaw. */
export const WEB_EVENT_KINDS = ["GAME", "MUSIC", "FESTIVAL", "OTHER", "HOLIDAY", "CLOSURE", "TRIVIA", "MOVIE"] as const;
export type WebEventKind = (typeof WEB_EVENT_KINDS)[number];

const optionalText = z.string().min(1).optional();

// A featured event's own page (website src/lib/events/schema.ts eventPageSchema).
const line = (max: number) => z.string().trim().min(1).max(max);
const httpsUrl = z.url({ protocol: /^https$/ });
export const feedEventPageSchema = z.strictObject({
  hero: httpsUrl.optional(),
  heroAlt: line(200).optional(),
  intro: line(600).optional(),
  sections: z.array(z.strictObject({ title: line(80), body: line(4000) })).max(8).optional(),
  schedule: z.array(z.strictObject({ time: line(20), what: line(140) })).max(24).optional(),
  links: z.array(z.strictObject({ label: line(60), href: httpsUrl })).max(6).optional(),
});
export type FeedEventPage = z.infer<typeof feedEventPageSchema>;

export const feedEventSchema = z.strictObject({
  id: z.string().min(1),
  date: isoDate,
  title: z.string().min(1),
  kind: z.enum(WEB_EVENT_KINDS),
  closed: z.boolean(),
  startTime: hhmm.nullable(),
  endTime: hhmm.nullable(),
  description: z.string().nullable(),
  slug: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/, "expected YYYY-MM-DD-kebab-title").optional(),
  imageUrl: z.url().optional(),
  imageAlt: optionalText,
  ticketUrl: z.url().optional(),
  rsvpUrl: z.url().optional(),
  priceLabel: optionalText,
  kitchenCloseOverride: hhmm.optional(),
  barCloseOverride: hhmm.optional(),
  featured: z.boolean().optional(),
  page: feedEventPageSchema.optional(),
  updatedAt: optionalText,
});

export const eventsFeedSchema = z.strictObject({
  timezone: z.literal(SITE_TIMEZONE),
  events: z.array(feedEventSchema),
});

export type FeedEvent = z.infer<typeof feedEventSchema>;
export type EventsFeed = z.infer<typeof eventsFeedSchema>;

// ---- Site (hours, notice, contact) ---------------------------------------------------

const dayHours = z.strictObject({ open: hhmm, close: hhmm, kitchenClose: hhmm }).nullable();
export const weeklyHoursSchema = z.strictObject({ mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours });
export type WebDayHours = z.infer<typeof dayHours>;
export type WebWeekHours = z.infer<typeof weeklyHoursSchema>;

export const LINK_KEYS = ["order", "eGiftCard", "map", "instagram", "facebook", "bandBookingForm"] as const;
export type LinkKey = (typeof LINK_KEYS)[number];

const url = z.url();

// The band under the website's header (website src/lib/site/announcements.ts).
export const ANNOUNCEMENT_TONES = ["closure", "event", "info"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

/** A path on the website ("/events/oktoberfest") or a full https address; nothing else. */
export const isWebsiteHref = (s: string) => (s.startsWith("/") && !s.startsWith("//") && !/\s/.test(s)) || /^https:\/\/[^\s]+$/.test(s);

export const feedAnnouncementSchema = z.strictObject({
  id: z.string().min(1).max(64),
  text: line(140),
  tone: z.enum(ANNOUNCEMENT_TONES),
  link: z.strictObject({ href: z.string().min(1).refine(isWebsiteHref, "expected /path or https URL"), label: line(40) }).optional(),
  from: isoDate.optional(),
  until: isoDate.optional(),
});
export type FeedAnnouncement = z.infer<typeof feedAnnouncementSchema>;

export const siteFeedSchema = z.strictObject({
  timezone: z.literal(SITE_TIMEZONE),
  /** The week in force today (seasonal hours applied). */
  hours: weeklyHoursSchema,
  notice: z.strictObject({ text: z.string().min(1).max(280), until: isoDate.nullable() }).nullable(),
  /** The season in force today, if any, and every season with its own week. */
  season: z.string().nullable(),
  seasons: z.array(z.strictObject({ label: z.string().min(1), from: z.string().regex(/^\d{2}-\d{2}$/), to: z.string().regex(/^\d{2}-\d{2}$/), hours: weeklyHoursSchema })),
  // Contact: each is null when not filled in Ops (the website keeps its own value).
  name: z.string().min(1).nullable(),
  address: z.strictObject({ street: z.string(), city: z.string(), state: z.string(), zip: z.string(), geo: z.null() }).nullable(),
  phone: z.strictObject({ display: z.string().min(1), tel: z.string().regex(/^\+1\d{10}$/), note: z.string() }).nullable(),
  email: z.email().nullable(),
  /** Only the links set in Ops. */
  links: z.strictObject(Object.fromEntries(LINK_KEYS.map((k) => [k, url.optional()])) as Record<LinkKey, z.ZodOptional<typeof url>>),
  /** Last time anything here was saved in Ops (null until the first save). */
  updatedAt: z.string().nullable(),
  /** Lines for the band under the header: active, in order, not yet ended (future ones too; the website filters by day). */
  announcements: z.array(feedAnnouncementSchema),
});

export type SiteFeed = z.infer<typeof siteFeedSchema>;
