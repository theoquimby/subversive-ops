import { describe, expect, it } from "vitest";
import { getHelp, helpFor, searchHelp } from "../content";
import { taps } from "../areas/taps";

describe("tap list help", () => {
  it("has every entry the tap list, beers and setup pages use", () => {
    for (const id of ["taps.list", "taps.beers", "taps.prices", "taps.square", "taps.comingSoon", "taps.tv", "taps.website"]) expect(getHelp(id), id).toBeDefined();
  });
  it("keeps popovers short", () => {
    for (const e of taps) expect(e.body.length, e.id).toBeLessThan(330);
  });
  it("explains putting it on a TV, step by step, for the devices people have", () => {
    const tv = getHelp("taps.tv")!;
    expect(tv.article).toMatch(/1\. /);
    for (const w of ["Fire TV", "Chromecast", "Smart TV", "full screen"]) expect(tv.article, w).toContain(w);
    expect(searchHelp("fire stick").map((e) => e.id)).toContain("taps.tv");
    expect(searchHelp("chromecast").map((e) => e.id)).toContain("taps.tv");
  });
  it("documents the website snippet and the JSON feed", () => {
    const w = getHelp("taps.website")!;
    expect(w.article).toContain("<iframe");
    expect(w.article).toContain("/api/public/taps");
    expect(searchHelp("embed").map((e) => e.id)).toContain("taps.website");
  });
  it("lets staff read the tap list but not the manager setup", () => {
    const staff = helpFor("STAFF").map((e) => e.id);
    expect(staff).toContain("taps.list");
    expect(staff).not.toContain("taps.tv");
  });
});
