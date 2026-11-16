import { describe, expect, it } from "vitest";
import { dropPosition } from "../positionLinks";

describe("dropPosition", () => {
  it("takes the id out and says whether anything changed", () => {
    expect(dropPosition(["bar", "kitchen"], "bar")).toEqual({ ids: ["kitchen"], changed: true, emptied: false });
    expect(dropPosition(["kitchen"], "bar")).toEqual({ ids: ["kitchen"], changed: false, emptied: false });
  });
  it("says when it was the only one", () => {
    expect(dropPosition(["bar"], "bar")).toEqual({ ids: [], changed: true, emptied: true });
    expect(dropPosition([], "bar")).toEqual({ ids: [], changed: false, emptied: false });
  });
});
