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
