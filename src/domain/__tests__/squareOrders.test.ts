import { describe, expect, it } from "vitest";
import { lineNetCents, lineUnits, type SquareLine } from "../squareOrders";

const m = (amount: number) => ({ amount });

describe("lineNetCents", () => {
  it("is gross minus discounts, before tax and service charges", () => {
    const li: SquareLine = { quantity: "1", gross_sales_money: m(1600), total_discount_money: m(400), total_tax_money: m(96), total_service_charge_money: m(200), total_money: m(1496) };
    expect(lineNetCents(li)).toBe(1200);
  });
  it("falls back to total − tax − service charge without a gross amount", () => {
    expect(lineNetCents({ quantity: "1", total_money: m(1496), total_tax_money: m(96), total_service_charge_money: m(200) })).toBe(1200);
  });
  it("reads return lines' gross_return_money", () => {
    expect(lineNetCents({ quantity: "1", gross_return_money: m(900), total_discount_money: m(0) })).toBe(900);
  });
});

describe("lineUnits", () => {
  it("gives the item its own price and each paid modifier its own when nothing is discounted", () => {
    const li: SquareLine = {
      catalog_object_id: "SANDWICH",
      name: "Grilled Chicken Sandwich",
      variation_name: "Regular",
      quantity: "2",
      variation_total_price_money: m(3200),
      gross_sales_money: m(3600),
      total_discount_money: m(0),
      modifiers: [
        { catalog_object_id: "BACON", name: "Add Bacon", total_price_money: m(400) },
        { catalog_object_id: "SIDE", name: "Side Salad", total_price_money: m(0) },
      ],
    };
    expect(lineUnits(li, 1)).toEqual([
      { squareId: "SANDWICH", name: "Grilled Chicken Sandwich", qty: 2, netCents: 3200 },
      { squareId: "BACON", name: "Add Bacon", qty: 2, netCents: 400 },
      { squareId: "SIDE", name: "Side Salad", qty: 2, netCents: 0 },
    ]);
  });

  it("never makes a comped $0 item with paid add-ons negative", () => {
    // "Sauces & Sides" is $0 with priced modifiers; a 100% comp used to put −$3 on the item.
    const li: SquareLine = {
      catalog_object_id: "SAUCES",
      name: "Sauces & Sides",
      quantity: "1",
      variation_total_price_money: m(0),
      gross_sales_money: m(300),
      total_discount_money: m(300),
      modifiers: [{ catalog_object_id: "AIOLI", name: "Garlic Aioli", total_price_money: m(300) }],
    };
    expect(lineUnits(li, 1).map((u) => u.netCents)).toEqual([0, 0]);
  });

  it("shares a partial discount between the item and its modifiers, adding up to the line", () => {
    const li: SquareLine = {
      catalog_object_id: "SALAD",
      quantity: "1",
      variation_total_price_money: m(1400),
      gross_sales_money: m(2000),
      total_discount_money: m(500),
      modifiers: [{ catalog_object_id: "CHICKEN", name: "Add chicken", total_price_money: m(600) }],
    };
    const units = lineUnits(li, 1);
    expect(units.map((u) => u.netCents)).toEqual([1050, 450]);
    expect(units.reduce((s, u) => s + u.netCents, 0)).toBe(1500);
  });

  it("rounds without losing cents", () => {
    const li: SquareLine = {
      catalog_object_id: "X",
      quantity: "1",
      variation_total_price_money: m(100),
      gross_sales_money: m(300),
      total_discount_money: m(100),
      modifiers: [
        { catalog_object_id: "A", total_price_money: m(100) },
        { catalog_object_id: "B", total_price_money: m(100) },
      ],
    };
    expect(lineUnits(li, 1).reduce((s, u) => s + u.netCents, 0)).toBe(200);
  });

  it("reads return_modifiers on return lines and makes everything negative", () => {
    const li: SquareLine = {
      catalog_object_id: "BURGER",
      name: "Burger",
      quantity: "1",
      variation_total_price_money: m(1500),
      gross_return_money: m(1700),
      total_discount_money: m(0),
      return_modifiers: [{ catalog_object_id: "CHEESE", name: "Add cheddar", total_price_money: m(200) }],
    };
    expect(lineUnits(li, -1)).toEqual([
      { squareId: "BURGER", name: "Burger", qty: -1, netCents: -1500 },
      { squareId: "CHEESE", name: "Add cheddar", qty: -1, netCents: -200 },
    ]);
  });

  it("multiplies modifier quantity, and a 'no cheese' (quantity 0) counts nothing", () => {
    const li: SquareLine = {
      catalog_object_id: "B",
      quantity: "3",
      gross_sales_money: m(3000),
      modifiers: [
        { catalog_object_id: "EXTRA", quantity: "2", total_price_money: m(0) },
        { catalog_object_id: "NONE", quantity: "0", total_price_money: m(0) },
      ],
    };
    expect(lineUnits(li, 1).map((u) => u.qty)).toEqual([3, 6, 0]);
  });

  it("skips the item part of a custom amount but keeps catalog modifiers", () => {
    const li: SquareLine = { name: "Custom", quantity: "1", gross_sales_money: m(500), modifiers: [{ catalog_object_id: "MOD", total_price_money: m(100) }] };
    expect(lineUnits(li, 1)).toEqual([{ squareId: "MOD", name: "Modifier", qty: 1, netCents: 100 }]);
  });
});
