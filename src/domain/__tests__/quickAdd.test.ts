import { describe, expect, it } from "vitest";
import { parseQuickLine, QuickItem } from "../quickAdd";

const items: QuickItem[] = [
  { id: "beef", name: "Ground beef 80/20", units: ["g", "kg", "oz", "lb"] },
  { id: "ched", name: "Cheddar, sliced", units: ["slice", "g", "oz", "lb"] },
  { id: "flour", name: "All-purpose flour", units: ["cup", "g", "kg", "oz", "lb"] },
  { id: "aioli", name: "Garlic aioli", units: ["ml", "tsp", "tbsp", "cup"] },
  { id: "bun", name: "Burger bun", units: ["each", "dozen"] },
];

describe("parseQuickLine", () => {
  it.each([
    ["6 oz ground beef", "beef", 6, "oz"],
    ["6oz beef", "beef", 6, "oz"],
    ["2 slices cheddar", "ched", 2, "slice"],
    ["1 1/2 cups flour", "flour", 1.5, "cup"],
    ["aioli 1 tbsp", "aioli", 1, "tbsp"],
    ["- 1 bun", "bun", 1, "each"],
    ["½ cup of aioli", "aioli", 0.5, "cup"],
    ["beef ground 4 ounces", "beef", 4, "oz"],
  ])("%s", (raw, id, qty, unit) => {
    const p = parseQuickLine(raw, items)!;
    expect(p.item?.id).toBe(id);
    expect(p.qty).toBeCloseTo(qty);
    expect(p.unit).toBe(unit);
  });
  it("defaults qty to 1 and unit to the item's first unit", () => {
    const p = parseQuickLine("burger bun", items)!;
    expect([p.qty, p.unit, p.item?.id]).toEqual([1, "each", "bun"]);
  });
});
