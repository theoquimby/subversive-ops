import { describe, expect, it } from "vitest";
import { allFindings, allWatching, evidenceOf, isWatching, type AnalyticsRun, type Evidence, type Opportunity } from "../analytics";
import { buildActions, priceResults, watchList } from "../lab";
import { emptyFeedState, markFeed } from "../analytics";

const opp = (o: Partial<Opportunity> & Pick<Opportunity, "key" | "kind">): Opportunity => ({ model: "feed", title: o.key, action: "Do it.", monthly: 100, low: 50, high: 150, confidence: 0.5, how: ["Because the numbers say so.", "Second step."], inputs: [{ label: "Sales", value: "$100" }], href: "/insights", ...o });

const ev = (v: Partial<Evidence> = {}): Evidence => ({ verdict: "real", summary: "Relative to how busy you were, it sold 12% less.", rows: [{ label: "Orders per open day", before: "85", after: "78", change: "−9%", changePct: -0.09 }], steps: ["Step."], excluded: ["Labor Day (Sep 7)"], method: "Per 100 orders, same weekday mix.", sure: "Fairly sure: the range stays below zero.", effect: { mid: -0.12, low: -0.2, high: -0.04 }, ...v });

const run = (results: AnalyticsRun["results"]): AnalyticsRun => ({ version: "2.1.0", computedAt: "2026-11-13T00:00:00Z", results, timings: {}, source: "local", seconds: 1 });

describe("evidence", () => {
  it("uses the model's evidence when sent (service 2.1+)", () => {
    const e = evidenceOf(opp({ key: "a", kind: "feed.follow", evidence: ev() }));
    expect(e.summary).toMatch(/Relative to how busy/);
    expect(e.excluded).toEqual(["Labor Day (Sep 7)"]);
  });

  it("builds one from how and inputs for an older service or app-side findings (kegs)", () => {
    const e = evidenceOf(opp({ key: "k", kind: "kegs.runout", confidence: 0.7 }));
    expect(e.verdict).toBe("real");
    expect(e.summary).toBe("Because the numbers say so.");
    expect(e.steps).toEqual(["Second step."]);
    expect(e.rows).toEqual([{ label: "Sales", value: "$100" }]);
    expect(e.sure).toMatch(/^Pretty sure/);
    expect(evidenceOf(opp({ key: "k2", kind: "x", confidence: 0.2 })).sure).toMatch(/^A hunch/);
  });
});

describe("watching", () => {
  it("keeps findings that didn't survive the controls out of the actions", () => {
    const real = opp({ key: "staffing.over.4.16", kind: "staffing.over", evidence: ev() });
    const watch = opp({ key: "feed.follow.lager.2026-08-24", kind: "feed.follow.watch", status: "watching", monthly: 0, evidence: ev({ verdict: "unclear" }) });
    // An older-style kind, but the new evidence says unclear: still not an action.
    const unclear = opp({ key: "feed.follow.salad.2026-09-07", kind: "feed.follow", title: "Since raising the salad: −$84 a month", vector: undefined, evidence: ev({ verdict: "unclear" }) } as Partial<Opportunity> & Pick<Opportunity, "key" | "kind">);
    expect(isWatching(watch) && isWatching(unclear) && !isWatching(real)).toBe(true);
    const out = buildActions([real, watch, unclear], emptyFeedState(), "2026-11-13");
    expect(out.map((a) => a.key)).toEqual(["staffing.over.4.16"]);
    expect(out[0].evidence?.method).toBeTruthy();
  });

  it("collects the watch list from every model and the feed, biggest effect first, without duplicates", () => {
    const w1 = opp({ key: "w1", kind: "feed.follow.watch", status: "watching", evidence: ev({ verdict: "unclear", effect: { mid: -0.05, low: -0.2, high: 0.1 }, watch: "About 3 more weeks will tell." }) });
    const w2 = opp({ key: "w2", kind: "staffing.over.watch", status: "watching", evidence: ev({ verdict: "unclear", effect: { mid: -0.4, low: -0.7, high: 0.02 } }) });
    const r = run({ staffing: { id: "staffing", title: "", status: "ok", headline: "", action: "", monthly: null, range: null, confidence: { level: "low", score: 0.2, note: "" }, how: [], inputs: [], chart: null, details: {}, opportunities: [], watching: [w2] }, feed: { items: [], errors: [], finders: [], watching: [w1, w2] } });
    const all = allWatching(r);
    expect(all.map((o) => o.key)).toEqual(["w2", "w1"]);
    const list = watchList(all, emptyFeedState());
    expect(list[1].watch).toBe("About 3 more weeks will tell.");
    expect(list[0].area).toBe("staffing");
    // Not for us hides it.
    const st = markFeed(emptyFeedState(), { key: "w1", kind: "feed.follow.watch", title: "w1", monthly: 0 }, "dismissed", "2026-11-13");
    expect(watchList(all, st).map((w) => w.key)).toEqual(["w2"]);
  });

  it("works with an older service that sends no watch list or evidence", () => {
    const r = run({ feed: { items: [opp({ key: "feed.follow.a.2026-09-07", kind: "feed.follow", title: "Since raising the A: −$84 a month" })], errors: [], finders: [] } });
    expect(allWatching(r)).toEqual([]);
    expect(allFindings(r)).toHaveLength(1);
    expect(priceResults(allFindings(r))).toHaveLength(1);
  });

  it("doesn't count an unclear price follow-up as a result", () => {
    const f = [opp({ key: "a", kind: "feed.follow", title: "Since raising the A: +$40 a month", evidence: ev({ verdict: "good" }) }), opp({ key: "b", kind: "feed.follow", title: "Since raising the B: −$84 a month", evidence: ev({ verdict: "unclear" }) })];
    expect(priceResults(f).map((p) => p.key)).toEqual(["a"]);
  });
});
