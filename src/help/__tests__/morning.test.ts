import { describe, expect, it } from "vitest";
import { canFollowHelpLink, getHelp, helpFor, searchHelp } from "../content";
import { morningBrief } from "../areas/morning";
import { getTour, tourForPath } from "../tours";

describe("morning brief and shift notes help", () => {
  it("has every zone and tip the brief, notes and Overview use", () => {
    for (const id of ["brief.morning", "brief.yesterday", "brief.today", "brief.tonight", "brief.insight", "brief.notes", "brief.wrap", "brief.page", "overview.notes", "notes.page", "notes.composer", "notes.history"]) expect(getHelp(id), id).toBeDefined();
  });
  it("keeps popovers short", () => {
    for (const e of morningBrief) expect(e.body.length, e.id).toBeLessThan(330);
  });
  it("lets staff read about shift notes but not the brief", () => {
    const staff = helpFor("STAFF").map((e) => e.id);
    expect(staff).toContain("notes.page");
    expect(staff).toContain("notes.composer");
    expect(staff).not.toContain("brief.morning");
    expect(canFollowHelpLink("/notes", "STAFF")).toBe(true);
    expect(canFollowHelpLink("/help/notes.page", "STAFF")).toBe(true);
    expect(canFollowHelpLink("/brief", "STAFF")).toBe(false);
  });
  it("is found by the words people use", () => {
    expect(searchHelp("handoff").map((e) => e.id)).toContain("notes.page");
    expect(searchHelp("86").map((e) => e.id)).toContain("notes.page");
    expect(searchHelp("morning").map((e) => e.id)).toContain("brief.morning");
  });
  it("tours the brief and the notes page", () => {
    expect(tourForPath("/brief")?.id).toBe("brief");
    expect(tourForPath("/notes")?.id).toBe("notes");
    expect(getTour("notes")?.audience).toBe("all");
    expect(getTour("overview")!.steps.some((s) => s.target === "overview.notes")).toBe(true);
  });
});
