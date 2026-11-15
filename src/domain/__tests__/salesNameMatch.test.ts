import { describe, expect, it } from "vitest";
import { matchSaleNames, nameScore, nameTokens } from "../salesNameMatch";

// Max's menu recipes and real Square item names.
const recipes = [
  "Classic Burger", "Impossible Classic", "Lil Burger", "Lil Burger with Fries", "Mushroom & Swiss Burger", "Impossible Mushroom & Swiss",
  "Bacon Barbecue Burger", "Wings (6)", "Wings (10)", "Chicken Tenders", "Bavarian Pretzel", "Caesar Salad", "Grilled Chicken",
  "Buffalo Chicken Sandwich", "Buffalo Chicken Salad", "Side of Garlic Aioli", "Side of Vegan Garlic Aioli", "Side of Subversive Sauce", "Impossible Vegan Burger",
].map((name, i) => ({ id: `r${i}`, name }));
const match = (sale: string) => matchSaleNames([sale], recipes).get(sale)?.recipeName ?? null;

describe("sale name → recipe", () => {
  it("tokenizes plainly", () => {
    expect(nameTokens("Lil' Burger · Beef")).toEqual(["lil", "burger", "beef"]);
    expect(nameTokens("Wings (6) · Buffalo")).toEqual(["wing", "6", "buffalo"]);
  });

  it("matches the names Square uses", () => {
    expect(match("Classic Smash Burger")).toBe("Classic Burger");
    expect(match("Impossible Classic Burger")).toBe("Impossible Classic");
    expect(match("Lil' Burger · Beef")).toBe("Lil Burger");
    expect(match("Mushroom + Swiss Burger")).toBe("Mushroom & Swiss Burger");
    expect(match("Impossible Mushroom + Swiss Burger")).toBe("Impossible Mushroom & Swiss");
    expect(match("Bacon Barbecue Smash Burger")).toBe("Bacon Barbecue Burger");
    expect(match("Wings (6) · Buffalo")).toBe("Wings (6)");
    expect(match("Bavarian Pretzel Sticks")).toBe("Bavarian Pretzel");
    expect(match("Chicken Caesar Salad")).toBe("Caesar Salad");
    expect(match("Grilled Chicken Sandwich")).toBe("Grilled Chicken");
    expect(match("Buffalo Chicken Salad")).toBe("Buffalo Chicken Salad");
    expect(match("Garlic Aioli")).toBe("Side of Garlic Aioli");
    expect(match("Subversive Sauce")).toBe("Side of Subversive Sauce");
    expect(match("Vegan Impossible Burger")).toBe("Impossible Vegan Burger");
  });

  it("leaves out drinks, instructions and near misses", () => {
    expect(match("Festbier · Full Pour")).toBeNull();
    expect(match("No pickles")).toBeNull();
    expect(match("Add Bacon to Burger")).toBeNull();
    expect(match("The Bavarian Burger")).toBeNull();
    expect(match("Subversive Schnitzel Sandwich")).toBeNull();
    expect(match("Side Salad")).toBeNull();
    expect(match("Side of Grilled Chicken")).toBeNull();
    expect(match("Giant Pretzel · Giant Pretzel")).toBeNull();
  });

  it("scores 0 when a meaningful word is missing on both sides", () => {
    expect(nameScore("Wings (6) · Buffalo", "Wings (10)")).toBe(0);
    expect(nameScore("Chicken Tenders", "Chicken Tenders")).toBe(1);
  });
});
