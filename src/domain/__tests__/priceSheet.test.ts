import { describe, expect, it } from "vitest";
import { detectMapping, diffPrices, inferPackQty, packTextForUnit, parsePrice, parseRows } from "../priceSheet";

describe("detectMapping", () => {
  it("finds typical distributor columns", () => {
    expect(detectMapping(["Item #", "Description", "Pack/Size", "UOM", "Case Price"])).toEqual({
      sku: "Item #", description: "Description", pack: "Pack/Size", unit: "UOM", price: "Case Price",
    });
  });
});

describe("parsePrice", () => {
  it("handles currency strings", () => {
    expect(parsePrice("$1,234.50")).toBe(1234.5);
    expect(parsePrice(12)).toBe(12);
    expect(parsePrice("n/a")).toBeNull();
  });
});

describe("inferPackQty", () => {
  it("parses common pack strings", () => {
    expect(inferPackQty("6/32 OZ", "g")).toBeCloseTo(6 * 32 * 28.349523125, 4);
    expect(inferPackQty("6/32 OZ", "ml")).toBeCloseTo(6 * 32 * 29.5735295625, 4);
    expect(inferPackQty("4/1 GAL", "ml")).toBeCloseTo(4 * 3785.41, 1);
    expect(inferPackQty("25 LB", "g")).toBeCloseTo(11339.8, 1);
    expect(inferPackQty("200 CT", "each")).toBe(200);
    expect(inferPackQty("6/#10", "g")).toBeNull();
    expect(inferPackQty("25 LB", "ml")).toBeNull();
  });
});

describe("parseRows + diffPrices", () => {
  const mapping = { sku: "Item", description: "Desc", price: "Price", pack: "Pack" };
  const { rows, errors } = parseRows(
    [
      { Item: "1", Desc: "Fries", Price: "$40.00", Pack: "6/5 LB" },
      { Item: "2", Desc: "Ketchup", Price: "22.10", Pack: "6/#10" },
      { Item: "", Desc: "", Price: "" },
      { Item: "3", Desc: "Mayo", Price: "TBD" },
      { Item: "4", Desc: "Buns", Price: "18" },
    ],
    mapping,
  );
  it("parses rows and reports errors", () => {
    expect(rows.map((r) => r.sku)).toEqual(["1", "2", "4"]);
    expect(errors).toEqual([{ row: 5, message: 'Unreadable price "TBD"' }]);
  });
  it("diffs against current prices", () => {
    const d = diffPrices(rows, [
      { sku: "1", description: "Fries", currentPrice: 36 },
      { sku: "2", description: "Ketchup", currentPrice: 22.1 },
      { sku: "9", description: "Old item", currentPrice: 5 },
    ]);
    expect(d.changed[0].changePct).toBeCloseTo(4 / 36);
    expect(d.unchanged.map((r) => r.sku)).toEqual(["2"]);
    expect(d.newProducts.map((r) => r.sku)).toEqual(["4"]);
    expect(d.missing.map((m) => m.sku)).toEqual(["9"]);
  });
});

describe("distributor exports with case and piece rows", () => {
  const mapping = { sku: "Item Code", description: "Item Name", price: "Unit Price", pack: "Pack Size", unit: "UOM" };
  const records = [
    { "Item Name": "DAIRY + EGGS", "Item Code": "", "Unit Price": "" },
    { "Item Name": "Butter Solid Unsalted", "Item Code": "023611", "Pack Size": "36/1 LB", UOM: "Case", "Unit Price": "$93.60" },
    { "Item Name": "Butter Solid Unsalted", "Item Code": "023611", "Pack Size": "36/1 LB", UOM: "Piece", "Unit Price": "$2.60" },
    { "Item Name": "Sanitizer Hard Surface", "Item Code": "770298", "Pack Size": "4/1 GAL", UOM: "Piece", "Unit Price": "$25.94" },
    { "Item Name": "Sanitizer Hard Surface", "Item Code": "770298", "Pack Size": "4/1 GAL", UOM: "Case", "Unit Price": "$103.77" },
  ];
  it("skips section headers and keeps the case row by default", () => {
    const { rows, errors } = parseRows(records, mapping);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.sku, r.purchaseUnit, r.price])).toEqual([["023611", "case", 93.6], ["770298", "case", 103.77]]);
  });
  it("keeps the unit we already buy in", () => {
    const { rows } = parseRows(records, mapping, (sku) => (sku === "023611" ? "piece" : undefined));
    expect(rows.find((r) => r.sku === "023611")).toMatchObject({ purchaseUnit: "piece", price: 2.6 });
  });
  it("sizes a piece as one inner pack", () => {
    expect(packTextForUnit("36/1 LB", "piece")).toBe("1 LB");
    expect(packTextForUnit("36/1 LB", "case")).toBe("36/1 LB");
    expect(packTextForUnit("1/BOX", "piece")).toBe("1/BOX");
  });
});
