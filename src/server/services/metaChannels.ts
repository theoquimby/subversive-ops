import "server-only";
import type { Prisma } from "@prisma/client";
import { addDays, businessDate, dateRange, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import {
  BACKFILL_EMPTY_STREAK,
  backfillWindow,
  chunkDays,
  countInteractions,
  IG_DAY_METRICS,
  IG_FOLLOWS_BREAKDOWN,
  IG_FOLLOWS_METRIC,
  IG_TAPS_BREAKDOWN,
  IG_TAPS_METRIC,
  igMediaMetrics,
  igStoredNames,
  isFatalKind,
  mergePostNumbers,
  META_MAX_HISTORY_DAYS,
  META_REREAD_DAYS,
  metaTokenFrom,
  missingScopes,
  missingScopesMessage,
  needsReconnectKind,
  NO_PAGES_MESSAGE,
  NOT_LINKED_MESSAGE,
  PAGE_CHUNK_DAYS,
  PAGE_DAY_METRICS,
  PAGE_POST_METRICS,
  pickPage,
  recentWindow,
  runSteps,
  tokenPlan,
  type ChannelPost,
  type MetaScope,
  type MetricValue,
  type PostNumbers,
  type StepOutcome,
} from "@/domain/metaData";
import type { MetaFacts, PostRow, SocialChannel } from "@/domain/onlineChannels";
import { decryptJSON, deriveKey, encryptJSON } from "@/domain/squareSecurity";
import { db } from "../db";
import { env } from "../env";
import { exchangeCode, exchangeLongLived, grantedScopes, igAccount, igDayTotals, igMedia, igMediaInsights, kindOfError, listPages, MetaError, pageDayInsights, pagePostInsights, pagePosts, revokeApp, type MetaApp } from "../integrations/meta";
import { businessToday } from "./sales";
import { getSecrets } from "./secrets";

/**
 * Instagram and the Facebook Page, through one Facebook sign-in by the owner
 * (read-only permissions). Tokens are encrypted in Setting `meta.connection`
 * the same way Google's, Square's and QuickBooks' are; a nightly sync writes
 * OnlineChannelDaily and OnlinePost; and every state short of "connected and
 * reporting" is one the pages can explain.
 *
 * Privacy: only aggregate numbers and the business's own posts are stored. No
 * follower lists, no names of people who liked or commented, no messages.
 */

const CONNECTION_KEY = "meta.connection";
const STATE_KEY = "meta.syncState";
export const META_REDIRECT_PATH = "/api/meta/oauth/callback";

const cryptoKey = () => deriveKey(env.SESSION_SECRET, "meta.connection");
/** Signs the `state` a sign-in carries to Facebook and back. */
export const metaStateKey = () => deriveKey(env.SESSION_SECRET, "meta.oauth.state");

interface Stored {
  v: 1;
  /** The owner's long-lived sign-in (about 60 days): only used to look for Pages. */
  userToken: string;
  userExpiresAt: string | null;
  scopes: string[];
  connectedAt: string;
  connectedBy: string | null;
  pageId: string | null;
  pageName: string | null;
  /** The Page's own token: no end date, and what the nightly sync uses. */
  pageToken: string | null;
  igId: string | null;
  igUsername: string | null;
  /** Which token Instagram last answered to. */
  igWith: "page" | "user";
  needsReconnect?: string | null;
}

export interface ChannelSync {
  /** The newest day read. */
  lastDay: ISODate | null;
  /** The oldest day read so far; older days fill in a slice a night. */
  earliestDay: ISODate | null;
  backfillDone: boolean;
  at: string | null;
  error: string | null;
  /** Numbers Meta refused on the last run (it has removed them, or renamed them). */
  skipped: string[];
}

export interface MetaSyncState {
  instagram: ChannelSync;
  facebook: ChannelSync;
  posts: { at: string | null; error: string | null };
}

const emptyChannel = (): ChannelSync => ({ lastDay: null, earliestDay: null, backfillDone: false, at: null, error: null, skipped: [] });
const emptyState = (): MetaSyncState => ({ instagram: emptyChannel(), facebook: emptyChannel(), posts: { at: null, error: null } });

export class MetaNotConnectedError extends Error {
  constructor(message = "Instagram and Facebook aren't connected yet. Connect them on Online → Instagram.") {
    super(message);
  }
}

export async function metaApp(): Promise<MetaApp | null> {
  const s = await getSecrets(["META_APP_ID", "META_APP_SECRET"] as const);
  return s.META_APP_ID && s.META_APP_SECRET ? { appId: s.META_APP_ID, appSecret: s.META_APP_SECRET } : null;
}

async function readStored(): Promise<Stored | null> {
  const s = await db.setting.findUnique({ where: { key: CONNECTION_KEY } });
  if (!s) return null;
  try {
    const v = decryptJSON<Stored>(cryptoKey(), s.value);
    return v?.v === 1 ? v : null;
  } catch {
    return null;
  }
}

async function writeStored(s: Stored) {
  const value = encryptJSON(cryptoKey(), s);
  await db.setting.upsert({ where: { key: CONNECTION_KEY }, create: { key: CONNECTION_KEY, value }, update: { value } });
}

/** Change a few fields of the stored connection, re-reading it first so a slow sync doesn't undo a newer choice. */
async function patchStored(patch: Partial<Stored>) {
  const cur = await readStored();
  if (cur) await writeStored({ ...cur, ...patch });
}

export async function metaSyncState(): Promise<MetaSyncState> {
  const s = await db.setting.findUnique({ where: { key: STATE_KEY } });
  try {
    if (!s) return emptyState();
    const j = JSON.parse(s.value) as Partial<MetaSyncState>;
    const e = emptyState();
    return { instagram: { ...e.instagram, ...j.instagram }, facebook: { ...e.facebook, ...j.facebook }, posts: { ...e.posts, ...j.posts } };
  } catch {
    return emptyState();
  }
}

async function saveState(st: MetaSyncState) {
  const value = JSON.stringify(st);
  await db.setting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value }, update: { value } });
}

// ---- Status ----------------------------------------------------------------------------------------

export interface MetaStatus {
  appReady: boolean;
  connected: boolean;
  needsReconnect: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
  pageId: string | null;
  pageName: string | null;
  igId: string | null;
  igUsername: string | null;
  /** Permissions that weren't ticked at sign-in. */
  missing: MetaScope[];
  /** The day the owner's sign-in runs out. The nightly sync carries on after it; looking for Pages again doesn't. */
  userExpiresOn: ISODate | null;
  state: MetaSyncState;
  hasData: Record<SocialChannel, boolean>;
}

export async function metaStatus(): Promise<MetaStatus> {
  const [app, s, state, ig, fb] = await Promise.all([metaApp(), readStored(), metaSyncState(), db.onlineChannelDaily.count({ where: { channel: "instagram" }, take: 1 }), db.onlineChannelDaily.count({ where: { channel: "facebook" }, take: 1 })]);
  return {
    appReady: !!app,
    connected: !!s && !s.needsReconnect,
    needsReconnect: s?.needsReconnect ?? null,
    connectedAt: s?.connectedAt ?? null,
    connectedBy: s?.connectedBy ?? null,
    pageId: s?.pageId ?? null,
    pageName: s?.pageName ?? null,
    igId: s?.igId ?? null,
    igUsername: s?.igUsername ?? null,
    missing: s ? missingScopes(s.scopes) : [],
    userExpiresOn: s ? tokenPlan({ pageToken: s.pageToken, userToken: s.userToken, userExpiresAt: s.userExpiresAt }, new Date()).userExpiresOn : null,
    state,
    hasData: { instagram: ig > 0, facebook: fb > 0 },
  };
}

/** What the pages need to know to say why a channel has no numbers. */
export const metaFacts = (s: MetaStatus): MetaFacts => ({
  appReady: s.appReady,
  connected: s.connected,
  needsReconnect: !!s.needsReconnect,
  pagePicked: !!s.pageId,
  instagramLinked: !!s.igId,
  synced: { instagram: !!s.state.instagram.lastDay && !s.state.instagram.error, facebook: !!s.state.facebook.lastDay && !s.state.facebook.error },
});

// ---- Connect -----------------------------------------------------------------------------------------

export interface PageChoice {
  id: string;
  name: string;
  instagram: string | null;
  canAnalyze: boolean;
}

export interface Discovery {
  pages: PageChoice[];
  pageId: string | null;
  notes: string[];
}

/** Finish "Connect": swap the code for a long-lived sign-in, note what was allowed, then find the Page and its Instagram account. */
export async function connectMeta(args: { code: string; redirectUri: string; by: string }): Promise<Discovery | { error: string }> {
  const app = await metaApp();
  if (!app) throw new MetaNotConnectedError("Paste the App ID and App secret first, then connect.");
  const now = new Date();
  const short = metaTokenFrom(await exchangeCode(app, args.code, args.redirectUri), now);
  const long = metaTokenFrom(await exchangeLongLived(app, short.token), now);
  const scopes = await grantedScopes(long.token).catch(() => [] as string[]);
  const old = await readStored();
  await writeStored({
    v: 1,
    userToken: long.token,
    userExpiresAt: long.expiresAt,
    scopes,
    connectedAt: now.toISOString(),
    connectedBy: args.by,
    pageId: old?.pageId ?? null,
    pageName: old?.pageName ?? null,
    pageToken: null,
    igId: old?.igId ?? null,
    igUsername: old?.igUsername ?? null,
    igWith: "page",
    needsReconnect: null,
  });
  return discoverMeta().catch((e) => ({ error: (e as Error).message }));
}

/** The owner's sign-in, while it still works: looking for Pages is the one thing that needs it. */
function liveUserToken(s: Stored): string {
  const plan = tokenPlan({ pageToken: null, userToken: s.userToken, userExpiresAt: s.userExpiresAt }, new Date());
  if (plan.use !== "user") throw new MetaNotConnectedError(plan.reconnect ?? "Press Connect again.");
  return s.userToken;
}

/** Find the Pages this sign-in manages, pick the business's (or keep the one picked), and note anything in the way. */
export async function discoverMeta(choose?: string): Promise<Discovery> {
  const s = await readStored();
  if (!s) throw new MetaNotConnectedError();
  const pages = await listPages(liveUserToken(s));
  const pick = (choose ? pages.find((p) => p.id === choose) : null) ?? pickPage(pages, s.pageId);
  const notes: string[] = [];
  const missing = missingScopesMessage(missingScopes(s.scopes));
  if (missing) notes.push(missing);
  if (!pages.length) notes.push(NO_PAGES_MESSAGE);
  else if (!pick) notes.push("Pick which Page is the business.");
  else {
    if (!pick.instagram) notes.push(NOT_LINKED_MESSAGE);
    if (!pick.canAnalyze) notes.push("This sign-in isn't allowed to see the Page's numbers. Someone with full control of the Page should press Connect again.");
  }
  const changed = !!s.pageId && !!pick && pick.id !== s.pageId;
  await patchStored({ pageId: pick?.id ?? null, pageName: pick?.name ?? null, pageToken: pick?.token ?? null, igId: pick?.instagram?.id ?? null, igUsername: pick?.instagram?.username ?? null, igWith: "page" });
  // A different Page is a different business: its numbers must not mix with the last one's.
  if (changed) await clearChannelData();
  return { pages: pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram?.username ?? null, canAnalyze: p.canAnalyze })), pageId: pick?.id ?? null, notes };
}

async function clearChannelData() {
  await db.$transaction([db.onlineChannelDaily.deleteMany({ where: { channel: { in: ["instagram", "facebook"] } } }), db.onlinePost.deleteMany({ where: { channel: { in: ["instagram", "facebook"] } } }), db.setting.deleteMany({ where: { key: STATE_KEY } })]);
}

/** Disconnect: Facebook forgets the app's permission and the tokens are deleted. Numbers already brought in stay. */
export async function disconnectMeta() {
  const s = await readStored();
  if (s?.userToken) await revokeApp(s.userToken).catch(() => undefined);
  await db.setting.deleteMany({ where: { key: { in: [CONNECTION_KEY, STATE_KEY] } } });
}

// ---- Sync --------------------------------------------------------------------------------------------

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nowISO = () => new Date().toISOString();

/** Run `fn` over `items`, a few at a time, in order. Stops handing out work once `stop()` says so or one throws. */
async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>, stop: () => boolean = () => false): Promise<void> {
  let i = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (i < items.length && failed == null && !stop()) {
      const item = items[i++];
      try {
        await fn(item);
      } catch (e) {
        failed ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  if (failed != null) throw failed;
}

interface Ctx {
  s: Stored;
  st: MetaSyncState;
  today: ISODate;
  deadline: number;
  notes: string[];
  /** Small failures so far (one day, one post): logged and skipped, up to a limit. */
  soft: number;
}

const SOFT_LIMIT = 12;
const overTime = (c: Ctx) => Date.now() > c.deadline;

/** One day or one post failed in a way the next may not: log it, skip it, and give up only if it keeps happening. */
function skipOrThrow(c: Ctx, e: unknown, what: string) {
  const kind = kindOfError(e);
  // Every later call would fail the same way: end this part (and, for a dead sign-in or a throttle, the run).
  if (isFatalKind(kind) || kind === "permission" || kind === "not-professional") throw e;
  if (++c.soft > SOFT_LIMIT) throw e;
  console.warn(`meta sync: skipped ${what}: ${e instanceof MetaError ? `${e.kind} (${e.info.code ?? e.info.status})` : msg(e)}`);
}

/** Replace exactly the stored names a request covers, for one channel over a span of days. */
async function replaceRows(channel: SocialChannel, from: ISODate, to: ISODate, names: string[], rows: { day: ISODate; metric: string; value: number }[]) {
  if (!names.length) return;
  await db.$transaction([
    db.onlineChannelDaily.deleteMany({ where: { channel, day: { gte: parseISODate(from), lte: parseISODate(to) }, metric: { in: names } } }),
    db.onlineChannelDaily.createMany({ data: rows.map((r) => ({ channel, day: parseISODate(r.day), metric: r.metric, value: r.value })), skipDuplicates: true }),
  ]);
}

/**
 * Instagram calls: the Page's token first (it has no end date); if Instagram
 * refuses it, the owner's own sign-in, remembered for next time.
 */
async function withIg<T>(c: Ctx, fn: (token: string) => Promise<T>): Promise<T> {
  const plan = tokenPlan({ pageToken: null, userToken: c.s.userToken, userExpiresAt: c.s.userExpiresAt }, new Date());
  const user = plan.use === "user" ? c.s.userToken : null;
  const order = (c.s.igWith === "user" ? [user, c.s.pageToken] : [c.s.pageToken, user]).filter((t): t is string => !!t);
  if (!order.length) throw new MetaNotConnectedError(plan.reconnect ?? "Press Connect again.");
  try {
    return await fn(order[0]);
  } catch (e) {
    const kind = kindOfError(e);
    if (order.length < 2 || !(kind === "auth" || kind === "permission" || kind === "role")) throw e;
    const r = await fn(order[1]);
    c.s.igWith = c.s.igWith === "user" ? "page" : "user";
    await patchStored({ igWith: c.s.igWith });
    return r;
  }
}

/**
 * Ask for several metrics together; if Meta says one of them isn't a metric
 * any more, ask one at a time and leave out the ones it refuses. `skipped`
 * remembers them for the rest of the run.
 */
async function askTolerant<R>(asked: string[], skipped: Set<string>, ask: (metrics: string[]) => Promise<R>, merge: (a: R, b: R) => R): Promise<{ result: R; answered: string[] } | null> {
  const metrics = asked.filter((m) => !skipped.has(m));
  if (!metrics.length) return null;
  try {
    return { result: await ask(metrics), answered: metrics };
  } catch (e) {
    if (kindOfError(e) !== "invalid-metric") throw e;
    if (metrics.length === 1) {
      skipped.add(metrics[0]);
      return null;
    }
    let result: R | null = null;
    const answered: string[] = [];
    for (const m of metrics) {
      try {
        const r = await ask([m]);
        result = result == null ? r : merge(result, r);
        answered.push(m);
      } catch (e2) {
        if (kindOfError(e2) !== "invalid-metric") throw e2;
        skipped.add(m);
      }
    }
    return result == null ? null : { result, answered };
  }
}

// -- Instagram, a day at a time

const IG_GROUPS: { metrics: string[]; breakdown?: string }[] = [{ metrics: [...IG_DAY_METRICS] }, { metrics: [IG_TAPS_METRIC], breakdown: IG_TAPS_BREAKDOWN }, { metrics: [IG_FOLLOWS_METRIC], breakdown: IG_FOLLOWS_BREAKDOWN }];

async function readInstagramDay(c: Ctx, day: ISODate, skipped: Set<string>): Promise<number> {
  let count = 0;
  for (const g of IG_GROUPS) {
    try {
      const got = await askTolerant<{ rows: MetricValue[] }>(g.metrics, skipped, (m) => withIg(c, (t) => igDayTotals(t, c.s.igId!, day, env.BUSINESS_TIMEZONE, m, g.breakdown)), (a, b) => ({ rows: [...a.rows, ...b.rows] }));
      if (!got) continue;
      await replaceRows("instagram", day, day, igStoredNames(got.answered), got.result.rows.map((r) => ({ ...r, day })));
      count += got.result.rows.length;
    } catch (e) {
      if (kindOfError(e) === "range") throw e;
      skipOrThrow(c, e, `instagram ${day}`);
    }
  }
  return count;
}

async function syncInstagramDaily(c: Ctx) {
  const st = c.st.instagram;
  const skipped = new Set<string>();
  const first = !st.lastDay;
  const win = recentWindow(c.today, st.lastDay);
  const days = dateRange(win.from, addDays(win.to, 1));
  const done = new Set<ISODate>();
  // The first time, newest first (the days people look at); after that oldest first, so a cut-short run leaves no gap.
  const order = first ? [...days].reverse() : days;
  try {
    await pool(order, 3, async (day) => {
      await readInstagramDay(c, day, skipped);
      done.add(day);
    }, () => overTime(c));
  } finally {
    let run = 0;
    while (run < order.length && done.has(order[run])) run++;
    if (run > 0) {
      if (first) {
        st.lastDay = win.to;
        st.earliestDay = order[run - 1];
      } else {
        st.lastDay = order[run - 1] > (st.lastDay ?? "") ? order[run - 1] : st.lastDay;
        st.earliestDay ??= win.from;
      }
    }
    st.skipped = [...skipped];
  }
  await backfillInstagram(c, skipped);
  st.skipped = [...skipped];
  if (skipped.size) c.notes.push(`Instagram no longer gives: ${[...skipped].join(", ")}. Everything else was brought in.`);
}

/** Older days, a slice a night, until two years back or the history runs out. */
async function backfillInstagram(c: Ctx, skipped: Set<string>) {
  const st = c.st.instagram;
  if (st.backfillDone || !st.earliestDay) return;
  // Leave room for the posts and the Page.
  if (c.deadline - Date.now() < 20_000) return;
  const win = backfillWindow(c.today, st.earliestDay);
  if (!win) {
    st.backfillDone = true;
    return;
  }
  const order = dateRange(win.from, addDays(win.to, 1)).reverse();
  const rowsBy = new Map<ISODate, number>();
  try {
    await pool(order, 3, async (day) => void rowsBy.set(day, await readInstagramDay(c, day, skipped)), () => c.deadline - Date.now() < 15_000);
  } catch (e) {
    // Older than Instagram keeps: that's the end of the history, not a fault.
    if (kindOfError(e) !== "range") throw e;
    st.backfillDone = true;
  } finally {
    let run = 0;
    let empty = 0;
    while (run < order.length && rowsBy.has(order[run])) {
      empty = rowsBy.get(order[run]) === 0 ? empty + 1 : 0;
      run++;
    }
    if (run > 0) st.earliestDay = order[run - 1];
    if (empty >= BACKFILL_EMPTY_STREAK || (run === order.length && win.from <= addDays(c.today, -META_MAX_HISTORY_DAYS))) st.backfillDone = true;
  }
}

/** Today's follower count, kept as one number a day so the change over a period can be shown. */
async function snapshotInstagramFollowers(c: Ctx) {
  const a = await withIg(c, (t) => igAccount(t, c.s.igId!));
  if (a?.followers == null) return;
  await replaceRows("instagram", c.today, c.today, ["followers"], [{ day: c.today, metric: "followers", value: a.followers }]);
  if (a.username && a.username !== c.s.igUsername) {
    c.s.igUsername = a.username;
    await patchStored({ igUsername: a.username });
  }
}

// -- The Facebook Page, a range at a time

async function syncFacebookDaily(c: Ctx) {
  const st = c.st.facebook;
  const skipped = new Set<string>();
  // Page numbers come a range at a time, so the whole two years is a handful of calls.
  const win = recentWindow(c.today, st.lastDay, META_REREAD_DAYS, META_MAX_HISTORY_DAYS);
  const chunks = chunkDays(win.from, win.to, PAGE_CHUNK_DAYS).reverse();
  let oldest: ISODate | null = null;
  let complete = true;
  for (const ch of chunks) {
    if (overTime(c)) {
      complete = false;
      break;
    }
    try {
      const got = await askTolerant(Object.keys(PAGE_DAY_METRICS), skipped, (m) => pageDayInsights(c.s.pageToken!, c.s.pageId!, ch.from, ch.to, m), (a, b) => ({ rows: [...a.rows, ...b.rows], seen: [...a.seen, ...b.seen] }));
      if (got) await replaceRows("facebook", ch.from, ch.to, got.answered.map((m) => PAGE_DAY_METRICS[m]), got.result.rows);
      oldest = ch.from;
    } catch (e) {
      // Further back than Facebook keeps: stop going back, keep what was read.
      if (kindOfError(e) === "range" && oldest) break;
      throw e;
    }
  }
  st.skipped = [...skipped];
  // Only a run that read every piece moves the marker on; a cut-short one is read again in full next time.
  if (complete && oldest) {
    st.lastDay = win.to;
    st.earliestDay = st.earliestDay && st.earliestDay < oldest ? st.earliestDay : oldest;
    st.backfillDone = true;
  }
  if (skipped.size) c.notes.push(`Facebook no longer gives: ${[...skipped].join(", ")}. Everything else was brought in.`);
}

// -- Posts

const postData = (channel: SocialChannel, p: ChannelPost) => ({ channel, externalId: p.externalId, postedAt: new Date(p.postedAt), kind: p.kind, caption: p.caption, permalink: p.permalink, thumbnailUrl: p.thumbnailUrl });

async function savePost(channel: SocialChannel, p: ChannelPost, n: PostNumbers) {
  const m = mergePostNumbers(p, n);
  const interactions = m.interactions ?? (channel === "facebook" ? countInteractions(m.likes, m.comments, m.shares) : null);
  const numbers = { views: m.views, reach: m.reach, likes: m.likes, comments: m.comments, saves: m.saves, shares: m.shares, interactions, profileVisits: m.profileVisits, follows: m.follows, extra: (m.extra ?? undefined) as Prisma.InputJsonValue | undefined };
  const base = postData(channel, p);
  await db.onlinePost.upsert({
    where: { channel_externalId: { channel, externalId: p.externalId } },
    create: { ...base, ...numbers, metricsAt: m.hasInsights ? new Date() : null },
    // No insights this time: keep the numbers from before, and just refresh the counts that came with the post.
    update: m.hasInsights ? { ...base, ...numbers, metricsAt: new Date() } : { ...base, ...(m.likes != null ? { likes: m.likes } : {}), ...(m.comments != null ? { comments: m.comments } : {}), ...(m.shares != null ? { shares: m.shares } : {}) },
  });
}

const NO_INSIGHTS: PostNumbers = { views: null, reach: null, likes: null, comments: null, saves: null, shares: null, interactions: null, profileVisits: null, follows: null, extra: null, any: false };
const mergeNumbers = (a: PostNumbers, b: PostNumbers): PostNumbers => ({
  views: a.views ?? b.views,
  reach: a.reach ?? b.reach,
  likes: a.likes ?? b.likes,
  comments: a.comments ?? b.comments,
  saves: a.saves ?? b.saves,
  shares: a.shares ?? b.shares,
  interactions: a.interactions ?? b.interactions,
  profileVisits: a.profileVisits ?? b.profileVisits,
  follows: a.follows ?? b.follows,
  extra: a.extra || b.extra ? { ...a.extra, ...b.extra } : null,
  any: a.any || b.any,
});

async function syncPosts(c: Ctx, channel: SocialChannel, list: ChannelPost[], insights: (p: ChannelPost, metrics: string[]) => Promise<PostNumbers>, metricsFor: (p: ChannelPost) => string[]) {
  const skipped = new Set<string>();
  await pool(list, 4, async (p) => {
    let n = NO_INSIGHTS;
    try {
      const got = await askTolerant(metricsFor(p), skipped, (m) => insights(p, m), mergeNumbers);
      if (got) n = got.result;
    } catch (e) {
      const kind = kindOfError(e);
      // A post with no numbers yet, or one that has since been deleted, isn't a failure.
      if (kind !== "no-insights" && kind !== "gone") skipOrThrow(c, e, `${channel} post`);
    }
    await savePost(channel, p, n);
  }, () => overTime(c));
}

async function syncInstagramPosts(c: Ctx) {
  const list = await withIg(c, (t) => igMedia(t, c.s.igId!));
  await syncPosts(c, "instagram", list, (p, m) => withIg(c, (t) => igMediaInsights(t, p.externalId, m)), (p) => igMediaMetrics(p.kind));
}

async function syncFacebookPosts(c: Ctx) {
  let list: ChannelPost[];
  try {
    list = await pagePosts(c.s.pageToken!, c.s.pageId!);
  } catch (e) {
    // Not allowed the reaction and comment counts: the posts themselves still come.
    if (kindOfError(e) !== "permission") throw e;
    list = await pagePosts(c.s.pageToken!, c.s.pageId!, true);
  }
  await syncPosts(c, "facebook", list, (p, m) => pagePostInsights(c.s.pageToken!, p.externalId, m), () => PAGE_POST_METRICS);
}

export interface MetaSyncResult {
  ok: boolean;
  skipped?: string;
  errors: string[];
  notes: string[];
  steps: StepOutcome[];
}

/**
 * Nightly, on "Sync now" and right after connecting. Each part runs on its
 * own: one that fails is noted and the next still runs, unless the sign-in has
 * died or Meta asked us to slow down, in which case the run stops there and
 * what was already saved stays. `budgetMs` keeps it inside the time the caller has.
 */
export async function syncMeta(opts: { budgetMs?: number } = {}): Promise<MetaSyncResult> {
  let s = await readStored();
  if (!s) return { ok: false, skipped: "not connected", errors: [], notes: [], steps: [] };
  if (s.needsReconnect) return { ok: false, skipped: "needs reconnect", errors: [s.needsReconnect], notes: [], steps: [] };
  if (!s.pageId || !s.pageToken) return { ok: false, skipped: "no page picked", errors: ["Pick the Facebook Page first."], notes: [], steps: [] };

  // Renew the owner's sign-in while it still can be. Best effort: the sync itself runs on the Page's token.
  const plan = tokenPlan({ pageToken: s.pageToken, userToken: s.userToken, userExpiresAt: s.userExpiresAt }, new Date());
  if (plan.refreshUser) {
    try {
      const app = await metaApp();
      if (app) {
        const t = metaTokenFrom(await exchangeLongLived(app, s.userToken), new Date());
        await patchStored({ userToken: t.token, userExpiresAt: t.expiresAt });
        s = { ...s, userToken: t.token, userExpiresAt: t.expiresAt };
      }
    } catch (e) {
      console.warn(`meta sync: the sign-in wasn't renewed: ${msg(e)}`);
    }
  }

  const st = await metaSyncState();
  const c: Ctx = { s, st, today: businessToday(), deadline: Date.now() + (opts.budgetMs ?? 200_000), notes: [], soft: 0 };
  const ig = !!s.igId;
  const steps = [
    ...(ig ? [{ name: "Instagram numbers", run: () => syncInstagramDaily(c) }, { name: "Instagram followers", run: () => snapshotInstagramFollowers(c) }] : []),
    { name: "Facebook Page numbers", run: () => syncFacebookDaily(c) },
    ...(ig ? [{ name: "Instagram posts", run: () => syncInstagramPosts(c) }] : []),
    { name: "Facebook posts", run: () => syncFacebookPosts(c) },
  ];
  const run = await runSteps(steps, kindOfError, msg);

  const outcome = (name: string) => run.outcomes.find((o) => o.name === name);
  const errorOf = (name: string) => {
    const o = outcome(name);
    return o?.status === "failed" ? o.error : null;
  };
  const at = nowISO();
  const ran = (name: string) => outcome(name) && outcome(name)!.status !== "skipped";
  if (ran("Instagram numbers")) st.instagram = { ...st.instagram, at, error: errorOf("Instagram numbers") ?? errorOf("Instagram followers") };
  if (ran("Facebook Page numbers")) st.facebook = { ...st.facebook, at, error: errorOf("Facebook Page numbers") };
  if (ran("Instagram posts") || ran("Facebook posts")) st.posts = { at, error: errorOf("Instagram posts") ?? errorOf("Facebook posts") };
  await saveState(st);
  // The sign-in died mid-run: say so everywhere until the owner connects again.
  if (run.stopped && needsReconnectKind(run.stopped.kind)) await patchStored({ needsReconnect: run.stopped.message });

  const errors = run.outcomes.flatMap((o) => (o.status === "failed" ? [`${o.name}: ${o.error}`] : []));
  return { ok: errors.length === 0, errors, notes: c.notes, steps: run.outcomes };
}

// ---- Reading -----------------------------------------------------------------------------------------

export async function channelRows(channel: SocialChannel, from: ISODate, to: ISODate, metrics?: string[]): Promise<{ day: ISODate; metric: string; value: number }[]> {
  const rows = await db.onlineChannelDaily.findMany({ where: { channel, day: { gte: parseISODate(from), lte: parseISODate(to) }, ...(metrics ? { metric: { in: metrics } } : {}) } });
  return rows.map((r) => ({ day: toISODate(r.day), metric: r.metric, value: r.value.toNumber() }));
}

/** The first and last day a channel has any of these numbers above zero. */
export async function channelBounds(channel: SocialChannel, metrics: string[]): Promise<{ first: ISODate | null; last: ISODate | null }> {
  const where = { channel, metric: { in: metrics }, value: { gt: 0 } };
  const [first, last] = await Promise.all([db.onlineChannelDaily.findFirst({ where, orderBy: { day: "asc" }, select: { day: true } }), db.onlineChannelDaily.findFirst({ where, orderBy: { day: "desc" }, select: { day: true } })]);
  return { first: first ? toISODate(first.day) : null, last: last ? toISODate(last.day) : null };
}

export async function channelPosts(channel: SocialChannel, take = 80): Promise<PostRow[]> {
  const rows = await db.onlinePost.findMany({ where: { channel }, orderBy: { postedAt: "desc" }, take });
  return rows.map((r) => ({
    id: r.id,
    channel,
    kind: r.kind,
    postedAt: r.postedAt.toISOString(),
    day: businessDate(r.postedAt, env.BUSINESS_TIMEZONE),
    caption: r.caption,
    permalink: r.permalink,
    thumbnailUrl: r.thumbnailUrl,
    views: r.views,
    reach: r.reach,
    likes: r.likes,
    comments: r.comments,
    saves: r.saves,
    shares: r.shares,
    interactions: r.interactions,
    profileVisits: r.profileVisits,
    follows: r.follows,
    hasNumbers: r.metricsAt != null,
  }));
}
