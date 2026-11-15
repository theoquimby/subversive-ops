import { describe, expect, it } from "vitest";
import { canFollowHelpLink, getHelp, helpFor, helpForPath } from "../content";
import { staffHome } from "../areas/staffHome";
import { getTour, toursFor, tourForPath } from "../tours";

describe("staff home help", () => {
  it("keeps every popover short, readable by staff and in the my area", () => {
    for (const e of staffHome) {
      expect(e.area, e.id).toBe("my");
      expect(e.body.length, e.id).toBeLessThan(330);
      expect(e.audience, e.id).toBe("all");
      expect(e.draft, e.id).toBeFalsy();
    }
  });

  it("lets staff read every my.* entry and follow its route", () => {
    const staff = new Set(helpFor("STAFF").map((e) => e.id));
    for (const id of ["my.today", "my.nextShift", "my.todo", "my.quick", "my.setup", "my.me", "my.offline", "my.page", "my.documents", "my.training"]) {
      expect(staff.has(id), id).toBe(true);
      expect(canFollowHelpLink(getHelp(id)!.route ?? "/my", "STAFF"), id).toBe(true);
    }
  });

  it("maps Today, My shifts and Me to their own help and the staff tour", () => {
    expect(helpForPath("/my").map((e) => e.id)).toContain("my.today");
    expect(helpForPath("/my/shifts").map((e) => e.id)).toContain("my.page");
    expect(helpForPath("/my/me").map((e) => e.id)).toContain("my.me");
    expect(tourForPath("/my")?.id).toBe("today");
    expect(tourForPath("/my/shifts")?.id).toBe("today");
  });

  it("has a staff tour that only goes where staff can", () => {
    const t = getTour("today")!;
    expect(t.audience).toBe("all");
    expect(toursFor("STAFF").map((x) => x.id)).toContain("today");
    for (const s of t.steps) if (s.route) expect(canFollowHelpLink(s.route, "STAFF"), s.route).toBe(true);
    for (const s of t.steps) if (s.helpId) expect(getHelp(s.helpId), s.helpId).toBeDefined();
  });
});
