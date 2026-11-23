import { describe, expect, it } from "vitest";
import { countAge, gapStory, type GapRow } from "../varianceStory";

const row = (name: string, cost: number, over: Partial<GapRow> = {}): GapRow => ({ name, cost, cause: cost > 0 ? "over" : "under", dish: null, group: "food", ...over });
const totals = { sales: 4000, theoreticalCost: 500, actualCost: 615, wasteCost: 0 };

describe("gapStory", () => {
  it("names the money and where half of it went, with the one thing to do", () => {
    const s = gapStory({ ...totals, unexplainedCost: 115, rows: [row("Burger bun", 58, { dish: "Burger" }), row("Fries", 40), row("Tomato", 17)] });
    expect(s.headline).toBe("$115 of stock went missing, about half of it Burger bun");
    expect(s.lead?.name).toBe("Burger bun");
    expect(s.action).toBe("Weigh a few portions of Burger and log waste as it happens.");
    expect(s.line).toBe("By the recipes, $4,000 of sales should have used $500 of stock (12.5%). $615 went out (15.4%), and none was logged as waste.");
  });

  it("takes one tone for the whole finding, and it's never green when stock went missing", () => {
    const small = gapStory({ ...totals, actualCost: 530, unexplainedCost: 30, rows: [row("Burger bun", 30)] });
    expect(small.tone).toBe("neutral");
    const big = gapStory({ ...totals, unexplainedCost: 115, rows: [row("Burger bun", 115)] });
    expect(big.tone).toBe("bad");
  });

  it("doesn't name an ingredient when the gap is spread out", () => {
    const s = gapStory({ ...totals, unexplainedCost: 100, rows: [row("A", 25), row("B", 25), row("C", 25), row("D", 25)] });
    expect(s.headline).toBe("$100 of stock went missing");
    expect(s.lead).toBeNull();
  });

  it("asks about pours for a drink, and about the link for stock nothing sold uses", () => {
    expect(gapStory({ ...totals, unexplainedCost: 80, rows: [row("IPA keg", 80, { group: "beverage", dish: "IPA pint" })] }).action).toBe("Check pour sizes on IPA pint, and ring in comps and staff drinks.");
    expect(gapStory({ ...totals, unexplainedCost: 80, rows: [row("Fryer oil", 80, { cause: "unsold" })] }).action).toMatch(/^Fryer oil went out but nothing sold uses it/);
  });

  it("points at deliveries when less went out than the recipes say", () => {
    const s = gapStory({ ...totals, actualCost: 400, unexplainedCost: -100, rows: [row("Ground beef", -80), row("Tomato", -20)] });
    expect(s.headline).toBe("$100 less went out than the recipes say, most of it Ground beef");
    expect(s.action).toBe("Check every delivery of Ground beef was received on Ordering, then recount it.");
  });

  it("says when there's nothing to chase", () => {
    const s = gapStory({ ...totals, actualCost: 505, unexplainedCost: 5, rows: [] });
    expect(s.headline).toBe("Stock matches the recipes");
  });
});

describe("countAge", () => {
  it("says how old the last count is, and calls a week stale", () => {
    expect(countAge(0)).toEqual({ words: "today", stale: false });
    expect(countAge(1).words).toBe("yesterday");
    expect(countAge(9)).toEqual({ words: "9 days ago", stale: true });
  });
});
