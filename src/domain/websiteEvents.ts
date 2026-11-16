/**
 * Calendar events as the website reads them (GET /api/public/events): only
 * guest-facing fields, the optional web fields Max sets on the Website page, and
 * stable slugs. Hidden events never leave, nor does anything about a private
 * booking: a buyout goes out only as "Closed for a private event". Pure.
 */

import { kebab } from "./websiteMenu";
import { feedEventSchema, isHHmm, WEB_EVENT_KINDS, type FeedEvent, type FeedEventPage, type WebEventKind } from "./websiteSchema";

export const FINER_KINDS = ["TRIVIA", "MOVIE"] as const;
export type FinerKind = (typeof FINER_KINDS)[number];
export const isFinerKind = (s: string | null | undefined): s is FinerKind => !!s && (FINER_KINDS as readonly string[]).includes(s);

export interface EventIn {
  id: string;
  date: string;
  title: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface WebEventIn {
  slug: string;
  hidden: boolean;
  webKind: string | null;
  closed: boolean | null;
  imageUrl: string | null;
  imageAlt: string | null;
  ticketUrl: string | null;
  rsvpUrl: string | null;
  priceLabel: string | null;
  featured: boolean;
  kitchenCloseOverride: string | null;
  barCloseOverride: string | null;
  /** The event's own page, already built for the feed (websiteEventPage.feedPage). */
  page?: FeedEventPage;
  updatedAt: string;
}

export interface EventFeedOptions {
  /** Whether a HOLIDAY means closed (Website → Events setting). */
  holidaysClosed: boolean;
}

/** "2026-11-21-knicks-vs-blazers"; a clash gets -2, -3… */
export function slugFor(date: string, title: string, taken: ReadonlySet<string>): string {
  const base = `${date}-${kebab(title) || "event"}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const s = `${base.slice(0, 70)}-${i}`;
    if (!taken.has(s)) return s;
  }
}

/** Whether the website shows the day as closed. */
export function isClosed(kind: string, override: boolean | null | undefined, opts: EventFeedOptions): boolean {
  if (override != null) return override;
  return kind === "CLOSURE" || (kind === "HOLIDAY" && opts.holidaysClosed);
}

const httpUrl = (s: string | null | undefined) => {
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};
const text = (s: string | null | undefined) => (s && s.trim() ? s.trim() : undefined);

/** One event for the feed, or null when it shouldn't be public (private, hidden). */
export function feedEvent(e: EventIn, w: WebEventIn | null, opts: EventFeedOptions): FeedEvent | null {
  if (e.kind === "PRIVATE" || w?.hidden) return null;
  const kind: WebEventKind = isFinerKind(w?.webKind) ? w!.webKind as WebEventKind : ((WEB_EVENT_KINDS as readonly string[]).includes(e.kind) ? (e.kind as WebEventKind) : "OTHER");
  const updated = [e.updatedAt, w?.updatedAt].filter((x): x is string => !!x).sort().pop();
  const out: FeedEvent = {
    id: e.id,
    date: e.date,
    title: e.title.trim(),
    kind,
    closed: isClosed(e.kind, w?.closed, opts),
    startTime: e.startTime && isHHmm(e.startTime) ? e.startTime : null,
    endTime: e.endTime && isHHmm(e.endTime) ? e.endTime : null,
    description: text(e.notes) ?? null,
  };
  if (w) {
    if (/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(w.slug)) out.slug = w.slug;
    const img = httpUrl(w.imageUrl);
    if (img) {
      out.imageUrl = img;
      if (text(w.imageAlt)) out.imageAlt = text(w.imageAlt);
    }
    const ticket = httpUrl(w.ticketUrl);
    if (ticket) out.ticketUrl = ticket;
    const rsvp = httpUrl(w.rsvpUrl);
    if (rsvp) out.rsvpUrl = rsvp;
    if (text(w.priceLabel)) out.priceLabel = text(w.priceLabel);
    if (w.kitchenCloseOverride && isHHmm(w.kitchenCloseOverride)) out.kitchenCloseOverride = w.kitchenCloseOverride;
    if (w.barCloseOverride && isHHmm(w.barCloseOverride)) out.barCloseOverride = w.barCloseOverride;
    if (w.featured) out.featured = true;
    if (w.page) out.page = w.page;
  }
  if (updated) out.updatedAt = updated;
  const ok = feedEventSchema.safeParse(out);
  if (ok.success) return ok.data;
  // A page that doesn't pass is left off; the event itself still goes.
  if (!out.page) return null;
  delete out.page;
  const again = feedEventSchema.safeParse(out);
  return again.success ? again.data : null;
}

/** What the website says on a day the whole place is booked. Never who booked it. */
export const PRIVATE_CLOSURE_TITLE = "Closed for a private event";

/**
 * A buyout on the website: a closure with its hours and nothing else (no
 * client, no headcount, no notes). Bookings that only take part of the place
 * aren't sent at all.
 */
export function privateClosureEvent(e: { id: string; date: string; startTime: string | null; endTime: string | null; updatedAt: string }): FeedEvent | null {
  const out: FeedEvent = {
    id: e.id,
    date: e.date,
    title: PRIVATE_CLOSURE_TITLE,
    kind: "CLOSURE",
    closed: true,
    startTime: e.startTime && isHHmm(e.startTime) ? e.startTime : null,
    endTime: e.endTime && isHHmm(e.endTime) ? e.endTime : null,
    description: null,
    updatedAt: e.updatedAt,
  };
  const ok = feedEventSchema.safeParse(out);
  return ok.success ? ok.data : null;
}

/** pastDays and days from the query string, clamped. */
export function feedWindow(params: URLSearchParams): { days: number; pastDays: number } {
  const n = (k: string, d: number, max: number) => {
    const v = Number(params.get(k));
    return Number.isFinite(v) && params.get(k) !== null && params.get(k) !== "" ? Math.min(max, Math.max(0, Math.floor(v))) : d;
  };
  return { days: Math.max(1, n("days", 120, 365)), pastDays: n("pastDays", 0, 365) };
}
