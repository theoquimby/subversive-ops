import { describe, expect, it } from "vitest";
import { menuStory, type DishCost } from "../menuStory";

const dish = (name: string, foodCostPct: number | null, over: Partial<DishCost> = {}): DishCost => ({ name, foodCostPct, target: 0.3, price: 15, cost: foodCostPct == null ? null : foodCostPct * 15, ...over });

describe("menuStory", () => {
  it("names the dishes that cost the most to plate when all are within target", () => {
    const s = menuStory([dish("Fries", 0.18), dish("Burger", 0.29), dish("Soft pretzel", 0.27), dish("Special", null)], { needWork: 0 });
    expect(s.tone).toBe("good");
    expect(s.headline).toBe("Burger and soft pretzel cost the most to plate");
    expect(s.line).toMatch(/^Every dish is within its target\. Burger at 29%, Soft pretzel at 27%/);
    expect(s.named).toEqual(["Burger", "Soft pretzel"]);
    expect(s.ranked.map((d) => d.name)).toEqual(["Burger", "Soft pretzel", "Fries"]);
    expect(s.line).toContain("1 without a price isn't counted.");
  });

  it("leads with what's over target, and says what price brings it back", () => {
    const s = menuStory([dish("Burger", 0.36, { cost: 5.4 }), dish("Fries", 0.31), dish("Salad", 0.2)], { needWork: 2 });
    expect(s.tone).toBe("bad");
    expect(s.over).toBe(2);
    expect(s.headline).toBe("2 dishes cost more to plate than their target");
    expect(s.line).toContain("Burger and fries run over. Burger is at 36% against a 30% target.");
    expect(s.line).toContain("2 recipes need ingredients or prices");
    expect(s.action).toBe("Raise Burger to about $18 or trim its portion to bring it back to target.");
  });

  it("says when nothing can be costed yet", () => {
    const s = menuStory([dish("Special", null)], { needWork: 1 });
    expect(s.tone).toBe("unknown");
    expect(s.average).toBeNull();
  });
});
