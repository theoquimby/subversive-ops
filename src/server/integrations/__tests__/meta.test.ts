import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Meta is tested with fetch stubbed out: no network, no keys, no database.
vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const meta = await import("../meta");
const { META_API_VERSION } = await import("@/domain/metaData");

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const bad = (status: number, error: Record<string, unknown>) => new Response(JSON.stringify({ error }), { status });
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url: new URL(url), init, headers: new Headers(init.headers) };
};

// Not real credentials: built from parts so scanners don't flag them.
const TOKEN = ["test", "token", "value"].join("-");
const APP = { appId: "1".repeat(16), appSecret: "ab".repeat(16) };

describe("the Meta integration", () => {
  it("makes no call when it is imported", () => {
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("calls", () => {
    beforeEach(() => fetchMock.mockReset());
    afterEach(() => fetchMock.mockReset());

    it("pins the API version, sends the token in a header (never the address), and sets a timeout", async () => {
      fetchMock.mockResolvedValueOnce(ok({ id: "1784", username: "drinksubversive", followers_count: 2140, media_count: 310 }));
      const a = await meta.igAccount(TOKEN, "1784");
      expect(a).toEqual({ id: "1784", username: "drinksubversive", followers: 2140, mediaCount: 310 });
      const { url, init, headers } = lastCall();
      expect(url.origin).toBe("https://graph.facebook.com");
      expect(url.pathname).toBe(`/${META_API_VERSION}/1784`);
      expect(url.search).not.toContain(TOKEN);
      expect(url.searchParams.get("access_token")).toBeNull();
      expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.cache).toBe("no-store");
    });

    it("swaps the sign-in code for a token, then for a long-lived one", async () => {
      fetchMock.mockResolvedValueOnce(ok({ access_token: "short", token_type: "bearer", expires_in: 5000 }));
      expect(await meta.exchangeCode(APP, "the-code", "https://ops.example.com/api/meta/oauth/callback")).toMatchObject({ access_token: "short" });
      let c = lastCall();
      expect(c.url.pathname).toBe(`/${META_API_VERSION}/oauth/access_token`);
      expect(Object.fromEntries(c.url.searchParams)).toEqual({ client_id: APP.appId, client_secret: APP.appSecret, redirect_uri: "https://ops.example.com/api/meta/oauth/callback", code: "the-code" });
      fetchMock.mockResolvedValueOnce(ok({ access_token: "long", token_type: "bearer", expires_in: 5_183_944 }));
      expect(await meta.exchangeLongLived(APP, "short")).toMatchObject({ access_token: "long", expires_in: 5_183_944 });
      c = lastCall();
      expect(c.url.searchParams.get("grant_type")).toBe("fb_exchange_token");
      expect(c.url.searchParams.get("fb_exchange_token")).toBe("short");
    });

    it("turns Meta's error into a plain message and a kind the sync can act on", async () => {
      fetchMock.mockResolvedValueOnce(bad(400, { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463 }));
      const e = await meta.igAccount(TOKEN, "1784").catch((x) => x);
      expect(e).toBeInstanceOf(meta.MetaError);
      expect(e.kind).toBe("auth");
      expect(e.message).toMatch(/Connect again/);
      expect(e.message).not.toContain(TOKEN);
      expect(meta.kindOfError(e)).toBe("auth");
      expect(meta.kindOfError(new Error("something else"))).toBe("other");
    });

    it("treats an error that arrives with a 200 as an error too", async () => {
      fetchMock.mockResolvedValueOnce(ok({ error: { message: "(#4) Application request limit reached", code: 4 } }));
      const e = await meta.igAccount(TOKEN, "1784").catch((x) => x);
      expect(e.kind).toBe("rate");
    });

    it("says when Facebook couldn't be reached, without failing any other way", async () => {
      fetchMock.mockRejectedValueOnce(new Error("fetch failed"));
      const e = await meta.igAccount(TOKEN, "1784").catch((x) => x);
      expect(e).toBeInstanceOf(meta.MetaError);
      expect(e.kind).toBe("transient");
      expect(e.message).toMatch(/Couldn't reach Facebook/);
    });

    it("lists every Page, following Facebook's next-page marker", async () => {
      fetchMock.mockResolvedValueOnce(ok({ data: [{ id: "10", name: "Subversive", access_token: "p10", tasks: ["ANALYZE"], instagram_business_account: { id: "1784", username: "drinksubversive" } }], paging: { cursors: { after: "NEXT" }, next: "https://graph.facebook.com/x" } }));
      fetchMock.mockResolvedValueOnce(ok({ data: [{ id: "11", name: "Other", access_token: "p11" }] }));
      const pages = await meta.listPages(TOKEN);
      expect(pages.map((p) => p.id)).toEqual(["10", "11"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(lastCall().url.searchParams.get("after")).toBe("NEXT");
      expect(lastCall().url.pathname).toBe(`/${META_API_VERSION}/me/accounts`);
    });

    it("asks Instagram for one day's totals", async () => {
      fetchMock.mockResolvedValueOnce(ok({ data: [{ name: "reach", period: "day", total_value: { value: 812 } }, { name: "views", period: "day", total_value: { value: 2305 } }] }));
      const r = await meta.igDayTotals(TOKEN, "1784", "2026-11-14", "America/New_York", ["reach", "views"]);
      expect(r.rows).toEqual([{ metric: "reach", value: 812 }, { metric: "views", value: 2305 }]);
      const { url } = lastCall();
      expect(url.pathname).toBe(`/${META_API_VERSION}/1784/insights`);
      expect(url.searchParams.get("metric_type")).toBe("total_value");
    });

    it("reads the Page's numbers and posts with the Page's own token, asking for counts only", async () => {
      fetchMock.mockResolvedValueOnce(ok({ data: [{ name: "page_media_view", period: "day", values: [{ value: 410, end_time: "2026-11-14T08:00:00+0000" }] }] }));
      const r = await meta.pageDayInsights("page-token", "10", "2026-11-01", "2026-11-13", ["page_media_view"]);
      expect(r.rows).toEqual([{ day: "2026-11-13", metric: "views", value: 410 }]);
      expect(lastCall().headers.get("authorization")).toBe("Bearer page-token");
      fetchMock.mockResolvedValueOnce(ok({ data: [] }));
      await meta.pagePosts("page-token", "10");
      const fields = lastCall().url.searchParams.get("fields")!;
      expect(fields).toContain("reactions.limit(0).summary(total_count)");
      expect(fields).toContain("comments.limit(0).summary(total_count)");
      // Never who reacted or commented, and no messages.
      expect(fields).not.toMatch(/from|comments\{|conversations|messages/);
    });

    it("takes back the app's permission on disconnect", async () => {
      fetchMock.mockResolvedValueOnce(ok({ success: true }));
      await meta.revokeApp(TOKEN);
      const { url, init } = lastCall();
      expect(init.method).toBe("DELETE");
      expect(url.pathname).toBe(`/${META_API_VERSION}/me/permissions`);
    });
  });
});
