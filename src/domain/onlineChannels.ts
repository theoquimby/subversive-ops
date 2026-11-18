import { addDays, daysBetween, type ISODate } from "./dates";
import type { ReconnectBy } from "./metaData";
import type { DayValue, LookItem, SourceState, Span, Windows } from "./online";

/**
 * Online channels: places the business is present that report a number a day
 * and a list of its own posts (Instagram and the Facebook Page today; a
 * review site could be the next). Stored in OnlineChannelDaily and OnlinePost
 * under short shared metric names, so a new channel needs no new tables.
 *
 * Pure (no database, no network): what each number counts in plain words,
 * followers and their change, a typical day, sorting posts, the best and
 * worst post of a period in a sentence, what a page says while a channel
 * isn't ready, and the channel's lines for "Worth a look".
 * docs/online-channels.md says how to add a channel.
 */

export const SOCIAL_CHANNELS = ["instagram", "facebook"] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

/** The one page that connects both (they share a Facebook sign-in). */
export const META_SETUP_HREF = "/online/meta";

export interface MetricCopy {
  title: string;
  /** What the number counts, in a line. */
  counts: string;
  /** Finishes a tooltip's sentence: "312 views". */
  unit: string;
}

interface ChannelInfo {
  label: string;
  href: string;
  /** Reads after "on": "on Instagram", "on the Facebook Page". */
  place: string;
  /** Who a post reaches. */
  audience: string;
  copy: { views: MetricCopy; reach: MetricCopy; taps: MetricCopy; interactions: MetricCopy; visits: MetricCopy; website: MetricCopy };
}

/** The shared metric names (OnlineChannelDaily.metric) and what each one counts on each channel. */
export const SOCIAL: Record<SocialChannel, ChannelInfo> = {
  instagram: {
    label: "Instagram",
    href: "/online/instagram",
    place: "Instagram",
    audience: "accounts",
    copy: {
      views: { title: "Views", counts: "Times your posts, reels and stories were shown", unit: "views" },
      reach: { title: "Accounts reached", counts: "Accounts that saw at least one post, reel or story that day", unit: "accounts" },
      taps: { title: "Taps on your profile's buttons", counts: "Taps on Call, Directions, Email and Text on the Instagram profile", unit: "taps" },
      interactions: { title: "Likes, comments, saves and shares", counts: "Every like, comment, save and share on your posts, reels and stories", unit: "in all" },
      visits: { title: "Profile visits from posts", counts: "Times someone opened the profile from one of the posts listed below", unit: "visits" },
      website: { title: "Went on to the website", counts: "Website visits that started on Instagram, counted by the website", unit: "visits" },
    },
  },
  facebook: {
    label: "Facebook Page",
    href: "/online/facebook",
    place: "the Facebook Page",
    audience: "people",
    copy: {
      views: { title: "Views", counts: "Times anything from the Page was shown: posts, videos and the Page itself", unit: "views" },
      reach: { title: "People reached", counts: "People who saw anything from the Page that day", unit: "people" },
      taps: { title: "Taps on the Page's buttons", counts: "Taps on the Page's contact details and its main button", unit: "taps" },
      interactions: { title: "Reactions, comments, shares and clicks", counts: "Every reaction, comment, share and click on the Page's posts", unit: "in all" },
      visits: { title: "Visits to the Page", counts: "Times someone opened the Page itself", unit: "visits" },
      website: { title: "Went on to the website", counts: "Website visits that started on Facebook, counted by the website", unit: "visits" },
    },
  },
};

/** The buttons on an Instagram profile, as stored and as shown. */
export const TAP_LABEL: Record<string, string> = { tap_directions: "Directions", tap_call: "Call", tap_email: "Email", tap_text: "Text", tap_book: "Book", tap_other: "Other" };

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sayDay = (d: ISODate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

// ---- Followers -----------------------------------------------------------------------------------

export interface FollowerSummary {
  /** The latest count on record. */
  now: number | null;
  asOf: ISODate | null;
  /** Followers gained (or lost) since `since`. Null with only one count on record. */
  change: number | null;
  /** The day the change is counted from. */
  since: ISODate | null;
  /** The record starts inside the period, so the change covers only part of it. */
  partial: boolean;
  trend: { x: ISODate; y: number }[];
}

/**
 * Followers are a count on a day, not something to add up: the change is the
 * latest count against the last one before the period began, or against the
 * first one on record when the record starts later than that.
 */
export function followerSummary(counts: DayValue[], w: Windows): FollowerSummary {
  const byDay = new Map<ISODate, number>();
  for (const c of counts) byDay.set(c.day, c.value);
  const days = [...byDay.keys()].sort();
  if (!days.length) return { now: null, asOf: null, change: null, since: null, partial: false, trend: [] };
  const asOf = days[days.length - 1];
  const now = byDay.get(asOf)!;
  const before = days.filter((d) => d < w.cur.from).pop() ?? null;
  const first = days[0];
  const base = before ?? (first !== asOf ? first : null);
  return {
    now,
    asOf,
    change: base ? now - byDay.get(base)! : null,
    since: base,
    partial: !before && base != null,
    trend: days.filter((d) => d >= w.cur.from).map((d) => ({ x: d, y: byDay.get(d)! })),
  };
}

/** The average over the days that have a number. For counts of people, which can't be added across days. */
export function dailyAverage(rows: DayValue[], span: Span): number | null {
  const inside = rows.filter((r) => r.day >= span.from && r.day <= span.to);
  return inside.length ? inside.reduce((s, r) => s + r.value, 0) / inside.length : null;
}

// ---- Posts ---------------------------------------------------------------------------------------

export interface PostRow {
  id: string;
  channel: SocialChannel;
  /** post | reel | video | carousel | link | text */
  kind: string;
  /** ISO instant. */
  postedAt: string;
  /** The business day it went up. */
  day: ISODate;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  interactions: number | null;
  profileVisits: number | null;
  follows: number | null;
  /** The channel has sent numbers for this post. */
  hasNumbers: boolean;
}

export const KIND_LABEL: Record<string, string> = { post: "Post", reel: "Reel", video: "Video", carousel: "Photos", link: "Link", text: "Text" };

export const POST_SORTS = ["reach", "views", "interactions", "newest"] as const;
export type PostSort = (typeof POST_SORTS)[number];

/** Biggest first; a post with no number yet goes last; ties go to the newer post. */
export function sortPosts<T extends Pick<PostRow, "postedAt" | "reach" | "views" | "interactions">>(posts: T[], by: PostSort): T[] {
  const newer = (a: T, b: T) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0);
  if (by === "newest") return [...posts].sort(newer);
  return [...posts].sort((a, b) => {
    const x = a[by];
    const y = b[by];
    if (x == null || y == null) return x == null && y == null ? newer(a, b) : x == null ? 1 : -1;
    return y - x || newer(a, b);
  });
}

/**
 * The posts a page lists: those that went up in the period, newest first. A
 * period with fewer than `min` shows the latest `fallback` instead, so a
 * 7-day view isn't an empty table.
 */
export function postsForPage(posts: PostRow[], span: Span, min = 3, fallback = 12): { list: PostRow[]; inPeriod: boolean } {
  const newest = sortPosts(posts, "newest");
  const inside = newest.filter((p) => p.day >= span.from && p.day <= span.to);
  if (inside.length >= min || newest.length === inside.length) return { list: inside, inPeriod: true };
  return { list: newest.slice(0, fallback), inPeriod: false };
}

const NAME_MAX = 46;
const kindWord = (kind: string) => (kind === "reel" ? "reel" : kind === "video" ? "video" : "post");

/** A post in a sentence: its opening words in quotes, or "the reel from Nov 3" when it has no caption. */
export function postName(p: Pick<PostRow, "caption" | "kind" | "day">): string {
  const t = (p.caption ?? "").trim();
  if (!t) return `the ${kindWord(p.kind)} from ${sayDay(p.day)}`;
  if (t.length <= NAME_MAX) return `“${t}”`;
  const cut = t.slice(0, NAME_MAX);
  const at = cut.lastIndexOf(" ");
  return `“${(at > NAME_MAX * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…”`;
}

const named = (p: PostRow) => (p.caption?.trim() ? `${postName(p)} (${sayDay(p.day)})` : postName(p));

export interface BestWorst {
  best: PostRow;
  /** Null when no other post is old enough to judge. */
  worst: PostRow | null;
  /** What a typical post reached (the middle one). */
  typical: number;
  /** Posts with numbers that went into the comparison. */
  counted: number;
}

/** A post this young is still collecting its numbers, so it can't be the quietest. */
export const POST_SETTLE_DAYS = 2;
export const MIN_POSTS_TO_COMPARE = 3;

/**
 * The post that reached the most and the one that reached the least, among
 * the posts given (a period's). Posts with no numbers yet are left out; with
 * fewer than three left there is nothing fair to say.
 */
export function bestAndWorst(posts: PostRow[], today: ISODate): BestWorst | null {
  const counted = posts.filter((p) => p.reach != null);
  if (counted.length < MIN_POSTS_TO_COMPARE) return null;
  const byReach = sortPosts(counted, "reach");
  const best = byReach[0];
  const settledBy = addDays(today, -POST_SETTLE_DAYS);
  const worst = [...byReach].reverse().find((p) => p.id !== best.id && p.day <= settledBy) ?? null;
  const sorted = counted.map((p) => p.reach!).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const typical = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { best, worst, typical, counted: counted.length };
}

/** "about 3 times", "about 1.5 times"; null when the lead is too small to mention. */
function timesTypical(bw: BestWorst): string | null {
  const ratio = bw.typical > 0 ? bw.best.reach! / bw.typical : 0;
  if (ratio < 1.5) return null;
  return `about ${ratio >= 3 ? Math.round(ratio) : Math.round(ratio * 2) / 2} times`;
}

/** The best and worst post of the period, in a sentence or two. */
export function postCallout(bw: BestWorst | null, period: string, channel: SocialChannel): string | null {
  if (!bw) return null;
  const times = timesTypical(bw);
  const first = `Of ${bw.counted} posts in the last ${period}, ${named(bw.best)} reached the most ${SOCIAL[channel].audience}: ${n0(bw.best.reach!)}${times ? `, ${times} a typical post` : ""}.`;
  return bw.worst ? `${first} The quietest was ${named(bw.worst)}, at ${n0(bw.worst.reach!)}.` : first;
}

// ---- What a page says while a channel isn't ready ---------------------------------------------------

/** What the app knows about the Meta connection (from metaStatus()). */
export interface MetaFacts {
  /** The App ID and App secret are saved. */
  appReady: boolean;
  connected: boolean;
  needsReconnect: boolean;
  /** A Facebook Page has been picked. */
  pagePicked: boolean;
  /** That Page has an Instagram professional account linked to it. */
  instagramLinked: boolean;
  /** A sync of the channel's daily numbers has finished without an error. */
  synced: Record<SocialChannel, boolean>;
}

const READY: SourceState = { kind: "ready", title: "", body: "", href: null, action: null };

const WILL_SHOW: Record<SocialChannel, string> = {
  instagram: "how many accounts your posts and reels reach, how followers change, and what people tap on the profile",
  facebook: "how often the Page and its posts are seen, how followers change, and what people tap on the Page",
};

/**
 * Instagram answers only to the owner's own Facebook sign-in, which runs out
 * after about 60 days: from ten days before, say so where the app raises
 * connections that need attention.
 */
export function metaReconnectSoonState(r: ReconnectBy | null): SourceState {
  if (!r?.soon) return READY;
  if (r.daysLeft < 0)
    return { kind: "reconnect", title: `Instagram stopped on ${sayDay(r.on)}: connect again`, body: "Instagram only answers to the owner's own Facebook sign-in, and that ran out. The Facebook Page carries on. Connect again and Instagram picks up where it left off.", href: META_SETUP_HREF, action: "Connect again" };
  return { kind: "reconnect", title: `Connect Instagram again by ${sayDay(r.on)}`, body: "Instagram only answers to the owner's own Facebook sign-in, which runs out then. Connecting again takes a minute and nothing is lost.", href: META_SETUP_HREF, action: "Connect again" };
}

/**
 * Instagram or the Facebook Page. One Facebook sign-in connects both, so the
 * "connect" and "connect again" states use the same title for each and
 * "Worth a look" only says them once.
 */
export function socialState(channel: SocialChannel, f: MetaFacts, hasData: boolean): SourceState {
  if (hasData) return READY;
  if (f.needsReconnect)
    return { kind: "reconnect", title: "Instagram and Facebook need connecting again", body: "The Facebook sign-in expired or was removed, so new numbers have stopped coming in. Connect again and they pick up where they left off.", href: META_SETUP_HREF, action: "Connect again" };
  if (!f.connected)
    return { kind: "connect", title: "Instagram and Facebook aren't connected yet", body: `One sign-in with Facebook connects both. This then shows ${WILL_SHOW[channel]}. It only reads; nothing is ever posted.`, href: META_SETUP_HREF, action: "Connect" };
  if (!f.pagePicked)
    return { kind: "pick", title: "Pick the Facebook Page", body: "Facebook is connected, but the app doesn't know which Page is the business. Pick it and the numbers arrive after the next sync.", href: META_SETUP_HREF, action: "Pick the Page" };
  if (channel === "instagram" && !f.instagramLinked)
    return {
      kind: "setup",
      title: "No Instagram account is linked to the Facebook Page",
      body: "Instagram only shares numbers for a professional account (business or creator; switching is free) that is linked to the Facebook Page. The guide has both steps.",
      href: `${META_SETUP_HREF}#instagram`,
      action: "See how to link it",
    };
  if (!f.synced[channel])
    return { kind: "syncing", title: "Connected. The first numbers are on their way", body: `${channel === "instagram" ? "Instagram's" : "The Page's"} numbers arrive with the first sync, which starts as soon as you connect and can take a few minutes. Older days fill in over the next few nights.`, href: META_SETUP_HREF, action: "See the status" };
  return {
    kind: "empty",
    title: `Connected. No numbers from ${channel === "instagram" ? "Instagram" : "Facebook"} yet`,
    body:
      channel === "instagram"
        ? "Instagram hasn't sent anything so far. It only reports for a professional account, and only days with some activity. Once it does, the numbers show here."
        : "Facebook hasn't sent anything so far. It only gives numbers for Pages with 100 or more likes. Once it does, they show here.",
    href: META_SETUP_HREF,
    action: "See the status",
  };
}

// ---- Worth a look ----------------------------------------------------------------------------------

/** No post for this long is worth a mention. */
export const QUIET_DAYS = 21;
/** A post has to reach this many times a typical one, and at least this many, to be called out. */
export const STANDOUT_TIMES = 3;
export const STANDOUT_MIN_REACH = 200;
/** Followers lost over the period before it is worth a warning: at least 10, and 2% of where it started. */
export const FOLLOWER_DROP_MIN = 10;
export const FOLLOWER_DROP_SHARE = 0.02;

/**
 * A channel's own lines for "Worth a look": a long gap since the last post, a
 * post that travelled much further than usual, and followers falling by more
 * than a wobble. Sharp changes in its daily numbers go through the same rule
 * as every other source (worthALook's metrics).
 */
export function socialLook(a: { channel: SocialChannel; period: string; today: ISODate; lastPostDay: ISODate | null; best: BestWorst | null; followers: FollowerSummary | null }): LookItem[] {
  const c = SOCIAL[a.channel];
  const out: LookItem[] = [];
  const f = a.followers;
  if (f && f.now != null && f.change != null && !f.partial) {
    const start = f.now - f.change;
    if (f.change <= -Math.max(FOLLOWER_DROP_MIN, start * FOLLOWER_DROP_SHARE))
      out.push({ key: `followers-${a.channel}`, tone: "warn", title: `${a.channel === "instagram" ? "Instagram" : "The Facebook Page"} lost ${n0(-f.change)} followers`, detail: `${n0(f.now)} now, ${n0(start)} at the start of the last ${a.period}.`, href: c.href });
  }
  if (a.lastPostDay) {
    const gap = daysBetween(a.lastPostDay, a.today);
    if (gap >= QUIET_DAYS) out.push({ key: `quiet-${a.channel}`, tone: "neutral", title: `Nothing posted on ${c.place} for ${gap} days`, detail: `The last post went up on ${sayDay(a.lastPostDay)}.`, href: `${c.href}#posts` });
  }
  const bw = a.best;
  if (bw && bw.typical > 0 && bw.best.reach! >= STANDOUT_MIN_REACH && bw.best.reach! / bw.typical >= STANDOUT_TIMES) {
    const kind = kindWord(bw.best.kind);
    out.push({
      key: `standout-${a.channel}`,
      tone: "good",
      title: `${a.channel === "instagram" ? "An Instagram" : "A Facebook"} ${kind} reached ${timesTypical(bw)} your usual`,
      detail: `${named(bw.best)} reached ${n0(bw.best.reach!)} ${c.audience}. A typical post reaches ${n0(bw.typical)}.`,
      href: `${c.href}#posts`,
    });
  }
  return out;
}
