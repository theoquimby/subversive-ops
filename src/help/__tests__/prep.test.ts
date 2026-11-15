import { describe, expect, it } from "vitest";
import { canFollowHelpLink, getHelp, helpFor, helpForPath } from "../content";
import { prep } from "../areas/prep";
import { getTour, tourForPath } from "../tours";

describe("prep help", () => {
  it("keeps every popover short and in the prep area", () => {
    for (const e of prep) {
      expect(e.area, e.id).toBe("prep");
      expect(e.body.length, e.id).toBeLessThan(330);
      expect(e.draft, e.id).toBeFalsy();
    }
  });

  it("lets kitchen staff read the list help and take the tour, not the setup", () => {
    const staff = new Set(helpFor("STAFF").map((e) => e.id));
    expect(staff.has("prep.page")).toBe(true);
    expect(staff.has("prep.onHand")).toBe(true);
    expect(staff.has("prep.setup")).toBe(false);
    expect(canFollowHelpLink("/prep", "STAFF")).toBe(true);
    expect(canFollowHelpLink("/help?tour=prep", "STAFF")).toBe(true);
    expect(getTour("prep")?.audience).toBe("all");
  });

  it("maps the pages", () => {
    expect(tourForPath("/prep")?.id).toBe("prep");
    expect(tourForPath("/prep/setup")?.id).toBe("prep");
    expect(helpForPath("/prep").map((e) => e.id)).toContain("prep.page");
    expect(helpForPath("/prep/abc123").map((e) => e.id)).toContain("prep.page");
    expect(getHelp("prep.setup.par")?.route).toBe("/prep/setup");
  });
});
