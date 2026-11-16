import { describe, expect, it } from "vitest";
import { moreLabel, shownCount } from "../lists";

describe("shownCount", () => {
  it("shows everything when the list is short", () => {
    expect(shownCount(0, 8)).toBe(0);
    expect(shownCount(5, 8)).toBe(5);
    expect(shownCount(8, 8)).toBe(8);
  });
  it("never hides just one or two", () => {
    expect(shownCount(9, 8)).toBe(9);
    expect(shownCount(10, 8)).toBe(10);
    expect(shownCount(11, 8)).toBe(8);
    expect(shownCount(11, 8, 0)).toBe(8);
    expect(shownCount(9, 8, 0)).toBe(8);
  });
  it("keeps at least one", () => expect(shownCount(40, 0)).toBe(1));
});

describe("moreLabel", () => {
  it("says how many, with the right noun", () => {
    expect(moreLabel(12)).toBe("Show 12 more");
    expect(moreLabel(1, ["keg", "kegs"])).toBe("Show 1 more keg");
    expect(moreLabel(3, ["keg", "kegs"])).toBe("Show 3 more kegs");
  });
});
