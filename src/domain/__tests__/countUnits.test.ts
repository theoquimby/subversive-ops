import { describe, expect, it } from "vitest";
import { describeParts, innerPackText, looksOff, packCount, readParts, sumParts, tidyParts, unitOptions } from "../countUnits";
import { toBase } from "../units";

const GAL = 3785.411784;

describe("packCount / innerPackText", () => {
  it("reads how many pieces a case holds", () => {
    expect(packCount("6/#10")).toBe(6);
    expect(packCount("4/1 GAL")).toBe(4);
    expect(packCount("24/BNCH")).toBe(24);
    expect(packCount("1/25 LB")).toBeNull();
    expect(packCount("200 CT")).toBeNull();
    expect(packCount(null)).toBeNull();
    expect(innerPackText("6/#10")).toBe("#10");
    expect(innerPackText("4/1 GAL")).toBe("1 GAL");
  });
});

describe("unitOptions", () => {
  it("offers the piece inside a case (the surprise Max hit: counted in piece, bought by the case)", () => {
    const o = unitOptions({ base: "ml", countUnit: "piece", conversions: [], products: [{ id: "p", purchaseUnit: "case", packQtyBase: 4 * GAL, packText: "4/1 GAL" }], preferredProductId: "p" });
    expect(o.units[0]).toBe("piece");
    expect(o.units).toContain("case");
    expect(toBase(2, "piece", "ml", o.conversions)).toBeCloseTo(2 * GAL, 3);
    expect(toBase(1, "case", "ml", o.conversions)).toBeCloseTo(4 * GAL, 3);
  });

  it("adds the case when the product is bought by the piece", () => {
    const o = unitOptions({ base: "ml", countUnit: null, conversions: [], products: [{ id: "p", purchaseUnit: "piece", packQtyBase: 5000, packText: "2/5 LT" }], preferredProductId: "p" });
    expect(o.units[0]).toBe("piece");
    expect(toBase(1, "case", "ml", o.conversions)).toBe(10000);
  });

  it("includes packs from every supplier product, not just the preferred one", () => {
    const o = unitOptions({
      base: "g", countUnit: null, conversions: [],
      products: [
        { id: "a", purchaseUnit: "each", packQtyBase: 21.26, packText: ".75 oz" },
        { id: "b", purchaseUnit: "case", packQtyBase: 113.4, packText: "1/4oz" },
      ],
      preferredProductId: "a",
    });
    expect(o.units).toEqual(expect.arrayContaining(["each", "case", "g", "oz", "lb", "kg"]));
  });

  it("keeps two different cases apart: cans and jugs of the same ketchup", () => {
    const o = unitOptions({
      base: "ml", countUnit: null, conversions: [],
      products: [
        { id: "cans", purchaseUnit: "case", packQtyBase: 6 * 3000, packText: "6/#10" },
        { id: "jugs", purchaseUnit: "piece", packQtyBase: 3371.38, packText: "6/114 OZ" },
      ],
      preferredProductId: "cans",
    });
    expect(o.units).toEqual(expect.arrayContaining(["case", "piece", "piece (114 oz)", "case (6/114 oz)"]));
    expect(toBase(1, "piece", "ml", o.conversions)).toBe(3000);
    expect(toBase(1, "piece (114 oz)", "ml", o.conversions)).toBeCloseTo(3371.38, 2);
    expect(o.notes["case (6/114 oz)"]).toContain("6/114 OZ");
  });

  it("never overrides a custom unit the manager set", () => {
    const o = unitOptions({ base: "ml", countUnit: "jug", conversions: [{ unit: "jug", baseQty: 3300 }, { unit: "case", baseQty: 9999 }], products: [{ id: "p", purchaseUnit: "case", packQtyBase: 18000, packText: "6/#10" }], preferredProductId: "p" });
    expect(o.units[0]).toBe("jug");
    expect(toBase(1, "case", "ml", o.conversions)).toBe(9999);
    expect(toBase(1, "case (6/#10)", "ml", o.conversions)).toBe(18000);
  });

  it("offers volume units for a weighed item once a cup weight is known", () => {
    const o = unitOptions({ base: "g", countUnit: null, conversions: [{ unit: "cup", baseQty: 120 }], products: [], preferredProductId: null });
    expect(o.units).toEqual(expect.arrayContaining(["qt", "gal", "tbsp"]));
    expect(o.units).not.toContain("bbl");
    expect(toBase(1, "qt", "g", o.conversions)).toBeCloseTo(480, 0);
  });

  it("reads a density from a pack that gives volume for a weighed item", () => {
    const o = unitOptions({ base: "g", countUnit: null, conversions: [], products: [{ id: "p", purchaseUnit: "case", packQtyBase: 16000, packText: "4/1 GAL" }], preferredProductId: "p" });
    expect(toBase(1, "gal", "g", o.conversions)).toBeCloseTo(4000, 3);
  });

  it("doesn't guess a density from a bare OZ", () => {
    const o = unitOptions({ base: "ml", countUnit: null, conversions: [], products: [{ id: "p", purchaseUnit: "case", packQtyBase: 4000, packText: "12/14 OZ" }], preferredProductId: "p" });
    expect(o.units).not.toContain("lb");
  });

  it("limits staff to the allowed units, default first", () => {
    const o = unitOptions({ base: "g", countUnit: "case", allowed: ["lb", "case", "nonsense"], conversions: [], products: [{ id: "p", purchaseUnit: "case", packQtyBase: 9071.85, packText: "4/5 LB" }], preferredProductId: "p" });
    expect(o.staffUnits).toEqual(["case", "lb"]);
    expect(o.units.length).toBeGreaterThan(2);
  });

  it("starts count-based items in each, not cases of 2500", () => {
    const o = unitOptions({ base: "each", countUnit: null, conversions: [], products: [{ id: "p", purchaseUnit: "case", packQtyBase: 2500, packText: "1/2500 CT" }], preferredProductId: "p" });
    expect(o.units[0]).toBe("each");
    expect(o.units).toContain("case");
  });
});

describe("mixed-unit counts", () => {
  const conv = [{ unit: "jug", baseQty: 3371 }, { unit: "can", baseQty: 3000 }];
  it("adds 2 jugs + 3 cans", () => {
    expect(sumParts([{ qty: 2, unit: "jug" }, { qty: 3, unit: "can" }], "ml", conv)).toBe(2 * 3371 + 9000);
  });
  it("mixes custom and standard units", () => {
    expect(sumParts([{ qty: 1, unit: "jug" }, { qty: 1, unit: "l" }], "ml", conv)).toBe(4371);
  });
  it("refuses negatives and unknown units", () => {
    expect(() => sumParts([{ qty: -1, unit: "jug" }], "ml", conv)).toThrow();
    expect(() => sumParts([{ qty: 1, unit: "lb" }], "ml", conv)).toThrow();
  });
  it("tidies blanks and repeats", () => {
    expect(tidyParts([{ qty: 2, unit: "jug" }, { qty: null, unit: "can" }, { qty: 1, unit: "Jug" }, { qty: 3, unit: "can" }])).toEqual([{ qty: 3, unit: "jug" }, { qty: 3, unit: "can" }]);
    expect(describeParts([{ qty: 2, unit: "jug" }, { qty: 3, unit: "can" }])).toBe("2 jug + 3 can");
  });
  it("reads stored parts safely", () => {
    expect(readParts([{ qty: 2, unit: "jug" }, { bad: 1 }])).toEqual([{ qty: 2, unit: "jug" }]);
    expect(readParts(null)).toBeNull();
    expect(readParts("x")).toBeNull();
  });
});

describe("looksOff", () => {
  it("flags 40 cases when the last count was 2", () => {
    expect(looksOff(40, 2).off).toBe(true);
    expect(looksOff(0.2, 2).off).toBe(true);
  });
  it("lets normal swings and small numbers through", () => {
    expect(looksOff(3, 2).off).toBe(false);
    expect(looksOff(0, 2).off).toBe(false);
    expect(looksOff(5, 1, 6).off).toBe(false);
    expect(looksOff(40, null).off).toBe(false);
  });
});
