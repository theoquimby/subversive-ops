import { describe, expect, it } from "vitest";
import { addDays, weekday } from "../dates";
import { MIN_LINK_DAYS, ols, salesLink, type LinkDay } from "../webStats";
import { webFindings } from "../webFindings";

/** Deterministic noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** Weekends busy for both sales and clicks; `beta` = true effect of one extra click on log sales. */
function days(n: number, beta: number, seed = 1): LinkDay[] {
  const r = rng(seed);
  const out: LinkDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays("2026-01-05", i);
    const wd = weekday(date);
    if (wd === 2) continue; // closed Tuesdays
    const busy = wd === 5 || wd === 6 ? 1 : 0;
    const actions = Math.max(0, Math.round(8 + busy * 10 + normal(r) * 4));
    const logSales = Math.log(2500) + busy * 0.6 + i * 0.001 + beta * (actions - (8 + busy * 10)) + normal(r) * 0.12;
    out.push({ date, sales: Math.exp(logSales), actions, event: i % 37 === 0 });
  }
  return out;
}

describe("ols", () => {
  it("recovers a known line", () => {
    const X = Array.from({ length: 50 }, (_, i) => [1, i]);
    const y = X.map(([, x]) => 3 + 2 * x);
    const f = ols(X, y)!;
    expect(f.beta[0]).toBeCloseTo(3, 6);
    expect(f.beta[1]).toBeCloseTo(2, 6);
  });
  it("refuses a singular design", () => {
    expect(ols([[1, 1], [1, 1], [1, 1]], [1, 2, 3])).toBeNull();
  });
});

describe("website actions vs sales: guardrails", () => {
  it("says nothing with too little history", () => {
    const l = salesLink(days(40, 0.02), "direction clicks");
    expect(l.verdict).toBe("thin");
    expect(l.n).toBeLessThan(MIN_LINK_DAYS);
    expect(l.effect).toBeNull();
  });
  it("does not mistake the weekend pattern for a link (no real effect)", () => {
    // Weekends have more clicks AND more sales, but clicks add nothing beyond the weekday.
    const l = salesLink(days(200, 0, 7), "direction clicks");
    expect(l.verdict).toBe("unclear");
    expect(l.sentence).toMatch(/No clear link/);
  });
  it("finds a real link when there is one, with a range, and never says 'caused'", () => {
    const l = salesLink(days(200, 0.02, 3), "direction clicks");
    expect(l.verdict).toBe("real");
    expect(l.effect!.mid).toBeGreaterThan(0.05);
    expect(l.effect!.low).toBeGreaterThan(0);
    expect(l.effect!.low).toBeLessThan(l.effect!.mid);
    expect(l.sentence).toMatch(/more sales/);
    expect(l.sentence).toMatch(/isn't proof/);
    expect(l.sentence).not.toMatch(/\b(drives|drove|led to|thanks to|because of)\b/);
  });
  it("leaves event days and closed days out", () => {
    const d = days(120, 0.02, 5);
    const l = salesLink([...d, { date: "2026-06-01", sales: 0, actions: 50 }, { date: "2026-06-02", sales: 90000, actions: 90, event: true }]);
    expect(l.n).toBe(d.filter((x) => !x.event).length);
  });
  it("needs real variation in the actions", () => {
    const flat = days(150, 0).map((d) => ({ ...d, actions: 0 }));
    expect(salesLink(flat).verdict).toBe("thin");
  });
});

describe("website findings for the Insights feed", () => {
  it("says which source sends the direction clicks, only with enough clicks", () => {
    const f = webFindings({
      directionsBySource: [
        { source: "google-maps", count: 48 },
        { source: "google", count: 20 },
        { source: "instagram", count: 12 },
      ],
      sources: [],
      total: { sessions: 2000, converted: 200 },
      link: null,
    });
    expect(f).toHaveLength(1);
    expect(f[0].title).toBe("Google Maps sends 60% of your website's direction clicks");
    expect(f[0].kind).toBe("web.directions.source");
    expect(webFindings({ directionsBySource: [{ source: "google-maps", count: 10 }], sources: [], total: { sessions: 10, converted: 1 }, link: null })).toHaveLength(0);
  });
  it("flags a big source that clearly underperforms, never direct", () => {
    const f = webFindings({
      directionsBySource: [],
      sources: [
        { source: "direct", sessions: 900, converted: 10 },
        { source: "instagram", sessions: 500, converted: 10 },
      ],
      total: { sessions: 2000, converted: 300 },
      link: null,
    });
    expect(f.map((x) => x.kind)).toEqual(["web.source.weak"]);
    expect(f[0].title).toMatch(/Instagram/);
  });
  it("only mentions sales when the link is real", () => {
    const real = salesLink(days(200, 0.02, 3));
    const unclear = salesLink(days(200, 0, 7));
    const base = { directionsBySource: [], sources: [], total: { sessions: 0, converted: 0 } };
    expect(webFindings({ ...base, link: real }).map((x) => x.kind)).toEqual(["web.sales.link"]);
    expect(webFindings({ ...base, link: unclear })).toHaveLength(0);
  });
});
