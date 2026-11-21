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

  it("with no unit typed, picks one people use: its own (slice), else oz or fl oz, not 1 g or 1 ml", () => {
    expect(parseQuickLine("cheddar", items)!.unit).toBe("slice");
    expect(parseQuickLine("ground beef", items)!.unit).toBe("oz");
    expect(parseQuickLine("mayo", [{ id: "mayo", name: "Mayonnaise", units: ["ml", "l", "tsp", "tbsp", "fl oz", "cup"] }])!.unit).toBe("fl oz");
    // A unit that was typed is kept.
    expect(parseQuickLine("20 g ground beef", items)!.unit).toBe("g");
  });

  it("says when it's only guessing, and offers the next closest", () => {
    // Every word typed is in the name: sure.
    for (const raw of ["6 oz ground beef", "mayo", "2 slices cheddar", "beef ground 4 ounces", "1 bun"]) {
      const list = raw === "mayo" ? [...items, { id: "mayo", name: "Mayonnaise", units: ["ml"] }] : items;
      expect(parseQuickLine(raw, list)!.sure, raw).toBe(true);
    }
    // "brioche bun" isn't a burger bun: shown as a guess, never added without asking.
    const p = parseQuickLine("1 brioche bun", items)!;
    expect(p.item?.id).toBe("bun");
    expect(p.sure).toBe(false);
    expect(p.name).toBe("brioche bun");
    // Nothing close at all.
    const none = parseQuickLine("2 oz pepper jack", items)!;
    expect(none.item).toBeNull();
    expect(none.sure).toBe(false);
    expect(none.name).toBe("pepper jack");
    expect([none.qty, none.unit]).toEqual([2, "oz"]);
  });

  it("never takes plain cider for hard cider", () => {
    const bar = [...items, { id: "hc", name: "Indian Ladder Hard Cider", units: ["ml", "fl oz"] }, { id: "bourbon", name: "Bourbon", units: ["ml", "fl oz"] }];
    const cider = parseQuickLine("4 oz cider", bar)!;
    expect(cider.sure).toBe(false);
    expect(cider.name).toBe("cider");
    expect(parseQuickLine("12 oz hard cider", bar)!).toMatchObject({ sure: true, item: { id: "hc" } });
    expect(parseQuickLine("1.5 oz bourbon", bar)!).toMatchObject({ sure: true, item: { id: "bourbon" } });
  });
});
