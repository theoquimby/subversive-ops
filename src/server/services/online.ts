import "server-only";
import { addDays, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { isBrandQuery, sumGsc } from "@/domain/googleData";
import {
  alignToData,
  compare,
  coverage,
  GOOGLE_SETUP_HREF,
  LISTING_ACTION_METRICS,
  LISTING_LABEL,
  LISTING_VIEW_METRICS,
  listingActionsTotal,
  listingState,
  listingViews,
  nextSteps,
  rangeOf,
  rangeWindows,
  ratio,
  reviewsState,
  reviewSummary,
  searchState,
  signInState,
  sourceMix,
  sumByMetric,
  trendPoints,
  unavailable,
  WEBSITE_VISITS_KEY,
  websiteState,
  worthALook,
  type Delta,
  type GoogleFacts,
  type ListingActionMetric,
  type ListingViewMetric,
  type LookItem,
  type LookMetric,
  type MixPart,
  type NextStep,
  type OnlineRangeId,
  type ReviewSummary,
  type SideTotals,
  type SourceState,
  type TrendPoint,
  type Windows,
} from "@/domain/online";
import { bestAndWorst, dailyAverage, followerSummary, META_SETUP_HREF, postCallout, postsForPage, SOCIAL, SOCIAL_CHANNELS, socialLook, socialState, TAP_LABEL, type BestWorst, type FollowerSummary, type MetaFacts, type PostRow, type SocialChannel } from "@/domain/onlineChannels";
import { rollingRating } from "@/domain/reviews";
import { db } from "../db";
import { googleStatus, profileRows, searchRows, type GoogleStatus } from "./googleSearch";
import { channelBounds, channelPosts, channelRows, metaFacts, metaStatus, type MetaStatus } from "./metaChannels";
import { needsReply, reviewDate, SETTING_PLACE_ID } from "./reviews";
import { businessToday } from "./sales";
import { dailyRows, extraOrigins, firstHitDay, mainWebsiteOrigin, refreshRollups } from "./webAnalytics";

/**
 * Online → Overview, Google listing, Instagram and Facebook: Google Search
 * (Search Console), the Google listing (Business Profile), the website's own
 * visit counts, Instagram, the Facebook Page and reviews, read from what is
 * already stored. No calls to Google or Meta.
 *
 * Every source loads on its own and fails soft: a source that throws is
 * logged and shown as unavailable, and the rest of the page carries on.
 */

/** A block of a page: what to say while its source isn't ready, and its numbers once it is. */
export interface Loaded<T> {
  state: SourceState;
  data: T | null;
}

export interface SearchQuery {
  query: string;
  /** Times the website was shown in Google's results for this search. */
  shown: number;
  clicks: number;
  /** Average spot in the results (1 is the top). */
  position: number | null;
  /** A search for the business by name. */
  brand: boolean;
}

export interface SearchBlock {
  windows: Windows;
  /** The last day Google has reported. */
  through: ISODate | null;
  /** The day the history starts, when that is inside the period. */
  since: ISODate | null;
  stale: boolean;
  shown: Delta;
  clicks: Delta;
  clickRate: number | null;
  position: number | null;
  /** Share of clicks from searches for the business by name. */
  brandShare: number | null;
  trend: TrendPoint[];
  queries: SearchQuery[];
}

export interface ListingBlock {
  windows: Windows;
  through: ISODate | null;
  since: ISODate | null;
  stale: boolean;
  /** Times the listing was shown, in all and by where. */
  views: Delta;
  maps: Delta;
  search: Delta;
  split: { key: ListingViewMetric; label: string; value: number }[];
  /** Calls, direction requests, website clicks, menu clicks and bookings together. */
  actions: Delta;
  totals: SideTotals;
  viewsTrend: TrendPoint[];
  /** Views per point, split by where the listing was shown. */
  surfaceTrend: { x: ISODate; to: ISODate; maps: number; search: number }[];
  actionTrends: { metric: ListingActionMetric; label: string; total: Delta; points: TrendPoint[] }[];
  keywords: { keyword: string; value: number | null; threshold: number | null }[];
  /** YYYY-MM the keywords are for, and whether that month is still filling in. */
  keywordMonth: string | null;
  keywordMonthPartial: boolean;
}

export interface WebsiteBlock {
  windows: Windows;
  since: ISODate | null;
  visits: Delta;
  people: Delta;
  trend: TrendPoint[];
  mix: { total: number; parts: MixPart[] };
  /** Calls, directions, orders, ticket and RSVP taps and inquiries together. */
  actions: Delta;
  totals: SideTotals;
}

export interface ReviewsBlock {
  summary: ReviewSummary;
  /** Rolling average of the last 5 reviews. */
  trend: { x: ISODate; y: number }[];
  trendFrom: ISODate;
  needReply: number;
  googleConnected: boolean;
}

/** Instagram or the Facebook Page over a period. */
export interface SocialBlock {
  channel: SocialChannel;
  windows: Windows;
  /** The last day the channel has reported. */
  through: ISODate | null;
  since: ISODate | null;
  stale: boolean;
  /** Times its posts (and the profile or Page) were shown. */
  views: Delta;
  viewsTrend: TrendPoint[];
  /** Accounts (or people) reached on a typical day; a count of people can't be added across days. */
  reachPerDay: number | null;
  reachPerDayBefore: number | null;
  reachTrend: TrendPoint[];
  followers: FollowerSummary;
  /** Taps on the profile's (or Page's) buttons. */
  taps: Delta;
  tapsTrend: TrendPoint[];
  /** Instagram splits its taps by button. */
  tapParts: { key: string; label: string; value: number }[];
  /** Visits to the Page itself (Facebook only). */
  visits: Delta | null;
  visitsTrend: TrendPoint[];
  interactions: Delta;
  /** Website visits that started on this channel, counted by the website. Null while the website isn't counting. */
  website: Delta | null;
  /** For "What they did next". */
  totals: SideTotals;
  /** The period's posts (or the latest few, when the period has almost none). */
  posts: PostRow[];
  postsInPeriod: boolean;
  best: BestWorst | null;
  /** The best and worst post of the period, in a sentence. */
  callout: string | null;
  /** Profile visits that came from the period's posts (Instagram only). */
  postVisits: number | null;
  lastPostDay: ISODate | null;
}

export interface OnlineOverview {
  range: OnlineRangeId;
  /** "28 days" */
  period: string;
  today: ISODate;
  windows: Windows;
  search: Loaded<SearchBlock>;
  listing: Loaded<ListingBlock>;
  website: Loaded<WebsiteBlock>;
  instagram: Loaded<SocialBlock>;
  facebook: Loaded<SocialBlock>;
  reviews: Loaded<ReviewsBlock>;
  next: NextStep[];
  look: LookItem[];
}

export interface SocialConnection {
  connected: boolean;
  /** "@drinksubversive", or the Page's name. */
  name: string | null;
  connectedBy: string | null;
  lastSyncAt: string | null;
  error: string | null;
  /** Numbers Meta no longer gives, as named by Meta. */
  skipped: string[];
  manageHref: string;
}

export interface SocialReport {
  range: OnlineRangeId;
  period: string;
  today: ISODate;
  windows: Windows;
  channel: SocialChannel;
  block: Loaded<SocialBlock>;
  connection: SocialConnection | null;
}

export interface ListingConnection {
  connected: boolean;
  /** The listing's name on Google. */
  title: string | null;
  connectedBy: string | null;
  lastSyncAt: string | null;
  /** The last day the sync read. */
  lastDay: ISODate | null;
  error: string | null;
  manageHref: string;
}

export interface ListingReport {
  range: OnlineRangeId;
  period: string;
  today: ISODate;
  windows: Windows;
  listing: Loaded<ListingBlock>;
  /** Null when the connection itself couldn't be read. */
  connection: ListingConnection | null;
}

// ---- Loading, softly ---------------------------------------------------------------------------

type Soft<T> = { ok: true; value: T } | { ok: false };

async function soft<T>(what: string, fn: () => Promise<T>): Promise<Soft<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    console.error(`online: ${what} unavailable`, e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

/** Failed to load → unavailable; loaded with numbers → ready; loaded with none → whatever the connection says. */
function block<T>(res: Soft<T | null>, what: string, state: (hasData: boolean) => SourceState): Loaded<T> {
  if (!res.ok) return { state: unavailable(what), data: null };
  return { state: state(res.value != null), data: res.value };
}

const factsFrom = (s: GoogleStatus | null, has: { search: boolean; listing: boolean }): GoogleFacts | null =>
  s && {
    connected: s.connected,
    needsReconnect: !!s.needsReconnect,
    searchAllowed: s.grant.search,
    listingAllowed: s.grant.business,
    siteUrl: s.siteUrl,
    location: s.location,
    hasSearchData: has.search,
    hasListingData: has.listing,
    listingSynced: !!s.state.profile.lastDay && !s.state.profile.error,
  };

const dayRange = (from: ISODate, to: ISODate) => ({ gte: parseISODate(from), lte: parseISODate(to) });

// ---- Google Search (Search Console) ---------------------------------------------------------------

async function loadSearch(w: Windows): Promise<SearchBlock | null> {
  const [last, first] = await Promise.all([
    db.googleSearchDaily.findFirst({ where: { dim: "total" }, orderBy: { day: "desc" }, select: { day: true } }),
    db.googleSearchDaily.findFirst({ where: { dim: "total" }, orderBy: { day: "asc" }, select: { day: true } }),
  ]);
  if (!last || !first) return null;
  const a = alignToData(w, toISODate(last.day));
  const firstDay = toISODate(first.day);
  const since = coverage(a.cur, firstDay).since;
  const comparable = !a.stale && coverage(a.prev, firstDay).kind === "full";
  const [cur, prev, byQuery] = await Promise.all([
    searchRows(a.cur.from, a.cur.to, ["total"]),
    searchRows(a.prev.from, a.prev.to, ["total"]),
    db.googleSearchDaily.groupBy({ by: ["key"], where: { dim: "query", day: dayRange(a.cur.from, a.cur.to) }, _sum: { clicks: true, impressions: true } }),
  ]);
  const tc = sumGsc(cur);
  const tp = sumGsc(prev);
  const all = byQuery.map((q) => ({ query: q.key, shown: q._sum.impressions ?? 0, clicks: q._sum.clicks ?? 0 }));
  const top = [...all].sort((x, y) => y.shown - x.shown || y.clicks - x.clicks).slice(0, 10);
  // Average spot is weighted by how often each day's result was shown, so it needs the top searches' daily rows.
  const rows = top.length ? await db.googleSearchDaily.findMany({ where: { dim: "query", key: { in: top.map((t) => t.query) }, day: dayRange(a.cur.from, a.cur.to) }, select: { key: true, impressions: true, position: true } }) : [];
  const spot = new Map<string, number>();
  for (const r of rows) spot.set(r.key, (spot.get(r.key) ?? 0) + r.position.toNumber() * r.impressions);
  const qClicks = all.reduce((s, q) => s + q.clicks, 0);
  const cmp = (c: number, p: number) => compare(c, p, comparable ? "full" : "none");
  return {
    windows: { cur: a.cur, prev: a.prev },
    through: a.through,
    since,
    stale: a.stale,
    shown: cmp(tc.impressions, tp.impressions),
    clicks: cmp(tc.clicks, tp.clicks),
    clickRate: tc.ctr,
    position: tc.position,
    brandShare: ratio(all.filter((q) => isBrandQuery(q.query)).reduce((s, q) => s + q.clicks, 0), qClicks),
    trend: trendPoints(cur.map((r) => ({ day: r.day, value: r.impressions })), comparable ? prev.map((r) => ({ day: r.day, value: r.impressions })) : null, a, since),
    queries: top.map((t) => ({ ...t, position: t.shown > 0 && spot.has(t.query) ? spot.get(t.query)! / t.shown : null, brand: isBrandQuery(t.query) })),
  };
}

// ---- The Google listing (Business Profile) -----------------------------------------------------------

const monthBefore = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

async function loadListing(w: Windows, today: ISODate): Promise<ListingBlock | null> {
  const [last, first] = await Promise.all([
    db.googleProfileDaily.findFirst({ where: { value: { gt: 0 } }, orderBy: { day: "desc" }, select: { day: true } }),
    db.googleProfileDaily.findFirst({ where: { value: { gt: 0 } }, orderBy: { day: "asc" }, select: { day: true } }),
  ]);
  if (!last || !first) return null;
  const a = alignToData(w, toISODate(last.day));
  const firstDay = toISODate(first.day);
  const since = coverage(a.cur, firstDay).since;
  const comparable = !a.stale && coverage(a.prev, firstDay).kind === "full";
  // The last finished month's search terms; this month's (still filling in) only when that is all there is.
  const thisMonth = today.slice(0, 7);
  const lastMonth = monthBefore(thisMonth);
  const [cur, prev, kws] = await Promise.all([profileRows(a.cur.from, a.cur.to), profileRows(a.prev.from, a.prev.to), db.googleProfileKeyword.findMany({ where: { month: { in: [lastMonth, thisMonth] } } })]);
  const tc = sumByMetric(cur);
  const tp = sumByMetric(prev);
  const vc = listingViews(tc);
  const vp = listingViews(tp);
  const cmp = (c: number, p: number) => compare(c, p, comparable ? "full" : "none");
  const series = (rows: typeof cur, metrics: readonly string[]) => rows.filter((r) => metrics.includes(r.metric)).map((r) => ({ day: r.day, value: r.value }));
  const points = (metrics: readonly string[]) => trendPoints(series(cur, metrics), comparable ? series(prev, metrics) : null, a, since);
  const maps = points(LISTING_VIEW_METRICS.filter((m) => m.endsWith("_MAPS")));
  const search = points(LISTING_VIEW_METRICS.filter((m) => m.endsWith("_SEARCH")));
  const keywordMonth = kws.some((k) => k.month === lastMonth) ? lastMonth : kws.some((k) => k.month === thisMonth) ? thisMonth : null;
  return {
    windows: { cur: a.cur, prev: a.prev },
    through: a.through,
    since,
    stale: a.stale,
    views: cmp(vc.total, vp.total),
    maps: cmp(vc.maps, vp.maps),
    search: cmp(vc.search, vp.search),
    split: LISTING_VIEW_METRICS.map((key) => ({ key, label: LISTING_LABEL[key], value: tc[key] ?? 0 })),
    actions: cmp(listingActionsTotal(tc), listingActionsTotal(tp)),
    totals: { cur: tc, prev: comparable ? tp : null },
    viewsTrend: points(LISTING_VIEW_METRICS),
    surfaceTrend: maps.map((m, i) => ({ x: m.x, to: m.to, maps: m.cur, search: search[i]?.cur ?? 0 })),
    actionTrends: LISTING_ACTION_METRICS.map((metric) => ({ metric, label: LISTING_LABEL[metric], total: cmp(tc[metric] ?? 0, tp[metric] ?? 0), points: points([metric]) }))
      // Bookings only once the listing has some.
      .filter((t) => t.metric !== "BUSINESS_BOOKINGS" || t.total.cur > 0 || (tp[t.metric] ?? 0) > 0),
    keywords: kws
      .filter((k) => k.month === keywordMonth)
      .map((k) => ({ keyword: k.keyword, value: k.value, threshold: k.threshold }))
      .sort((x, y) => (y.value ?? 0) - (x.value ?? 0) || x.keyword.localeCompare(y.keyword))
      .slice(0, 20),
    keywordMonth,
    keywordMonthPartial: keywordMonth === thisMonth,
  };
}

// ---- The website's own visits ---------------------------------------------------------------------

async function loadWebsite(w: Windows): Promise<{ data: WebsiteBlock | null; hasAddress: boolean }> {
  // Yesterday's rollup may not be built yet on the first view of the day.
  await refreshRollups().catch((e) => console.error("online: rollups not refreshed", e instanceof Error ? e.message : e));
  const [firstDay, main, extra] = await Promise.all([firstHitDay(), mainWebsiteOrigin(), extraOrigins()]);
  const hasAddress = !!main || extra.length > 0;
  if (!firstDay) return { data: null, hasAddress };
  const [cur, prev] = await Promise.all([dailyRows(w.cur.from, w.cur.to, ["total", "source", "action", "event"]), dailyRows(w.prev.from, w.prev.to, ["total", "action", "event"])]);
  const since = coverage(w.cur, firstDay).since;
  const comparable = coverage(w.prev, firstDay).kind === "full";
  const cmp = (c: number, p: number) => compare(c, p, comparable ? "full" : "none");
  const of = (rows: typeof cur, dim: string) => rows.filter((r) => r.dim === dim);
  const sum = (rows: typeof cur, f: "sessions" | "visitors" | "count") => rows.reduce((s, r) => s + r[f], 0);
  // Actions by name, plus menu views (an event, not an action) for the side-by-side with the listing.
  const counts = (rows: typeof cur) => sumByMetric([...of(rows, "action"), ...of(rows, "event").filter((r) => r.key === "menu_view")].map((r) => ({ metric: r.key, value: r.count })));
  const bySource = new Map<string, number>();
  for (const r of of(cur, "source")) bySource.set(r.key, (bySource.get(r.key) ?? 0) + r.sessions);
  const totalRows = (rows: typeof cur) => of(rows, "total").map((r) => ({ day: r.day, value: r.sessions }));
  return {
    hasAddress,
    data: {
      windows: w,
      since,
      visits: cmp(sum(of(cur, "total"), "sessions"), sum(of(prev, "total"), "sessions")),
      people: cmp(sum(of(cur, "total"), "visitors"), sum(of(prev, "total"), "visitors")),
      trend: trendPoints(totalRows(cur), comparable ? totalRows(prev) : null, w, since),
      mix: sourceMix([...bySource].map(([source, visits]) => ({ source, visits }))),
      actions: cmp(sum(of(cur, "action"), "count"), sum(of(prev, "action"), "count")),
      totals: { cur: counts(cur), prev: comparable ? counts(prev) : null },
    },
  };
}

// ---- Instagram and the Facebook Page ----------------------------------------------------------------

/** The numbers that show a channel is reporting (followers are a count on a day, so they don't). */
const ACTIVITY = ["views", "reach", "interactions", "profile_taps", "profile_visits"];
const TAP_ORDER = ["tap_directions", "tap_call", "tap_email", "tap_text", "tap_book", "tap_other"];

async function loadSocial(channel: SocialChannel, w: Windows, today: ISODate, period: string): Promise<SocialBlock | null> {
  const [bounds, posts, followerRows, webFirst] = await Promise.all([channelBounds(channel, ACTIVITY), channelPosts(channel), channelRows(channel, addDays(w.prev.from, -7), today, ["followers"]), firstHitDay()]);
  if (!bounds.last && !posts.length && !followerRows.length) return null;
  const a = alignToData(w, bounds.last);
  const since = coverage(a.cur, bounds.first).since;
  const comparable = !a.stale && coverage(a.prev, bounds.first).kind === "full";
  const webComparable = !!webFirst && coverage(w.prev, webFirst).kind === "full";
  const [cur, prev, webCur, webPrev] = await Promise.all([
    channelRows(channel, a.cur.from, a.cur.to),
    channelRows(channel, a.prev.from, a.prev.to),
    webFirst ? dailyRows(w.cur.from, w.cur.to, ["source"]) : Promise.resolve([]),
    webFirst ? dailyRows(w.prev.from, w.prev.to, ["source"]) : Promise.resolve([]),
  ]);
  const tc = sumByMetric(cur);
  const tp = sumByMetric(prev);
  const cmp = (c: number, p: number) => compare(c, p, comparable ? "full" : "none");
  const series = (rows: typeof cur, metric: string) => rows.filter((r) => r.metric === metric).map((r) => ({ day: r.day, value: r.value }));
  const points = (metric: string) => trendPoints(series(cur, metric), comparable ? series(prev, metric) : null, a, since);
  const fromChannel = (rows: { key: string; sessions: number }[]) => rows.filter((r) => r.key === channel).reduce((n, r) => n + r.sessions, 0);
  const website = webFirst ? compare(fromChannel(webCur), fromChannel(webPrev), webComparable ? "full" : "none") : null;
  // The website's count joins this channel's totals only when both have the same history to compare with.
  const withWeb = website && webComparable === comparable ? website : null;
  const span = { from: w.cur.from, to: today, days: w.cur.days + 1 };
  const page = postsForPage(posts, span);
  const inSpan = posts.filter((p) => p.day >= span.from && p.day <= span.to);
  const best = bestAndWorst(inSpan, today);
  const visits = inSpan.filter((p) => p.profileVisits != null);
  return {
    channel,
    windows: { cur: a.cur, prev: a.prev },
    through: a.through,
    since,
    stale: a.stale,
    views: cmp(tc.views ?? 0, tp.views ?? 0),
    viewsTrend: points("views"),
    reachPerDay: dailyAverage(series(cur, "reach"), a.cur),
    reachPerDayBefore: comparable ? dailyAverage(series(prev, "reach"), a.prev) : null,
    reachTrend: points("reach"),
    followers: followerSummary(followerRows.map((r) => ({ day: r.day, value: r.value })), w),
    taps: cmp(tc.profile_taps ?? 0, tp.profile_taps ?? 0),
    tapsTrend: points("profile_taps"),
    tapParts: TAP_ORDER.filter((k) => (tc[k] ?? 0) > 0).map((k) => ({ key: k, label: TAP_LABEL[k], value: tc[k] })),
    visits: channel === "facebook" ? cmp(tc.profile_visits ?? 0, tp.profile_visits ?? 0) : null,
    visitsTrend: channel === "facebook" ? points("profile_visits") : [],
    interactions: cmp(tc.interactions ?? 0, tp.interactions ?? 0),
    website,
    totals: { cur: { ...tc, ...(withWeb ? { [WEBSITE_VISITS_KEY]: withWeb.cur } : {}) }, prev: comparable ? { ...tp, ...(withWeb ? { [WEBSITE_VISITS_KEY]: withWeb.prev ?? 0 } : {}) } : null },
    posts: page.list,
    postsInPeriod: page.inPeriod,
    best,
    callout: postCallout(best, period, channel),
    postVisits: visits.length ? visits.reduce((n, p) => n + (p.profileVisits ?? 0), 0) : null,
    lastPostDay: posts[0]?.day ?? null,
  };
}

const NO_META: MetaFacts = { appReady: false, connected: false, needsReconnect: false, pagePicked: false, instagramLinked: false, synced: { instagram: false, facebook: false } };

const socialBlock = (channel: SocialChannel, res: Soft<SocialBlock | null>, status: Soft<MetaStatus>): Loaded<SocialBlock> =>
  block(res, SOCIAL[channel].place, (hasData) => (hasData ? socialState(channel, NO_META, true) : status.ok ? socialState(channel, metaFacts(status.value), false) : unavailable("the Instagram and Facebook connection")));

// ---- Reviews ----------------------------------------------------------------------------------------

async function loadReviews(w: Windows, today: ISODate): Promise<ReviewsBlock> {
  const [rows, place] = await Promise.all([db.review.findMany({ select: { rating: true, postedAt: true, replied: true, sentiment: true } }), db.setting.findUnique({ where: { key: SETTING_PLACE_ID } })]);
  const pts = rows.map((r) => ({ day: reviewDate(r.postedAt), rating: r.rating }));
  // A short period rarely has enough reviews for a line, so the trend never covers less than 90 days.
  const ninety = addDays(today, -90);
  const trendFrom = w.cur.from < ninety ? w.cur.from : ninety;
  return {
    summary: reviewSummary(pts, w, today),
    trend: rollingRating(pts.map((p) => ({ rating: p.rating, postedAt: p.day, themes: [], sentiment: null })), 5)
      .filter((p) => p.date >= trendFrom)
      .map((p) => ({ x: p.date, y: Math.round(p.avg * 100) / 100 })),
    trendFrom,
    needReply: rows.filter(needsReply).length,
    googleConnected: !!place?.value,
  };
}

// ---- Pages ---------------------------------------------------------------------------------------------

export async function onlineOverview(range: OnlineRangeId): Promise<OnlineOverview> {
  const today = businessToday();
  const windows = rangeWindows(range, today);
  const period = rangeOf(range).label;
  const [status, searchRes, listingRes, websiteRes, reviewsRes, meta, igRes, fbRes] = await Promise.all([
    soft("Google connection", googleStatus),
    soft("Google Search", () => loadSearch(windows)),
    soft("Google listing", () => loadListing(windows, today)),
    soft("website visits", () => loadWebsite(windows)),
    soft("reviews", () => loadReviews(windows, today)),
    soft("Instagram and Facebook connection", metaStatus),
    soft("Instagram", () => loadSocial("instagram", windows, today, period)),
    soft("Facebook Page", () => loadSocial("facebook", windows, today, period)),
  ]);
  const facts = factsFrom(status.ok ? status.value : null, { search: searchRes.ok && searchRes.value != null, listing: listingRes.ok && listingRes.value != null });
  const google = (what: string, state: (f: GoogleFacts) => SourceState) => (hasData: boolean) => (hasData ? state({ ...(facts ?? NO_FACTS), hasSearchData: true, hasListingData: true }) : facts ? state(facts) : unavailable(what));

  const search = block(searchRes, "Google Search", google("the Google connection", searchState));
  const listing = block(listingRes, "the Google listing", google("the Google connection", listingState));
  const website = block(websiteRes.ok ? { ok: true, value: websiteRes.value.data } : websiteRes, "website visits", (has) => websiteState({ hasVisits: has, hasAddress: websiteRes.ok && websiteRes.value.hasAddress }));
  const reviewsLoaded = reviewsRes.ok && reviewsRes.value.summary.total > 0 ? reviewsRes.value : null;
  const reviews = block(reviewsRes.ok ? { ok: true, value: reviewsLoaded } : reviewsRes, "reviews", () => reviewsState({ count: reviewsRes.ok ? reviewsRes.value.summary.total : 0, googleConnected: reviewsRes.ok && reviewsRes.value.googleConnected }));

  const instagram = socialBlock("instagram", igRes, meta);
  const facebook = socialBlock("facebook", fbRes, meta);
  const social = { instagram, facebook };

  const next = nextSteps({ listing: listing.data?.totals ?? null, website: website.data?.totals ?? null, instagram: instagram.data?.totals ?? null, facebook: facebook.data?.totals ?? null });

  const metrics: LookMetric[] = [];
  if (search.data) {
    metrics.push({ key: "shown", label: "Google Search appearances", delta: search.data.shown, href: "/online#searches" });
    metrics.push({ key: "clicks", label: "Clicks from Google Search", delta: search.data.clicks, href: "/online#searches" });
  }
  if (listing.data) {
    metrics.push({ key: "listing-views", label: "Views of the Google listing", delta: listing.data.views, href: "/online/google" });
    const t = (m: ListingActionMetric) => listing.data!.actionTrends.find((x) => x.metric === m)?.total;
    for (const [m, label] of [["BUSINESS_DIRECTION_REQUESTS", "Direction requests from the listing"], ["CALL_CLICKS", "Calls from the listing"], ["WEBSITE_CLICKS", "Website clicks from the listing"]] as const) {
      const d = t(m);
      if (d) metrics.push({ key: m, label, delta: d, href: "/online/google" });
    }
  }
  if (website.data) {
    metrics.push({ key: "visits", label: "Website visits", delta: website.data.visits, href: "/website/analytics" });
    metrics.push({ key: "web-actions", label: "Actions taken on the website", delta: website.data.actions, href: "/website/analytics#actions" });
  }
  for (const c of SOCIAL_CHANNELS) {
    const b = social[c].data;
    if (!b || b.stale) continue;
    metrics.push({ key: `${c}-views`, label: c === "instagram" ? "Instagram views" : "Facebook Page views", delta: b.views, href: SOCIAL[c].href });
    metrics.push({ key: `${c}-taps`, label: c === "instagram" ? "Taps on the Instagram profile's buttons" : "Taps on the Facebook Page's buttons", delta: b.taps, href: SOCIAL[c].href });
  }
  const stale = [
    ...(search.data?.stale && search.data.through ? [{ key: "search", label: "Google Search numbers", through: search.data.through, href: GOOGLE_SETUP_HREF }] : []),
    ...(listing.data?.stale && listing.data.through ? [{ key: "listing", label: "The Google listing's numbers", through: listing.data.through, href: GOOGLE_SETUP_HREF }] : []),
    ...SOCIAL_CHANNELS.flatMap((c) => {
      const b = social[c].data;
      return b?.stale && b.through ? [{ key: c, label: c === "instagram" ? "Instagram's numbers" : "The Facebook Page's numbers", through: b.through, href: META_SETUP_HREF, from: c === "instagram" ? "Instagram" : "Facebook" }] : [];
    }),
  ];
  const look = worthALook({
    period,
    metrics,
    states: [
      ...(facts ? [{ key: "google", state: signInState(facts) }] : []),
      // An expired Facebook sign-in is worth raising even while older numbers still show.
      ...(meta.ok && meta.value.needsReconnect ? [{ key: "meta", state: socialState("instagram", metaFacts(meta.value), false) }] : []),
      { key: "search", state: search.state },
      { key: "listing", state: listing.state },
      { key: "website", state: website.state },
      { key: "instagram", state: instagram.state },
      { key: "facebook", state: facebook.state },
      { key: "reviews", state: reviews.state },
    ],
    stale,
    rating: reviews.data && reviews.data.summary.ratingChange != null ? { cur: reviews.data.summary.avg, prev: reviews.data.summary.prevAvg } : { cur: null, prev: null },
    needReply: reviews.data?.needReply ?? 0,
    extra: SOCIAL_CHANNELS.flatMap((c) => {
      const b = social[c].data;
      return b ? socialLook({ channel: c, period, today, lastPostDay: b.lastPostDay, best: b.best, followers: b.followers }) : [];
    }),
  });

  return { range, period, today, windows, search, listing, website, instagram, facebook, reviews, next, look };
}

const NO_FACTS: GoogleFacts = { connected: false, needsReconnect: false, searchAllowed: false, listingAllowed: false, siteUrl: null, location: null, hasSearchData: false, hasListingData: false, listingSynced: false };

export async function googleListing(range: OnlineRangeId): Promise<ListingReport> {
  const today = businessToday();
  const windows = rangeWindows(range, today);
  const [status, listingRes] = await Promise.all([soft("Google connection", googleStatus), soft("Google listing", () => loadListing(windows, today))]);
  const s = status.ok ? status.value : null;
  const facts = factsFrom(s, { search: s?.hasSearchData ?? false, listing: listingRes.ok && listingRes.value != null });
  const listing = block(listingRes, "the Google listing", (hasData) => (hasData ? listingState({ ...(facts ?? NO_FACTS), hasListingData: true }) : facts ? listingState(facts) : unavailable("the Google connection")));
  return {
    range,
    period: rangeOf(range).label,
    today,
    windows,
    listing,
    connection: s && {
      connected: s.connected,
      title: s.locationTitle,
      connectedBy: s.connectedBy,
      lastSyncAt: s.state.profile.at,
      lastDay: s.state.profile.lastDay,
      error: s.needsReconnect ?? s.state.profile.error,
      manageHref: GOOGLE_SETUP_HREF,
    },
  };
}

/** Online → Instagram and Online → Facebook: one channel over a period, and the state of its connection. */
export async function socialReport(channel: SocialChannel, range: OnlineRangeId): Promise<SocialReport> {
  const today = businessToday();
  const windows = rangeWindows(range, today);
  const period = rangeOf(range).label;
  const [status, res] = await Promise.all([soft("Instagram and Facebook connection", metaStatus), soft(SOCIAL[channel].label, () => loadSocial(channel, windows, today, period))]);
  const s = status.ok ? status.value : null;
  const sync = s?.state[channel];
  return {
    range,
    period,
    today,
    windows,
    channel,
    block: socialBlock(channel, res, status),
    connection: s && {
      connected: s.connected,
      name: channel === "instagram" ? (s.igUsername ? `@${s.igUsername}` : null) : s.pageName,
      connectedBy: s.connectedBy,
      lastSyncAt: sync?.at ?? null,
      error: s.needsReconnect ?? sync?.error ?? s.state.posts.error,
      skipped: sync?.skipped ?? [],
      manageHref: META_SETUP_HREF,
    },
  };
}
