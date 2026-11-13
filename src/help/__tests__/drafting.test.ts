import { describe, expect, it } from "vitest";
import { getHelp, searchHelp } from "../content";
import { drafting } from "../areas/drafting";

describe("recipe drafting help", () => {
  it("has every zone and tip the drafting pages use", () => {
    for (const id of ["menu.drafts", "menu.drafts.intake", "menu.drafts.review", "menu.drafts.beer", "menu.drafts.start"]) expect(getHelp(id), id).toBeDefined();
  });
  it("keeps popovers short and plain", () => {
    for (const e of drafting) {
      expect(e.body.length, e.id).toBeLessThan(330);
      expect(e.body, e.id).not.toMatch(/allergen-free|gluten-free|safe for/i);
    }
  });
  it("is found by the words people use", () => {
    expect(searchHelp("recipe card").map((e) => e.id)).toContain("menu.drafts.intake");
    expect(searchHelp("bbl").map((e) => e.id)).toContain("menu.drafts.beer");
    expect(searchHelp("draft").map((e) => e.id)).toContain("menu.drafts");
  });
});
