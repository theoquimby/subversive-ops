import { describe, expect, it } from "vitest";
import { AREAS, HELP, getHelp, helpFor, searchHelp } from "../content";
import { TOURS, getTour, tourForPath } from "../tours";

describe("help content", () => {
  it("has unique ids", () => {
    const ids = HELP.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references entries, areas and tours that exist", () => {
    const areas = new Set(AREAS.map((a) => a.id));
    for (const e of HELP) {
      expect(areas.has(e.area), `${e.id} area`).toBe(true);
      for (const r of e.related ?? []) expect(getHelp(r), `${e.id} → related ${r}`).toBeDefined();
      if (e.tour) expect(getTour(e.tour), `${e.id} → tour ${e.tour}`).toBeDefined();
    }
  });

  it("keeps popover text short", () => {
    for (const e of HELP) {
      expect(e.body.length, e.id).toBeLessThan(330);
      expect(e.title.length, e.id).toBeLessThan(60);
    }
  });

  it("marks every upcoming-area entry as draft", () => {
    const upcoming = new Set(AREAS.filter((a) => a.upcoming).map((a) => a.id));
    for (const e of HELP) if (upcoming.has(e.area)) expect(e.draft, e.id).toBe(true);
  });

  it("hides manager-only entries from staff", () => {
    const staff = helpFor("STAFF");
    expect(staff.some((e) => e.id === "count.home")).toBe(true);
    expect(staff.some((e) => e.id === "prices.import")).toBe(false);
  });

  it("finds entries by title, keyword and body", () => {
    expect(searchHelp("yield")[0].id).toBe("ingredients.yield");
    expect(searchHelp("cmd k").map((e) => e.id)).toContain("app.commandBar");
    expect(searchHelp("spread of hours").map((e) => e.id)).toContain("labor.spread");
    expect(searchHelp("zzzzqqq")).toEqual([]);
  });
});

describe("tours", () => {
  it("have unique ids and valid steps", () => {
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    for (const t of TOURS) {
      expect(t.steps.length).toBeGreaterThan(2);
      for (const s of t.steps) {
        if (s.helpId) expect(getHelp(s.helpId), `${t.id}: ${s.title}`).toBeDefined();
        expect(s.target && s.selector, `${t.id}: ${s.title} has both target and selector`).toBeFalsy();
      }
    }
  });

  it("start on a page", () => {
    for (const t of TOURS) expect(t.steps[0].route, t.id).toBeTruthy();
  });

  it("map pages to tours", () => {
    expect(tourForPath("/")?.id).toBe("overview");
    expect(tourForPath("/menu/abc")?.id).toBe("menu");
    expect(tourForPath("/waste")?.id).toBe("counting");
    expect(tourForPath("/settings")).toBeUndefined();
  });
});
