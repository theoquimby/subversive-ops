import { describe, expect, it } from "vitest";
import { BACK_ON_MENU_DAYS, cleanupPlan, isBackOnMenu, type CleanupItem } from "../linkCleanup";

const item = (name: string, kind: CleanupItem["kind"], sales30: number, extra: Partial<CleanupItem> = {}): CleanupItem => ({ squareId: name, name, kind, sales30, sure: false, beer: false, ...extra });

describe("the linking clean-up", () => {
  const items = [
    item("New York Nectar · Full Pour", "beer", 2149, { beer: true }),
    item("Festbier · Full Pour", "beer", 1880, { beer: true }),
    item("Festbier · Half Pour (9 oz)", "beer", 165, { beer: true }),
    item("Greek Salad", "food", 576, { sure: true }),
    item("Wings (6) · Buffalo", "food", 598, { sure: true }),
    item("Indian Ladder Hard Cider", "drink", 1048),
    item("Subversive Schnitzel Sandwich", "food", 860),
    item("Gin and Tonic", "drink", 770),
    item("Festbier | 4 pack 16 oz cans", "packaged", 540),
    item("Gift Card", "notSales", 300),
  ];

  it("puts the steps in order, biggest first, with links to check at the top", () => {
    const p = cleanupPlan({ items, beers: 2, check: { items: 3, dollars: 900 }, total: 20_000, linked: 9_000, skipped: 500 });
    expect(p.steps.map((s) => s.key)).toEqual(["check", "beer", "recipes", "sure", "each", "notSales"]);
    const beer = p.steps.find((s) => s.key === "beer")!;
    expect(beer.title).toBe("Enter what a keg costs for 2 beers");
    expect(beer.dollars).toBe(4194);
    expect(beer.share).toBeCloseTo(4194 / 20_000);
    expect(beer.href).toBe("#beer");
    // A sure match isn't counted again under recipes.
    const recipes = p.steps.find((s) => s.key === "recipes")!;
    expect(recipes.items).toBe(3);
    expect(recipes.detail).toContain("Indian Ladder Hard Cider, Subversive Schnitzel Sandwich and Gin and Tonic");
    expect(p.steps.find((s) => s.key === "sure")!.title).toBe("Accept 2 sure matches");
    expect(p.steps.find((s) => s.key === "each")!.title).toBe("Give 1 can, bottle or merch item a cost each");
    expect(p.steps.find((s) => s.key === "check")!.title).toBe("Check 3 links that may be wrong");
    expect(p.now).toBeCloseTo(0.45);
    expect(p.withSkipped).toBeCloseTo(0.475);
    // Gift cards come out of what counts; everything else gets a cost.
    expect(p.after).toBeCloseTo((9_000 + 500 + 4194 + 1174 + 540 + 2678) / (20_000 - 300));
    expect(p.done).toBe(false);
  });

  it("is done when everything that sold has a cost or is skipped and nothing needs checking", () => {
    const p = cleanupPlan({ items: [], beers: 0, check: { items: 0, dollars: 0 }, total: 10_000, linked: 9_500, skipped: 500 });
    expect(p.steps).toEqual([]);
    expect(p.done).toBe(true);
    expect(p.after).toBe(1);
    expect(cleanupPlan({ items: [], beers: 0, check: { items: 1, dollars: 50 }, total: 10_000, linked: 10_000, skipped: 0 }).done).toBe(false);
  });

  it("brings a skipped special back once it sells most weeks", () => {
    expect(isBackOnMenu(BACK_ON_MENU_DAYS)).toBe(true);
    expect(isBackOnMenu(BACK_ON_MENU_DAYS - 1)).toBe(false);
    expect(isBackOnMenu(0)).toBe(false);
  });

  it("copes with no sales at all", () => {
    const p = cleanupPlan({ items: [item("Pretzel", "food", 0)], beers: 0, check: { items: 0, dollars: 0 }, total: 0, linked: 0, skipped: 0 });
    expect(p.now).toBe(0);
    expect(p.after).toBe(0);
    expect(p.steps[0].share).toBe(0);
  });
});
