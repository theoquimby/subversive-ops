import { describe, expect, it } from "vitest";
import { areaFor, isActive, MANAGER_NAV, navItemFor } from "@/lib/areas";
import { AREAS, getHelp, helpFor, helpForPath, searchHelp } from "../content";
import { online } from "../areas/online";

describe("online help", () => {
  it("has every entry the two pages use", () => {
    for (const id of ["online.page", "online.found", "online.next", "online.look", "online.reviews", "online.searches", "online.google", "online.google.views", "online.google.actions", "online.google.keywords", "online.google.connection"]) expect(getHelp(id), id).toBeDefined();
    expect(AREAS.some((a) => a.id === "online")).toBe(true);
  });
  it("keeps popovers short and in plain words", () => {
    for (const e of online) {
      expect(e.body.length, e.id).toBeLessThan(330);
      expect(e.body, e.id).not.toMatch(/impressions|CTR\b/);
    }
  });
  it("explains the waiting state and where each number lives", () => {
    expect(getHelp("online.google")!.article).toMatch(/Waiting on Google's approval/);
    expect(getHelp("online.page")!.article).toMatch(/Where each number lives/);
  });
  it("is findable, manager-only and offered on its pages", () => {
    expect(searchHelp("google listing").map((e) => e.id)).toContain("online.google");
    expect(helpFor("STAFF").some((e) => e.area === "online")).toBe(false);
    expect(helpForPath("/online").map((e) => e.id)).toContain("online.page");
    expect(helpForPath("/online/google")[0].id).toBe("online.google");
  });
});

describe("the Online menu group", () => {
  const group = MANAGER_NAV.find((g) => g.title === "Online")!;
  it("sits after Numbers and lists the four pages", () => {
    const titles = MANAGER_NAV.map((g) => g.title);
    expect(titles.indexOf("Online")).toBe(titles.indexOf("Numbers") + 1);
    expect(group.items.map((i) => [i.label, i.href])).toEqual([["Overview", "/online"], ["Website", "/website"], ["Google listing", "/online/google"], ["Reviews", "/reviews"]]);
    expect(group.items.every((i) => i.area === "online")).toBe(true);
  });
  it("keeps Website's pages under it, and nothing left behind in Numbers", () => {
    expect(group.items.find((i) => i.href === "/website")!.children!.map((c) => c.href)).toContain("/website/analytics");
    const numbers = MANAGER_NAV.find((g) => g.title === "Numbers")!.items.map((i) => i.href);
    expect(numbers).not.toContain("/website");
    expect(numbers).not.toContain("/reviews");
  });
  it("gives every page under it the Online hue", () => {
    for (const p of ["/online", "/online/google", "/website", "/website/analytics", "/website/analytics/google", "/reviews"]) expect(areaFor(p), p).toBe("online");
    expect(areaFor("/insights")).toBe("numbers");
  });
  it("lights the most specific page, and names the overview for the phone top bar", () => {
    expect(isActive("/online", "/online")).toBe(true);
    expect(isActive("/online/google", "/online")).toBe(false);
    expect(isActive("/online/google", "/online/google")).toBe(true);
    expect(navItemFor("/online/google")!.label).toBe("Google listing");
    expect(navItemFor("/online")!.heading).toBe("Online");
  });
});
