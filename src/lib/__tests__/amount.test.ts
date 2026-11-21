import { describe, expect, it } from "vitest";
import { parseAmount } from "../amount";

describe("parseAmount", () => {
  it.each([
    ["12", 12],
    ["12.50", 12.5],
    ["$12.50", 12.5],
    [" $ 1,200 ", 1200],
    ["1,200.75", 1200.75],
    ["12.5k", 12500],
    ["2K", 2000],
    ["1/2", 0.5],
    ["1 1/2", 1.5],
    ["½", 0.5],
    ["1½", 1.5],
    ["-3", -3],
    ["(40)", -40],
    ["30%", 30],
    [".75", 0.75],
  ])("%s → %s", (text, n) => {
    expect(parseAmount(text)).toBeCloseTo(n);
  });

  it.each(["", "  ", "abc", "1/0", "12..5", "$", "1,2,3x"])("%s → null", (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});
