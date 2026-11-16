/**
 * A featured event's own page on the website (Oktoberfest and the like): a
 * landscape photo, an intro, a few sections, the running order and links.
 * Stored as WebEvent.page (JSON) with the photo in WebImage; sent as `page` on
 * the event in GET /api/public/events. Limits mirror the website's reader
 * (website src/lib/events/schema.ts eventPageSchema). Pure.
 */

import { feedEventPageSchema, type FeedEventPage } from "./websiteSchema";

export const EVENT_PAGE_LIMITS = {
  intro: 600,
  sections: 8,
  sectionTitle: 80,
  sectionBody: 4000,
  schedule: 24,
  time: 20,
  what: 140,
  links: 6,
  linkLabel: 60,
  heroAlt: 200,
  heroMinWidth: 1600,
} as const;

export interface PageSection {
  title: string;
  body: string;
}
export interface PageRow {
  time: string;
  what: string;
}
export interface PageLink {
  label: string;
  href: string;
}

export interface EventPageContent {
  intro: string | null;
  sections: PageSection[];
  schedule: PageRow[];
  links: PageLink[];
}

export const emptyPage = (): EventPageContent => ({ intro: null, sections: [], schedule: [], links: [] });

const L = EVENT_PAGE_LIMITS;
const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
/** Keeps paragraphs: Windows line ends, trailing spaces and runs of blank lines tidied. */
export const tidyBody = (s: unknown) =>
  String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Paragraphs at blank lines, as the website shows them. */
export const paragraphs = (body: string) =>
  tidyBody(body)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** An https link as typed: a bare address gets https://; http and anything else is refused. */
export function httpsHref(raw: string): string | null {
  const v = String(raw ?? "").trim();
  if (!v || /^http:\/\//i.test(v)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface EventPageInput {
  intro: string;
  sections: { title: string; body: string }[];
  schedule: { time: string; what: string }[];
  links: { label: string; href: string }[];
}

export type EventPageCheck = { ok: true; value: EventPageContent } | { ok: false; errors: string[] };

/** What Max typed, checked against what the website accepts. Fully blank rows are dropped. Row numbers are as he sees them. */
export function checkEventPage(input: EventPageInput): EventPageCheck {
  const errors: string[] = [];
  const intro = tidyBody(input.intro);
  if (intro.length > L.intro) errors.push(`Intro: keep it to ${L.intro} characters (it's ${intro.length}).`);

  const sectionsIn = (input.sections ?? []).map((s) => ({ title: oneLine(s?.title), body: tidyBody(s?.body) }));
  const scheduleIn = (input.schedule ?? []).map((r) => ({ time: oneLine(r?.time), what: oneLine(r?.what) }));
  const linksIn = (input.links ?? []).map((l) => ({ label: oneLine(l?.label), href: String(l?.href ?? "").trim() }));

  if (sectionsIn.filter((s) => s.title || s.body).length > L.sections) errors.push(`Up to ${L.sections} sections.`);
  if (scheduleIn.filter((r) => r.time || r.what).length > L.schedule) errors.push(`Up to ${L.schedule} schedule rows.`);
  if (linksIn.filter((l) => l.label || l.href).length > L.links) errors.push(`Up to ${L.links} links.`);

  const sections: PageSection[] = [];
  sectionsIn.forEach((s, i) => {
    if (!s.title && !s.body) return;
    const at = `Section ${i + 1}`;
    if (!s.title) errors.push(`${at}: add a heading.`);
    else if (s.title.length > L.sectionTitle) errors.push(`${at}: keep the heading to ${L.sectionTitle} characters.`);
    if (!s.body) errors.push(`${at}: add some words under the heading.`);
    else if (s.body.length > L.sectionBody) errors.push(`${at}: keep it to ${L.sectionBody} characters (it's ${s.body.length}).`);
    sections.push(s);
  });

  const schedule: PageRow[] = [];
  scheduleIn.forEach((r, i) => {
    if (!r.time && !r.what) return;
    const at = `Schedule row ${i + 1}`;
    if (!r.time) errors.push(`${at}: add a time, like 12:00 or Noon.`);
    else if (r.time.length > L.time) errors.push(`${at}: keep the time to ${L.time} characters.`);
    if (!r.what) errors.push(`${at}: say what happens.`);
    else if (r.what.length > L.what) errors.push(`${at}: keep it to ${L.what} characters.`);
    schedule.push(r);
  });

  const links: PageLink[] = [];
  linksIn.forEach((l, i) => {
    if (!l.label && !l.href) return;
    const at = `Link ${i + 1}`;
    if (!l.label) errors.push(`${at}: add the words to show, like Tickets.`);
    else if (l.label.length > L.linkLabel) errors.push(`${at}: keep the words to ${L.linkLabel} characters.`);
    const href = httpsHref(l.href);
    if (!l.href) errors.push(`${at}: add the address.`);
    else if (!href) errors.push(`${at}: use an https:// address.`);
    links.push({ label: l.label, href: href ?? l.href });
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { intro: intro || null, sections, schedule, links } };
}

/** WebEvent.page as stored, read tolerantly (anything odd is left out). */
export function parseStoredPage(raw: unknown): EventPageContent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyPage();
  const o = raw as Record<string, unknown>;
  const list = <T,>(v: unknown, keys: (keyof T & string)[]): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object" && keys.every((k) => typeof (x as Record<string, unknown>)[k] === "string")) as T[]) : []);
  return {
    intro: typeof o.intro === "string" && o.intro.trim() ? o.intro : null,
    sections: list<PageSection>(o.sections, ["title", "body"]).map((s) => ({ title: s.title, body: s.body })),
    schedule: list<PageRow>(o.schedule, ["time", "what"]).map((r) => ({ time: r.time, what: r.what })),
    links: list<PageLink>(o.links, ["label", "href"]).map((l) => ({ label: l.label, href: l.href })),
  };
}

export const isEmptyPage = (p: EventPageContent) => !p.intro && !p.sections.length && !p.schedule.length && !p.links.length;

/**
 * The event's `page` for the feed, or undefined when there's nothing to show
 * (or it wouldn't pass the website's checks: then only the page is left off,
 * never the event). The photo goes only as an https address.
 */
export function feedPage(content: EventPageContent, hero: { url: string; alt: string | null } | null): FeedEventPage | undefined {
  const p: FeedEventPage = {};
  if (hero && /^https:\/\//.test(hero.url)) {
    p.hero = hero.url;
    const alt = oneLine(hero.alt);
    if (alt) p.heroAlt = alt.slice(0, L.heroAlt);
  }
  if (content.intro?.trim()) p.intro = content.intro.trim();
  if (content.sections.length) p.sections = content.sections;
  if (content.schedule.length) p.schedule = content.schedule;
  if (content.links.length) p.links = content.links;
  if (!Object.keys(p).length) return undefined;
  const ok = feedEventPageSchema.safeParse(p);
  return ok.success ? ok.data : undefined;
}

/** Why a photo can't go at the top of the page, or null when it can. */
export function heroProblem(width: number, height: number): string | null {
  if (!(width > 0 && height > 0)) return "Couldn't read the size of that photo. Try a JPEG or PNG.";
  if (height > width) return "This photo is taller than it is wide. The top of the page needs a landscape photo.";
  if (height === width) return "This photo is square. The top of the page needs a landscape photo, wider than it is tall.";
  if (width < L.heroMinWidth) return `This photo is ${width} px wide; the top of the page needs at least ${L.heroMinWidth} px. Use the original from the camera or phone, not a screenshot or one saved from a message.`;
  return null;
}

/** "Photo · intro · 2 sections · schedule", or "No page". */
export function pageSummary(p: EventPageContent, hasHero: boolean): string {
  const parts = [hasHero ? "Photo" : null, p.intro ? "intro" : null, p.sections.length ? `${p.sections.length} section${p.sections.length === 1 ? "" : "s"}` : null, p.schedule.length ? "schedule" : null, p.links.length ? `${p.links.length} link${p.links.length === 1 ? "" : "s"}` : null].filter((x): x is string => !!x);
  if (!parts.length) return "No page";
  const s = parts.join(" · ");
  return s[0].toUpperCase() + s.slice(1);
}
