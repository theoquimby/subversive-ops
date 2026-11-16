import { describe, expect, it } from "vitest";
import { alertMode, COUNT_STALE_DAYS, isBrewery, itemNeed, shouldNag, supplierNeed, type ItemNeedInput } from "../orderNeed";

const TODAY = "2026-11-16";
const item = (over: Partial<ItemNeedInput> = {}): ItemNeedInput => ({
  name: "Butter",
  today: TODAY,
  countedOn: "2026-11-10",
  onHandNow: 10_000,
  incoming: 0,
  usageToNext: 2_000,
  usageNextToAfter: 3_000,
  safetyPct: 0.2,
  par: null,
  ...over,
});

describe("itemNeed", () => {
  it("is ok when stock lasts past the delivery after next with its buffer to spare", () => {
    // 10000 − 2000 − 3000 = 5000 left; safety = 20% of 3000 = 600.
    const n = itemNeed(item());
    expect(n.status).toBe("ok");
    expect(n.projected).toBe(5_000);
    expect(n.safety).toBe(600);
  });
  it("is short when it would dip below its safety level before the delivery after next", () => {
    const n = itemNeed(item({ onHandNow: 5_400 }));
    // 5400 − 5000 = 400 < 600.
    expect(n.status).toBe("short");
  });
  it("counts what's already on order", () => {
    expect(itemNeed(item({ onHandNow: 5_400, incoming: 1_000 })).status).toBe("ok");
  });
  it("is short when already below safety with nothing coming", () => {
    expect(itemNeed(item({ onHandNow: 100, usageToNext: 0, usageNextToAfter: 1_000, safetyPct: 0.5 })).status).toBe("short");
  });
  it("uses the par level for items no recipe uses", () => {
    expect(itemNeed(item({ usageToNext: 0, usageNextToAfter: 0, par: 4, onHandNow: 3 })).status).toBe("short");
    expect(itemNeed(item({ usageToNext: 0, usageNextToAfter: 0, par: 4, onHandNow: 4 })).status).toBe("ok");
  });
  it("is unused when nothing uses it and it has no par", () => {
    expect(itemNeed(item({ usageToNext: 0, usageNextToAfter: 0 })).status).toBe("unused");
  });
  it("doesn't guess without a count", () => {
    expect(itemNeed(item({ countedOn: null, onHandNow: 0 })).status).toBe("unknown");
  });
  it(`doesn't trust a count older than ${COUNT_STALE_DAYS} days`, () => {
    expect(itemNeed(item({ countedOn: "2026-10-25", onHandNow: 0 })).status).toBe("unknown"); // 22 days
    expect(itemNeed(item({ countedOn: "2026-10-26", onHandNow: 0 })).status).toBe("short"); // 21 days
    expect(itemNeed(item({ countedOn: "2026-11-10", onHandNow: 0 }), { staleDays: 3 }).status).toBe("unknown");
  });
  it("leaves an unused, uncounted item alone (nothing to know)", () => {
    expect(itemNeed(item({ countedOn: null, usageToNext: 0, usageNextToAfter: 0 })).status).toBe("unused");
  });
});

describe("supplierNeed", () => {
  it("needs an order when any item runs short, naming them", () => {
    const n = supplierNeed([itemNeed(item()), itemNeed(item({ name: "Garlic", onHandNow: 100 }))]);
    expect(n.needs).toBe(true);
    expect(n.short).toEqual(["Garlic"]);
  });
  it("doesn't need one when everything is covered", () => {
    const n = supplierNeed([itemNeed(item()), itemNeed(item({ name: "Oil", usageToNext: 0, usageNextToAfter: 0 }))]);
    expect(n).toMatchObject({ needs: false, short: [], countNeeded: [], checked: 1 });
  });
  it("says a count is needed instead of alerting when stock is unknown", () => {
    const n = supplierNeed([itemNeed(item()), itemNeed(item({ name: "Lemons", countedOn: null }))]);
    expect(n.needs).toBe(false);
    expect(n.countNeeded).toEqual(["Lemons"]);
  });
  it("still alerts for a short item next to an uncounted one", () => {
    const n = supplierNeed([itemNeed(item({ name: "Garlic", onHandNow: 0 })), itemNeed(item({ name: "Lemons", countedOn: null }))]);
    expect(n.needs).toBe(true);
    expect(n.countNeeded).toEqual(["Lemons"]);
  });
});

describe("alertMode and shouldNag", () => {
  it("follows the cadence unless set", () => {
    expect(alertMode("regular", null)).toBe("on");
    expect(alertMode("as_needed", null)).toBe("low");
    expect(alertMode("as_needed", "on")).toBe("on");
    expect(alertMode("regular", "off")).toBe("off");
    expect(alertMode("weird", undefined)).toBe("on");
  });
  it("nags regular suppliers always, as-needed ones only when stock runs short", () => {
    expect(shouldNag("on", null)).toBe(true);
    expect(shouldNag("low", null)).toBe(false);
    expect(shouldNag("low", { needs: false })).toBe(false);
    expect(shouldNag("low", { needs: true })).toBe(true);
    expect(shouldNag("off", { needs: true })).toBe(false);
  });
  it("knows the brewery side", () => {
    expect(isBrewery("brewery")).toBe(true);
    expect(isBrewery("kitchen")).toBe(false);
    expect(isBrewery(null)).toBe(false);
  });
});
