import { describe, expect, it } from "vitest";
import { buildChecklist, historyFact, menuLinksFact, pricesFact, recipesFact, SETUP_ITEMS } from "../setupChecklist";

describe("setup checklist", () => {
  it("has unique ids, both groups, and essentials first", () => {
    expect(new Set(SETUP_ITEMS.map((i) => i.id)).size).toBe(SETUP_ITEMS.length);
    const groups = SETUP_ITEMS.map((i) => i.group);
    expect(groups.lastIndexOf("essentials")).toBeLessThan(groups.indexOf("nice"));
  });

  it("counts done items per group and points at the next essential", () => {
    const c = buildChecklist({ square: { done: true }, history: { done: true }, ai: { done: true } });
    expect(c.essentials.done).toBe(2);
    expect(c.nice.done).toBe(1);
    expect(c.essentialsDone).toBe(false);
    expect(c.next?.id).toBe("suppliers");
  });

  it("moves on to nice-to-haves once the essentials are done", () => {
    const facts = Object.fromEntries(SETUP_ITEMS.filter((i) => i.group === "essentials").map((i) => [i.id, { done: true }]));
    const c = buildChecklist(facts);
    expect(c.essentialsDone).toBe(true);
    expect(c.next?.group).toBe("nice");
  });

  it("leaves out items whose page hasn't landed", () => {
    const c = buildChecklist({}, (r) => !r.startsWith("/website"));
    expect(c.items.some((i) => i.id === "website" || i.id === "google")).toBe(false);
    expect(c.items.some((i) => i.id === "square")).toBe(true);
  });

  it("calls menu links done at 80% and history done at a season or a finished import", () => {
    expect(menuLinksFact(0, 0).done).toBe(false);
    expect(menuLinksFact(7, 10)).toEqual({ done: false, detail: "7 of 10 linked" });
    expect(menuLinksFact(8, 10).done).toBe(true);
    expect(historyFact(false, 30).done).toBe(false);
    expect(historyFact(false, 120).done).toBe(true);
    expect(historyFact(true, 0)).toEqual({ done: true, detail: undefined });
  });

  it("walks Square → suppliers → prices → recipes → links, in that order", () => {
    const order = SETUP_ITEMS.map((i) => i.id);
    expect(order.indexOf("square")).toBeLessThan(order.indexOf("suppliers"));
    expect(order.indexOf("suppliers")).toBeLessThan(order.indexOf("prices"));
    expect(order.indexOf("prices")).toBeLessThan(order.indexOf("recipes"));
    expect(order.indexOf("recipes")).toBeLessThan(order.indexOf("menuLinks"));
  });

  it("calls prices done when most recipe ingredients are priced, or on the first document before recipes", () => {
    expect(pricesFact({ usedInRecipes: 0, priced: 0, documents: 0 })).toEqual({ done: false, detail: undefined });
    expect(pricesFact({ usedInRecipes: 0, priced: 0, documents: 1 }).done).toBe(true);
    expect(pricesFact({ usedInRecipes: 10, priced: 7, documents: 3 })).toEqual({ done: false, detail: "7 of 10 recipe ingredients priced" });
    expect(pricesFact({ usedInRecipes: 10, priced: 8, documents: 3 }).done).toBe(true);
  });

  it("calls recipes done at a handful", () => {
    expect(recipesFact(0)).toEqual({ done: false, detail: undefined });
    expect(recipesFact(4).done).toBe(false);
    expect(recipesFact(5)).toEqual({ done: true, detail: "5 recipes with ingredients" });
  });
});
