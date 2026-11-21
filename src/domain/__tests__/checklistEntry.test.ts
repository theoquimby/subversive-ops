import { describe, expect, it } from "vitest";
import { copyName, splitPastedSteps } from "../checklists";

describe("splitPastedSteps", () => {
  it("makes one step per line", () => {
    expect(splitPastedSteps("Bleach the drains\nWipe the taps\r\nLock the back door")).toEqual(["Bleach the drains", "Wipe the taps", "Lock the back door"]);
  });
  it("drops bullets, numbers, tick boxes and blank lines", () => {
    expect(splitPastedSteps("- Mop\n\n* Sweep\n• Bins out\n1. Count the drawer\n2) Lights off\n[ ] Alarm on\n☐ Doors")).toEqual(["Mop", "Sweep", "Bins out", "Count the drawer", "Lights off", "Alarm on", "Doors"]);
  });
  it("keeps a single line as it is", () => {
    expect(splitPastedSteps("Just one step")).toEqual(["Just one step"]);
  });
  it("keeps steps short and the list sane", () => {
    expect(splitPastedSteps("x".repeat(400))[0]).toHaveLength(160);
    expect(splitPastedSteps(Array.from({ length: 150 }, (_, i) => `Step ${i}`).join("\n"))).toHaveLength(100);
  });
});

describe("copyName", () => {
  it("adds (copy), then counts up", () => {
    expect(copyName("Closing — bar", ["Closing — bar"])).toBe("Closing — bar (copy)");
    expect(copyName("Closing — bar", ["Closing — bar", "Closing — bar (copy)"])).toBe("Closing — bar (copy 2)");
    expect(copyName("Closing — bar (copy)", ["Closing — bar (copy)"])).toBe("Closing — bar (copy 2)");
  });
});
