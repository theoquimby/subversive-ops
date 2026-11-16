import { describe, expect, it } from "vitest";
import { getHelp, helpFor, searchHelp } from "../content";
import { websiteAnalytics } from "../areas/websiteAnalytics";
import { getTour, tourForPath } from "../tours";

describe("website analytics help", () => {
  it("has every entry the analytics and Google pages use", () => {
    for (const id of ["website.analytics", "website.analytics.funnel", "website.analytics.sources", "website.analytics.salesLink", "website.analytics.google", "website.analytics.googleSetup", "website.analytics.setup", "website.analytics.rate"]) expect(getHelp(id), id).toBeDefined();
  });
  it("keeps popovers short", () => {
    for (const e of websiteAnalytics) expect(e.body.length, e.id).toBeLessThan(330);
  });
  it("is honest about privacy and about the sales link", () => {
    expect(getHelp("website.analytics")!.body).toMatch(/No cookies/);
    expect(getHelp("website.analytics.salesLink")!.body).toMatch(/never that one causes/);
    expect(getHelp("website.analytics.googleSetup")!.article).toMatch(/Basic API Access/);
    expect(getHelp("website.analytics.googleSetup")!.route).toBe("/settings/connections/google");
    expect(getHelp("settings.google")!.article).toMatch(/Waiting on Google/);
  });
  it("is findable and manager-only", () => {
    expect(searchHelp("search console").map((e) => e.id)).toContain("website.analytics.googleSetup");
    expect(searchHelp("utm").map((e) => e.id)).toContain("website.analytics.sources");
    expect(helpFor("STAFF").map((e) => e.id)).not.toContain("website.analytics");
  });
  it("has a short tour for the page", () => {
    const t = getTour("webanalytics")!;
    expect(t.steps.length).toBeGreaterThanOrEqual(4);
    expect(tourForPath("/website/analytics")?.id).toBe("webanalytics");
    for (const s of t.steps) if (s.helpId) expect(getHelp(s.helpId), s.helpId).toBeDefined();
  });
});
