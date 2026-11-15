import { describe, expect, it } from "vitest";
import { monthEnd } from "../areas/monthEnd";
import { getArea, getHelp, helpForPath } from "../content";
import { getTour, tourForPath } from "../tours";

describe("month-end help", () => {
  it("covers the page and stays short", () => {
    expect(getArea("accounting")).toBeTruthy();
    for (const id of ["accounting.page", "accounting.stats", "accounting.checklist", "accounting.inventory", "accounting.salesTax", "accounting.tips", "accounting.pack", "accounting.journal"]) {
      const e = getHelp(id);
      expect(e, id).toBeTruthy();
      expect(e!.body.length, id).toBeLessThan(330);
      expect(e!.route, id).toBe("/accounting");
    }
    expect(helpForPath("/accounting").length).toBe(monthEnd.length);
  });

  it("links only to entries that exist", () => {
    for (const e of monthEnd) for (const r of e.related ?? []) expect(getHelp(r), `${e.id} → ${r}`).toBeTruthy();
  });

  it("never states tax rules as fact, and avoids native-UI words and hype", () => {
    const tax = getHelp("accounting.salesTax")!.body;
    expect(tax).toMatch(/settings?/i);
    expect(tax).toMatch(/accountant/i);
    for (const e of monthEnd) expect(`${e.body} ${e.article ?? ""}`, e.id).not.toMatch(/\b(dropdown|checkbox|AI-powered|seamless|leverage|guaranteed)\b/i);
  });

  it("has a short tour that starts on the page", () => {
    const t = getTour("month-end")!;
    expect(t.steps.length).toBeLessThanOrEqual(8);
    expect(t.steps[0].route).toBe("/accounting");
    expect(tourForPath("/accounting")?.id).toBe("month-end");
    for (const s of t.steps) if (s.helpId) expect(getHelp(s.helpId), s.helpId).toBeTruthy();
  });
});
