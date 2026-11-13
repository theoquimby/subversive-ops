import { describe, expect, it } from "vitest";
import { dateRuns, emptyPending, isStale, mergePending, monthsBefore, planChunks, retryDelayMs, tokenNeedsRefresh, webhookStream, webhookTimestamp } from "../squareSync";

describe("monthsBefore", () => {
  it("steps back calendar months", () => {
    expect(monthsBefore("2026-11-13", 3)).toBe("2026-08-13");
    expect(monthsBefore("2026-11-13", 12)).toBe("2025-11-13");
  });
  it("clamps to the end of shorter months", () => {
    expect(monthsBefore("2026-05-31", 3)).toBe("2026-02-28");
  });
});

describe("planChunks", () => {
  it("covers the range newest first without gaps or overlap", () => {
    const chunks = planChunks("2026-10-01", "2026-10-20", 7);
    expect(chunks).toEqual([
      { from: "2026-10-13", toExclusive: "2026-10-20" },
      { from: "2026-10-06", toExclusive: "2026-10-13" },
      { from: "2026-10-01", toExclusive: "2026-10-06" },
    ]);
  });
  it("handles an exact multiple and an empty range", () => {
    expect(planChunks("2026-10-01", "2026-10-15", 7)).toHaveLength(2);
    expect(planChunks("2026-10-01", "2026-10-01", 7)).toEqual([]);
  });
  it("plans about 26 weekly chunks for six months", () => {
    const today = "2026-11-13";
    const n = planChunks(monthsBefore(today, 6), "2026-11-14", 7).length;
    expect(n).toBeGreaterThanOrEqual(26);
    expect(n).toBeLessThanOrEqual(27);
  });
});

describe("retryDelayMs", () => {
  it("honors Retry-After seconds, capped", () => {
    expect(retryDelayMs(1, "2")).toBe(2000);
    expect(retryDelayMs(1, "120")).toBe(10_000);
  });
  it("honors Retry-After dates", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    expect(retryDelayMs(1, "Fri, 13 Nov 2026 12:00:03 GMT", now)).toBe(3000);
  });
  it("backs off exponentially otherwise", () => {
    expect([1, 2, 3, 4].map((a) => retryDelayMs(a, null))).toEqual([500, 1000, 2000, 4000]);
  });
});

describe("tokenNeedsRefresh / isStale", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  it("refreshes inside the last 7 days", () => {
    expect(tokenNeedsRefresh("2026-11-19T12:00:00Z", now)).toBe(true);
    expect(tokenNeedsRefresh("2026-12-01T12:00:00Z", now)).toBe(false);
    expect(tokenNeedsRefresh(null, now)).toBe(false);
  });
  it("is stale when missing or old", () => {
    expect(isStale(null, now, 15)).toBe(true);
    expect(isStale("2026-11-13T11:50:00Z", now, 15)).toBe(false);
    expect(isStale("2026-11-13T11:40:00Z", now, 15)).toBe(true);
  });
});

describe("webhooks", () => {
  it("routes event types", () => {
    expect(webhookStream("order.updated")).toBe("sales");
    expect(webhookStream("payment.created")).toBe("sales");
    expect(webhookStream("labor.timecard.updated")).toBe("labor");
    expect(webhookStream("catalog.version.updated")).toBe("catalog");
    expect(webhookStream("customer.created")).toBeNull();
  });
  it("finds the object's timestamp", () => {
    expect(webhookTimestamp({ created_at: "2026-11-13T01:00:00Z", data: { object: { timecard: { start_at: "2026-11-12T22:00:00Z" } } } })).toBe("2026-11-12T22:00:00Z");
    expect(webhookTimestamp({ created_at: "2026-11-13T01:00:00Z", data: { object: { order_updated: { updated_at: "2026-11-13T00:59:00Z" } } } })).toBe("2026-11-13T00:59:00Z");
    expect(webhookTimestamp({ created_at: "2026-11-13T01:00:00Z" })).toBe("2026-11-13T01:00:00Z");
  });
  it("merges pending dates", () => {
    const p = mergePending(mergePending(emptyPending(), { sales: ["2026-11-13"] }), { sales: ["2026-11-12", "2026-11-13"], catalog: true });
    expect(p).toEqual({ sales: ["2026-11-12", "2026-11-13"], labor: [], catalog: true });
  });
  it("collapses dates into ranges", () => {
    expect(dateRuns(["2026-11-13", "2026-11-12", "2026-11-10"])).toEqual([
      { from: "2026-11-10", toExclusive: "2026-11-11" },
      { from: "2026-11-12", toExclusive: "2026-11-14" },
    ]);
  });
});
