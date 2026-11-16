/**
 * Website announcements: the short lines in the band under the website's
 * header (closures, big nights, a plain note). Never the staff Announcement.
 * Limits mirror the website's reader (website src/lib/site/announcements.ts):
 * id 64, text 140, link a /path or https address with a label of 40, tone
 * closure | event | info, from/until New York days, both included. Pure.
 */

import { kebab } from "./websiteMenu";
import { ANNOUNCEMENT_TONES, feedAnnouncementSchema, isIsoDate, isWebsiteHref, type AnnouncementTone, type FeedAnnouncement } from "./websiteSchema";

export { ANNOUNCEMENT_TONES, type AnnouncementTone };

export const ANNOUNCEMENT_LIMITS = {
  id: 64,
  text: 140,
  /** Under about this many characters it stays on two lines on a phone. */
  twoLines: 90,
  label: 40,
} as const;

export const TONE_LABEL: Record<AnnouncementTone, string> = { closure: "Closure", event: "Event", info: "Plain" };
export const TONE_HINT: Record<AnnouncementTone, string> = { closure: "Orange, for a closure or changed hours", event: "Yellow, for a big night", info: "Plain, for anything else" };

export const isTone = (s: string): s is AnnouncementTone => (ANNOUNCEMENT_TONES as readonly string[]).includes(s);

export interface AnnouncementInput {
  text: string;
  tone: string;
  linkHref: string;
  linkLabel: string;
  from: string;
  until: string;
}

export interface AnnouncementValue {
  text: string;
  tone: AnnouncementTone;
  linkHref: string | null;
  linkLabel: string | null;
  from: string | null;
  until: string | null;
}

export type AnnouncementField = keyof AnnouncementInput;
export type AnnouncementCheck = { ok: true; value: AnnouncementValue } | { ok: false; errors: Partial<Record<AnnouncementField, string>> };

const oneLine = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

/** A link as typed: a website path stays as it is, a bare address gets https://. undefined = not usable. */
export function cleanHref(raw: string): { href: string } | { error: string } | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (v.startsWith("/")) return isWebsiteHref(v) ? { href: v } : { error: "That isn't a page on the website. Paths look like /events/…" };
  if (/^http:\/\//i.test(v)) return { error: "Use an https:// address (the website only links to secure pages)." };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return { error: "Use a full https:// address, or pick an event." };
    const href = u.toString();
    return isWebsiteHref(href) ? { href } : { error: "Use a full https:// address, or pick an event." };
  } catch {
    return { error: "That isn't a web address." };
  }
}

/** Everything Max typed, checked against what the website accepts. */
export function checkAnnouncement(input: AnnouncementInput): AnnouncementCheck {
  const errors: Partial<Record<AnnouncementField, string>> = {};
  const text = oneLine(input.text);
  if (!text) errors.text = "Write the line guests should see.";
  else if (text.length > ANNOUNCEMENT_LIMITS.text) errors.text = `Keep it to ${ANNOUNCEMENT_LIMITS.text} characters (it's ${text.length}).`;

  const tone = String(input.tone ?? "");
  if (!isTone(tone)) errors.tone = "Pick closure, event or plain.";

  let linkHref: string | null = null;
  let linkLabel: string | null = null;
  const link = cleanHref(input.linkHref);
  if (link && "error" in link) errors.linkHref = link.error;
  else if (link) {
    linkHref = link.href;
    linkLabel = oneLine(input.linkLabel);
    if (!linkLabel) errors.linkLabel = "Add a word or two for the link, like Details.";
    else if (linkLabel.length > ANNOUNCEMENT_LIMITS.label) errors.linkLabel = `Keep the link words to ${ANNOUNCEMENT_LIMITS.label} characters.`;
  }

  const day = (raw: string, field: "from" | "until") => {
    const v = String(raw ?? "").trim();
    if (!v) return null;
    if (!isIsoDate(v)) {
      errors[field] = "Pick a day.";
      return null;
    }
    return v;
  };
  const from = day(input.from, "from");
  const until = day(input.until, "until");
  if (from && until && from > until) errors.until = "The last day is before the first.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { text, tone: tone as AnnouncementTone, linkHref, linkLabel: linkHref ? linkLabel : null, from, until } };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 20", or "Oct 1, 2027" when it isn't this year. */
function monthDay(iso: string, today: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const s = `${MONTHS[m - 1]} ${d}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? s : `${s}, ${y}`;
}

export type AnnouncementState = "upcoming" | "showing" | "ended";

/** Where a line stands today, in words: "Shows Nov 20 – Nov 26", "Showing now", "Ended". */
export function announcementWhen(from: string | null, until: string | null, today: string): { state: AnnouncementState; label: string } {
  if (until && until < today) return { state: "ended", label: "Ended" };
  if (from && from > today) return { state: "upcoming", label: until ? `Shows ${monthDay(from, today)} – ${monthDay(until, today)}` : `Shows from ${monthDay(from, today)}` };
  if (until === today) return { state: "showing", label: "Showing now · last day today" };
  return { state: "showing", label: until ? `Showing now · until ${monthDay(until, today)}` : "Showing now" };
}

/**
 * The id the website remembers a closed line by: a few words of the text and
 * today's date ("closed-thanksgiving-day-2026-11-16"), -2, -3… when taken.
 * "Show again" mints a new one so people who closed the line see it again.
 */
export function publicIdFor(text: string, today: string, taken: ReadonlySet<string>): string {
  let base = kebab(text).slice(0, 40);
  if (base.length === 40 && base.includes("-")) base = base.slice(0, base.lastIndexOf("-"));
  base = base.replace(/-+$/, "") || "notice";
  const id = `${base}-${today}`;
  if (!taken.has(id)) return id;
  for (let i = 2; ; i++) {
    const next = `${id}-${i}`;
    if (!taken.has(next)) return next;
  }
}

export interface StoredAnnouncement {
  publicId: string;
  text: string;
  tone: string;
  linkHref: string | null;
  linkLabel: string | null;
  from: string | null;
  until: string | null;
  sort: number;
  active: boolean;
}

/**
 * What GET /api/public/site sends as `announcements`: active ones, in Max's
 * order, whose last day hasn't passed (future ones too, with `from`; the
 * website keeps those that stand on its own New York day). Each is checked on
 * its own; a bad link is left off rather than losing the line.
 */
export function feedAnnouncements(rows: readonly StoredAnnouncement[], today: string): FeedAnnouncement[] {
  const seen = new Set<string>();
  const out: FeedAnnouncement[] = [];
  const ordered = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.sort - b.r.sort || a.i - b.i);
  for (const { r } of ordered) {
    if (!r.active) continue;
    if (r.until && r.until < today) continue;
    if (seen.has(r.publicId)) continue;
    const a: FeedAnnouncement = { id: r.publicId, text: oneLine(r.text), tone: isTone(r.tone) ? r.tone : "info" };
    if (r.linkHref && r.linkLabel) {
      const link = { href: r.linkHref, label: oneLine(r.linkLabel) };
      if (isWebsiteHref(link.href) && link.label && link.label.length <= ANNOUNCEMENT_LIMITS.label) a.link = link;
    }
    if (r.from) a.from = r.from;
    if (r.until) a.until = r.until;
    const ok = feedAnnouncementSchema.safeParse(a);
    if (!ok.success) continue;
    seen.add(r.publicId);
    out.push(ok.data);
  }
  return out;
}
