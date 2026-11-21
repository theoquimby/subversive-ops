import { describe, expect, it } from "vitest";
import { periodPicks } from "../payroll";

describe("periodPicks", () => {
  it("weekly pay: last week is also the last pay period, so it's one chip", () => {
    expect(periodPicks("2026-11-20", { payPeriod: "WEEKLY", payPeriodAnchor: "" })).toEqual([
      { label: "Last week", hint: "last pay period", from: "2026-11-09", to: "2026-11-15" },
      { label: "This week", hint: "this pay period", from: "2026-11-16", to: "2026-11-22" },
    ]);
  });

  it("every two weeks: last week, this pay period and the last one", () => {
    // Periods run from Monday Nov 9 (anchor), so Nov 20 is in Nov 9 – 22.
    expect(periodPicks("2026-11-20", { payPeriod: "BIWEEKLY", payPeriodAnchor: "2026-11-09" })).toEqual([
      { label: "Last week", from: "2026-11-09", to: "2026-11-15" },
      { label: "This pay period", from: "2026-11-09", to: "2026-11-22" },
      { label: "Last pay period", from: "2026-10-26", to: "2026-11-08" },
    ]);
  });
});
