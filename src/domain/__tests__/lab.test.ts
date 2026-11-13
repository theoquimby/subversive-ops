import { describe, expect, it } from "vitest";
import { emptyFeedState, markFeed, type Opportunity } from "../analytics";
import { buildActions, completeThrough, kindMeta, parseRange, rangeFrom, rootCause, sortActions, stars, storyOf, trackRecord, whatIf, type LabFinding } from "../lab";

const opp = (o: Partial<LabFinding> & Pick<LabFinding, "key" | "kind">): LabFinding => ({ model: "feed", title: o.key, action: "Do it.", monthly: 100, low: 50, high: 150, confidence: 0.5, how: ["Because."], inputs: [], href: "/insights", ...o });

describe("data range", () => {
  it("defaults to 3 years and parses the setting", () => {
    expect(parseRange(null)).toBe("3y");
    expect(parseRange('{"preset":"4y"}')).toBe("4y");
    expect(parseRange('{"preset":"nope"}')).toBe("3y");
    expect(parseRange("not json")).toBe("3y");
  });
  it("never starts before the first sale", () => {
    expect(rangeFrom("12m", "2026-11-13")).toBe("2025-11-13");
    expect(rangeFrom("4y", "2026-11-13", "2024-02-01")).toBe("2024-02-01");
    expect(rangeFrom("all", "2026-11-13", "2019-08-01")).toBe("2019-08-01");
  });
  it("leaves out today and a day whose sync didn't see closing", () => {
    expect(completeThrough("2026-11-13", "2026-11-13")).toBe("2026-11-12");
    expect(completeThrough("2026-11-13", "2026-11-12")).toBe("2026-11-11");
    expect(completeThrough("2026-11-13", null)).toBe("2026-11-12");
  });
});

describe("actions", () => {
  it("merges an hour that loses money and over-staffing on the same part of the day", () => {
    const hours = opp({ key: "feed.hours.5.11", kind: "feed.hours", subject: "5.11", monthly: 355, title: "Saturdays 11am–12pm loses $82/week" });
    const staff = opp({ key: "staffing.over.5.11", kind: "staffing.over", model: "staffing", subject: "5.11", monthly: 240, title: "Saturday 11am–12pm: 2.2 more people than needed" });
    const other = opp({ key: "price.plus1.x", kind: "price.test", subject: "x", monthly: 90 });
    expect(rootCause(hours)).toBe(rootCause(staff));
    const out = buildActions([hours, staff, other], emptyFeedState(), "2026-11-13");
    expect(out).toHaveLength(2);
    const slot = out.find((a) => a.parts.length === 2)!;
    expect(slot.monthly).toBe(355); // the bigger fix, never the sum
    expect(slot.alsoSeen).toEqual([staff.title]);
  });

  it("uses the model's lead and group when sent", () => {
    const a = opp({ key: "a", kind: "staffing.over", group: "slot.3.evening", monthly: 100 });
    const lead = opp({ key: "lab.slot.3", kind: "lab.slot", group: "slot.3.evening", lead: true, monthly: 120, title: "Thursday evening is quiet but fully staffed" });
    const [x] = buildActions([a, lead], emptyFeedState(), "2026-11-13");
    expect(x.title).toBe(lead.title);
    expect(x.key).toBe("g:slot.3.evening");
  });

  it("drops one-off days, good news and tracking notes", () => {
    const out = buildActions(
      [
        opp({ key: "anomaly.labor.2026-11-02", kind: "anomaly.labor" }),
        opp({ key: "feed.follow.wait.x", kind: "feed.follow.wait" }),
        opp({ key: "feed.follow.y", kind: "feed.follow", title: "Since raising the pretzel: +$70 a month" }),
        opp({ key: "feed.follow.z", kind: "feed.follow", title: "Since raising the lager: −$170 a month" }),
      ],
      emptyFeedState(),
      "2026-11-13",
    );
    expect(out.map((a) => a.key)).toEqual(["feed.follow.z"]);
  });

  it("hides what's done, and done on a merged part hides the merged action", () => {
    const hours = opp({ key: "feed.hours.5.11", kind: "feed.hours", subject: "5.11" });
    const staff = opp({ key: "staffing.over.5.12", kind: "staffing.over", subject: "5.12" });
    const st = markFeed(emptyFeedState(), hours, "done", "2026-11-10");
    expect(buildActions([hours, staff], st, "2026-11-13")).toHaveLength(0);
  });

  it("fills area, effort and a story from the kind", () => {
    const [a] = buildActions([opp({ key: "feed.price.creep.Sysco", kind: "feed.price.creep", monthly: 300, confidence: 0.45 })], emptyFeedState(), "2026-11-13");
    expect(a.area).toBe("costs");
    expect(a.effort).toBe("medium");
    expect(a.vector).toBe("save");
    expect(a.story.todo).toBe("Do it.");
    expect(kindMeta("menu.reprice").area).toBe("menu");
    expect(storyOf(opp({ key: "k", kind: "x", story: { now: "N", why: "W", todo: "T", gain: "G" } })).now).toBe("N");
  });

  it("rates money, certainty and effort into 1–5 stars", () => {
    expect(stars(600, 0.7, "easy")).toBe(5);
    expect(stars(40, 0.2, "hard")).toBe(1);
    expect(stars(150, 0.5, "medium")).toBe(3);
  });

  it("sorts and filters by vector and area", () => {
    const xs = [
      { key: "a", stars: 3, score: 10, value: 300, vector: "save" as const, effort: "hard" as const, confidence: 0.3, area: "hours" as const },
      { key: "b", stars: 4, score: 20, value: 100, vector: "earn" as const, effort: "easy" as const, confidence: 0.8, area: "menu" as const },
      { key: "c", stars: 2, score: 5, value: 50, vector: "save" as const, effort: "easy" as const, confidence: 0.6, area: "staffing" as const },
    ];
    expect(sortActions(xs, "best").map((x) => x.key)).toEqual(["b", "a", "c"]);
    expect(sortActions(xs, "saved").map((x) => x.key)).toEqual(["a", "c"]);
    expect(sortActions(xs, "earned").map((x) => x.key)).toEqual(["b"]);
    expect(sortActions(xs, "easiest").map((x) => x.key)).toEqual(["b", "c", "a"]);
    expect(sortActions(xs, "certain").map((x) => x.key)).toEqual(["b", "c", "a"]);
    expect(sortActions(xs, "best", "menu").map((x) => x.key)).toEqual(["b"]);
  });
});

describe("what-if", () => {
  const base = { sales: 60000, cogs: 18000, labor: 15000, laborHours: 750, waste: 600, openDays: 26, guests: 2000, elasticity: -0.8 };
  it("is zero with no moves", () => {
    expect(whatIf(base, { pricePct: 0, laborHoursPerDay: 0, guestsPct: 0 }).change).toBeCloseTo(0);
  });
  it("prices each lever like the drivers model", () => {
    expect(whatIf(base, { pricePct: 0, laborHoursPerDay: 1, guestsPct: 0 }).change).toBeCloseTo(20 * 26);
    expect(whatIf(base, { pricePct: 0, laborHoursPerDay: 0, guestsPct: 0.05 }).change).toBeCloseTo(0.05 * (60000 - 18000 - 600));
    const p = whatIf(base, { pricePct: 0.01, laborHoursPerDay: 0, guestsPct: 0 });
    expect(p.change).toBeGreaterThan(0);
    expect(p.change).toBeLessThan(600); // volume dips, so less than 1% of sales
    expect(p.after.guests).toBeLessThan(base.guests);
  });
});

describe("track record", () => {
  it("lists what's done with the measured follow-up", () => {
    const o = opp({ key: "price.plus1.pretzel", kind: "price.test", subject: "pretzel", monthly: 120 });
    const st = markFeed(emptyFeedState(), o, "done", "2026-10-01");
    const follow: Opportunity = opp({ key: "feed.follow.pretzel.2026-10-01", kind: "feed.follow", subject: "pretzel", title: "Since raising the pretzel: +$150 a month" });
    const t = trackRecord(st, [follow]);
    expect(t.items[0].measured).toContain("+$150");
    expect(t.monthly).toBe(120);
  });
});
