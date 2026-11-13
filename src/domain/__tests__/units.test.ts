import { describe, expect, it } from "vitest";
import { formatBase, toBase, UnitError } from "../units";

describe("toBase", () => {
  it("converts standard units within a dimension", () => {
    expect(toBase(1, "lb", "g")).toBeCloseTo(453.592, 3);
    expect(toBase(2, "Tbsp", "ml")).toBeCloseTo(29.5735, 3);
    expect(toBase(1, "dozen", "each")).toBe(12);
  });
  it("prefers ingredient-specific conversions", () => {
    expect(toBase(2, "slice", "g", [{ unit: "slice", baseQty: 21 }])).toBe(42);
    expect(toBase(1, "cup", "g", [{ unit: "cup", baseQty: 120 }])).toBe(120);
  });
  it("refuses cross-dimension conversions without a custom unit", () => {
    expect(() => toBase(1, "cup", "g")).toThrow(UnitError);
    expect(() => toBase(1, "handful", "g")).toThrow(/Unknown unit/);
  });
  it("formats base quantities", () => {
    expect(formatBase(1500, "g")).toBe("1.5 kg");
    expect(formatBase(250, "ml")).toBe("250 ml");
  });
});
