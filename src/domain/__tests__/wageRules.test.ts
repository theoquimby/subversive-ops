import { describe, expect, it } from "vitest";
import { applyWageTable, NY_UPSTATE_WAGES, reviewDue, wageRulesOn } from "../wageRules";

describe("NY wage table", () => {
  it("switches on January 1", () => {
    expect(wageRulesOn("2025-12-31").current?.minimumWage).toBe(15.5);
    expect(wageRulesOn("2026-01-01").current?.minimumWage).toBe(16);
    expect(wageRulesOn("2026-11-13").next?.effective).toBe("2027-01-01");
    expect(wageRulesOn("2027-01-01").current?.status).toBe("estimated");
  });

  it("returns nothing before the table starts", () => {
    expect(wageRulesOn("2020-06-01").current).toBeNull();
    const rules = { minimumWage: 12, tippedMinimumWage: 8, other: 1 };
    expect(applyWageTable(rules, "2020-06-01")).toEqual(rules);
  });

  it("applies the year's rates and keeps other fields", () => {
    expect(applyWageTable({ minimumWage: 0, tippedMinimumWage: 0, other: 1 }, "2025-07-04")).toEqual({ minimumWage: 15.5, tippedMinimumWage: 10.35, other: 1 });
  });

  it("is sorted and future rows are marked", () => {
    const eff = NY_UPSTATE_WAGES.map((v) => v.effective);
    expect([...eff].sort()).toEqual(eff);
    for (const v of NY_UPSTATE_WAGES) if (v.effective >= "2027-01-01") expect(v.status).toBe("estimated");
  });

  it("knows when a review is due", () => {
    expect(reviewDue(null, "2026-11-13").due).toBe(true);
    expect(reviewDue("2025-12-01", "2026-11-13").reason).toMatch(/changed/);
    expect(reviewDue("2026-02-01", "2026-11-13").due).toBe(false);
    expect(reviewDue("2026-02-01", "2027-03-01").due).toBe(true);
  });
});
