import "server-only";
import { after } from "next/server";
import { addDays, toISODate } from "@/domain/dates";
import { hoursOn, seasonOn } from "@/domain/openingHours";
import { beerColor } from "@/domain/kegs";
import { parseAddress, parseLinks, parsePhone, isEmailAddress, type WebLinks } from "@/domain/websiteContact";
import { feedAnnouncements, type StoredAnnouncement } from "@/domain/websiteAnnouncements";
import { feedPage, parseStoredPage } from "@/domain/websiteEventPage";
import { isBuyout } from "@/domain/privateEvents";
import { feedEvent, privateClosureEvent, slugFor, type WebEventIn } from "@/domain/websiteEvents";
import { liveNotice, parseExactHours, parseNotice, webSeasons, webWeek, type ExactHours, type StoredNotice } from "@/domain/websiteHours";
import { buildMenu, DEFAULT_NOTICES, type MenuRecipeIn, type MenuWarning, type SectionMetaIn, type TapBeerIn } from "@/domain/websiteMenu";
import { eventsFeedSchema, siteFeedSchema, SITE_TIMEZONE, type EventsFeed, type SiteFeed, type WebMenu } from "@/domain/websiteSchema";
import { db, num } from "../db";
import { env } from "../env";
import { getRegularHours, getSeasonalHours } from "./labor-rules";
import { getPrivateEventConfig } from "./privateEvents";
import { businessToday } from "./sales";
import { getSecrets } from "./secrets";
import { getBusinessContact } from "./settings";
import { tapList } from "./taps";

/**
 * Everything guests see on the public website, read from Ops: the site feed
 * (hours, notice, contact), the menu, events with their web fields, and the
 * revalidate ping that tells the website to read them again after a save.
 * The feeds live in src/app/api/public/*; the contract is docs/website-integration.md.
 */

// ---- Settings -------------------------------------------------------------------------

export const WEBSITE_KEYS = {
  notice: "website.notice",
  /** The notice the website was last told about (for the morning start/end ping). */
  noticeSent: "website.notice.sent",
  exactHours: "website.hours",
  links: "website.links",
  phoneNote: "website.phoneNote",
  holidaysClosed: "website.holidaysClosed",
  menuNotices: "website.menuNotices",
  lastPing: "website.ping.last",
  changed: (tag: WebsiteTag) => `website.changed.${tag}`,
} as const;

async function readJson<T>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  const v = JSON.stringify(value);
  await db.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export interface WebsiteSettings {
  notice: StoredNotice | null;
  exactHours: ExactHours;
  links: WebLinks;
  phoneNote: string;
  holidaysClosed: boolean;
  menuNotices: string[];
}

export async function websiteSettings(): Promise<WebsiteSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: [WEBSITE_KEYS.notice, WEBSITE_KEYS.exactHours, WEBSITE_KEYS.links, WEBSITE_KEYS.phoneNote, WEBSITE_KEYS.holidaysClosed, WEBSITE_KEYS.menuNotices] } } });
  const get = (k: string) => {
    const r = rows.find((x) => x.key === k);
    if (!r) return null;
    try {
      return JSON.parse(r.value) as unknown;
    } catch {
      return null;
    }
  };
  const notices = get(WEBSITE_KEYS.menuNotices);
  return {
    notice: parseNotice(get(WEBSITE_KEYS.notice)),
    exactHours: parseExactHours(get(WEBSITE_KEYS.exactHours)),
    links: parseLinks(get(WEBSITE_KEYS.links)),
    phoneNote: typeof get(WEBSITE_KEYS.phoneNote) === "string" ? (get(WEBSITE_KEYS.phoneNote) as string) : "",
    holidaysClosed: get(WEBSITE_KEYS.holidaysClosed) === true,
    menuNotices: Array.isArray(notices) ? notices.filter((n): n is string => typeof n === "string") : DEFAULT_NOTICES,
  };
}

export async function saveWebsiteSetting<K extends keyof WebsiteSettings>(key: K, value: WebsiteSettings[K] | null) {
  const k = WEBSITE_KEYS[key];
  if (value === null) await db.setting.deleteMany({ where: { key: k } });
  else await writeJson(k, value);
}

// ---- Site feed --------------------------------------------------------------------------

/** Website announcements as stored, for the feed (never the staff Announcement model). */
export async function storedAnnouncements(): Promise<StoredAnnouncement[]> {
  const rows = await db.webAnnouncement.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ publicId: r.publicId, text: r.text, tone: r.tone, linkHref: r.linkHref, linkLabel: r.linkLabel, from: iso(r.from), until: iso(r.until), sort: r.sort, active: r.active }));
}

export async function siteFeed(): Promise<{ feed: SiteFeed; stale: ReturnType<typeof webWeek>["stale"] }> {
  const today = businessToday();
  const [regular, seasons, s, contact, changed, announcements] = await Promise.all([getRegularHours(), getSeasonalHours(), websiteSettings(), getBusinessContact(), readJson<string>(WEBSITE_KEYS.changed("site")), storedAnnouncements()]);
  const week = webWeek(hoursOn(today, regular, seasons), s.exactHours);
  const phone = parsePhone(contact.phone);
  const feed: SiteFeed = {
    timezone: SITE_TIMEZONE,
    hours: week.hours,
    notice: liveNotice(s.notice, today),
    season: seasonOn(today, seasons)?.label ?? null,
    seasons: webSeasons(seasons, s.exactHours),
    name: contact.name.trim() || null,
    address: parseAddress(contact.address),
    phone: phone ? { ...phone, note: s.phoneNote.trim() } : null,
    email: isEmailAddress(contact.email) ? contact.email.trim() : null,
    links: s.links,
    updatedAt: changed ?? null,
    announcements: feedAnnouncements(announcements, today),
  };
  return { feed: siteFeedSchema.parse(feed), stale: week.stale };
}

// ---- Menu feed --------------------------------------------------------------------------

function iso(d: Date | null | undefined) {
  return d ? toISODate(d) : null;
}
const nyDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: env.BUSINESS_TIMEZONE }).format(d);

/** What the menu screen and the feed both need: recipes with web fields, sections, taps. */
export async function menuInputs() {
  const [recipes, items, sections, beers, taps, s, changed] = await Promise.all([
    db.recipe.findMany({ where: { kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true, category: true, kind: true, menuPrice: true, active: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.webMenuItem.findMany(),
    db.webMenuSection.findMany(),
    db.webBeer.findMany(),
    tapList(),
    websiteSettings(),
    readJson<string>(WEBSITE_KEYS.changed("menu")),
  ]);
  const byRecipe = new Map(items.map((i) => [i.recipeId, i]));
  const byBeer = new Map(beers.map((b) => [b.beerId, b]));
  const recipeIns: MenuRecipeIn[] = recipes.map((r) => {
    const w = byRecipe.get(r.id);
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      kind: r.kind === "MODIFIER" ? "MODIFIER" : "MENU",
      menuPrice: num(r.menuPrice),
      active: r.active,
      web: w
        ? { onWebsite: w.onWebsite, name: w.name, description: w.description, tags: w.tags, badge: w.badge, modifiers: w.modifiers, place: w.place, section: w.section, sort: w.sort, showPrice: w.showPrice, availableFrom: iso(w.availableFrom), availableUntil: iso(w.availableUntil) }
        : null,
    };
  });
  const sectionIns: SectionMetaIn[] = sections.map((x) => ({ id: x.id, title: x.title, place: x.place, intro: x.intro, note: x.note, modifiers: x.modifiers, sort: x.sort, availableFrom: iso(x.availableFrom), availableUntil: iso(x.availableUntil) }));
  const tapIns: TapBeerIn[] = taps.rows
    .filter((t) => t.beerId)
    .map((t) => {
      const w = byBeer.get(t.beerId!);
      return { beerId: t.beerId!, name: t.beer, style: t.style, abv: t.abv, description: t.description, color: beerColor(t.color).bg, house: t.house, diet: t.diet, pours: t.pours, web: w ? { onWebsite: w.onWebsite, family: w.family, badge: w.badge, hazy: w.hazy } : null };
    });
  const stamps = [...items.map((i) => i.updatedAt), ...sections.map((x) => x.updatedAt), ...beers.map((b) => b.updatedAt), ...(changed ? [new Date(changed)] : [])].filter((d) => !Number.isNaN(d.getTime()));
  const latest = stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : new Date();
  return { recipes: recipeIns, sections: sectionIns, taps: tapIns, notices: s.menuNotices, updated: nyDate(latest), tapRows: taps.rows };
}

export async function menuFeed(): Promise<{ menu: WebMenu; warnings: MenuWarning[]; counts: { food: number; drinks: number; beers: number } }> {
  const i = await menuInputs();
  return buildMenu({ recipes: i.recipes, sections: i.sections, taps: i.taps, notices: i.notices, today: businessToday(), updated: i.updated });
}

// ---- Events feed --------------------------------------------------------------------------

export const imageUrl = (origin: string, id: string | null | undefined) => (id ? `${origin.replace(/\/+$/, "")}/api/public/images/${id}` : null);

/** Gives every public event a stable slug the first time it's seen (never changed after). */
export async function ensureSlugs(events: { id: string; date: Date; title: string }[]) {
  if (!events.length) return;
  const have = new Set((await db.webEvent.findMany({ where: { eventId: { in: events.map((e) => e.id) } }, select: { eventId: true } })).map((w) => w.eventId));
  const missing = events.filter((e) => !have.has(e.id));
  if (!missing.length) return;
  const dates = [...new Set(missing.map((e) => toISODate(e.date)))];
  const taken = new Set((await db.webEvent.findMany({ where: { OR: dates.map((d) => ({ slug: { startsWith: d } })) }, select: { slug: true } })).map((w) => w.slug));
  const rows = missing.map((e) => {
    const slug = slugFor(toISODate(e.date), e.title, taken);
    taken.add(slug);
    return { eventId: e.id, slug };
  });
  // Two feeds racing: the second insert of the same event or slug is skipped, not an error.
  await db.webEvent.createMany({ data: rows, skipDuplicates: true });
}

export async function eventsFeed(opts: { days: number; pastDays: number; origin: string }): Promise<EventsFeed> {
  const today = businessToday();
  const from = addDays(today, -opts.pastDays);
  const to = addDays(today, opts.days);
  const where = { date: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) }, kind: { notIn: ["PRIVATE"] } };
  const rows = await db.event.findMany({ where, orderBy: [{ date: "asc" }, { startTime: "asc" }], select: { id: true, date: true, title: true, kind: true, startTime: true, endTime: true, notes: true, updatedAt: true } });
  await ensureSlugs(rows);
  const [webs, s] = await Promise.all([db.webEvent.findMany({ where: { eventId: { in: rows.map((r) => r.id) } } }), websiteSettings()]);
  const byId = new Map(webs.map((w) => [w.eventId, w]));
  const events = rows
    .map((e) => {
      const w = byId.get(e.id);
      const hero = imageUrl(opts.origin, w?.heroImageId);
      const web: WebEventIn | null = w
        ? { slug: w.slug, hidden: w.hidden, webKind: w.webKind, closed: w.closed, imageUrl: imageUrl(opts.origin, w.imageId), imageAlt: w.imageAlt, ticketUrl: w.ticketUrl, rsvpUrl: w.rsvpUrl, priceLabel: w.priceLabel, featured: w.featured, kitchenCloseOverride: w.kitchenCloseOverride, barCloseOverride: w.barCloseOverride, page: feedPage(parseStoredPage(w.page), hero ? { url: hero, alt: w.heroAlt } : null), updatedAt: w.updatedAt.toISOString() }
        : null;
      return feedEvent({ id: e.id, date: toISODate(e.date), title: e.title, kind: e.kind, startTime: e.startTime, endTime: e.endTime, notes: e.notes, updatedAt: e.updatedAt.toISOString() }, web, { holidaysClosed: s.holidaysClosed });
    })
    .filter((e): e is NonNullable<typeof e> => !!e);
  const closures = await privateClosures(where.date);
  const all = closures.length ? [...events, ...closures].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? "")) : events;
  return eventsFeedSchema.parse({ timezone: SITE_TIMEZONE, events: all });
}

/** Buyouts (the whole place booked) as "Closed for a private event"; nothing about the booking leaves. */
async function privateClosures(date: { gte: Date; lt: Date }) {
  const rows = await db.event.findMany({
    where: { date, kind: "PRIVATE", privateEvent: { isNot: null } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, date: true, startTime: true, endTime: true, updatedAt: true, privateEvent: { select: { space: true, type: true } } },
  });
  if (!rows.length) return [];
  const { spaces } = await getPrivateEventConfig();
  return rows
    .filter((r) => r.privateEvent && isBuyout(r.privateEvent, spaces))
    .map((r) => privateClosureEvent({ id: r.id, date: toISODate(r.date), startTime: r.startTime, endTime: r.endTime, updatedAt: r.updatedAt.toISOString() }))
    .filter((e): e is NonNullable<typeof e> => !!e);
}

// ---- Revalidate ping ------------------------------------------------------------------------

export type WebsiteTag = "events" | "menu" | "site";

export interface PingResult {
  at: string;
  ok: boolean;
  /** Not connected yet: nothing was sent. */
  skipped?: boolean;
  status?: number;
  message: string;
  tags: WebsiteTag[];
}

export const PING_DEBOUNCE_MS = 2500;

let generation = 0;
const pendingTags = new Set<WebsiteTag>();

/** The website address and secret, from Settings → Connections (or env). */
export async function websiteConnection(): Promise<{ url: string | null; secret: string | null }> {
  const s = await getSecrets(["WEBSITE_URL", "REVALIDATE_SECRET"] as const);
  return { url: s.WEBSITE_URL?.replace(/\/+$/, "") ?? null, secret: s.REVALIDATE_SECRET };
}

/** POST {url}/api/revalidate now and remember the result. Never throws. */
export async function sendPing(tags: WebsiteTag[]): Promise<PingResult> {
  const at = new Date().toISOString();
  let r: PingResult;
  try {
    const { url, secret } = await websiteConnection();
    if (!url || !secret) {
      r = { at, ok: false, skipped: true, message: !url ? "The website address isn't set yet" : "The shared secret isn't set yet", tags };
    } else {
      const res = await fetch(`${url}/api/revalidate`, {
        method: "POST",
        headers: { "x-revalidate-secret": secret, "content-type": "application/json" },
        body: JSON.stringify({ tags, source: "subversive-ops" }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
        redirect: "manual",
      });
      r =
        res.status === 200
          ? { at, ok: true, status: 200, message: "The website refreshed", tags }
          : { at, ok: false, status: res.status, message: res.status === 401 ? "The website turned the secret down. It must match REVALIDATE_SECRET on the website" : res.status === 404 ? "The website has no refresh address at /api/revalidate" : `The website answered ${res.status}`, tags };
    }
  } catch (e) {
    const err = e as Error;
    r = { at, ok: false, message: err.name === "TimeoutError" ? "The website didn't answer within 8 seconds" : `Couldn't reach the website (${err.message.slice(0, 120)})`, tags };
  }
  if (!r.ok && !r.skipped) console.error(`website revalidate ping failed: ${r.message}`);
  try {
    await writeJson(WEBSITE_KEYS.lastPing, r);
  } catch (e) {
    console.error("website: couldn't save the ping result", e);
  }
  return r;
}

export async function lastPing(): Promise<PingResult | null> {
  return readJson<PingResult>(WEBSITE_KEYS.lastPing);
}

/**
 * Call after any save that changes what guests see. Returns at once: it marks the
 * feed as changed, waits a moment so a burst of edits sends one ping, then pings
 * the website after the response has gone out. Never throws, never blocks a save.
 */
export function pingWebsite(...tags: WebsiteTag[]) {
  const mine = ++generation;
  for (const t of tags) pendingTags.add(t);
  const task = async () => {
    try {
      const now = new Date().toISOString();
      await Promise.all(tags.map((t) => writeJson(WEBSITE_KEYS.changed(t), now)));
      await new Promise((r) => setTimeout(r, PING_DEBOUNCE_MS));
      if (mine !== generation) return; // a later save in this instance will send it
      const send = [...pendingTags];
      pendingTags.clear();
      await sendPing(send);
    } catch (e) {
      console.error("website ping failed", e);
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * The website only hears about a save, so a notice that starts or ends on its
 * own needs a ping that day. Run each morning (daily-ops cron): when the notice
 * guests should see today differs from the one last sent, mark the site feed
 * changed and ping "site". Idempotent: the notice sent is remembered.
 */
export async function noticeTurnover(): Promise<{ showing: boolean; pinged: boolean; ping?: PingResult }> {
  const live = liveNotice((await websiteSettings()).notice, businessToday());
  const now = JSON.stringify(live);
  if ((await readJson<string>(WEBSITE_KEYS.noticeSent)) === now) return { showing: !!live, pinged: false };
  await writeJson(WEBSITE_KEYS.changed("site"), new Date().toISOString());
  const ping = await sendPing(["site"]);
  await writeJson(WEBSITE_KEYS.noticeSent, now);
  return { showing: !!live, pinged: true, ping };
}

/** After a save that pings the website itself: remember what it was told, so the morning run doesn't repeat it. */
export async function rememberNoticeSent(): Promise<void> {
  const live = liveNotice((await websiteSettings()).notice, businessToday());
  await writeJson(WEBSITE_KEYS.noticeSent, JSON.stringify(live));
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---- Health ---------------------------------------------------------------------------

export interface FeedHealth {
  id: "site" | "menu" | "events" | "taps";
  path: string;
  ok: boolean;
  count: number;
  noun: string;
  detail: string;
}

/** Each feed built here exactly as the website would get it, with a count. */
export async function feedsHealth(origin: string): Promise<FeedHealth[]> {
  const run = async (id: FeedHealth["id"], path: string, noun: string, fn: () => Promise<{ count: number; detail: string }>): Promise<FeedHealth> => {
    try {
      const r = await fn();
      return { id, path, ok: true, noun, ...r };
    } catch (e) {
      return { id, path, ok: false, count: 0, noun, detail: (e as Error).message.slice(0, 160) };
    }
  };
  return Promise.all([
    run("site", "/api/public/site", "open days", async () => {
      const { feed, stale } = await siteFeed();
      const open = Object.values(feed.hours).filter(Boolean).length;
      const n = Object.keys(stale).length;
      const a = feed.announcements.length;
      const extra = a ? ` · ${plural(a, "announcement")}` : "";
      return { count: open, detail: (n ? `${n} day${n === 1 ? "" : "s"} with exact times that no longer fit` : feed.notice ? "Notice showing" : "No notice") + extra };
    }),
    run("menu", "/api/public/menu", "items", async () => {
      const m = await menuFeed();
      return { count: m.counts.food + m.counts.drinks + m.counts.beers, detail: `${m.counts.food} food · ${m.counts.drinks} drinks · ${m.counts.beers} on tap${m.warnings.length ? ` · ${m.warnings.length} to check` : ""}` };
    }),
    run("events", "/api/public/events", "upcoming", async () => {
      const f = await eventsFeed({ days: 120, pastDays: 0, origin });
      const pages = f.events.filter((e) => e.page).length;
      return { count: f.events.length, detail: plural(f.events.filter((e) => e.closed).length, "closed day") + ` · ${f.events.filter((e) => e.imageUrl).length} with a picture` + (pages ? ` · ${plural(pages, "event page")}` : "") };
    }),
    run("taps", "/api/public/taps", "taps", async () => {
      const t = await tapList();
      return { count: t.rows.length, detail: t.comingSoon.length ? `${t.comingSoon.length} coming soon` : "Tap list for the TV and site" };
    }),
  ]);
}

