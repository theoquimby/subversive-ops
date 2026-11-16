import { describe, expect, it } from "vitest";
import { suggestCountEvery } from "../countEverySuggest";

const h = (pairs: [string, number][]) => pairs.map(([date, qty]) => ({ date, qty }));

describe("suggestCountEvery", () => {
  it("needs a few counts first", () => {
    expect(suggestCountEvery(h([["2026-11-01", 5], ["2026-11-08", 5], ["2026-11-15", 5]]), 1, "2026-11-16")).toBeNull();
  });
  it("takes an item off the sheet when it's the same every time over weeks", () => {
    const r = suggestCountEvery(h([["2026-10-01", 3], ["2026-10-15", 3], ["2026-11-01", 3], ["2026-11-15", 3]]), 100, "2026-11-16");
    expect(r).toEqual({ every: "changes", why: "The same on the last 4 counts" });
  });
  it("doesn't decide 'same' from counts days apart", () => {
    expect(suggestCountEvery(h([["2026-11-10", 3], ["2026-11-11", 3], ["2026-11-12", 3], ["2026-11-13", 3]]), 100, "2026-11-16")).toBeNull();
  });
  it("counts low-value items monthly, but not when they're out", () => {
    const moving = h([["2026-10-01", 4], ["2026-10-15", 2], ["2026-11-01", 5], ["2026-11-15", 3]]);
    expect(suggestCountEvery(moving, 2, "2026-11-16")).toEqual({ every: "monthly", why: "Worth about $6 on the shelf" });
    expect(suggestCountEvery(moving, 50, "2026-11-16")).toBeNull();
    expect(suggestCountEvery(h([["2026-10-01", 4], ["2026-10-15", 2], ["2026-11-01", 5], ["2026-11-15", 0]]), 2, "2026-11-16")).toBeNull();
  });
  it("ignores counts older than the lookback", () => {
    expect(suggestCountEvery(h([["2025-01-01", 3], ["2025-02-01", 3], ["2025-03-01", 3], ["2026-11-01", 3]]), 100, "2026-11-16")).toBeNull();
  });
});
