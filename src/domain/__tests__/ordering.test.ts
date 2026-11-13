import { describe, expect, it } from "vitest";
import { estimateOnHand, suggestLine } from "../ordering";

const product = { supplierProductId: "p", ingredientId: "i", ingredientName: "Fries", description: "Fries 6/5 lb", purchaseUnit: "case", packQtyBase: 13607.77, unitPrice: 42, safetyPct: 0.1 };

describe("suggestLine", () => {
  it("orders whole packs to cover the window", () => {
    const s = suggestLine(product, { onHandNow: 10000, usageUntilDelivery: 6000, usageDuringCover: 20000, incomingBeforeDelivery: 0 });
    // need 22000, projected 4000 → shortfall 18000 → 2 cases
    expect(s.suggestedUnits).toBe(2);
    expect(s.lineCost).toBe(84);
    expect(s.status).toBe("order");
  });
  it("reports covered when stock is enough", () => {
    const s = suggestLine(product, { onHandNow: 50000, usageUntilDelivery: 1000, usageDuringCover: 5000, incomingBeforeDelivery: 0 });
    expect(s.suggestedUnits).toBe(0);
    expect(s.status).toBe("covered");
  });
  it("won't guess for never-counted items", () => {
    const s = suggestLine(product, { onHandNow: 0, onHandKnown: false, usageUntilDelivery: 100, usageDuringCover: 500, incomingBeforeDelivery: 0 });
    expect(s.status).toBe("needs-count");
    expect(s.suggestedUnits).toBe(0);
  });
  it("needs setup without a pack size", () => {
    expect(suggestLine({ ...product, packQtyBase: null }, { onHandNow: 0, usageUntilDelivery: 0, usageDuringCover: 1, incomingBeforeDelivery: 0 }).status).toBe("needs-setup");
  });
});

describe("estimateOnHand", () => {
  it("rolls the last count forward and never goes negative", () => {
    expect(estimateOnHand({ lastCountQty: 100, receivedSinceCount: 50, usageSinceCount: 30, wasteSinceCount: 5 }).qty).toBe(115);
    expect(estimateOnHand({ lastCountQty: 10, receivedSinceCount: 0, usageSinceCount: 30, wasteSinceCount: 0 }).qty).toBe(0);
  });
});

import { cutoffRule, daysOfCover, daysOfCoverDaily, hoursUntil, nextCutoff, shouldAutoDraft } from "../ordering";
describe("runs out before delivery", () => {
  it("flags red when stock plus open orders won't last until the truck", () => {
    const s = suggestLine(product, { onHandNow: 2000, usageUntilDelivery: 6000, usageDuringCover: 20000, incomingBeforeDelivery: 1000, daysUntilDelivery: 3, coverDays: 4 });
    expect(s.status).toBe("runs-out");
    expect(s.suggestedUnits).toBeGreaterThan(0);
    expect(s.daysOfCover).toBeCloseTo(2000 / (26000 / 7));
    expect(s.note).toMatch(/Runs out/);
  });
  it("is not raised when an open order bridges the gap", () => {
    const s = suggestLine(product, { onHandNow: 2000, usageUntilDelivery: 6000, usageDuringCover: 20000, incomingBeforeDelivery: 5000 });
    expect(s.status).toBe("order");
  });
  it("is never raised for uncounted items", () => {
    expect(suggestLine(product, { onHandNow: 0, onHandKnown: false, usageUntilDelivery: 100, usageDuringCover: 100, incomingBeforeDelivery: 0 }).status).toBe("needs-count");
  });
});

describe("par-level fallback", () => {
  it("orders up to the minimum on hand when no recipe uses the item", () => {
    const s = suggestLine({ ...product, packQtyBase: 100 }, { onHandNow: 30, usageUntilDelivery: 0, usageDuringCover: 0, incomingBeforeDelivery: 0, parLevel: 250 });
    expect(s.byPar).toBe(true);
    expect(s.suggestedUnits).toBe(3); // 220 short → 3 packs of 100
    expect(s.daysOfCover).toBeNull();
  });
  it("ignores the par when forecasts drive the item", () => {
    const s = suggestLine({ ...product, packQtyBase: 100 }, { onHandNow: 30, usageUntilDelivery: 10, usageDuringCover: 10, incomingBeforeDelivery: 0, parLevel: 1000 });
    expect(s.byPar).toBe(false);
    expect(s.suggestedUnits).toBe(0);
  });
});

describe("daysOfCover", () => {
  it("divides stock by average daily use", () => {
    expect(daysOfCover(100, 70, 7)).toBe(10);
    expect(daysOfCover(100, 0, 7)).toBeNull();
  });
  it("follows the daily forecast when given", () => {
    // 10/day weekdays, 40 on the weekend: 55 covers two quiet days, then 35 of the 40 on day 3.
    expect(daysOfCoverDaily(55, [10, 10, 40, 40, 10])).toBeCloseTo(2.875);
    expect(daysOfCoverDaily(200, [10, 10])).toBeCloseTo(2 + 180 / 10);
    expect(daysOfCoverDaily(5, [0, 0])).toBeNull();
  });
});

describe("order cutoffs", () => {
  // Mon + Thu deliveries, order by 2pm the day before.
  const rule = cutoffRule({ time: "14:00" }, 1);
  it("defaults days-before to lead time and validates the time", () => {
    expect(cutoffRule({ time: "25:00" }, 2)).toEqual({ time: "14:00", daysBefore: 2, autoDraft: true });
  });
  it("finds the next delivery whose cutoff is still open", () => {
    // Sun 2026-11-15 at 09:00 → Monday's cutoff is Sun 14:00, still open.
    expect(nextCutoff([1, 4], rule, "2026-11-15", "09:00")).toEqual({ deliveryDate: "2026-11-16", cutoffDate: "2026-11-15", cutoffTime: "14:00" });
    // Sun at 15:00 → missed Monday; next is Thursday (cutoff Wed).
    expect(nextCutoff([1, 4], rule, "2026-11-15", "15:00")?.deliveryDate).toBe("2026-11-19");
    expect(nextCutoff([], rule, "2026-11-15", "15:00")).toBeNull();
  });
  it("drafts once the cutoff is within the window and nothing's on order", () => {
    expect(hoursUntil("2026-11-14", "07:00", "2026-11-15", "14:00")).toBe(31);
    expect(shouldAutoDraft({ rule, hoursToCutoff: 31, hasOrderForDelivery: false })).toBe(true);
    expect(shouldAutoDraft({ rule, hoursToCutoff: 31, hasOrderForDelivery: true })).toBe(false);
    expect(shouldAutoDraft({ rule, hoursToCutoff: 60, hasOrderForDelivery: false })).toBe(false);
    expect(shouldAutoDraft({ rule: { ...rule, autoDraft: false }, hoursToCutoff: 5, hasOrderForDelivery: false })).toBe(false);
  });
});
