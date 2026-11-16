import { beforeEach, describe, expect, it, vi } from "vitest";

// The sync is tested with Meta and the database both faked: no network, no keys, no Postgres.
vi.mock("server-only", () => ({}));
vi.mock("../../env", () => ({ env: { BUSINESS_TIMEZONE: "America/New_York", SESSION_SECRET: "a-session-secret-that-is-long-enough-000" } }));
vi.mock("../sales", () => ({ businessToday: () => "2026-11-16" }));
vi.mock("../secrets", () => ({ getSecrets: async () => ({ META_APP_ID: "1".repeat(16), META_APP_SECRET: "ab".repeat(16) }) }));

type Daily = { channel: string; day: Date; metric: string; value: number };
type PostRec = Record<string, unknown> & { channel: string; externalId: string };

const store = { settings: new Map<string, string>(), daily: [] as Daily[], posts: new Map<string, PostRec>() };
const inRange = (d: Date, w?: { gte?: Date; lte?: Date }) => !w || ((!w.gte || d >= w.gte) && (!w.lte || d <= w.lte));
const matches = (r: Daily, where: { channel?: string | { in: string[] }; day?: { gte?: Date; lte?: Date }; metric?: { in: string[] } }) =>
  (where.channel == null || (typeof where.channel === "string" ? r.channel === where.channel : where.channel.in.includes(r.channel))) && inRange(r.day, where.day) && (!where.metric || where.metric.in.includes(r.metric));

vi.mock("../../db", () => ({
  db: {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => (store.settings.has(where.key) ? { key: where.key, value: store.settings.get(where.key)! } : null),
      upsert: async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => void store.settings.set(where.key, store.settings.has(where.key) ? update.value : create.value),
      deleteMany: ({ where }: { where: { key: string | { in: string[] } } }) => {
        for (const k of typeof where.key === "string" ? [where.key] : where.key.in) store.settings.delete(k);
        return Promise.resolve({ count: 0 });
      },
    },
    onlineChannelDaily: {
      // Each runs at once and in order, so a [delete, create] transaction behaves like one.
      deleteMany: ({ where }: { where: Parameters<typeof matches>[1] }) => {
        store.daily = store.daily.filter((r) => !matches(r, where));
        return Promise.resolve({ count: 0 });
      },
      createMany: ({ data }: { data: Daily[] }) => {
        for (const d of data) if (!store.daily.some((r) => r.channel === d.channel && r.metric === d.metric && +r.day === +d.day)) store.daily.push(d);
        return Promise.resolve({ count: data.length });
      },
      count: async ({ where }: { where: Parameters<typeof matches>[1] }) => store.daily.filter((r) => matches(r, where)).length,
    },
    onlinePost: {
      upsert: async ({ where, create, update }: { where: { channel_externalId: { channel: string; externalId: string } }; create: PostRec; update: PostRec }) => {
        const key = `${where.channel_externalId.channel}:${where.channel_externalId.externalId}`;
        store.posts.set(key, store.posts.has(key) ? { ...store.posts.get(key)!, ...update } : create);
      },
      deleteMany: () => {
        store.posts.clear();
        return Promise.resolve({ count: 0 });
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

vi.mock("../../integrations/meta", async (actual) => ({
  ...(await actual<typeof import("../../integrations/meta")>()),
  exchangeCode: vi.fn(),
  exchangeLongLived: vi.fn(),
  grantedScopes: vi.fn(),
  revokeApp: vi.fn(),
  listPages: vi.fn(),
  igAccount: vi.fn(),
  igDayTotals: vi.fn(),
  pageDayInsights: vi.fn(),
  igMedia: vi.fn(),
  igMediaInsights: vi.fn(),
  pagePosts: vi.fn(),
  pagePostInsights: vi.fn(),
}));

const meta = vi.mocked(await import("../../integrations/meta"));
const { MetaError } = meta;
const { META_SCOPES } = await import("@/domain/metaData");
const svc = await import("../metaChannels");

const TODAY = "2026-11-16";
const USER = ["user", "token"].join("-");
const PAGE = ["page", "token"].join("-");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fail = (kind: ConstructorParameters<typeof MetaError>[2], message: string) => new MetaError(message, { status: 400, code: null, subcode: null, type: "", message }, kind);
const NONE = { views: null, reach: null, likes: null, comments: null, saves: null, shares: null, interactions: null, profileVisits: null, follows: null, extra: null, any: false };
const page = (patch: Record<string, unknown> = {}) => ({ id: "10", name: "Subversive", token: PAGE, canAnalyze: true, instagram: { id: "1784", username: "drinksubversive" }, ...patch });

/** Meta answering normally: a few numbers every day, two posts on Instagram and one on the Page. */
function healthy() {
  meta.exchangeCode.mockResolvedValue({ access_token: "short", expires_in: 3600 });
  meta.exchangeLongLived.mockResolvedValue({ access_token: USER, expires_in: 5_183_944 });
  meta.grantedScopes.mockResolvedValue([...META_SCOPES]);
  meta.revokeApp.mockResolvedValue(undefined);
  meta.listPages.mockResolvedValue([page()]);
  meta.igAccount.mockResolvedValue({ id: "1784", username: "drinksubversive", followers: 2140, mediaCount: 3 });
  meta.igDayTotals.mockImplementation(async (_t, _id, _day, _tz, metrics) => ({ rows: metrics.includes("reach") ? [{ metric: "reach", value: 300 }, { metric: "views", value: 700 }] : metrics.includes("profile_links_taps") ? [{ metric: "profile_taps", value: 3 }, { metric: "tap_call", value: 3 }] : [{ metric: "follows", value: 2 }], seen: [...metrics] }));
  meta.pageDayInsights.mockImplementation(async (_t, _id, from) => ({ rows: [{ day: from, metric: "views", value: 400 }, { day: from, metric: "followers", value: 1800 }], seen: ["page_media_view", "page_follows"] }));
  meta.igMedia.mockResolvedValue([
    { externalId: "m1", postedAt: "2026-11-10T21:00:00.000Z", kind: "reel", caption: "Trivia night is back", permalink: null, thumbnailUrl: null, likes: 88, comments: 6, shares: null },
    { externalId: "m2", postedAt: "2026-11-15T21:00:00.000Z", kind: "post", caption: "Kitchen special", permalink: null, thumbnailUrl: null, likes: 4, comments: 0, shares: null },
  ]);
  meta.igMediaInsights.mockResolvedValue({ ...NONE, views: 3400, reach: 2100, likes: 120, comments: 8, saves: 14, shares: 22, interactions: 164, any: true });
  meta.pagePosts.mockResolvedValue([{ externalId: "10_1", postedAt: "2026-11-02T16:00:00.000Z", kind: "post", caption: "New on tap", permalink: null, thumbnailUrl: null, likes: 41, comments: 5, shares: 3 }]);
  meta.pagePostInsights.mockResolvedValue({ ...NONE, views: 900, reach: 640, likes: 39, extra: { clicks: 37 }, any: true });
}

const connect = () => svc.connectMeta({ code: "the-code", redirectUri: "https://ops.example.com/api/meta/oauth/callback", by: "Max" });
const rows = (channel: string, metric: string) => store.daily.filter((r) => r.channel === channel && r.metric === metric);

beforeEach(() => {
  store.settings.clear();
  store.daily = [];
  store.posts.clear();
  vi.clearAllMocks();
  healthy();
});

describe("connecting", () => {
  it("keeps the tokens encrypted, picks the only Page and its Instagram account, and reports what it found", async () => {
    const found = await connect();
    expect(found).toEqual({ pages: [{ id: "10", name: "Subversive", instagram: "drinksubversive", canAnalyze: true }], pageId: "10", notes: [] });
    const saved = store.settings.get("meta.connection")!;
    expect(saved).not.toContain(USER);
    expect(saved).not.toContain(PAGE);
    const s = await svc.metaStatus();
    expect(s).toMatchObject({ appReady: true, connected: true, needsReconnect: null, pageId: "10", pageName: "Subversive", igUsername: "drinksubversive", connectedBy: "Max", missing: [], userExpiresOn: "2027-01-15" });
    expect(svc.metaFacts(s)).toMatchObject({ connected: true, pagePicked: true, instagramLinked: true, synced: { instagram: false, facebook: false } });
  });
  it("says so when no Instagram account is linked to the Page, or a box was unticked", async () => {
    meta.listPages.mockResolvedValue([page({ instagram: null })]);
    meta.grantedScopes.mockResolvedValue(["pages_show_list", "pages_read_engagement", "instagram_basic"]);
    const found = await connect();
    expect("notes" in found && found.notes.join(" ")).toMatch(/Not allowed at sign-in/);
    expect("notes" in found && found.notes.join(" ")).toMatch(/No Instagram account is linked/);
    expect((await svc.metaStatus()).missing).toEqual(["read_insights", "instagram_manage_insights"]);
  });
  it("asks which Page when there are several, and never hands a token to the page", async () => {
    meta.listPages.mockResolvedValue([page({ instagram: null }), page({ id: "11", name: "Another", instagram: null })]);
    const found = await connect();
    expect(found).toMatchObject({ pageId: null, notes: ["Pick which Page is the business."] });
    expect(JSON.stringify(found)).not.toContain(PAGE);
    expect(await svc.discoverMeta("11")).toMatchObject({ pageId: "11" });
    expect((await svc.metaStatus()).pageName).toBe("Another");
  });
  it("forgets the tokens on disconnect, and keeps the numbers", async () => {
    await connect();
    await svc.syncMeta();
    const before = store.daily.length;
    await svc.disconnectMeta();
    expect(meta.revokeApp).toHaveBeenCalledWith(USER);
    expect(store.settings.has("meta.connection")).toBe(false);
    expect(store.daily.length).toBe(before);
    expect(await svc.syncMeta()).toMatchObject({ ok: false, skipped: "not connected" });
  });
});

describe("the sync", () => {
  it("is skipped, without calling Meta, when nothing is connected", async () => {
    expect(await svc.syncMeta()).toMatchObject({ ok: false, skipped: "not connected" });
    expect(meta.igDayTotals).not.toHaveBeenCalled();
  });

  it("reads a month of Instagram, the Page's history, followers and posts, with the Page's own token", async () => {
    await connect();
    const r = await svc.syncMeta();
    expect(r).toMatchObject({ ok: true, errors: [] });
    expect(r.steps.map((s) => s.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    // Yesterday back 30 days, then the first slice of older days.
    const days = rows("instagram", "reach").map((x) => iso(x.day)).sort();
    expect(days[days.length - 1]).toBe("2026-11-15");
    expect(days).toContain("2026-10-17");
    expect(rows("instagram", "followers").map((x) => [iso(x.day), x.value])).toEqual([[TODAY, 2140]]);
    expect(rows("facebook", "views").length).toBeGreaterThan(5);
    expect(meta.igDayTotals.mock.calls.every((c) => c[0] === PAGE)).toBe(true);
    expect(meta.pageDayInsights.mock.calls.every((c) => c[0] === PAGE)).toBe(true);
    const st = await svc.metaSyncState();
    expect(st.instagram).toMatchObject({ lastDay: "2026-11-15", error: null, skipped: [] });
    expect(st.instagram.earliestDay! < "2026-10-17").toBe(true);
    expect(st.facebook).toMatchObject({ lastDay: "2026-11-15", backfillDone: true, error: null });
    expect([...store.posts.keys()].sort()).toEqual(["facebook:10_1", "instagram:m1", "instagram:m2"]);
    expect(store.posts.get("instagram:m1")).toMatchObject({ reach: 2100, views: 3400, interactions: 164, kind: "reel" });
    // The Page doesn't add reactions, comments and shares up itself.
    expect(store.posts.get("facebook:10_1")).toMatchObject({ reach: 640, likes: 39, comments: 5, shares: 3, interactions: 47 });
  });

  it("can be run twice without doubling anything, and then only re-reads the last few days", async () => {
    await connect();
    await svc.syncMeta();
    const reachRows = rows("instagram", "reach").length;
    meta.igDayTotals.mockClear();
    const st1 = await svc.metaSyncState();
    // Stop the backfill so only the nightly re-read is counted.
    store.settings.set("meta.syncState", JSON.stringify({ ...st1, instagram: { ...st1.instagram, backfillDone: true } }));
    await svc.syncMeta();
    expect(rows("instagram", "reach").length).toBe(reachRows);
    expect(store.posts.size).toBe(3);
    const reread = new Set(meta.igDayTotals.mock.calls.map((c) => c[2]));
    expect([...reread].sort()).toEqual(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });

  it("carries on when Instagram has removed a metric: asks one at a time, leaves that one out, and says which", async () => {
    await connect();
    meta.igDayTotals.mockImplementation(async (_t, _id, _day, _tz, metrics) => {
      if (metrics.includes("views") && metrics.length > 1) throw fail("invalid-metric", "Instagram no longer gives one of the numbers.");
      if (metrics.includes("views")) throw fail("invalid-metric", "Instagram no longer gives one of the numbers.");
      return { rows: metrics.includes("reach") ? [{ metric: "reach", value: 300 }] : [], seen: [...metrics] };
    });
    const r = await svc.syncMeta();
    expect(r.ok).toBe(true);
    expect(r.notes.join(" ")).toMatch(/Instagram no longer gives: views/);
    expect(rows("instagram", "reach").length).toBeGreaterThan(20);
    expect(rows("instagram", "views")).toEqual([]);
    expect((await svc.metaSyncState()).instagram.skipped).toEqual(["views"]);
    // After the first day, the removed one isn't asked for again.
    const lastAsk = meta.igDayTotals.mock.calls[meta.igDayTotals.mock.calls.length - 1][4];
    expect(lastAsk).not.toContain("views");
  });

  it("is fine with an empty account: no rows, no errors, and the backfill stops at the silence", async () => {
    await connect();
    meta.igDayTotals.mockResolvedValue({ rows: [], seen: [] });
    meta.pageDayInsights.mockResolvedValue({ rows: [], seen: [] });
    meta.igMedia.mockResolvedValue([]);
    meta.pagePosts.mockResolvedValue([]);
    meta.igAccount.mockResolvedValue({ id: "1784", username: "drinksubversive", followers: 0, mediaCount: 0 });
    const r = await svc.syncMeta();
    expect(r).toMatchObject({ ok: true, errors: [] });
    expect(store.daily.filter((x) => x.metric !== "followers")).toEqual([]);
    expect(store.posts.size).toBe(0);
    expect((await svc.metaSyncState()).instagram).toMatchObject({ lastDay: "2026-11-15", backfillDone: true });
  });

  it("saves a post that has no insights yet without numbers, and keeps going", async () => {
    await connect();
    meta.igMediaInsights.mockImplementation(async (_t, id) => {
      if (id === "m2") throw fail("no-insights", "No numbers for that post yet.");
      return { ...NONE, reach: 2100, views: 3400, any: true };
    });
    const r = await svc.syncMeta();
    expect(r.ok).toBe(true);
    expect(store.posts.get("instagram:m2")).toMatchObject({ metricsAt: null, reach: null, likes: 4, caption: "Kitchen special" });
    expect(store.posts.get("instagram:m1")).toMatchObject({ reach: 2100 });
    expect(store.posts.get("instagram:m1")!.metricsAt).toBeInstanceOf(Date);
  });

  it("skips one day that failed and still finishes the rest", async () => {
    await connect();
    const base = meta.igDayTotals.getMockImplementation()!;
    meta.igDayTotals.mockImplementation(async (t, id, day, tz, metrics, breakdown) => {
      if (day === "2026-11-03") throw fail("transient", "Facebook's service had a problem.");
      return base(t, id, day, tz, metrics, breakdown);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await svc.syncMeta();
    warn.mockRestore();
    expect(r.ok).toBe(true);
    const days = rows("instagram", "reach").map((x) => iso(x.day));
    expect(days).not.toContain("2026-11-03");
    expect(days).toContain("2026-11-02");
    expect(days).toContain("2026-11-04");
  });

  it("stops when the token expires mid-sync: keeps what was read, skips the rest, and asks to connect again", async () => {
    await connect();
    // The daily numbers come in, then the sign-in dies before the follower count.
    meta.igAccount.mockRejectedValue(fail("auth", "Facebook says the sign-in has expired or was removed. Press Connect again."));
    const r = await svc.syncMeta();
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => s.status)).toEqual(["ok", "failed", "skipped", "skipped", "skipped"]);
    expect(r.errors).toEqual(["Instagram followers: Facebook says the sign-in has expired or was removed. Press Connect again."]);
    expect(rows("instagram", "reach").length).toBeGreaterThan(20);
    expect(meta.pageDayInsights).not.toHaveBeenCalled();
    expect(meta.igMedia).not.toHaveBeenCalled();
    // Both tokens were tried before giving up.
    expect(meta.igAccount.mock.calls.map((c) => c[0])).toEqual([PAGE, USER]);
    const s = await svc.metaStatus();
    expect(s.connected).toBe(false);
    expect(s.needsReconnect).toMatch(/Connect again/);
    expect(s.state.instagram.lastDay).toBe("2026-11-15");
    // The next night doesn't hammer a dead sign-in.
    meta.igDayTotals.mockClear();
    expect(await svc.syncMeta()).toMatchObject({ ok: false, skipped: "needs reconnect" });
    expect(meta.igDayTotals).not.toHaveBeenCalled();
    // Connecting again clears it.
    meta.igAccount.mockResolvedValue({ id: "1784", username: "drinksubversive", followers: 2140, mediaCount: 3 });
    await connect();
    expect((await svc.metaStatus()).connected).toBe(true);
  });

  it("stops when Meta asks to slow down, without asking to connect again", async () => {
    await connect();
    meta.pageDayInsights.mockRejectedValue(fail("rate", "Facebook asked us to slow down. The next nightly sync tries again."));
    const r = await svc.syncMeta();
    expect(r.steps.map((s) => s.status)).toEqual(["ok", "ok", "failed", "skipped", "skipped"]);
    const s = await svc.metaStatus();
    expect(s.needsReconnect).toBeNull();
    expect(s.state.facebook.error).toMatch(/slow down/);
  });

  it("falls back to the owner's sign-in when Instagram won't take the Page's token, and remembers", async () => {
    await connect();
    const base = meta.igDayTotals.getMockImplementation()!;
    meta.igDayTotals.mockImplementation(async (t, id, day, tz, metrics, breakdown) => {
      if (t === PAGE) throw fail("permission", "Facebook didn't allow that.");
      return base(t, id, day, tz, metrics, breakdown);
    });
    const r = await svc.syncMeta();
    expect(r.steps[0]).toEqual({ name: "Instagram numbers", status: "ok" });
    const pageTries = meta.igDayTotals.mock.calls.filter((c) => c[0] === PAGE).length;
    // Only the first calls tried the Page's token; the rest went straight to the one that works.
    expect(pageTries).toBeLessThanOrEqual(3);
    expect(meta.igAccount.mock.calls[0][0]).toBe(USER);
  });

  it("renews the owner's sign-in when it is close to running out, and syncs either way", async () => {
    meta.exchangeLongLived.mockResolvedValueOnce({ access_token: USER, expires_in: 5 * 86_400 });
    await connect();
    meta.exchangeLongLived.mockClear();
    meta.exchangeLongLived.mockRejectedValueOnce(fail("transient", "Facebook's service had a problem."));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await svc.syncMeta()).ok).toBe(true);
    warn.mockRestore();
    expect(meta.exchangeLongLived).toHaveBeenCalledTimes(1);
    meta.exchangeLongLived.mockResolvedValueOnce({ access_token: "renewed", expires_in: 5_183_944 });
    expect((await svc.syncMeta()).ok).toBe(true);
    expect((await svc.metaStatus()).userExpiresOn! > "2026-12-31").toBe(true);
  });
});
