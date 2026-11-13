import { describe, expect, it } from "vitest";
import { businessDateOf, businessDateTime } from "../format";

describe("business timestamp formatting", () => {
  // 02:30 UTC on Nov 14 is still the evening of Nov 13 in New York.
  const late = new Date("2026-11-14T02:30:00Z");

  it("uses the business timezone, not UTC", () => {
    expect(businessDateOf(late, "America/New_York")).toBe("2026-11-13");
    expect(businessDateOf(late, "UTC")).toBe("2026-11-14");
    expect(businessDateOf("2026-11-14T02:30:00Z", "America/Los_Angeles")).toBe("2026-11-13");
  });

  it("formats date-times deterministically", () => {
    expect(businessDateTime(late, "America/New_York")).toBe("Nov 13, 9:30pm");
    expect(businessDateTime(new Date("2026-11-13T17:05:00Z"), "America/New_York")).toBe("Nov 13, 12:05pm");
    expect(businessDateTime(new Date("2026-11-13T05:00:00Z"), "America/New_York")).toBe("Nov 13, 12:00am");
  });
});
