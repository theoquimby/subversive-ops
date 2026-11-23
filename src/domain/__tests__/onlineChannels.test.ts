import { describe, expect, it } from "vitest";
import { countInteractions } from "../metaData";
import { nextSteps, rangeWindows, worthALook, type LookInput } from "../online";
import {
  bestAndWorst,
  dailyAverage,
  followerSummary,
  META_SETUP_HREF,
  postCallout,
  postHeadline,
  postName,
  postsForPage,
  SOCIAL,
  SOCIAL_CHANNELS,
  metaReconnectSoonState,
  socialLook,
  socialState,
  sortPosts,
  type MetaFacts,
  type PostRow,
} from "../onlineChannels";

const today = "2026-11-16";
const w = rangeWindows("28d", today); // Oct 19 – Nov 15, and Sep 21 – Oct 18 before it

let seq = 0;
const post = (day: string, reach: number | null, patch: Partial<PostRow> = {}): PostRow => ({
  id: `p${++seq}`,
  channel: "instagram",
  kind: "post",
  postedAt: `${day}T17:00:00.000Z`,
  day,
  caption: `Post from ${day}`,
  permalink: null,
  thumbnailUrl: null,
  views: reach == null ? null : reach * 2,
  reach,
  likes: null,
  comments: null,
  saves: null,
  shares: null,
  interactions: null,
  profileVisits: null,
  follows: null,
  hasNumbers: reach != null,
  ...patch,
});

describe("channels", () => {
  it("names Instagram and the Facebook Page, each with a page of its own", () => {
    expect(SOCIAL_CHANNELS).toEqual(["instagram", "facebook"]);
    expect(SOCIAL.instagram).toMatchObject({ label: "Instagram", href: "/online/instagram" });
    expect(SOCIAL.facebook).toMatchObject({ label: "Facebook Page", href: "/online/facebook" });
  });
  it("says what each number counts, without API words", () => {
    for (const c of SOCIAL_CHANNELS) for (const m of Object.values(SOCIAL[c].copy)) expect(`${m.title} ${m.counts}`).not.toMatch(/impressions|engagement|insights|\bCTA\b|total_value/i);
    expect(SOCIAL.instagram.copy.reach.counts).toMatch(/Accounts that saw at least one post/);
  });
});

describe("followers and their change", () => {
  const snaps = (pairs: [string, number][]) => pairs.map(([day, value]) => ({ day, value }));
  it("is the latest count, against the count just before the period began", () => {
    const f = followerSummary(snaps([["2026-10-10", 2000], ["2026-10-18", 2040], ["2026-11-01", 2100], ["2026-11-16", 2140]]), w);
    expect(f).toMatchObject({ now: 2140, asOf: "2026-11-16", change: 100, since: "2026-10-18", partial: false });
    expect(f.trend).toEqual([{ x: "2026-11-01", y: 2100 }, { x: "2026-11-16", y: 2140 }]);
  });
  it("counts from the first day on record when that is inside the period, and says so", () => {
    const f = followerSummary(snaps([["2026-11-10", 2120], ["2026-11-16", 2140]]), w);
    expect(f).toMatchObject({ now: 2140, change: 20, since: "2026-11-10", partial: true });
  });
  it("has a count but no change on the first day", () => {
    expect(followerSummary(snaps([["2026-11-16", 2140]]), w)).toMatchObject({ now: 2140, change: null, since: null });
  });
  it("is all empty for an empty account", () => {
    expect(followerSummary([], w)).toEqual({ now: null, asOf: null, change: null, since: null, partial: false, trend: [] });
  });
  it("copes with rows out of order and a falling count", () => {
    const f = followerSummary(snaps([["2026-11-16", 1900], ["2026-10-18", 2000]]), w);
    expect(f).toMatchObject({ now: 1900, change: -100 });
  });
});

describe("a typical day", () => {
  it("averages over the days that have a number, since daily reach can't be added up", () => {
    expect(dailyAverage([{ day: "2026-11-01", value: 100 }, { day: "2026-11-02", value: 300 }, { day: "2026-09-01", value: 9999 }], w.cur)).toBe(200);
    expect(dailyAverage([], w.cur)).toBeNull();
  });
});

describe("posts", () => {
  it("sorts by reach, most first, with posts that have no numbers yet last", () => {
    const list = [post("2026-11-01", 300), post("2026-11-10", null), post("2026-11-05", 900), post("2026-11-03", 300)];
    expect(sortPosts(list, "reach").map((p) => p.day)).toEqual(["2026-11-05", "2026-11-03", "2026-11-01", "2026-11-10"]);
    expect(sortPosts(list, "newest").map((p) => p.day)).toEqual(["2026-11-10", "2026-11-05", "2026-11-03", "2026-11-01"]);
    expect(sortPosts(list, "views")[0].day).toBe("2026-11-05");
    // Sorting never changes the list it was given.
    expect(list[0].day).toBe("2026-11-01");
  });
  it("lists the period's posts, or the latest few when the period has almost none", () => {
    const all = [post("2026-11-10", 500), post("2026-11-02", 400), post("2026-10-25", 300), post("2026-09-20", 200), post("2026-09-01", 100)];
    expect(postsForPage(all, w.cur)).toMatchObject({ inPeriod: true, list: [{ day: "2026-11-10" }, { day: "2026-11-02" }, { day: "2026-10-25" }] });
    const week = rangeWindows("7d", today).cur;
    const few = postsForPage(all, week);
    expect(few.inPeriod).toBe(false);
    expect(few.list).toHaveLength(5);
    expect(postsForPage([], w.cur)).toEqual({ list: [], inPeriod: true });
  });
  it("names a post by its opening words, or by its kind and day", () => {
    expect(postName(post("2026-11-03", 1, { caption: "Trivia night is back this Thursday. Teams of up to six, starts at 7." }))).toBe("“Trivia night is back this Thursday. Teams of…”");
    expect(postName(post("2026-11-03", 1, { caption: "New on tap" }))).toBe("“New on tap”");
    expect(postName(post("2026-11-03", 1, { caption: null, kind: "reel" }))).toBe("the reel from Nov 3");
  });
});

describe("the best and worst post of the period", () => {
  const list = [post("2026-10-21", 700), post("2026-10-28", 210, { caption: "Kitchen closes early Sunday" }), post("2026-11-03", 2100, { kind: "reel", caption: "Trivia night is back this Thursday" }), post("2026-11-08", 650), post("2026-11-12", 800)];
  it("picks the widest and the quietest, and what a typical post reaches", () => {
    const bw = bestAndWorst(list, today)!;
    expect(bw.best.day).toBe("2026-11-03");
    expect(bw.worst!.day).toBe("2026-10-28");
    expect(bw.typical).toBe(700);
    expect(bw.counted).toBe(5);
  });
  it("says it in a sentence", () => {
    const s = postCallout(bestAndWorst(list, today), "28 days", "instagram")!;
    expect(s).toBe("Of 5 posts in the last 28 days, “Trivia night is back this Thursday” (Nov 3) reached the most accounts: 2,100, about 3 times a typical post. The quietest was “Kitchen closes early Sunday” (Oct 28), at 210.");
    expect(postCallout(bestAndWorst(list, today), "28 days", "facebook")).toMatch(/reached the most people/);
  });
  it("makes the standout post the page's headline", () => {
    expect(postHeadline(bestAndWorst(list, today), "instagram")).toBe("“Trivia night is back this Thursday” reached about 3 times a typical post");
    const even = [post("2026-11-01", 100), post("2026-11-02", 110), post("2026-11-03", 120)];
    expect(postHeadline(bestAndWorst(even, today), "facebook")).toMatch(/reached the most people$/);
    expect(postHeadline(null, "instagram")).toBeNull();
  });
  it("doesn't call a post from the last two days the quietest: its numbers are still coming in", () => {
    const fresh = [...list, post("2026-11-15", 40)];
    const bw = bestAndWorst(fresh, today)!;
    expect(bw.worst!.day).toBe("2026-10-28");
    expect(bw.counted).toBe(6);
  });
  it("needs at least three posts with numbers", () => {
    expect(bestAndWorst(list.slice(0, 2), today)).toBeNull();
    expect(bestAndWorst([post("2026-11-01", null), post("2026-11-02", null), post("2026-11-03", null)], today)).toBeNull();
    expect(bestAndWorst([], today)).toBeNull();
    expect(postCallout(null, "28 days", "instagram")).toBeNull();
  });
  it("leaves a post with no insights yet out of the comparison", () => {
    const bw = bestAndWorst([...list, post("2026-11-09", null)], today)!;
    expect(bw.counted).toBe(5);
    expect(bw.worst!.reach).toBe(210);
  });
  it("leaves out the multiple when the best is close to typical", () => {
    const flat = [post("2026-10-21", 500), post("2026-10-28", 480), post("2026-11-03", 520)];
    expect(postCallout(bestAndWorst(flat, today), "28 days", "instagram")).not.toMatch(/times a typical/);
  });
});

describe("what a page says while Instagram or Facebook isn't ready", () => {
  const facts = (patch: Partial<MetaFacts> = {}): MetaFacts => ({ appReady: true, connected: true, needsReconnect: false, pagePicked: true, instagramLinked: true, synced: { instagram: true, facebook: true }, ...patch });
  it("is ready as soon as there are numbers, whatever the connection says", () => {
    expect(socialState("instagram", facts({ connected: false, needsReconnect: true }), true).kind).toBe("ready");
  });
  it("asks to connect, in the same words for both, so it is only raised once", () => {
    const ig = socialState("instagram", facts({ appReady: false, connected: false }), false);
    const fb = socialState("facebook", facts({ appReady: false, connected: false }), false);
    expect(ig).toMatchObject({ kind: "connect", href: META_SETUP_HREF, action: "Connect" });
    expect(ig.title).toBe("Instagram and Facebook aren't connected yet");
    expect(fb.title).toBe(ig.title);
  });
  it("asks to connect again when the sign-in has died", () => {
    expect(socialState("facebook", facts({ needsReconnect: true }), false)).toMatchObject({ kind: "reconnect", action: "Connect again" });
  });
  it("asks for the Page to be picked, and says when no Instagram account is linked to it", () => {
    expect(socialState("facebook", facts({ pagePicked: false }), false)).toMatchObject({ kind: "pick", action: "Pick the Page" });
    const none = socialState("instagram", facts({ instagramLinked: false }), false);
    expect(none.kind).toBe("setup");
    expect(none.title).toBe("No Instagram account is linked to the Facebook Page");
    expect(none.body).toMatch(/professional/);
    // The Page itself doesn't need Instagram.
    expect(socialState("facebook", facts({ instagramLinked: false, synced: { instagram: false, facebook: false } }), false).kind).toBe("syncing");
  });
  it("says the first numbers are on their way, then that there are none yet", () => {
    expect(socialState("instagram", facts({ synced: { instagram: false, facebook: true } }), false)).toMatchObject({ kind: "syncing", title: "Connected. The first numbers are on their way" });
    const empty = socialState("facebook", facts(), false);
    expect(empty.kind).toBe("empty");
    expect(empty.body).toMatch(/100 or more/);
    expect(socialState("instagram", facts(), false).body).toMatch(/professional/);
  });
});

describe("what they did next, with Instagram and the Facebook Page", () => {
  const listing = { cur: { BUSINESS_DIRECTION_REQUESTS: 300, CALL_CLICKS: 60, WEBSITE_CLICKS: 150 }, prev: { BUSINESS_DIRECTION_REQUESTS: 200, CALL_CLICKS: 60, WEBSITE_CLICKS: 100 } };
  const instagram = { cur: { tap_directions: 40, tap_call: 12, tap_email: 2, tap_text: 1, website_visits: 55 }, prev: { tap_directions: 30, tap_call: 12, tap_email: 0, tap_text: 0, website_visits: 40 } };
  const facebook = { cur: { profile_visits: 210, profile_taps: 18, website_visits: 20 }, prev: null };
  it("lines Instagram's buttons up with the same step on the listing", () => {
    const steps = nextSteps({ listing, website: null, instagram, facebook });
    const dir = steps.find((s) => s.key === "directions")!;
    expect(dir.listing).toMatchObject({ cur: 300 });
    expect(dir.instagram).toMatchObject({ cur: 40, prev: 30 });
    expect(dir.facebook).toBeNull();
    expect(steps.find((s) => s.key === "call")!.instagram).toMatchObject({ cur: 12 });
    const site = steps.find((s) => s.key === "site")!;
    expect(site).toMatchObject({ listing: { cur: 150 }, instagram: { cur: 55 }, facebook: { cur: 20, prev: null } });
  });
  it("adds the steps only social has, when there is something to show", () => {
    const keys = nextSteps({ listing, website: null, instagram, facebook }).map((s) => s.key);
    expect(keys).toEqual(["directions", "call", "site", "menu", "page", "button", "message"]);
    expect(nextSteps({ listing, website: null, instagram: { cur: {}, prev: null }, facebook: null }).map((s) => s.key)).toEqual(["directions", "call", "site", "menu"]);
  });
  it("still works with neither", () => {
    expect(nextSteps({ listing, website: null }).every((s) => s.instagram === null && s.facebook === null)).toBe(true);
    expect(nextSteps({ listing: null, website: null, instagram: null, facebook: null })).toEqual([]);
  });
});

describe("worth a look, for social", () => {
  const base = (patch: Partial<LookInput> = {}): LookInput => ({ period: "28 days", metrics: [], states: [], stale: [], rating: { cur: null, prev: null }, needReply: 0, ...patch });
  const quiet = { channel: "instagram" as const, period: "28 days", today, lastPostDay: "2026-11-12", best: null, followers: null };
  it("has nothing to say about a channel ticking over", () => {
    expect(socialLook(quiet)).toEqual([]);
  });
  it("mentions a long gap since the last post", () => {
    const out = socialLook({ ...quiet, lastPostDay: "2026-10-20" });
    expect(out).toEqual([{ key: "quiet-instagram", tone: "neutral", title: "Nothing posted on Instagram for 27 days", detail: "The last post went up on Oct 20.", href: "/online/instagram#posts" }]);
    expect(socialLook({ ...quiet, lastPostDay: null })).toEqual([]);
  });
  it("calls out a post that travelled much further than usual", () => {
    const list = [post("2026-10-21", 700), post("2026-10-28", 600), post("2026-11-03", 2400, { kind: "reel", caption: "Trivia night is back" }), post("2026-11-08", 650)];
    const out = socialLook({ ...quiet, best: bestAndWorst(list, today) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "standout-instagram", tone: "good", title: "An Instagram reel reached about 4 times your usual" });
    expect(out[0].detail).toBe("“Trivia night is back” (Nov 3) reached 2,400 accounts. A typical post reaches 675.");
    // Not for small numbers, or a modest lead.
    expect(socialLook({ ...quiet, best: bestAndWorst([post("2026-10-21", 20), post("2026-10-28", 22), post("2026-11-03", 90)], today) })).toEqual([]);
    expect(socialLook({ ...quiet, best: bestAndWorst([post("2026-10-21", 700), post("2026-10-28", 600), post("2026-11-03", 1200)], today) })).toEqual([]);
  });
  it("warns when followers fall by more than a wobble", () => {
    const f = followerSummary([{ day: "2026-10-18", value: 2140 }, { day: "2026-11-16", value: 2080 }], w);
    expect(socialLook({ ...quiet, channel: "facebook", lastPostDay: "2026-11-12", followers: f })).toEqual([
      { key: "followers-facebook", tone: "warn", title: "The Facebook Page lost 60 followers", detail: "2,080 now, 2,140 at the start of the last 28 days.", href: "/online/facebook" },
    ]);
    const small = followerSummary([{ day: "2026-10-18", value: 2140 }, { day: "2026-11-16", value: 2135 }], w);
    expect(socialLook({ ...quiet, followers: small })).toEqual([]);
  });
  it("joins the rest of the list, good news last, and names who stopped sending numbers", () => {
    const extra = socialLook({ ...quiet, lastPostDay: "2026-10-20" });
    const out = worthALook(base({ extra, needReply: 2, stale: [{ key: "instagram", label: "Instagram's numbers", through: "2026-11-02", href: META_SETUP_HREF, from: "Instagram" }] }));
    expect(out.map((i) => i.key)).toEqual(["stale-instagram", "reply", "quiet-instagram"]);
    expect(out[0].detail).toBe("Nothing newer has arrived from Instagram. Check the connection and sync again.");
  });
});

describe("a Page post's reactions, comments and shares together", () => {
  it("adds up what there is, and is nothing when there is nothing", () => {
    expect(countInteractions(41, 5, 3)).toBe(49);
    expect(countInteractions(41, null, null)).toBe(41);
    expect(countInteractions(null, null, null)).toBeNull();
  });
});

describe("a reminder to connect again before Instagram stops", () => {
  it("is raised from ten days before, with the date, and only then", () => {
    const st = metaReconnectSoonState({ on: "2027-01-15", daysLeft: 9, soon: true });
    expect(st).toMatchObject({ kind: "reconnect", href: META_SETUP_HREF, action: "Connect again" });
    expect(st.title).toMatch(/Jan 15/);
    expect(metaReconnectSoonState({ on: "2027-01-15", daysLeft: 30, soon: false }).kind).toBe("ready");
    expect(metaReconnectSoonState(null).kind).toBe("ready");
    expect(metaReconnectSoonState({ on: "2027-01-15", daysLeft: -2, soon: true }).title).toMatch(/stopped/);
  });
  it("shows in Worth a look", () => {
    const look = worthALook({ period: "28 days", metrics: [], states: [{ key: "meta-soon", state: metaReconnectSoonState({ on: "2027-01-15", daysLeft: 4, soon: true }) }], stale: [], rating: { cur: null, prev: null }, needReply: 0 } as LookInput);
    expect(look[0]).toMatchObject({ tone: "warn", href: META_SETUP_HREF });
    expect(look[0].title).toMatch(/Jan 15/);
  });
});
