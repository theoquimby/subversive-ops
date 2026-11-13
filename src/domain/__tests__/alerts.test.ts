import { describe, expect, it } from "vitest";
import { DEFAULT_SPIKE_THRESHOLD, invoiceAlertDue, isBadReview, newSpikes, parseSentKeys, parseSpikeThreshold, ratingTrend, spikeKey } from "../alerts";

describe("invoice alerts", () => {
  it("alerts once per issue status", () => {
    expect(invoiceAlertDue(null, "PRICE_ISSUE")).toBe(true);
    expect(invoiceAlertDue("PRICE_ISSUE", "PRICE_ISSUE")).toBe(false);
    expect(invoiceAlertDue("PRICE_ISSUE", "PRICE_AND_QTY")).toBe(true);
    expect(invoiceAlertDue(null, "MATCHED")).toBe(false);
    expect(invoiceAlertDue(null, "NEEDS_REVIEW")).toBe(false);
    expect(invoiceAlertDue("QTY_ISSUE", "APPROVED")).toBe(false);
  });
});

describe("price spikes", () => {
  const moves = [
    { productId: "a", changePct: 0.12, date: "2026-11-10" },
    { productId: "b", changePct: 0.08, date: "2026-11-11" },
    { productId: "c", changePct: 0.05, date: "2026-11-11" },
    { productId: "d", changePct: -0.2, date: "2026-11-11" },
  ];
  it("keeps increases at or over the threshold not yet sent", () => {
    expect(newSpikes(moves, 0.08, new Set()).map((m) => m.productId)).toEqual(["a", "b"]);
    expect(newSpikes(moves, 0.08, new Set([spikeKey(moves[0])])).map((m) => m.productId)).toEqual(["b"]);
    expect(newSpikes(moves, 0.04, new Set()).map((m) => m.productId)).toEqual(["a", "b", "c"]);
  });
  it("re-alerts the same product for a later price date", () => {
    expect(newSpikes([{ productId: "a", changePct: 0.1, date: "2026-11-12" }], 0.08, new Set(["a@2026-11-10"]))).toHaveLength(1);
  });
  it("parses the threshold defensively", () => {
    expect(parseSpikeThreshold("0.15")).toBe(0.15);
    expect(parseSpikeThreshold(undefined)).toBe(DEFAULT_SPIKE_THRESHOLD);
    expect(parseSpikeThreshold("")).toBe(DEFAULT_SPIKE_THRESHOLD);
    expect(parseSpikeThreshold("-1")).toBe(DEFAULT_SPIKE_THRESHOLD);
    expect(parseSpikeThreshold("abc")).toBe(DEFAULT_SPIKE_THRESHOLD);
  });
  it("prunes old sent keys and ignores junk", () => {
    const raw = JSON.stringify(["a@2026-11-10", "b@2026-01-01", 5, "nonsense"]);
    expect(parseSentKeys(raw, "2026-11-13")).toEqual(["a@2026-11-10"]);
    expect(parseSentKeys("{bad", "2026-11-13")).toEqual([]);
  });
});

describe("reviews", () => {
  it("flags 1–2 star reviews", () => {
    expect(isBadReview(1)).toBe(true);
    expect(isBadReview(2)).toBe(true);
    expect(isBadReview(3)).toBe(false);
    expect(isBadReview(0)).toBe(false);
  });
  it("averages the last 30 days against the 30 before", () => {
    const r = ratingTrend(
      [
        { rating: 5, date: "2026-11-12" },
        { rating: 3, date: "2026-10-20" },
        { rating: 4, date: "2026-10-10" }, // previous window
        { rating: 2, date: "2026-08-01" }, // out of both
      ],
      "2026-11-13",
    );
    expect(r).toEqual({ avg: 4, count: 2, prevAvg: 4, delta: 0 });
    expect(ratingTrend([], "2026-11-13")).toEqual({ avg: null, count: 0, prevAvg: null, delta: null });
  });
});
