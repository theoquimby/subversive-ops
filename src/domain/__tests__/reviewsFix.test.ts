import { describe, expect, it } from "vitest";
import { ratingDrop, whatToFixFallback } from "../reviews";

const r = (postedAt: string, rating: number, themes: string[] = [], sentiment: string | null = null) => ({ postedAt, rating, themes, sentiment });

describe("ratingDrop", () => {
  const today = "2026-11-13";
  const base = ["2026-08-01", "2026-08-15", "2026-09-01", "2026-09-20", "2026-10-01", "2026-10-10"].map((d) => r(d, 5));
  it("alerts when the last 30 days slip by 0.3★ or more", () => {
    const recent = [r("2026-10-20", 4, ["service-speed"], "mixed"), r("2026-11-01", 3, ["service-speed", "food"], "negative"), r("2026-11-10", 5)];
    const d = ratingDrop([...base, ...recent], today);
    expect(d.recent).toBe(4);
    expect(d.baseline).toBe(5);
    expect(d.alert).toBe(true);
    expect(d.themes[0]).toBe("service-speed");
  });
  it("stays quiet with too few reviews", () => {
    expect(ratingDrop([...base, r("2026-11-01", 1)], today).alert).toBe(false);
  });
  it("stays quiet when the rating holds", () => {
    expect(ratingDrop([...base, r("2026-11-01", 5), r("2026-11-02", 5), r("2026-11-03", 5), r("2026-11-04", 4)], today).alert).toBe(false);
  });
});

describe("whatToFixFallback", () => {
  it("ranks critical themes, boosts this month's and skips praise-only themes", () => {
    const out = whatToFixFallback({
      themes: [
        { theme: "beer", total: 12, negative: 0, mixed: 0 },
        { theme: "food", total: 5, negative: 2, mixed: 0 },
        { theme: "service-speed", total: 4, negative: 1, mixed: 2 },
        { theme: "cleanliness", total: 1, negative: 1, mixed: 0 },
      ],
      recentThemes: ["service-speed"],
      rootCauses: ["Short-staffed: 20 h on the floor vs 28 h needed."],
    });
    expect(out.map((f) => f.theme)).toEqual(["service-speed", "food", "cleanliness"]);
    expect(out[0].why).toMatch(/Short-staffed/);
    expect(out.every((f) => f.action.length > 20)).toBe(true);
  });
});
