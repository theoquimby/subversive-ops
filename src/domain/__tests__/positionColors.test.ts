import { describe, expect, it } from "vitest";
import { positionColor } from "../positionColors";

describe("positionColor", () => {
  it("moves positions off the status hues, keeping each one's family", () => {
    expect(positionColor("#dc2626")).toBe("var(--pos-violet)"); // red would read as "bad"
    expect(positionColor("#16a34a")).toBe("var(--pos-aqua)"); // green would read as "good"
    expect(positionColor("#d97706")).toBe("var(--pos-orange)"); // amber
    expect(positionColor("#2563eb")).toBe("var(--pos-blue)");
    expect(positionColor("#7c3aed")).toBe("var(--pos-magenta)");
    expect(positionColor("#db2777")).toBe("var(--pos-magenta)");
  });
  it("gives greys and anything unreadable the magenta slot", () => {
    expect(positionColor("#64748b")).toBe("var(--pos-magenta)");
    expect(positionColor("not a colour")).toBe("var(--pos-magenta)");
    expect(positionColor(null)).toBe("var(--pos-magenta)");
  });
});
