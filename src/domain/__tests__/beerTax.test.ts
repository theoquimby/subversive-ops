import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_SETTINGS, parsePeriod, periodKey, periodOf, previousPeriod, readTaxSettings, returnsDue, worksheet, type Move } from "../beerTax";

const mv = (kind: Move["kind"], gallons: number, beer = "IPA"): Move => ({ date: "2026-10-05", kind, gallons, beerId: beer, beer });

describe("beer tax periods", () => {
  it("finds months, quarters and years", () => {
    expect(periodOf("2026-11-16", "month")).toMatchObject({ start: "2026-11-01", end: "2026-11-30", label: "Nov 2026" });
    expect(periodOf("2026-11-16", "quarter")).toMatchObject({ start: "2026-10-01", end: "2026-12-31", label: "Q4 2026" });
    expect(periodOf("2024-02-10", "month").end).toBe("2024-02-29");
    expect(periodOf("2026-11-16", "year")).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
    expect(previousPeriod(periodOf("2026-01-10", "quarter")).label).toBe("Q4 2025");
  });
  it("round-trips period keys", () => {
    for (const k of ["2026-Q3", "2026-10", "2026"]) expect(periodKey(parsePeriod(k)!)).toBe(k);
    expect(parsePeriod("2026-13")).toBeNull();
    expect(parsePeriod("nope")).toBeNull();
  });
});

describe("beer tax worksheet", () => {
  it("taxes taproom, account and other removals less returns", () => {
    const w = worksheet([mv("packaged", 62), mv("taproom", 31), mv("account", 15.5), mv("removed", 15.5), mv("returned", 0)], DEFAULT_TAX_SETTINGS);
    expect(w.packagedGal).toBe(62);
    expect(w.taxableGal).toBe(62);
    expect(w.taxableBbl).toBe(2);
    expect(w.federalTax).toBe(7);
    expect(w.nyGross).toBeCloseTo(8.68);
    expect(w.nyTax).toBe(0); // small brewer credit covers it
    expect(w.byBeer[0]).toMatchObject({ beer: "IPA", taxable: 62 });
  });
  it("applies the NY credit only to what's left of the yearly gallons", () => {
    const w = worksheet([mv("taproom", 1000)], DEFAULT_TAX_SETTINGS, 499_500);
    expect(w.nyCredit).toBeCloseTo(500 * 0.14);
    expect(w.nyTax).toBeCloseTo(500 * 0.14);
    const off = worksheet([mv("taproom", 100)], { ...DEFAULT_TAX_SETTINGS, nyCredit: false });
    expect(off.nyTax).toBeCloseTo(14);
  });
  it("never goes below zero when more comes back than goes out", () => {
    const w = worksheet([mv("taproom", 10), mv("returned", 20)], DEFAULT_TAX_SETTINGS);
    expect(w.taxableGal).toBe(0);
    expect(w.federalTax).toBe(0);
  });
});

describe("returns due", () => {
  it("lists the last finished period of each return with its state", () => {
    const r = returnsDue("2026-11-16", DEFAULT_TAX_SETTINGS, [{ form: "brop", periodStart: "2026-07-01" }], 10, "2025-01-01");
    const fed = r.filter((x) => x.form === "federal");
    // Q3 was due Oct 14 and isn't filed → overdue; nothing older is shown unless it's overdue too
    expect(fed.map((x) => x.period.label)).toContain("Q3 2026");
    expect(fed.find((x) => x.period.label === "Q3 2026")?.state).toBe("overdue");
    expect(r.find((x) => x.form === "brop" && x.period.label === "Q3 2026")?.state).toBe("filed");
    const ny = r.find((x) => x.form === "ny" && x.period.label === "Oct 2026");
    expect(ny).toMatchObject({ due: "2026-11-20", state: "due-soon" });
  });
  it("only chases an older period once filings are tracked", () => {
    const fresh = returnsDue("2026-11-16", DEFAULT_TAX_SETTINGS, [], 10, "2025-01-01").filter((x) => x.form === "ny");
    expect(fresh.map((x) => x.period.label)).toEqual(["Oct 2026"]);
    const tracked = returnsDue("2026-11-16", DEFAULT_TAX_SETTINGS, [{ form: "ny", periodStart: "2026-08-01" }], 10, "2025-01-01").filter((x) => x.form === "ny");
    expect(tracked.map((x) => x.period.label)).toEqual(["Sep 2026", "Oct 2026"]);
  });
  it("asks for nothing when there's no keg history at all", () => {
    expect(returnsDue("2026-11-16", DEFAULT_TAX_SETTINGS, [], 10, null)).toEqual([]);
  });
  it("leaves out periods from before there was any history", () => {
    const r = returnsDue("2026-11-16", DEFAULT_TAX_SETTINGS, [], 10, "2026-10-24");
    expect(r.map((x) => `${x.form} ${x.period.label}`)).toEqual(["ny Oct 2026"]);
  });
  it("reads settings safely", () => {
    expect(readTaxSettings(null)).toEqual(DEFAULT_TAX_SETTINGS);
    expect(readTaxSettings("{bad").federalRate).toBe(3.5);
    const s = readTaxSettings(JSON.stringify({ federalRate: 16, freq: { ny: "quarter", federal: "bogus" } }));
    expect(s.federalRate).toBe(16);
    expect(s.freq.ny).toBe("quarter");
    expect(s.freq.federal).toBe("quarter");
  });
});
