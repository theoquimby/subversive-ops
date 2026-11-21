import { describe, expect, it } from "vitest";
import { handSku, readHandPrice, typedPrice } from "../manualPrice";
import { looksLikeMisread } from "../priceSheet";
import { copyName, linesLeftOut, leftOutText, prepStubYield } from "../recipeEntry";

describe("readHandPrice", () => {
  const base = { supplier: "Price Chopper", what: "50 lb bag", size: "50", sizeUnit: "lb", price: "$42.50", per: "bag" };
  it("reads a price for a weighed ingredient", () => {
    const r = readHandPrice(base, "Flour", "g", []);
    expect("ok" in r && r.ok).toMatchObject({ supplier: "Price Chopper", packText: "50 lb bag", purchaseUnit: "bag", price: 42.5, description: "Flour, 50 lb bag" });
    expect("ok" in r && r.ok.packQtyBase).toBeCloseTo(50 * 453.59237);
  });
  it("reads amounts the way people type them", () => {
    const r = readHandPrice({ ...base, size: "1 1/2", sizeUnit: "kg", price: "1,200" }, "Flour", "g", []);
    expect("ok" in r && r.ok.packQtyBase).toBeCloseTo(1500);
    expect("ok" in r && r.ok.price).toBe(1200);
  });
  it("uses the ingredient's own units", () => {
    const r = readHandPrice({ ...base, size: "200", sizeUnit: "slice" }, "Cheddar", "g", [{ unit: "slice", baseQty: 21 }]);
    expect("ok" in r && r.ok.packQtyBase).toBe(4200);
  });
  it("fills in what you buy and the unit when left blank", () => {
    const r = readHandPrice({ ...base, what: "", per: "" }, "Flour", "g", []);
    expect("ok" in r && r.ok).toMatchObject({ packText: "50 lb", purchaseUnit: "case", description: "Flour" });
  });
  it.each([
    [{ supplier: "  " }, "supplier"],
    [{ size: "" }, "size"],
    [{ size: "lots" }, "size"],
    [{ size: "0" }, "size"],
    [{ price: "" }, "price"],
    [{ price: "abc" }, "price"],
    [{ price: "-3" }, "price"],
    [{ sizeUnit: "gal" }, "sizeUnit"],
  ])("says what's wrong: %o", (patch, field) => {
    const r = readHandPrice({ ...base, ...patch }, "Flour", "g", []);
    expect("error" in r && r.field).toBe(field);
  });
  it("names the measure when the unit doesn't fit", () => {
    const r = readHandPrice({ ...base, sizeUnit: "gal" }, "Flour", "g", []);
    expect("error" in r && r.error).toMatch(/weight/);
  });
});

describe("handSku", () => {
  it("is stable for an ingredient", () => {
    expect(handSku("ckabc123def456")).toBe("HAND-23DEF456");
  });
});

describe("typedPrice", () => {
  it.each([
    ["", 4, { kind: "blank" }],
    ["  ", null, { kind: "blank" }],
    ["4.00", 4, { kind: "same" }],
    ["$4.50", 4, { kind: "change", price: 4.5 }],
    ["3", null, { kind: "change", price: 3 }],
    ["abc", 4, { kind: "bad" }],
    ["-2", 4, { kind: "bad" }],
  ])("%s (now %s)", (text, now, want) => {
    expect(typedPrice(text, now)).toMatchObject(want);
  });
  it("gives the change against the current price", () => {
    const t = typedPrice("6", 4);
    expect(t.kind === "change" && t.delta).toBeCloseTo(0.5);
  });
});

describe("looksLikeMisread", () => {
  it("flags changes over about 40%", () => {
    expect(looksLikeMisread(0.39)).toBe(false);
    expect(looksLikeMisread(0.41)).toBe(true);
    expect(looksLikeMisread(-0.45)).toBe(true);
    expect(looksLikeMisread(9)).toBe(true);
  });
});

describe("linesLeftOut", () => {
  const l = (ingredientId: string | null, qty: number, subRecipeId: string | null = null) => ({ ingredientId, subRecipeId, qty, unit: "oz" });
  it("finds lines with no item and lines with no amount", () => {
    const out = linesLeftOut([l("a", 2), l(null, 1), l("b", 0), l(null, 0, "r"), l("c", NaN)]);
    expect(out.blank).toHaveLength(1);
    expect(out.noAmount.map((x) => x.ingredientId ?? x.subRecipeId)).toEqual(["b", "r", "c"]);
  });
  it("says it in plain words", () => {
    expect(leftOutText({ blank: [1], noAmount: [] }, [])).toBe("1 line with no item picked will be left out when you save.");
    expect(leftOutText({ blank: [1, 2], noAmount: [3] }, ["Mayo"])).toBe("3 lines will be left out when you save: 2 with no item picked, and Mayo with no amount.");
    expect(leftOutText({ blank: [], noAmount: [1, 2] }, ["Mayo", "Buns"])).toBe("2 lines with no amount will be left out when you save: Mayo and Buns.");
    expect(leftOutText({ blank: [], noAmount: [] }, [])).toBeNull();
  });
});

describe("copyName", () => {
  it("adds (copy), then counts up", () => {
    expect(copyName("Burger", () => false)).toBe("Burger (copy)");
    const taken = new Set(["burger (copy)", "burger (copy 2)"]);
    expect(copyName("Burger", (n) => taken.has(n.toLowerCase()))).toBe("Burger (copy 3)");
  });
  it("copies a copy without stacking", () => {
    expect(copyName("Burger (copy)", (n) => n === "Burger (copy)")).toBe("Burger (copy 2)");
  });
});

describe("prepStubYield", () => {
  it("follows the unit typed, so the line keeps working", () => {
    expect(prepStubYield("tbsp")).toEqual({ yieldQty: 1, yieldUnit: "qt", yieldBase: "ml" });
    expect(prepStubYield("oz")).toEqual({ yieldQty: 1, yieldUnit: "lb", yieldBase: "g" });
    expect(prepStubYield("")).toEqual({ yieldQty: 1, yieldUnit: "each", yieldBase: "each" });
    expect(prepStubYield("slice")).toEqual({ yieldQty: 1, yieldUnit: "each", yieldBase: "each" });
  });
});
