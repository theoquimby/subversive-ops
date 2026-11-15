import { createHash } from "node:crypto";
import { addDays, daysBetween, type ISODate } from "./dates";

/**
 * Website analytics: first-party, cookieless, privacy-friendly.
 *
 * Pure (no database, no network): what the collector accepts, how a visit's
 * source is worked out from the referrer and UTM tags, bot filtering, the
 * daily-rotating visitor hash, sessions, the daily rollups the dashboards
 * read, funnel math and period comparisons. The service
 * (src/server/services/webAnalytics.ts) wires these to Prisma.
 */

// ---- Events ---------------------------------------------------------------------------

/** Named events the website may send (anything else is dropped). */
export const EVENT_NAMES = [
  "click_call",
  "click_directions",
  "click_order_online",
  "menu_view",
  "event_view",
  "ticket_click",
  "rsvp_click",
  "inquiry_submit",
  "newsletter_signup",
  "outbound_click",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
export type HitKind = "pageview" | EventName;
export const isEventName = (s: unknown): s is EventName => typeof s === "string" && (EVENT_NAMES as readonly string[]).includes(s);

/** The things a guest does that are worth money: the "action" step of the funnel. */
export const ACTIONS = ["click_call", "click_directions", "click_order_online", "ticket_click", "rsvp_click", "inquiry_submit"] as const satisfies readonly EventName[];
export type ActionName = (typeof ACTIONS)[number];
export const isAction = (k: string): k is ActionName => (ACTIONS as readonly string[]).includes(k);

export const EVENT_LABEL: Record<EventName, string> = {
  click_call: "Calls",
  click_directions: "Directions",
  click_order_online: "Order online",
  menu_view: "Menu views",
  event_view: "Event views",
  ticket_click: "Ticket clicks",
  rsvp_click: "RSVPs",
  inquiry_submit: "Private-event inquiries",
  newsletter_signup: "Newsletter sign-ups",
  outbound_click: "Outbound links",
};

/** A visit "looked at what we offer": the menu or an event. */
export function isInterest(kind: string, path: string): boolean {
  if (kind === "menu_view" || kind === "event_view") return true;
  return kind === "pageview" && (path === "/menu" || path.startsWith("/menu/") || path.startsWith("/events/") || path === "/beer");
}

// ---- Payload -----------------------------------------------------------------------------

/** What the website sends. Short keys keep each beacon well under 1 KB. */
export interface CollectPayload {
  /** "pageview" or an event name */
  n: HitKind;
  /** location.href */
  u: string;
  /** document.referrer (only on the first page of a visit; "" otherwise is fine) */
  r?: string;
  /** window.innerWidth, for the device class */
  w?: number;
  /** Event properties (label, href, slug…): flat, short strings and numbers only */
  p?: Record<string, string | number | boolean>;
}

export const MAX_BODY_BYTES = 2048;

/** Validate a beacon body. Returns null for anything malformed (the collector answers 204 either way). */
export function parsePayload(raw: string): CollectPayload | null {
  if (!raw || raw.length > MAX_BODY_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const n = o.n;
  if (n !== "pageview" && !isEventName(n)) return null;
  if (typeof o.u !== "string" || o.u.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(o.u);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const r = typeof o.r === "string" && o.r.length <= 1000 ? o.r : "";
  const w = typeof o.w === "number" && Number.isFinite(o.w) && o.w > 0 && o.w < 10000 ? Math.round(o.w) : undefined;
  let p: CollectPayload["p"];
  if (o.p && typeof o.p === "object" && !Array.isArray(o.p)) {
    p = {};
    for (const [k, val] of Object.entries(o.p as Record<string, unknown>).slice(0, 8)) {
      if (!/^[a-z_]{1,24}$/i.test(k)) continue;
      if (typeof val === "string") p[k] = val.slice(0, 200);
      else if (typeof val === "number" && Number.isFinite(val)) p[k] = val;
      else if (typeof val === "boolean") p[k] = val;
    }
    if (!Object.keys(p).length) p = undefined;
  }
  return { n, u: url.toString(), r, w, p };
}

/** "/events/trivia-night/" → "/events/trivia-night". Query strings and fragments are dropped. */
export function normalizePath(pathname: string): string {
  let p = pathname.split(/[?#]/)[0] || "/";
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep as-is */
  }
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.slice(0, 200) || "/";
}

// ---- Origins --------------------------------------------------------------------------------

/** "https://www.drinksubversive.com/" or "drinksubversive.com" → "https://drinksubversive.com" etc. Null if unusable. */
export function normalizeOrigin(raw: string): string | null {
  const v = raw.trim().replace(/\/+$/, "");
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The website's origins plus their www / bare twins, so either spelling of the address works. */
export function expandOrigins(list: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const o = normalizeOrigin(raw);
    if (!o) continue;
    out.add(o);
    const u = new URL(o);
    if (/^(localhost|127\.|\[::1\])/.test(u.hostname)) continue;
    out.add(u.hostname.startsWith("www.") ? `${u.protocol}//${u.hostname.slice(4)}${u.port ? `:${u.port}` : ""}` : `${u.protocol}//www.${u.hostname}${u.port ? `:${u.port}` : ""}`);
  }
  return [...out];
}

export const hostOf = (origin: string) => {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// ---- Bots -----------------------------------------------------------------------------------

const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|scrape|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|site24x7|monitor|preview|facebookexternalhit|facebookcatalog|embedly|quora link|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|bingpreview|vercel|curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|axios\/|node-fetch|undici|go-http-client|java\/|okhttp|libwww|apache-httpclient|httpclient|postman|insomnia|feedfetcher|google-inspectiontool|google-read-aloud|mediapartners|adsbot|chrome-lighthouse|ahrefs|semrush|mj12|dotbot|petalbot|yandex|baiduspider|bytespider|gptbot|claudebot|ccbot|perplexity|applebot|duckduckbot|amazonbot/i;

/**
 * True for crawlers, link previews, monitors, scripts and prefetches. Real
 * browsers always send a user agent with "Mozilla/" and an Accept-Language.
 */
export function isBot(h: { ua: string | null | undefined; acceptLanguage?: string | null; purpose?: string | null }): boolean {
  const ua = (h.ua ?? "").trim();
  if (ua.length < 20 || ua.length > 512) return true;
  if (!/^Mozilla\/|^Opera\//.test(ua)) return true;
  if (BOT_UA.test(ua)) return true;
  if (h.purpose && /prefetch|prerender/i.test(h.purpose)) return true;
  if (h.acceptLanguage === null || h.acceptLanguage === "") return true;
  return false;
}

// ---- Device -------------------------------------------------------------------------------

export type Device = "mobile" | "tablet" | "desktop";

export function deviceClass(ua: string, width?: number): Device {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone|webOS|BlackBerry/i.test(ua)) return "mobile";
  // iPadOS asks for the desktop site; its width gives it away.
  if (/Macintosh/.test(ua) && width != null && width <= 1366 && width >= 744 && /Safari/.test(ua) && !/Chrome/.test(ua)) return width < 1024 ? "tablet" : "desktop";
  if (width != null && width < 600) return "mobile";
  return "desktop";
}

// ---- Source / medium ---------------------------------------------------------------------

export type Medium = "direct" | "organic" | "maps" | "social" | "referral" | "email" | "paid" | "listing" | "internal" | "other";

export interface Attribution {
  source: string;
  medium: Medium;
  campaign: string | null;
  content: string | null;
  term: string | null;
  /** Referrer host, without www */
  referrer: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct",
  google: "Google Search",
  "google-maps": "Google Maps",
  "google-business": "Google listing",
  "apple-maps": "Apple Maps",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
  ecosia: "Ecosia",
  brave: "Brave Search",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X (Twitter)",
  reddit: "Reddit",
  youtube: "YouTube",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
  threads: "Threads",
  yelp: "Yelp",
  tripadvisor: "Tripadvisor",
  untappd: "Untappd",
  opentable: "OpenTable",
  email: "Email",
  newsletter: "Newsletter",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  "(not set)": "Not known",
};

/** "google-maps" → "Google Maps"; an unknown host stays as the host. */
export const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;

export const MEDIUM_LABEL: Record<Medium, string> = {
  direct: "Typed in or bookmarked",
  organic: "Search",
  maps: "Maps",
  social: "Social",
  referral: "Other websites",
  email: "Email",
  paid: "Ads",
  listing: "Listings & reviews",
  internal: "Internal",
  other: "Other",
};

/** Referrer host → [source, medium]. Order matters: maps before search. */
const HOST_RULES: [RegExp, string, Medium][] = [
  [/^maps\.google\.|^google\.[a-z.]+\/maps|^maps\.app\.goo\.gl$|^goo\.gl$/, "google-maps", "maps"],
  [/^business\.google\.com$|^g\.page$/, "google-business", "maps"],
  [/^(www\.)?google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$|^news\.google\.com$/, "google", "organic"],
  [/^maps\.apple\.com$|^(www\.)?apple\.com$/, "apple-maps", "maps"],
  [/(^|\.)bing\.com$/, "bing", "organic"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo", "organic"],
  [/(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.com$/, "yahoo", "organic"],
  [/(^|\.)ecosia\.org$/, "ecosia", "organic"],
  [/(^|\.)search\.brave\.com$/, "brave", "organic"],
  [/(^|\.)instagram\.com$/, "instagram", "social"],
  [/(^|\.)facebook\.com$|^fb\.me$|(^|\.)messenger\.com$/, "facebook", "social"],
  [/(^|\.)threads\.(net|com)$/, "threads", "social"],
  [/(^|\.)tiktok\.com$/, "tiktok", "social"],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "x", "social"],
  [/(^|\.)reddit\.com$/, "reddit", "social"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube", "social"],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, "pinterest", "social"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin", "social"],
  [/(^|\.)yelp\.[a-z.]+$/, "yelp", "listing"],
  [/(^|\.)tripadvisor\.[a-z.]+$/, "tripadvisor", "listing"],
  [/(^|\.)untappd\.com$/, "untappd", "listing"],
  [/(^|\.)opentable\.[a-z.]+$/, "opentable", "listing"],
  [/^mail\.google\.com$|^com\.google\.android\.gm$|(^|\.)outlook\.(live|office)\.com$|^mail\.yahoo\.com$|(^|\.)mail\.[a-z.]+$/, "email", "email"],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "chatgpt", "referral"],
  [/(^|\.)perplexity\.ai$/, "perplexity", "referral"],
];

const UTM_SOURCE_ALIASES: [RegExp, string][] = [
  [/^(gbp|gmb|google[\s_-]?(business|my[\s_-]?business|business[\s_-]?profile)|google[\s_-]?listing|business\.google\.com)$/i, "google-business"],
  [/^google[\s_-]?maps$|^maps$/i, "google-maps"],
  [/^google$/i, "google"],
  [/^(ig|insta|instagram)$/i, "instagram"],
  [/^(fb|facebook|meta)$/i, "facebook"],
  [/^(tw|twitter|x)$/i, "x"],
  [/^(tt|tiktok)$/i, "tiktok"],
  [/^(newsletter|mailchimp|klaviyo|substack|buttondown)$/i, "newsletter"],
  [/^e-?mail$/i, "email"],
  [/^yelp$/i, "yelp"],
  [/^untappd$/i, "untappd"],
];

function mediumFromUtm(m: string | null, source: string): Medium {
  const v = (m ?? "").toLowerCase().trim();
  if (/^(cpc|ppc|paid|paidsearch|paid[-_ ]?social|cpm|display|ads?)$/.test(v)) return "paid";
  if (/^(e-?mail|newsletter)$/.test(v)) return "email";
  if (/^(social|social[-_ ]?media|sm|story|bio|link[-_ ]?in[-_ ]?bio)$/.test(v)) return "social";
  if (/^(organic|search|seo)$/.test(v)) return source === "google-business" || source === "google-maps" ? "maps" : "organic";
  if (/^(maps?|local|gbp|listing|profile)$/.test(v)) return source.includes("google") || source === "apple-maps" ? "maps" : "listing";
  if (/^(referral|partner|affiliate)$/.test(v)) return "referral";
  if (/^(print|qr|offline|poster|flyer|menu|table[-_ ]?tent)$/.test(v)) return "other";
  // No (or an unknown) medium: guess from the source.
  if (source === "google-business" || source === "google-maps" || source === "apple-maps") return "maps";
  if (["instagram", "facebook", "x", "tiktok", "threads", "reddit", "youtube", "pinterest", "linkedin"].includes(source)) return "social";
  if (source === "email" || source === "newsletter") return "email";
  if (["google", "bing", "duckduckgo", "yahoo", "ecosia", "brave"].includes(source)) return "organic";
  return v ? "other" : "referral";
}

const clean = (s: string | null | undefined, max = 100) => {
  const v = (s ?? "").trim().slice(0, max);
  return v ? v : null;
};

/**
 * Where a visit came from, from its landing URL (UTM tags, click ids) and the
 * referrer. UTM tags win, then click ids, then the referrer's host. A
 * referrer on the website itself means the visit is still going ("internal").
 */
export function classifySource(args: { url: string; referrer?: string | null; siteHosts: string[] }): Attribution {
  let url: URL | null = null;
  try {
    url = new URL(args.url);
  } catch {
    url = null;
  }
  const q = url?.searchParams;
  const utmSource = clean(q?.get("utm_source"));
  const campaign = clean(q?.get("utm_campaign"));
  const content = clean(q?.get("utm_content"));
  const term = clean(q?.get("utm_term"));
  let refHost: string | null = null;
  let refPath = "";
  if (args.referrer) {
    try {
      const r = new URL(args.referrer);
      if (r.protocol === "android-app:") refHost = r.hostname.toLowerCase();
      else if (r.protocol === "http:" || r.protocol === "https:") {
        refHost = r.hostname.toLowerCase().replace(/^www\./, "");
        refPath = r.pathname;
      }
    } catch {
      refHost = null;
    }
  }
  const own = new Set(args.siteHosts.map((h) => h.toLowerCase().replace(/^www\./, "")));
  const internal = !!refHost && own.has(refHost);

  if (utmSource) {
    const alias = UTM_SOURCE_ALIASES.find(([re]) => re.test(utmSource))?.[1];
    const source = alias ?? utmSource.toLowerCase().replace(/\s+/g, "-").slice(0, 60);
    return { source, medium: mediumFromUtm(q?.get("utm_medium") ?? null, source), campaign, content, term, referrer: internal ? null : refHost };
  }
  if (q?.get("gclid") || q?.get("gbraid") || q?.get("wbraid")) return { source: "google", medium: "paid", campaign, content, term, referrer: refHost };
  if (q?.get("msclkid")) return { source: "bing", medium: "paid", campaign, content, term, referrer: refHost };
  if (internal) return { source: "direct", medium: "internal", campaign, content, term, referrer: null };
  if (refHost) {
    const key = `${refHost}${refPath.startsWith("/maps") ? "/maps" : ""}`;
    const rule = HOST_RULES.find(([re]) => re.test(key) || re.test(refHost!));
    if (rule) return { source: rule[1], medium: rule[2], campaign, content, term, referrer: refHost };
    if (q?.get("fbclid")) return { source: "facebook", medium: "social", campaign, content, term, referrer: refHost };
    return { source: refHost.slice(0, 80), medium: "referral", campaign, content, term, referrer: refHost };
  }
  if (q?.get("fbclid")) return { source: "facebook", medium: "social", campaign, content, term, referrer: null };
  return { source: "direct", medium: "direct", campaign, content, term, referrer: null };
}

/** A hit that starts a new visit even inside 30 minutes: someone came back from a search, a post, an ad. */
export const startsNewVisit = (a: Attribution) => a.medium !== "internal" && a.medium !== "direct";

// ---- Visitor hash and the daily salt --------------------------------------------------------

/** The salt is replaced at the start of every business day; yesterday's is thrown away. */
export interface DailySalt {
  day: ISODate;
  salt: string;
}

export const saltIsCurrent = (s: DailySalt | null | undefined, day: ISODate): s is DailySalt => !!s && s.day === day && typeof s.salt === "string" && s.salt.length >= 32;

/**
 * A visitor id that only lasts a day: sha256(salt, site, IP, user agent),
 * shortened to 16 bytes. Without the salt (deleted tomorrow) it can't be
 * turned back into an IP or matched across days.
 */
export function visitorHash(salt: string, site: string, ip: string, ua: string): string {
  return createHash("sha256").update(`${salt}\u0000${site}\u0000${ip}\u0000${ua}`).digest("base64url").slice(0, 22);
}

/** A new visit id from the visitor and the time it started. */
export const sessionId = (visitor: string, at: Date) => createHash("sha256").update(`${visitor}:${at.toISOString()}`).digest("base64url").slice(0, 16);

export const SESSION_GAP_MS = 30 * 60_000;

/** Whether a hit continues the visitor's last visit. */
export function continuesVisit(last: { at: Date } | null, now: Date, incoming: Attribution): boolean {
  if (!last) return false;
  if (now.getTime() - last.at.getTime() > SESSION_GAP_MS) return false;
  return !startsNewVisit(incoming);
}

// ---- Rate limit ----------------------------------------------------------------------------

/**
 * A small fixed-window limiter (per server instance): at most `limit` hits a
 * minute per key. Enough to stop a stuck tab or a script from filling the table.
 */
export function createRateLimiter(limit = 60, windowMs = 60_000, maxKeys = 5000) {
  const hits = new Map<string, { start: number; n: number }>();
  return (key: string, now = Date.now()): boolean => {
    const h = hits.get(key);
    if (!h || now - h.start >= windowMs) {
      if (hits.size >= maxKeys) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
      }
      hits.set(key, { start: now, n: 1 });
      return true;
    }
    h.n++;
    return h.n <= limit;
  };
}

// ---- Rollups ----------------------------------------------------------------------------

export interface RollupHit {
  at: Date;
  kind: string;
  path: string;
  visitor: string;
  session: string;
  source: string;
  medium: string;
  campaign: string | null;
  referrer: string | null;
  device: string;
  country: string | null;
  region: string | null;
  city: string | null;
}

export type RollupDim = "total" | "page" | "source" | "medium" | "campaign" | "device" | "country" | "region" | "city" | "referrer" | "event" | "eventSource" | "eventPage" | "action";

export interface RollupRow {
  dim: RollupDim;
  key: string;
  views: number;
  visitors: number;
  sessions: number;
  entries: number;
  bounces: number;
  engaged: number;
  converted: number;
  count: number;
}

/** Separator for two-part keys (event + source, event + page). */
export const KEY_SEP = "\t";

interface Visit {
  id: string;
  visitor: string;
  source: string;
  medium: string;
  campaign: string | null;
  referrer: string | null;
  device: string;
  country: string | null;
  region: string | null;
  city: string | null;
  entry: string | null;
  views: number;
  events: number;
  interest: boolean;
  action: boolean;
  pages: Set<string>;
}

/**
 * One business day's hits → rows for every dimension. Visit-level numbers
 * (sessions, bounces, engaged, converted) are credited to the visit's first
 * source, device and place; page rows count the visits that saw the page.
 */
export function rollupDay(hits: RollupHit[]): RollupRow[] {
  const sorted = [...hits].sort((a, b) => a.at.getTime() - b.at.getTime());
  const visits = new Map<string, Visit>();
  const rows = new Map<string, RollupRow & { _v: Set<string>; _s: Set<string> }>();
  const row = (dim: RollupDim, key: string) => {
    const k = `${dim}|${key}`;
    let r = rows.get(k);
    if (!r) {
      r = { dim, key, views: 0, visitors: 0, sessions: 0, entries: 0, bounces: 0, engaged: 0, converted: 0, count: 0, _v: new Set(), _s: new Set() };
      rows.set(k, r);
    }
    return r;
  };

  for (const h of sorted) {
    let v = visits.get(h.session);
    if (!v) {
      v = { id: h.session, visitor: h.visitor, source: h.source, medium: h.medium, campaign: h.campaign, referrer: h.referrer, device: h.device, country: h.country, region: h.region, city: h.city, entry: null, views: 0, events: 0, interest: false, action: false, pages: new Set() };
      visits.set(h.session, v);
    }
    if (isInterest(h.kind, h.path)) v.interest = true;
    if (isAction(h.kind)) v.action = true;
    if (h.kind === "pageview") {
      v.views++;
      if (!v.entry) v.entry = h.path;
      v.pages.add(h.path);
      const p = row("page", h.path);
      p.views++;
      p._v.add(h.visitor);
      p._s.add(h.session);
    } else {
      v.events++;
      const e = row("event", h.kind);
      e.count++;
      e._v.add(h.visitor);
      e._s.add(h.session);
      const es = row("eventSource", `${h.kind}${KEY_SEP}${h.source}`);
      es.count++;
      es._s.add(h.session);
      const ep = row("eventPage", `${h.kind}${KEY_SEP}${h.path}`);
      ep.count++;
      ep._s.add(h.session);
      if (isAction(h.kind)) row("page", h.path).count++;
    }
  }

  const total = row("total", "all");
  for (const v of visits.values()) {
    const bounce = v.views <= 1 && v.events === 0;
    const dims: [RollupDim, string | null][] = [
      ["total", "all"],
      ["source", v.source],
      ["medium", v.medium],
      ["campaign", v.campaign],
      ["device", v.device],
      ["country", v.country],
      ["region", v.region && v.country ? `${v.country}-${v.region}` : null],
      ["city", v.city && v.country ? `${v.city}${KEY_SEP}${v.region ?? ""}${KEY_SEP}${v.country}` : null],
      ["referrer", v.referrer],
    ];
    for (const [dim, key] of dims) {
      if (!key) continue;
      const r = row(dim, key);
      r.sessions++;
      r._v.add(v.visitor);
      if (bounce) r.bounces++;
      if (v.interest) r.engaged++;
      if (v.action) r.converted++;
    }
    if (v.entry) {
      const r = row("page", v.entry);
      r.entries++;
      if (bounce) r.bounces++;
    }
    for (const p of v.pages) {
      const r = row("page", p);
      if (v.interest) r.engaged++;
      if (v.action) r.converted++;
    }
  }
  // Total views and action events.
  for (const h of sorted) {
    if (h.kind === "pageview") total.views++;
    else if (isAction(h.kind)) total.count++;
  }
  for (const h of sorted) {
    if (h.kind !== "pageview") continue;
    const s = visits.get(h.session)!;
    for (const [dim, key] of [["source", s.source], ["medium", s.medium], ["device", s.device], ["country", s.country], ["campaign", s.campaign]] as [RollupDim, string | null][]) {
      if (key) row(dim, key).views++;
    }
  }
  // Actions per kind as their own rows (visits that did each), for the funnel.
  for (const h of sorted) {
    if (!isAction(h.kind)) continue;
    const a = row("action", h.kind);
    a.count++;
    a._s.add(h.session);
    a._v.add(h.visitor);
  }

  return [...rows.values()].map(({ _v, _s, ...r }) => ({
    ...r,
    visitors: _v.size,
    sessions: r.dim === "page" || r.dim === "event" || r.dim === "eventSource" || r.dim === "eventPage" || r.dim === "action" ? _s.size : r.sessions,
  }));
}

// ---- Sums over a period ------------------------------------------------------------------

export type Totals = Omit<RollupRow, "dim" | "key">;
export const ZERO: Totals = { views: 0, visitors: 0, sessions: 0, entries: 0, bounces: 0, engaged: 0, converted: 0, count: 0 };

export function addTotals(a: Totals, b: Partial<Totals>): Totals {
  return {
    views: a.views + (b.views ?? 0),
    visitors: a.visitors + (b.visitors ?? 0),
    sessions: a.sessions + (b.sessions ?? 0),
    entries: a.entries + (b.entries ?? 0),
    bounces: a.bounces + (b.bounces ?? 0),
    engaged: a.engaged + (b.engaged ?? 0),
    converted: a.converted + (b.converted ?? 0),
    count: a.count + (b.count ?? 0),
  };
}

/** Sum daily rows by key, biggest first (by `sort`). */
export function sumByKey<T extends Partial<Totals> & { key: string }>(rows: T[], sort: keyof Totals = "sessions"): (Totals & { key: string })[] {
  const m = new Map<string, Totals>();
  for (const r of rows) m.set(r.key, addTotals(m.get(r.key) ?? ZERO, r));
  return [...m.entries()].map(([key, t]) => ({ key, ...t })).sort((a, b) => b[sort] - a[sort] || a.key.localeCompare(b.key));
}

/** Daily series for one metric over [from, to], zero-filled. */
export function dailySeries(rows: { day: ISODate; value: number }[], from: ISODate, to: ISODate): { x: ISODate; y: number }[] {
  const by = new Map<ISODate, number>();
  for (const r of rows) by.set(r.day, (by.get(r.day) ?? 0) + r.value);
  const out: { x: ISODate; y: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ x: d, y: by.get(d) ?? 0 });
  return out;
}

// ---- Periods and change ----------------------------------------------------------------

export interface Period {
  from: ISODate;
  to: ISODate;
  days: number;
}

export const PERIODS = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "28d", label: "28 days", days: 28 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "365d", label: "12 months", days: 365 },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];
export const parsePeriod = (s: string | null | undefined): PeriodId => (PERIODS.some((p) => p.id === s) ? (s as PeriodId) : "28d");

/** The chosen window ending yesterday or today, and the same-length window just before it. */
export function periods(id: PeriodId, today: ISODate): { cur: Period; prev: Period } {
  const days = PERIODS.find((p) => p.id === id)!.days;
  const to = today;
  const from = addDays(to, -(days - 1));
  const pto = addDays(from, -1);
  return { cur: { from, to, days }, prev: { from: addDays(pto, -(days - 1)), to: pto, days } };
}

/** Change vs the previous period: null when there's nothing to compare against. */
export function change(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return cur / prev - 1;
}

/** Whether a change is bigger than ordinary ups and downs for counts this size (Poisson, ~95%). */
export function changeIsClear(cur: number, prev: number): boolean {
  if (cur + prev < 20) return false;
  const z = Math.abs(cur - prev) / Math.sqrt(cur + prev);
  return z >= 2;
}

// ---- Funnel -----------------------------------------------------------------------------

export interface FunnelStep {
  id: string;
  label: string;
  value: number;
  /** Share of the first step */
  ofStart: number | null;
  /** Share of the step before */
  ofPrev: number | null;
}

/** Steps in order; each rate is null when the step before is empty. */
export function funnel(steps: { id: string; label: string; value: number }[]): FunnelStep[] {
  const first = steps[0]?.value ?? 0;
  return steps.map((s, i) => {
    const prev = i ? steps[i - 1].value : null;
    return { ...s, ofStart: first > 0 ? s.value / first : null, ofPrev: prev == null ? null : prev > 0 ? s.value / prev : null };
  });
}

/** Wilson score interval for a rate (z = 1.645 → 90%). */
export function wilson(k: number, n: number, z = 1.645): { rate: number; low: number; high: number } | null {
  if (!(n > 0)) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { rate: p, low: Math.max(0, (c - m) / d), high: Math.min(1, (c + m) / d) };
}

export const MIN_VISITS_FOR_RATE = 30;

export interface RateRow {
  key: string;
  sessions: number;
  converted: number;
  rate: number | null;
  low: number | null;
  high: number | null;
  /** "above" / "below" the overall rate when the 90% range doesn't include it */
  vsAll: "above" | "below" | "same" | "few";
}

/** Conversion rate per source (or page), with a range, and whether it really differs from the site as a whole. */
export function conversionRates(rows: { key: string; sessions: number; converted: number }[], overall: { sessions: number; converted: number }): RateRow[] {
  const all = overall.sessions > 0 ? overall.converted / overall.sessions : 0;
  return rows.map((r) => {
    const w = wilson(r.converted, r.sessions);
    if (!w || r.sessions < MIN_VISITS_FOR_RATE) return { key: r.key, sessions: r.sessions, converted: r.converted, rate: w?.rate ?? null, low: w?.low ?? null, high: w?.high ?? null, vsAll: "few" as const };
    return { key: r.key, sessions: r.sessions, converted: r.converted, rate: w.rate, low: w.low, high: w.high, vsAll: w.low > all ? "above" : w.high < all ? "below" : "same" };
  });
}

/** Share of a total, as a fraction; null when the total is 0. */
export const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

// ---- Retention ---------------------------------------------------------------------------

export const RAW_RETENTION_DAYS = 400;

/** The first business date to keep raw hits for. */
export const retentionCutoff = (today: ISODate, days = RAW_RETENTION_DAYS): ISODate => addDays(today, -days);

/** Days whose rollups need rebuilding: today and yesterday always; older days only if never built. */
export function daysToRoll(today: ISODate, builtThrough: ISODate | null, maxBack = 3): ISODate[] {
  const out: ISODate[] = [];
  const start = builtThrough && daysBetween(builtThrough, today) <= maxBack ? addDays(builtThrough, -1) : addDays(today, -maxBack);
  for (let d = start; d <= today; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---- Private-event inquiries by source ----------------------------------------------------

export interface InquiryBySource {
  source: string;
  inquiries: number;
  quoted: number;
  booked: number;
  /** Quote totals of booked events */
  revenue: number;
}

/** Inquiries recorded by Ops (with their source) joined to what became of each booking. */
export function inquiryAttribution(convs: { source: string; privateEventId: string | null }[], events: { id: string; quoted: boolean; booked: boolean; total: number }[]): InquiryBySource[] {
  const ev = new Map(events.map((e) => [e.id, e]));
  const by = new Map<string, InquiryBySource>();
  const seen = new Set<string>();
  for (const c of convs) {
    // One booking counts once even if the form was sent twice.
    if (c.privateEventId) {
      if (seen.has(c.privateEventId)) continue;
      seen.add(c.privateEventId);
    }
    const r = by.get(c.source) ?? { source: c.source, inquiries: 0, quoted: 0, booked: 0, revenue: 0 };
    r.inquiries++;
    const e = c.privateEventId ? ev.get(c.privateEventId) : undefined;
    if (e?.quoted) r.quoted++;
    if (e?.booked) {
      r.booked++;
      r.revenue += e.total;
    }
    by.set(c.source, r);
  }
  return [...by.values()].sort((a, b) => b.revenue - a.revenue || b.inquiries - a.inquiries);
}
