import { describe, expect, it } from "vitest";
import { allFindings, AnalyticsRun, breakEven, emptyFeedState, fixedTotal, forecastRange, markFeed, markSeen, Opportunity, parseFeedState, priceWhatIf, rankFeed, runAge } from "../analytics";

const opp = (key: string, monthly: number, confidence = 0.5, extra: Partial<Opportunity> = {}): Opportunity => ({
  key,
  kind: extra.kind ?? key.split(".").slice(0, 2).join("."),
  model: "feed",
  title: key,
  action: "do it",
  monthly,
  low: monthly / 2,
  high: monthly,
  confidence,
  how: [],
  inputs: [],
  href: "/insights",
  ...extra,
});

const T = "2026-11-13";

describe("priceWhatIf", () => {
  it("matches the constant-elasticity formula", () => {
    const r = priceWhatIf({ price: 10, unitCost: 3, qtyMonth: 100, elasticity: -1, sd: 0.2 }, 1);
    expect(r.qty).toBeCloseTo(100 * (11 / 10) ** -1);
    expect(r.profit).toBeCloseTo(r.qty * 8 - 700);
    expect(r.low).toBeLessThanOrEqual(r.profit);
    expect(r.high).toBeGreaterThanOrEqual(r.profit);
  });
  it("is zero at zero change", () => {
    expect(priceWhatIf({ price: 19, unitCost: 6, qtyMonth: 800, elasticity: -0.9, sd: 0.35 }, 0).profit).toBeCloseTo(0);
  });
});

describe("breakEven", () => {
  it("divides fixed costs by what each sales dollar leaves", () => {
    const b = breakEven({ fixedMonthly: 10000, laborFixedDaily: 180, laborVariable: 0.18, cogsPct: 0.3, wastePct: 0.02, openDaysPerMonth: 26 })!;
    expect(b.monthly).toBeCloseTo((10000 + 180 * 26) / 0.5);
    expect(b.daily).toBeCloseTo(b.monthly / 26);
  });
  it("refuses when nothing is left over", () => {
    expect(breakEven({ fixedMonthly: 1, laborFixedDaily: 0, laborVariable: 0.5, cogsPct: 0.5, wastePct: 0, openDaysPerMonth: 26 })).toBeNull();
  });
  it("sums fixed costs", () => {
    expect(fixedTotal({ rent: 5000, utilities: 900, insurance: null, other: 100 })).toBe(6000);
    expect(fixedTotal(null)).toBe(0);
  });
});

describe("rankFeed", () => {
  it("ranks by value × confidence", () => {
    const r = rankFeed([opp("a.x", 100, 0.9), opp("b.x", 300, 0.2), opp("c.x", 200, 0.6)], emptyFeedState(), T);
    expect(r.map((x) => x.key)).toEqual(["c.x", "a.x", "b.x"]);
  });
  it("counts one-offs at a twelfth a month and floors tiny values", () => {
    const r = rankFeed([opp("cash.a", 0, 0.5, { oneOff: 1200 }), opp("info.b", 1, 0.5)], emptyFeedState(), T);
    expect(r[0].value).toBe(100);
    expect(r[1].value).toBe(20);
  });
  it("hides done and dismissed, snoozes until the date", () => {
    let s = emptyFeedState();
    s = markFeed(s, opp("a.x", 100), "done", T);
    s = markFeed(s, opp("b.x", 100), "dismissed", T);
    s = markFeed(s, opp("c.x", 100), "snoozed", T, 7);
    const items = [opp("a.x", 100), opp("b.x", 100), opp("c.x", 100), opp("d.x", 50)];
    expect(rankFeed(items, s, T).map((x) => x.key)).toEqual(["d.x"]);
    expect(rankFeed(items, s, "2026-11-20").map((x) => x.key)).toEqual(["c.x", "d.x"]);
  });
  it("learns: Not useful down-ranks the whole kind, undo restores it", () => {
    let s = emptyFeedState();
    s = markFeed(s, opp("feed.event.roi.GAME", 100, 0.5, { kind: "feed.event.roi" }), "dismissed", T);
    const r = rankFeed([opp("feed.event.roi.MUSIC", 100, 0.5, { kind: "feed.event.roi" }), opp("feed.hours.1", 80, 0.5, { kind: "feed.hours" })], s, T);
    expect(r[0].key).toBe("feed.hours.1");
    expect(r[1].weight).toBeCloseTo(0.6);
    s = markFeed(s, opp("feed.event.roi.GAME", 100, 0.5, { kind: "feed.event.roi" }), "undo", T);
    expect(s.weights["feed.event.roi"]).toBeCloseTo(1);
    expect(s.marks["feed.event.roi.GAME"]).toBeUndefined();
  });
  it("weights never collapse to zero", () => {
    let s = emptyFeedState();
    for (let i = 0; i < 10; i++) s = markFeed(s, opp(`k.x.${i}`, 10, 0.5, { kind: "k.x" }), "dismissed", T);
    expect(s.weights["k.x"]).toBe(0.2);
  });
  it("fades a finding shown week after week, revives it when its value moves", () => {
    let s = emptyFeedState();
    const a = opp("a.x", 100, 0.5);
    s = markSeen(s, [a], "2026-10-23");
    s = markSeen(s, [a], "2026-10-30");
    s = markSeen(s, [a], "2026-11-06");
    s = markSeen(s, [a], "2026-11-06"); // same week: no extra count
    expect(s.seen["a.x"].weeks).toBe(3);
    const faded = rankFeed([a, opp("b.x", 60, 0.5)], s, T);
    expect(faded[0].key).toBe("b.x");
    expect(faded[1].novelty).toBeCloseTo(0.75 ** 3);
    const revived = rankFeed([{ ...a, monthly: 150 }, opp("b.x", 60, 0.5)], s, T);
    expect(revived[0].key).toBe("a.x");
    expect(revived[0].novelty).toBe(1);
  });
  it("does not fade on the Insights list (novelty off)", () => {
    let s = emptyFeedState();
    s = markSeen(s, [opp("a.x", 100)], "2026-10-01");
    expect(rankFeed([opp("a.x", 100)], s, T, { novelty: false })[0].novelty).toBe(1);
  });
  it("keeps one finding per subject (reprice and price test of the same dish)", () => {
    const r = rankFeed([opp("menu.reprice.burger", 300, 0.5, { kind: "menu.reprice", subject: "burger" }), opp("price.plus1.burger", 250, 0.5, { kind: "price.test", subject: "burger" }), opp("price.plus1.fries", 40, 0.5, { kind: "price.test", subject: "fries" })], emptyFeedState(), T);
    expect(r.map((x) => x.key)).toEqual(["menu.reprice.burger", "price.plus1.fries"]);
  });
  it("forgets old sightings", () => {
    const s = markSeen(markSeen(emptyFeedState(), [opp("a.x", 1)], "2026-01-01"), [opp("b.x", 1)], T);
    expect(s.seen["a.x"]).toBeUndefined();
  });
});

describe("helpers", () => {
  it("parses bad state safely", () => {
    expect(parseFeedState("nope")).toEqual(emptyFeedState());
    expect(parseFeedState(null)).toEqual(emptyFeedState());
  });
  it("collects findings without duplicates and reads forecast ranges", () => {
    const run = {
      version: "1",
      computedAt: "2026-11-13T08:00:00Z",
      timings: {},
      source: "local",
      seconds: 1,
      results: {
        menu: { opportunities: [opp("m.a", 10)] },
        forecast: { opportunities: [], details: { days: [{ date: "2026-11-14", closed: false, low: 3100, mid: 3350, high: 3600 }, { date: "2026-11-17", closed: true, low: 0, mid: 0, high: 0 }] } },
        feed: { items: [opp("m.a", 10), opp("f.b", 5)], errors: [], finders: [] },
      },
    } as unknown as AnalyticsRun;
    expect(allFindings(run).map((o) => o.key)).toEqual(["m.a", "f.b"]);
    expect(forecastRange(run, "2026-11-14")).toEqual({ low: 3100, mid: 3350, high: 3600 });
    expect(forecastRange(run, "2026-11-17")).toBeNull();
    expect(runAge("2026-11-13T08:00:00Z", new Date("2026-11-14T08:00:00Z"))).toEqual({ hours: 24, stale: false });
    expect(runAge(null).stale).toBe(true);
  });
});
