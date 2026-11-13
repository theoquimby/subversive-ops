import { describe, expect, it } from "vitest";
import { calibrateYield, matchBeer, ozBetween, ozByBeerDay, pourOz, shareFromHours, splitItemName, tapEstimate, unmatchedDraftNames } from "../kegPours";
import { kegOz } from "../kegs";

const beers = [
  { id: "nectar", name: "New York Nectar", squareNames: ["New York Nectar*"] },
  { id: "lager", name: "Golden Lager", squareNames: [] },
];

describe("Square item names", () => {
  it("splits item and pour", () => {
    expect(splitItemName("New York Nectar* · Full Pour")).toEqual({ base: "New York Nectar*", variation: "Full Pour" });
    expect(splitItemName("Golden Lager (Half pour)")).toEqual({ base: "Golden Lager", variation: "Half pour" });
    expect(splitItemName("Dark IPA - Large")).toEqual({ base: "Dark IPA", variation: "Large" });
    expect(splitItemName("Burger (No bun)")).toEqual({ base: "Burger (No bun)", variation: null });
  });
  it("knows pour sizes", () => {
    expect(pourOz("Full Pour")).toBe(16);
    expect(pourOz("Half Pour")).toBe(8);
    expect(pourOz("10 oz")).toBe(10);
    expect(pourOz("Taster")).toBe(4);
    expect(pourOz("Growler fill")).toBe(64);
    expect(pourOz("Crowler")).toBe(32);
    expect(pourOz("4-pack cans")).toBe(0);
    expect(pourOz(null)).toBe(16);
    expect(pourOz("Full Pour", { overrides: { "full pour": 14 } })).toBe(14);
    expect(pourOz("Whatever", { recipeOz: 12 })).toBe(12);
  });
  it("matches beers by Square name or own name, loosely", () => {
    expect(matchBeer("New York Nectar*", beers)).toBe("nectar");
    expect(matchBeer("golden  lager", beers)).toBe("lager");
    expect(matchBeer("Pilsner", beers)).toBeNull();
  });
  it("adds up ounces per beer per day", () => {
    const m = ozByBeerDay([
      { date: "2026-11-10", squareId: "a", name: "New York Nectar* · Full Pour", qty: 10 },
      { date: "2026-11-10", squareId: "b", name: "New York Nectar* · Half Pour", qty: 4 },
      { date: "2026-11-11", squareId: "c", name: "Golden Lager (Pint)", qty: 3 },
      { date: "2026-11-11", squareId: "d", name: "Fries", qty: 30 },
    ], beers);
    expect(m.get("nectar")?.get("2026-11-10")).toBe(192);
    expect(m.get("lager")?.get("2026-11-11")).toBe(48);
    expect(m.size).toBe(2);
  });
  it("suggests unmatched draft names", () => {
    expect(unmatchedDraftNames([{ name: "Pilsner · Full Pour", qty: 5 }, { name: "Pilsner · Half Pour", qty: 2 }, { name: "Fries", qty: 9 }, { name: "Golden Lager · Pint", qty: 1 }], beers)).toEqual([{ base: "Pilsner", qty: 7 }]);
  });
});

describe("poured since tapped", () => {
  const daily = new Map([["2026-11-10", 200], ["2026-11-11", 300], ["2026-11-12", 100]]);
  const even = (_d: string, a: number, b: number) => shareFromHours(undefined, a, b);
  it("counts whole days and a share of the first", () => {
    expect(ozBetween(daily, { date: "2026-11-10", hour: 18 }, null, even)).toBeCloseTo(200 * (6 / 24) + 300 + 100);
  });
  it("stops at the end time", () => {
    expect(ozBetween(daily, { date: "2026-11-10", hour: 0 }, { date: "2026-11-11", hour: 12 }, even)).toBeCloseTo(200 + 150);
  });
  it("uses hourly sales for the share", () => {
    const hours = Array.from({ length: 24 }, (_, h) => (h >= 16 && h < 22 ? 10 : 0));
    expect(shareFromHours(hours, 19, 24)).toBeCloseTo(0.5);
    expect(shareFromHours(hours, 0, 16)).toBe(0);
  });
});

describe("yield and what's left", () => {
  it("assumes 90% until kegs kick", () => {
    const y = calibrateYield([]);
    expect(y.measured).toBe(false);
    expect(y.yield).toBe(0.9);
    expect(Math.round(y.pintsPerHalf)).toBe(112);
  });
  it("learns from kicks and ignores odd ones", () => {
    const half = kegOz("half");
    const y = calibrateYield([{ kegOz: half, soldOz: half * 0.82 }, { kegOz: half, soldOz: half * 0.84 }, { kegOz: half, soldOz: half * 0.86 }, { kegOz: half, soldOz: half * 0.1 }]);
    expect(y.samples).toBe(3);
    expect(y.yield).toBeCloseTo(0.84, 2);
    expect(Math.round(y.pintsPerHalf)).toBe(104);
  });
  it("estimates % and days left", () => {
    const e = tapEstimate(1000, 0.9, 450, 90);
    expect(e.pctLeft).toBeCloseTo(0.5);
    expect(e.daysLeft).toBeCloseTo(5);
    expect(e.overdue).toBe(false);
    expect(tapEstimate(1000, 0.9, 1000, null)).toMatchObject({ pctLeft: 0, daysLeft: null, overdue: true });
  });
});
