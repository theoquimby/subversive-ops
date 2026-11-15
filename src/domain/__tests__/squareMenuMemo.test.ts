import { describe, expect, it } from "vitest";
import { matchConfidence } from "../squareMenu";

// matchConfidence keeps small memos of each name's tokens and self-score (the Sales page
// compares every unlinked Square item with every recipe). They must never change an answer.
describe("matchConfidence memo", () => {
  const pairs: [string, string][] = [
    ["Fish Tacos", "fish taco"],
    ["Smash Burger · Double", "Double Smash Burger"],
    ["IPA 16oz", "Hazy IPA"],
    ["", "Burger"],
    ["The Reg", "Burger"],
    ["Fries", "Truffle Fries"],
  ];

  it("gives the same score on repeat calls and in either order of first use", () => {
    const first = pairs.map(([a, b]) => matchConfidence(a, b));
    const again = pairs.map(([a, b]) => matchConfidence(a, b));
    expect(again).toEqual(first);
    // Warm the memo with thousands of other names (forcing a clear), then ask again.
    for (let i = 0; i < 25_000; i++) matchConfidence(`Item ${i}`, "Burger");
    expect(pairs.map(([a, b]) => matchConfidence(a, b))).toEqual(first);
  });

  it("scores names with no usable words as no match", () => {
    expect(matchConfidence("", "Burger")).toBe(0);
    expect(matchConfidence("the & of", "Burger")).toBe(0);
  });
});
