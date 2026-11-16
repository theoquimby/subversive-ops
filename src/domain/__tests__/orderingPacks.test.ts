import { describe, expect, it } from "vitest";
import { defaultPack, packOptions, packTradeoff } from "../ordering";

const OZ = { unit: "fl oz", factor: 29.5735 };
// Bulk ketchup, in ml: a case of 6 #10 cans (≈ 3 l each) vs jugs bought singly (114 fl oz each).
const products = [
  { supplierProductId: "cans", description: "Ketchup Canned", sku: "300601", packText: "6/#10", purchaseUnit: "case", packQtyBase: 18000, unitPrice: 54 },
  { supplierProductId: "jug", description: "Ketchup Jug", sku: "300612", packText: "6/114 OZ", purchaseUnit: "piece", packQtyBase: 3371.4, unitPrice: 11 },
];

describe("packOptions", () => {
  it("prices each pack per base unit and rounds up to whole packs", () => {
    const [cans, jug] = packOptions(5000, products);
    expect(cans.costPerBase).toBeCloseTo(0.003, 5);
    expect(cans.suggestedUnits).toBe(1);
    expect(cans.extraBase).toBe(13000);
    expect(jug.suggestedUnits).toBe(2);
    expect(jug.lineCost).toBe(22);
  });
  it("needs nothing when covered", () => expect(packOptions(0, products)[0].suggestedUnits).toBe(0));
});

describe("defaultPack", () => {
  const opts = packOptions(5000, products);
  it("remembers the last pack ordered", () => expect(defaultPack(opts, "jug", "cans")?.supplierProductId).toBe("jug"));
  it("then the preferred one", () => expect(defaultPack(opts, null, "jug")?.supplierProductId).toBe("jug"));
  it("then the cheapest per unit", () => expect(defaultPack(opts, null, null)?.supplierProductId).toBe("cans"));
});

describe("packTradeoff", () => {
  const opts = packOptions(5000, products);
  it("says the case is cheaper but a full case", () => {
    expect(packTradeoff(opts, "jug", OZ)).toBe("case (6/#10) is 8% cheaper per fl oz, but comes as a full case.");
  });
  it("from the case's side, says how much extra it buys", () => {
    expect(packTradeoff(opts, "cans", OZ)).toMatch(/^8% cheaper per fl oz than piece \(6\/114 OZ\), but it's a bigger pack: about 439\.6 fl oz more than needed\.$/);
  });
  it("stays quiet with one pack or no prices", () => {
    expect(packTradeoff(opts.slice(0, 1), "cans", OZ)).toBeNull();
    expect(packTradeoff(packOptions(5000, products.map((p) => ({ ...p, unitPrice: null }))), "cans", OZ)).toBeNull();
  });
});
