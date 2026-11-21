import { describe, expect, it } from "vitest";
import { autoLinkPlan, type AutoCandidate, type LinkedSibling } from "../autoLink";

const cand = (name: string, extra: Partial<AutoCandidate> = {}): AutoCandidate => ({ squareId: name, name, modifier: false, kind: "food", price: 13, sales30: 100, best: null, touched: false, ...extra });
const linked: LinkedSibling[] = [
  { name: "Wings (6) · Buffalo", modifier: false, price: 13, recipeId: "w6", recipeName: "Wings (6)" },
  { name: "Wings (6) · Barbecue", modifier: false, price: 13, recipeId: "w6", recipeName: "Wings (6)" },
  { name: "Festbier · Full Pour", modifier: false, price: 8, recipeId: "fb16", recipeName: "Festbier, 16 oz" },
  { name: "Giant Pretzel · The Full Hookup - Full Pour", modifier: false, price: 20, recipeId: "pz", recipeName: "Pretzel platter" },
  { name: "Burger · Beef", modifier: false, price: 18, recipeId: "beef", recipeName: "Classic Burger" },
  { name: "Burger · Chicken", modifier: false, price: 18, recipeId: "chix", recipeName: "Chicken Sandwich" },
];

describe("linking without a button", () => {
  it("links another flavour of an item already linked", () => {
    const plan = autoLinkPlan([cand("Wings (6) · Cajun"), cand("Wings (6) · Lemon Pepper", { price: 14 })], linked);
    expect(plan).toEqual([
      { squareId: "Wings (6) · Cajun", name: "Wings (6) · Cajun", recipeId: "w6", recipeName: "Wings (6)", why: "sibling", like: "Wings (6) · Buffalo", sales30: 100 },
      { squareId: "Wings (6) · Lemon Pepper", name: "Wings (6) · Lemon Pepper", recipeId: "w6", recipeName: "Wings (6)", why: "sibling", like: "Wings (6) · Buffalo", sales30: 100 },
    ]);
  });

  it("never follows a sibling of another size, at a far-off price, or when siblings disagree", () => {
    // A half pour is a different size from the full pour (and beer isn't linked to recipes here anyway).
    expect(autoLinkPlan([cand("Festbier · Half Pour (9 oz)", { kind: "drink", price: 5 })], linked)).toEqual([]);
    // Twice the price isn't the same dish.
    expect(autoLinkPlan([cand("Wings (6) · Truffle", { price: 26 })], linked)).toEqual([]);
    // Beef and chicken burgers are linked to different recipes: a new option is anyone's guess.
    expect(autoLinkPlan([cand("Burger · Impossible", { price: 18 })], linked)).toEqual([]);
  });

  it("links a sure match only when it passes the Sure matches test and is very sure", () => {
    const sure = cand("Greek Salad", { price: 16, best: { recipeId: "gs", recipeName: "Greek Salad", confidence: 1, safe: true } });
    const likely = cand("Wing Wednesday Special (10) wings · Buffalo", { best: { recipeId: "w10", recipeName: "Wings (10)", confidence: 0.63, safe: false } });
    const offCost = cand("Fries", { best: { recipeId: "f", recipeName: "Fries", confidence: 0.95, safe: false } });
    const justHigh = cand("Side Salad", { best: { recipeId: "ss", recipeName: "Side salad", confidence: 0.86, safe: true } });
    expect(autoLinkPlan([sure, likely, offCost, justHigh], linked).map((p) => [p.squareId, p.why])).toEqual([["Greek Salad", "sure"]]);
  });

  it("leaves alone anything a person has decided, and things that aren't recipes", () => {
    const best = { recipeId: "gs", recipeName: "Greek Salad", confidence: 1, safe: true };
    expect(autoLinkPlan([cand("Greek Salad", { best, touched: true }), cand("Wings (6) · Cajun", { touched: true })], linked)).toEqual([]);
    for (const kind of ["beer", "packaged", "retail", "notSales"] as const) expect(autoLinkPlan([cand("Greek Salad", { best, kind })], linked)).toEqual([]);
  });

  it("matches siblings as items or add-ons, not across", () => {
    expect(autoLinkPlan([cand("Wings (6) · Cajun", { modifier: true })], linked)).toEqual([]);
  });
});
