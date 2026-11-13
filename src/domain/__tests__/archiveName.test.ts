import { describe, expect, it } from "vitest";
import { archivedLabel, archivedName, baseName } from "../archiveName";

describe("archived names", () => {
  it("round-trips a readable suffix", () => {
    const n = archivedName("Butter", "Nov 13");
    expect(n).toBe("Butter · archived Nov 13");
    expect(baseName(n)).toBe("Butter");
    expect(archivedLabel(n)).toBe("Nov 13");
    expect(baseName(archivedName("Butter", "Nov 13", 2))).toBe("Butter");
    expect(archivedLabel(archivedName("Butter", "Nov 13", 2))).toBe("Nov 13");
  });
  it("understands the legacy timestamp form", () => {
    expect(baseName("Butter (archived 1794000000000)")).toBe("Butter");
    expect(archivedLabel("Butter (archived 1794000000000)")).toBeNull();
  });
});
