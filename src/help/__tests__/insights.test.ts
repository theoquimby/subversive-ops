import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getHelp } from "../content";
import { getTour, tourForPath } from "../tours";

const dir = path.join(__dirname, "../../app/(app)/insights");
const source = readdirSync(dir)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => readFileSync(path.join(dir, f), "utf8"))
  .join("\n");

describe("Insights Lab help", () => {
  it("has an entry for every help zone, tip and section on the page", () => {
    const ids = new Set([...source.matchAll(/(?:id|help)="(insights\.[a-zA-Z.]+)"/g)].map((m) => m[1]));
    for (const m of source.matchAll(/help: "(insights\.[a-zA-Z.]+)"/g)) ids.add(m[1]);
    expect(ids.size).toBeGreaterThan(8);
    for (const id of ids) expect(getHelp(id), id).toBeDefined();
  });

  it("points every tour step at something on the page", () => {
    const tour = getTour("insights")!;
    expect(tour).toBeDefined();
    expect(tourForPath("/insights")?.id).toBe("insights");
    for (const s of tour.steps) if (s.target) expect(source, s.target).toContain(`data-tour="${s.target}"`);
  });

  it("explains in plain English (no model names or statistics jargon)", () => {
    for (const id of ["insights.page", "insights.hero", "insights.queue", "insights.rating", "insights.range", "insights.story", "insights.lab", "insights.forecast", "insights.price", "insights.menu"]) {
      const e = getHelp(id)!;
      expect(`${e.body} ${e.article ?? ""}`, id).not.toMatch(/sarimax|z-score|kasavana|elasticity|regression|newsvendor/i);
    }
  });
});
