import { describe, expect, it } from "vitest";
import { cleanAreaName, moveArea, orderAreas } from "../storageAreas";

describe("storage areas", () => {
  it("keeps the saved order and adds areas in use after it", () => {
    expect(orderAreas(["Walk-in", "Bar"], ["Freezer", "Bar", "Walk-in", "Basement"])).toEqual(["Walk-in", "Bar", "Basement", "Freezer"]);
  });
  it("drops blanks and case duplicates", () => {
    expect(orderAreas([" Walk-in ", ""], ["walk-in", "Bar"])).toEqual(["Walk-in", "Bar"]);
  });
  it("cleans names", () => {
    expect(cleanAreaName("  Keg   cooler ")).toBe("Keg cooler");
  });
  it("moves an area", () => {
    expect(moveArea(["A", "B", "C"], "C", -1)).toEqual(["A", "C", "B"]);
    expect(moveArea(["A", "B"], "A", -1)).toEqual(["A", "B"]);
  });
});
