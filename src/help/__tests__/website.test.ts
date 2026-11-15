import { describe, expect, it } from "vitest";
import { website } from "../areas/website";
import { getHelp } from "../content";
import { getTour, tourForPath } from "../tours";

describe("website help", () => {
  it("has short popovers and links that resolve", () => {
    for (const e of website) {
      expect(e.body.length, e.id).toBeLessThan(330);
      for (const r of e.related ?? []) expect(getHelp(r), `${e.id} → ${r}`).toBeDefined();
    }
  });
  it("has a tour mapped to the hub", () => {
    expect(getTour("website")?.steps.length).toBeGreaterThan(4);
    expect(tourForPath("/website/menu")?.id).toBe("website");
  });
});
