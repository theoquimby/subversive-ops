import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { rangeWindows } from "@/domain/online";
import { bestAndWorst, followerSummary, postCallout, type PostRow } from "@/domain/onlineChannels";
import { seedOnlineChannels } from "../onlineChannels";

// The seed is run against a stand-in that only records what it was asked to write: no database.
type DailyRow = { channel: string; day: Date; metric: string; value: number };
type PostData = { channel: string; externalId: string; postedAt: Date; kind: string; caption?: string | null; reach?: number | null; views?: number | null; metricsAt?: Date | null };

function fakeDb() {
  const daily: DailyRow[] = [];
  const posts: PostData[] = [];
  const deleted: string[] = [];
  const db = {
    onlineChannelDaily: {
      createMany: vi.fn(async ({ data }: { data: DailyRow[] }) => (daily.push(...data), { count: data.length })),
      deleteMany: vi.fn(async () => (deleted.push("daily"), { count: 0 })),
    },
    onlinePost: {
      createMany: vi.fn(async ({ data }: { data: PostData[] }) => (posts.push(...data), { count: data.length })),
      deleteMany: vi.fn(async () => (deleted.push("posts"), { count: 0 })),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { db: db as unknown as PrismaClient, raw: db, daily, posts, deleted };
}

const today = "2026-11-16";
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("the Instagram and Facebook demo data", () => {
  it("adds about 120 days of numbers for both channels and about 30 posts, and deletes nothing", async () => {
    const f = fakeDb();
    const r = await seedOnlineChannels(f.db, today);
    expect(r).toEqual({ daily: f.daily.length, posts: f.posts.length, from: "2026-07-19", to: "2026-11-14" });
    expect(f.deleted).toEqual([]);
    expect(f.raw.onlineChannelDaily.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    expect(f.raw.onlinePost.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    for (const channel of ["instagram", "facebook"]) {
      const days = new Set(f.daily.filter((x) => x.channel === channel && x.metric === "views").map((x) => iso(x.day)));
      expect(days.size, channel).toBe(119);
    }
    expect(f.posts.length).toBeGreaterThanOrEqual(28);
    expect(f.posts.length).toBeLessThanOrEqual(34);
    expect(new Set(f.posts.map((p) => `${p.channel}:${p.externalId}`)).size).toBe(f.posts.length);
    expect(new Set(f.daily.map((x) => `${x.channel}:${iso(x.day)}:${x.metric}`)).size).toBe(f.daily.length);
  });

  it("uses the stored metric names the pages read, and only whole, non-negative numbers", async () => {
    const f = fakeDb();
    await seedOnlineChannels(f.db, today);
    const names = (channel: string) => [...new Set(f.daily.filter((x) => x.channel === channel).map((x) => x.metric))].sort();
    expect(names("instagram")).toEqual(["comments", "engaged", "followers", "follows", "interactions", "likes", "profile_taps", "reach", "saves", "shares", "tap_call", "tap_directions", "tap_email", "tap_text", "unfollows", "views"]);
    expect(names("facebook")).toEqual(["followers", "follows", "interactions", "profile_taps", "profile_visits", "reach", "unfollows", "views"]);
    expect(f.daily.every((x) => Number.isInteger(x.value) && x.value >= 0)).toBe(true);
  });

  it("keeps follower counts to today, and the daily numbers a couple of days behind", async () => {
    const f = fakeDb();
    await seedOnlineChannels(f.db, today);
    const last = (metric: string) => f.daily.filter((x) => x.channel === "instagram" && x.metric === metric).map((x) => iso(x.day)).sort().pop();
    expect(last("followers")).toBe(today);
    expect(last("views")).toBe("2026-11-14");
    const followers = f.daily.filter((x) => x.channel === "instagram" && x.metric === "followers").map((x) => ({ day: iso(x.day), value: x.value }));
    const s = followerSummary(followers, rangeWindows("28d", today));
    expect(s.now).toBeGreaterThan(2000);
    expect(s.change).toBeGreaterThan(0);
    expect(s.partial).toBe(false);
  });

  it("gives the pages something to say: a reel that travelled, and a post with no numbers yet", async () => {
    const f = fakeDb();
    await seedOnlineChannels(f.db, today);
    const rows: PostRow[] = f.posts
      .filter((p) => p.channel === "instagram")
      .map((p, i) => ({ id: String(i), channel: "instagram", kind: p.kind, postedAt: p.postedAt.toISOString(), day: iso(p.postedAt), caption: p.caption ?? null, permalink: null, thumbnailUrl: null, views: p.views ?? null, reach: p.reach ?? null, likes: null, comments: null, saves: null, shares: null, interactions: null, profileVisits: null, follows: null, hasNumbers: p.metricsAt != null }));
    expect(rows.some((p) => !p.hasNumbers && p.reach == null)).toBe(true);
    const w = rangeWindows("28d", today);
    const bw = bestAndWorst(rows.filter((p) => p.day >= w.cur.from), today)!;
    expect(bw.best.kind).toBe("reel");
    expect(bw.best.reach! / bw.typical).toBeGreaterThan(3);
    expect(postCallout(bw, "28 days", "instagram")).toMatch(/Trivia night is back/);
  });

  it("is the same every time, and clears only its own channels when asked to replace", async () => {
    const a = fakeDb();
    const b = fakeDb();
    await seedOnlineChannels(a.db, today);
    await seedOnlineChannels(b.db, today, { replace: true });
    expect(a.daily.map((x) => x.value)).toEqual(b.daily.map((x) => x.value));
    expect(b.deleted.sort()).toEqual(["daily", "posts"]);
    expect(b.raw.onlineChannelDaily.deleteMany.mock.calls[0]).toEqual([{ where: { channel: { in: ["instagram", "facebook"] } } }]);
  });
});
