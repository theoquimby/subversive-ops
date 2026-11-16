import { addDays, daysBetween, type ISODate } from "./dates";

/**
 * Online: how guests find the business (Google Search, the Google listing,
 * the website) and what they do next, side by side.
 *
 * Pure (no database, no network): the period a page shows and the one it is
 * compared with, change against the period before, trend points, the mix of
 * where website visits came from, the same intent on the listing and on the
 * website, what a block says while its source isn't ready, and the short
 * "worth a look" list. The service (src/server/services/online.ts) wires
 * these to Prisma.
 */

// ---- Ranges ------------------------------------------------------------------------------

/**
 * Whole weeks, so a period and the one before it hold the same weekdays
 * (a taproom's Saturday is nothing like its Tuesday).
 */
export const ONLINE_RANGES = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "28d", label: "28 days", days: 28 },
  { id: "3m", label: "3 months", days: 91 },
  { id: "12m", label: "12 months", days: 364 },
] as const;
export type OnlineRangeId = (typeof ONLINE_RANGES)[number]["id"];
export const DEFAULT_RANGE: OnlineRangeId = "28d";

/** `?range=` → a range id; anything else is 28 days. */
export function parseRange(raw: string | string[] | null | undefined): OnlineRangeId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return ONLINE_RANGES.some((r) => r.id === v) ? (v as OnlineRangeId) : DEFAULT_RANGE;
}

export const rangeOf = (id: OnlineRangeId) => ONLINE_RANGES.find((r) => r.id === id)!;

export interface Span {
  from: ISODate;
  to: ISODate;
  days: number;
}
export interface Windows {
  cur: Span;
  prev: Span;
}

/**
 * The chosen period, ending yesterday (today is only part of a day, and a
 * part-day would read as a drop), and the same number of days just before it.
 */
export function rangeWindows(id: OnlineRangeId, today: ISODate): Windows {
  const { days } = rangeOf(id);
  const to = addDays(today, -1);
  const from = addDays(to, -(days - 1));
  const pto = addDays(from, -1);
  return { cur: { from, to, days }, prev: { from: addDays(pto, -(days - 1)), to: pto, days } };
}

/** Google's numbers arrive 2–3 days late; a source this far behind or less is just late, not stopped. */
export const MAX_LAG_DAYS = 5;

export interface Aligned extends Windows {
  /** Days the source runs behind the period's last day. */
  lag: number;
  /** Further behind than a normal delay: the source has stopped updating. */
  stale: boolean;
  /** The last day the source has numbers for. */
  through: ISODate | null;
}

/**
 * Slide both periods back to end on a source's last day, so the days it
 * hasn't reported yet don't read as a drop. A source that is further behind
 * than a normal delay is left where it is and marked stale.
 */
export function alignToData(w: Windows, latest: ISODate | null, maxLag = MAX_LAG_DAYS): Aligned {
  if (!latest || latest >= w.cur.to) return { ...w, lag: 0, stale: false, through: latest };
  const lag = daysBetween(latest, w.cur.to);
  if (lag > maxLag) return { ...w, lag, stale: true, through: latest };
  const shift = (s: Span): Span => ({ from: addDays(s.from, -lag), to: addDays(s.to, -lag), days: s.days });
  return { cur: shift(w.cur), prev: shift(w.prev), lag, stale: false, through: latest };
}

export type Coverage = "full" | "partial" | "none";

/** How much of a period a source's history covers, given the first day it has numbers for. */
export function coverage(span: Span, first: ISODate | null): { kind: Coverage; since: ISODate | null; days: number } {
  if (!first || first > span.to) return { kind: "none", since: null, days: 0 };
  if (first <= span.from) return { kind: "full", since: null, days: span.days };
  return { kind: "partial", since: first, days: daysBetween(first, span.to) + 1 };
}

// ---- Change against the period before -------------------------------------------------------

export interface Delta {
  cur: number;
  /** Null when there is no comparable period before. */
  prev: number | null;
  /** Share of the period before, e.g. 0.25 = up 25%. Null when there is nothing to divide by. */
  change: number | null;
  /** Bigger than normal ups and downs (and on enough numbers to mean something). */
  clear: boolean;
  /** "same" covers every change that isn't clear; "new" is something where there was nothing. */
  trend: "up" | "down" | "same" | "new" | null;
}

/**
 * Counts wobble from period to period by about the square root of their size.
 * A change counts as clear when it is at least twice that, on at least 20 in
 * total (the same rule Website analytics uses).
 */
function isClear(cur: number, prev: number): boolean {
  if (cur + prev < 20) return false;
  return Math.abs(cur - prev) / Math.sqrt(cur + prev) >= 2;
}

export function delta(cur: number, prev: number | null): Delta {
  if (prev == null) return { cur, prev: null, change: null, clear: false, trend: null };
  const clear = isClear(cur, prev);
  if (!(prev > 0)) return { cur, prev, change: null, clear, trend: cur > 0 ? "new" : "same" };
  const change = cur / prev - 1;
  return { cur, prev, change, clear, trend: !clear ? "same" : change > 0 ? "up" : "down" };
}

/** A change only when the source's history covers the whole period before. */
export const compare = (cur: number, prev: number, prevCoverage: Coverage): Delta => delta(cur, prevCoverage === "full" ? prev : null);

/** A rate, or null when there is nothing to divide by. */
export const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

// ---- Trends ----------------------------------------------------------------------------------

export interface DayValue {
  day: ISODate;
  value: number;
}

export interface TrendPoint {
  /** First day of the point (a day, or the week it starts). */
  x: ISODate;
  /** Last day of the point; the same as `x` for a daily point. */
  to: ISODate;
  cur: number;
  /** The same point in the period before; null when there is none to compare. */
  prev: number | null;
}

export const sumDays = (rows: DayValue[], span: Span): number => rows.reduce((s, r) => (r.day >= span.from && r.day <= span.to ? s + r.value : s), 0);

/** A point a day up to a month; a point a week beyond that. */
export const bucketDays = (days: number): 1 | 7 => (days > 31 ? 7 : 1);

/**
 * The period as points for a chart, each with the matching point of the
 * period before. Days with nothing recorded are zero; with `since` (the day
 * the source's history starts), points before it are left out rather than
 * drawn as zeros. Weeks are counted back from the last day, so the last
 * point is always a whole week.
 */
export function trendPoints(cur: DayValue[], prev: DayValue[] | null, w: Windows, since?: ISODate | null): TrendPoint[] {
  const size = bucketDays(w.cur.days);
  const byDay = (rows: DayValue[]) => {
    const m = new Map<ISODate, number>();
    for (const r of rows) m.set(r.day, (m.get(r.day) ?? 0) + r.value);
    return m;
  };
  const c = byDay(cur);
  const p = prev ? byDay(prev) : null;
  const n = Math.floor(w.cur.days / size);
  const lead = w.cur.days - n * size;
  const out: TrendPoint[] = [];
  for (let b = 0; b < n; b++) {
    const offset = lead + b * size;
    const x = addDays(w.cur.from, offset);
    const to = addDays(x, size - 1);
    if (since && to < since) continue;
    let cv = 0;
    let pv = 0;
    for (let i = 0; i < size; i++) {
      cv += c.get(addDays(x, i)) ?? 0;
      if (p) pv += p.get(addDays(w.prev.from, offset + i)) ?? 0;
    }
    out.push({ x: since && since > x ? since : x, to, cur: cv, prev: p ? pv : null });
  }
  return out;
}

// ---- Where website visits came from -------------------------------------------------------------

export type Channel = "google-search" | "google-listing" | "search-other" | "social" | "direct" | "email" | "listings" | "other";

export const CHANNEL_LABEL: Record<Channel, string> = {
  "google-search": "Google Search",
  "google-listing": "Google Maps and the listing",
  "search-other": "Other search and maps",
  social: "Social",
  direct: "Typed in or bookmarked",
  email: "Email",
  listings: "Review and listing sites",
  other: "Everything else",
};

const CHANNEL_SOURCES: [Channel, string[]][] = [
  ["google-search", ["google"]],
  ["google-listing", ["google-maps", "google-business"]],
  ["search-other", ["bing", "duckduckgo", "yahoo", "ecosia", "brave", "apple-maps"]],
  ["social", ["instagram", "facebook", "threads", "tiktok", "x", "reddit", "youtube", "pinterest", "linkedin"]],
  ["direct", ["direct"]],
  ["email", ["email", "newsletter"]],
  ["listings", ["yelp", "tripadvisor", "untappd", "opentable"]],
];

/** A website visit's source (as Website analytics names it) → one of a few plain channels. */
export function channelOf(source: string): Channel {
  return CHANNEL_SOURCES.find(([, list]) => list.includes(source))?.[0] ?? "other";
}

export interface MixPart {
  key: Channel;
  label: string;
  visits: number;
  share: number;
}

/**
 * Visits by channel, biggest first, as shares of the whole. At most
 * `maxParts` parts: the smallest are folded into "Everything else", which
 * always comes last.
 */
export function sourceMix(rows: { source: string; visits: number }[], maxParts = 6): { total: number; parts: MixPart[] } {
  const by = new Map<Channel, number>();
  for (const r of rows) if (r.visits > 0) by.set(channelOf(r.source), (by.get(channelOf(r.source)) ?? 0) + r.visits);
  const total = [...by.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return { total: 0, parts: [] };
  let other = by.get("other") ?? 0;
  const named = [...by.entries()].filter(([k]) => k !== "other").sort((a, b) => b[1] - a[1]);
  let keep = named;
  if (named.length + (other > 0 ? 1 : 0) > maxParts) {
    keep = named.slice(0, Math.max(0, maxParts - 1));
    other += named.slice(keep.length).reduce((s, [, v]) => s + v, 0);
  }
  const part = (key: Channel, visits: number): MixPart => ({ key, label: CHANNEL_LABEL[key], visits, share: visits / total });
  return { total, parts: [...keep.map(([k, v]) => part(k, v)), ...(other > 0 ? [part("other", other)] : [])] };
}

// ---- The Google listing -------------------------------------------------------------------------

/** The Business Profile metrics the nightly sync stores (GoogleProfileDaily.metric). */
export const LISTING_VIEW_METRICS = ["BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH"] as const;
export type ListingViewMetric = (typeof LISTING_VIEW_METRICS)[number];
export const LISTING_ACTION_METRICS = ["BUSINESS_DIRECTION_REQUESTS", "CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_FOOD_MENU_CLICKS", "BUSINESS_BOOKINGS"] as const;
export type ListingActionMetric = (typeof LISTING_ACTION_METRICS)[number];

/** What each stored number counts, in plain words. */
export const LISTING_LABEL: Record<ListingViewMetric | ListingActionMetric, string> = {
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Google Maps, on a phone",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Google Maps, on a computer",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Google Search, on a phone",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Google Search, on a computer",
  BUSINESS_DIRECTION_REQUESTS: "Asked for directions",
  CALL_CLICKS: "Called",
  WEBSITE_CLICKS: "Opened the website",
  BUSINESS_FOOD_MENU_CLICKS: "Looked at the menu",
  BUSINESS_BOOKINGS: "Booked",
};

export type MetricTotals = Record<string, number>;

export function sumByMetric(rows: { metric: string; value: number }[]): MetricTotals {
  const out: MetricTotals = {};
  for (const r of rows) out[r.metric] = (out[r.metric] ?? 0) + r.value;
  return out;
}

/** Times the listing was shown, split by where (Maps or Search) and on what (phone or computer). */
export function listingViews(t: MetricTotals): { total: number; maps: number; search: number; phone: number; computer: number } {
  const v = (m: ListingViewMetric) => t[m] ?? 0;
  const maps = v("BUSINESS_IMPRESSIONS_MOBILE_MAPS") + v("BUSINESS_IMPRESSIONS_DESKTOP_MAPS");
  const search = v("BUSINESS_IMPRESSIONS_MOBILE_SEARCH") + v("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH");
  const phone = v("BUSINESS_IMPRESSIONS_MOBILE_MAPS") + v("BUSINESS_IMPRESSIONS_MOBILE_SEARCH");
  return { total: maps + search, maps, search, phone, computer: maps + search - phone };
}

export const listingActionsTotal = (t: MetricTotals): number => LISTING_ACTION_METRICS.reduce((s, m) => s + (t[m] ?? 0), 0);

// ---- What people did next ------------------------------------------------------------------------

export type StepKey = "directions" | "call" | "site" | "menu" | "order" | "tickets" | "inquiry" | "booking" | "page" | "button" | "message";

interface StepDef {
  key: StepKey;
  label: string;
  /** Business Profile metrics that count this on the listing. */
  listing: ListingActionMetric[];
  /** Website events that count this on the website. */
  website: string[];
  /** Stored channel metrics that count this on Instagram and on the Facebook Page. */
  instagram?: string[];
  facebook?: string[];
  /** Left out while it is zero everywhere (not every business has it). */
  optional?: boolean;
}

/** Website visits that began on a channel, counted by the website and put with that channel's totals. */
export const WEBSITE_VISITS_KEY = "website_visits";

const STEPS: StepDef[] = [
  { key: "directions", label: "Asked for directions", listing: ["BUSINESS_DIRECTION_REQUESTS"], website: ["click_directions"], instagram: ["tap_directions"] },
  { key: "call", label: "Called", listing: ["CALL_CLICKS"], website: ["click_call"], instagram: ["tap_call"] },
  { key: "site", label: "Went on to the website", listing: ["WEBSITE_CLICKS"], website: [], instagram: [WEBSITE_VISITS_KEY], facebook: [WEBSITE_VISITS_KEY] },
  { key: "menu", label: "Looked at the menu", listing: ["BUSINESS_FOOD_MENU_CLICKS"], website: ["menu_view"] },
  { key: "order", label: "Went to order online", listing: [], website: ["click_order_online"], optional: true },
  { key: "tickets", label: "Tapped a ticket or RSVP link", listing: [], website: ["ticket_click", "rsvp_click"], optional: true },
  { key: "inquiry", label: "Asked about a private event", listing: [], website: ["inquiry_submit"] },
  { key: "booking", label: "Booked through the listing", listing: ["BUSINESS_BOOKINGS"], website: [], optional: true },
  { key: "page", label: "Opened the Facebook Page", listing: [], website: [], facebook: ["profile_visits"], optional: true },
  { key: "button", label: "Tapped a button on the Facebook Page", listing: [], website: [], facebook: ["profile_taps"], optional: true },
  { key: "message", label: "Tapped Email or Text on Instagram", listing: [], website: [], instagram: ["tap_email", "tap_text"], optional: true },
];

export interface SideTotals {
  cur: MetricTotals;
  /** Null when the source has no comparable period before. */
  prev: MetricTotals | null;
}

export interface NextStep {
  key: StepKey;
  label: string;
  /** Null when the listing doesn't count this, or isn't connected. */
  listing: Delta | null;
  /** Null when the website doesn't count this, or isn't sending visits. */
  website: Delta | null;
  /** Null when Instagram (or the Facebook Page) doesn't count this, or isn't connected. */
  instagram: Delta | null;
  facebook: Delta | null;
}

/**
 * The same intent in each place, row by row: directions, calls, going on to
 * the website, the menu, and the things only one of them has. The Google
 * listing and the website come first; Instagram and the Facebook Page join
 * the rows they share. A side that isn't connected (null) leaves its bar
 * out; rows with no side left are dropped.
 */
export function nextSteps(a: { listing: SideTotals | null; website: SideTotals | null; instagram?: SideTotals | null; facebook?: SideTotals | null }): NextStep[] {
  const side = (s: SideTotals | null | undefined, keys: string[] | undefined): Delta | null => {
    if (!s || !keys?.length) return null;
    const sum = (t: MetricTotals) => keys.reduce((n, k) => n + (t[k] ?? 0), 0);
    return delta(sum(s.cur), s.prev ? sum(s.prev) : null);
  };
  const out: NextStep[] = [];
  for (const d of STEPS) {
    const sides = { listing: side(a.listing, d.listing), website: side(a.website, d.website), instagram: side(a.instagram, d.instagram), facebook: side(a.facebook, d.facebook) };
    const all = Object.values(sides);
    if (all.every((x) => !x)) continue;
    const any = all.some((x) => x && (x.cur > 0 || (x.prev ?? 0) > 0));
    if (d.optional && !any) continue;
    out.push({ key: d.key, label: d.label, ...sides });
  }
  return out;
}

// ---- Reviews -----------------------------------------------------------------------------------

export interface ReviewPoint {
  day: ISODate;
  rating: number;
}

export interface ReviewSummary {
  /** Average over the last 90 days: the same number the Reviews page leads with. */
  rating: number | null;
  ratingCount: number;
  /** Every review on file. */
  total: number;
  /** Reviews posted in the period, against the period before. */
  inPeriod: Delta;
  /** Average rating of the period's reviews, and of the period before. */
  avg: number | null;
  prevAvg: number | null;
  /** Stars up or down between the two, when each has at least three reviews. */
  ratingChange: number | null;
}

const MIN_REVIEWS_TO_COMPARE = 3;

export function reviewSummary(reviews: ReviewPoint[], w: Windows, today: ISODate): ReviewSummary {
  const mean = (rs: ReviewPoint[]) => (rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : null);
  const within = (s: Span) => reviews.filter((r) => r.day >= s.from && r.day <= s.to);
  const since90 = addDays(today, -90);
  const recent = reviews.filter((r) => r.day >= since90 && r.day <= today);
  const first = reviews.reduce<ISODate | null>((m, r) => (!m || r.day < m ? r.day : m), null);
  const cur = within(w.cur);
  const prev = within(w.prev);
  const prevCovered = coverage(w.prev, first).kind === "full";
  const avg = mean(cur);
  const prevAvg = prevCovered ? mean(prev) : null;
  return {
    rating: mean(recent),
    ratingCount: recent.length,
    total: reviews.length,
    inPeriod: delta(cur.length, prevCovered ? prev.length : null),
    avg,
    prevAvg,
    ratingChange: avg != null && prevAvg != null && cur.length >= MIN_REVIEWS_TO_COMPARE && prev.length >= MIN_REVIEWS_TO_COMPARE ? avg - prevAvg : null,
  };
}

// ---- What a block says while its source isn't ready ------------------------------------------------

export type SourceKind = "ready" | "waiting" | "connect" | "reconnect" | "pick" | "syncing" | "empty" | "setup" | "unavailable";

export interface SourceState {
  kind: SourceKind;
  title: string;
  /** One or two plain sentences: what will appear here, and what (if anything) to do. */
  body: string;
  /** Where to set it up. */
  href: string | null;
  action: string | null;
}

const READY: SourceState = { kind: "ready", title: "", body: "", href: null, action: null };
export const GOOGLE_SETUP_HREF = "/website/analytics/google";
export const TRACKING_SETUP_HREF = "/website/analytics#tracking";

/** What the app knows about the Google connection (from googleStatus()). */
export interface GoogleFacts {
  connected: boolean;
  needsReconnect: boolean;
  /** Search Console was allowed at sign-in. */
  searchAllowed: boolean;
  /** Business Profile was allowed at sign-in. */
  listingAllowed: boolean;
  /** The Search Console property picked for the website. */
  siteUrl: string | null;
  /** The Business Profile listing picked. */
  location: string | null;
  hasSearchData: boolean;
  hasListingData: boolean;
  /** A listing sync has finished without an error. */
  listingSynced: boolean;
}

const RECONNECT: SourceState = {
  kind: "reconnect",
  title: "Google needs connecting again",
  body: "The Google sign-in expired or was removed, so new numbers have stopped coming in. Connect again and they pick up where they left off.",
  href: GOOGLE_SETUP_HREF,
  action: "Connect again",
};

/** The Google sign-in itself: worth raising even while older numbers still show. */
export const signInState = (f: Pick<GoogleFacts, "needsReconnect">): SourceState => (f.needsReconnect ? RECONNECT : READY);

/** Google Search results (Search Console). */
export function searchState(f: GoogleFacts): SourceState {
  if (f.hasSearchData) return READY;
  if (f.needsReconnect) return RECONNECT;
  if (!f.connected || !f.searchAllowed)
    return {
      kind: "connect",
      title: "Google Search isn't connected yet",
      body: "Connect Google Search Console to see how often the website shows up in Google's results, the searches behind it, and how many people click through.",
      href: GOOGLE_SETUP_HREF,
      action: "Connect Google",
    };
  if (!f.siteUrl)
    return {
      kind: "pick",
      title: "Pick the website in Search Console",
      body: "Google is connected, but the app doesn't know which Search Console property is the website. Pick it and the searches appear after the next sync.",
      href: GOOGLE_SETUP_HREF,
      action: "Pick the website",
    };
  return {
    kind: "syncing",
    title: "Connected. The first numbers are on their way",
    body: "The searches that show the website arrive after tonight's sync, with up to 16 months of history.",
    href: GOOGLE_SETUP_HREF,
    action: "See the status",
  };
}

const LISTING_WILL_SHOW = "how often the listing appears on Google Search and Maps, and the calls, direction requests and website clicks that follow";

/** The Google listing (Business Profile). Its numbers need Google to approve access first. */
export function listingState(f: GoogleFacts): SourceState {
  if (f.hasListingData) return READY;
  if (f.needsReconnect) return RECONNECT;
  if (!f.connected)
    return {
      kind: "connect",
      title: "The Google listing isn't connected yet",
      body: `Connect Google to see ${LISTING_WILL_SHOW}. Google also has to approve access to a listing's numbers, which can take a couple of weeks.`,
      href: GOOGLE_SETUP_HREF,
      action: "Connect Google",
    };
  if (f.listingAllowed && f.location && f.listingSynced)
    return {
      kind: "empty",
      title: "Connected. No numbers from Google yet",
      body: `Google hasn't sent anything for this listing so far. When it does, this shows ${LISTING_WILL_SHOW}.`,
      href: GOOGLE_SETUP_HREF,
      action: "See the status",
    };
  return {
    kind: "waiting",
    title: "Waiting on Google's approval",
    body: `Your Google sign-in is done and nothing is broken. Google reviews each request to read a listing's numbers by hand, usually within two weeks, and emails when it's approved. After that, press Find again on the Connect Google page and this shows ${LISTING_WILL_SHOW}.${f.listingAllowed ? "" : " Business Profile wasn't ticked at sign-in, so connect Google again when the approval arrives."}`,
    href: GOOGLE_SETUP_HREF,
    action: "See the status",
  };
}

/** The website's own visit counts. */
export function websiteState(a: { hasVisits: boolean; hasAddress: boolean }): SourceState {
  if (a.hasVisits) return READY;
  return {
    kind: "setup",
    title: a.hasAddress ? "Waiting for the first visit" : "The website isn't sending visits yet",
    body: a.hasAddress
      ? "The website needs the small tracking snippet. Once it's on, this shows how many visits the website gets and where they come from, within a minute."
      : "Add the website's address and the small tracking snippet, and this shows how many visits the website gets and where they come from.",
    href: TRACKING_SETUP_HREF,
    action: "Set up tracking",
  };
}

/** Guest reviews. */
export function reviewsState(a: { count: number; googleConnected: boolean }): SourceState {
  if (a.count > 0) return READY;
  return a.googleConnected
    ? { kind: "empty", title: "No reviews yet", body: "Google reviews are checked every morning. The rating, how many came in and the trend show here once the first ones arrive.", href: "/reviews", action: "Open Reviews" }
    : { kind: "setup", title: "No reviews yet", body: "Connect Google reviews, or paste a few in on the Reviews page, and the rating, how many came in and the trend show here.", href: "/reviews", action: "Open Reviews" };
}

/** A source that failed to load: the rest of the page carries on. */
export const unavailable = (what: string): SourceState => ({ kind: "unavailable", title: `Couldn't load ${what} just now`, body: "The rest of the page is unaffected. Try again in a minute.", href: null, action: null });

// ---- Worth a look ---------------------------------------------------------------------------------

/** A drop of a quarter or more is worth a look; a halving is serious; a rise of 40% is worth a mention. */
export const SHARP_DROP = -0.25;
export const SERIOUS_DROP = -0.5;
export const SHARP_RISE = 0.4;
/** Stars the period's rating has to fall by, against the period before. */
export const RATING_SLIP = 0.3;

export interface LookMetric {
  key: string;
  /** A plural name that reads before "are down", e.g. "Calls from the listing". */
  label: string;
  delta: Delta;
  /** The page that explains it. */
  href: string;
}

export interface LookInput {
  /** The period in words, e.g. "28 days". */
  period: string;
  metrics: LookMetric[];
  states: { key: string; state: SourceState }[];
  /** Sources whose numbers have stopped arriving. `from` names who sends them (Google unless said). */
  stale: { key: string; label: string; through: ISODate; href: string; from?: string }[];
  /** Average rating of the period's reviews and of the period before (null when too few to compare). */
  rating: { cur: number | null; prev: number | null };
  /** Critical or mixed reviews with no reply. */
  needReply: number;
  /** Lines a source worked out for itself (see socialLook in ./onlineChannels). */
  extra?: LookItem[];
}

export interface LookItem {
  key: string;
  tone: "bad" | "warn" | "good" | "neutral";
  title: string;
  detail: string;
  href: string;
}

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const pct0 = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sayDay = (d: ISODate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const TONE_ORDER: Record<LookItem["tone"], number> = { bad: 0, warn: 1, neutral: 2, good: 3 };

/**
 * The short list under the charts: only things the numbers actually show.
 * A metric down sharply against the period before (and by more than normal
 * ups and downs), a source that still needs setting up, a source that has
 * stopped updating, a slipping rating, reviews waiting for a reply, and a
 * sharp rise, then whatever a source worked out for itself (`extra`). A
 * source that is only waiting on Google is not listed: there is nothing to
 * do about it. Most serious first, at most `max` rows.
 */
export function worthALook(a: LookInput, max = 6): LookItem[] {
  const out: LookItem[] = [];
  const both = (d: Delta) => `${n0(d.cur)} in the last ${a.period}, ${n0(d.prev ?? 0)} in the ${a.period} before.`;
  for (const m of a.metrics) {
    const d = m.delta;
    if (d.change == null || !d.clear || d.change > SHARP_DROP) continue;
    out.push({ key: `down-${m.key}`, tone: d.change <= SERIOUS_DROP ? "bad" : "warn", title: `${m.label} are down ${pct0(d.change)}`, detail: both(d), href: m.href });
  }
  const said = new Set<string>();
  for (const s of a.states) {
    const st = s.state;
    if (!st.href || !["connect", "reconnect", "pick", "setup"].includes(st.kind)) continue;
    // One expired sign-in stops several sources: say it once.
    if (said.has(st.title)) continue;
    said.add(st.title);
    out.push({ key: `setup-${s.key}`, tone: st.kind === "reconnect" ? "warn" : "neutral", title: st.title, detail: st.body, href: st.href });
  }
  for (const s of a.stale) out.push({ key: `stale-${s.key}`, tone: "warn", title: `${s.label} stopped on ${sayDay(s.through)}`, detail: `Nothing newer has arrived from ${s.from ?? "Google"}. Check the connection and sync again.`, href: s.href });
  if (a.rating.cur != null && a.rating.prev != null && a.rating.cur - a.rating.prev <= -RATING_SLIP) {
    out.push({ key: "rating", tone: "warn", title: `The rating slipped to ${a.rating.cur.toFixed(1)} from ${a.rating.prev.toFixed(1)}`, detail: `The average of reviews in the last ${a.period}, against the ${a.period} before.`, href: "/reviews" });
  }
  if (a.needReply > 0) {
    out.push({ key: "reply", tone: "warn", title: `${a.needReply} review${a.needReply === 1 ? " is" : "s are"} waiting for a reply`, detail: "Critical or mixed reviews nobody has answered yet.", href: "/reviews?show=open" });
  }
  for (const m of a.metrics) {
    const d = m.delta;
    if (d.change == null || !d.clear || d.change < SHARP_RISE) continue;
    out.push({ key: `up-${m.key}`, tone: "good", title: `${m.label} are up ${pct0(d.change)}`, detail: both(d), href: m.href });
  }
  out.push(...(a.extra ?? []));
  // Most serious first; within a tone, the bigger drop first, then the order found.
  const size = (i: LookItem) => (i.key.startsWith("down-") ? a.metrics.find((m) => `down-${m.key}` === i.key)?.delta.change ?? 0 : 0);
  return out
    .map((item, i) => ({ item, i }))
    .sort((x, y) => TONE_ORDER[x.item.tone] - TONE_ORDER[y.item.tone] || size(x.item) - size(y.item) || x.i - y.i)
    .slice(0, max)
    .map((x) => x.item);
}
