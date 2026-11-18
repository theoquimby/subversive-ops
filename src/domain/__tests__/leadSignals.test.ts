import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { aheadLevel, linkWord, sameDayLevel, testSignal, testSignals, type SignalDay } from "../leadSignals";

const START = "2025-06-01";
const N = 300;
const dates = Array.from({ length: N }, (_, i) => addDays(START, i));
const TODAY = addDays(START, N);
/** Demand swings slowly: three-week stretches at 30% above normal, then three at normal. */
const busy = (i: number) => (Math.floor(i / 21) % 2 ? 0.3 : 0);
const wobble = (i: number) => (((i * 7) % 11) - 5) / 100;
const series = (f: (i: number) => number, upTo = N) => new Map(dates.slice(0, upTo).map((d, i) => [d, f(i)]));
const flat: SignalDay[] = dates.map((date, i) => ({ date, forecast: 1000, actual: 1000 * (1 + busy(i) + wobble(i)) }));

describe("levels", () => {
  const at = (d: string) => (d >= START && d < TODAY ? 100 + (d >= addDays(START, 100) ? 50 : 0) : null);
  it("compares the last week on file with the four weeks before it", () => {
    // Forecasting day 107 with numbers one day late: the week is days 100–106 (150), the norm days 72–99 (100).
    expect(aheadLevel(at, addDays(START, 107), 1)).toBeCloseTo(0.5);
    // Three days late, the week is days 98–104: five of seven at 150.
    expect(aheadLevel(at, addDays(START, 107), 3)).toBeCloseTo((2 * 100 + 5 * 150) / 7 / 100 - 1);
  });
  it("needs the whole five weeks on file", () => {
    expect(aheadLevel(at, addDays(START, 20), 1)).toBeNull();
  });
  it("compares a day with the same weekday over the four weeks before", () => {
    expect(sameDayLevel(at, addDays(START, 100))).toBeCloseTo(0.5);
    expect(sameDayLevel(at, addDays(START, 10))).toBeNull();
  });
});

describe("testSignal", () => {
  it("finds a number that runs ahead of sales and shows it would have made the forecast closer", () => {
    // Searches rise with demand, on file a day late.
    const r = testSignal({ key: "s", label: "Search clicks", source: "Google Search", values: series((i) => 200 * (1 + busy(i))) }, flat, TODAY);
    expect(r.delay).toBe(1);
    expect(r.sameDay!.r).toBeGreaterThan(0.2);
    expect(r.ahead!.r).toBeGreaterThan(0.3);
    expect(r.ahead!.per20).toBeGreaterThan(0.02);
    expect(r.scored).toBeGreaterThan(100);
    expect(r.missWith!).toBeLessThan(r.missWithout!);
    expect(r.verdict).toBe("helps");
  });

  it("says no when a number has nothing to do with sales", () => {
    const r = testSignal({ key: "n", label: "Noise", source: "Website", values: series((i) => 100 + ((i * 13) % 17)) }, flat, TODAY);
    expect(Math.abs(r.ahead!.r)).toBeLessThan(0.2);
    expect(r.verdict).toBe("noHelp");
  });

  it("measures how late the numbers run and only uses what had arrived", () => {
    // The newest day on file is four days back.
    const r = testSignal({ key: "s", label: "Listing views", source: "Google listing", values: series((i) => 200 * (1 + busy(i)), N - 3) }, flat, TODAY);
    expect(r.delay).toBe(4);
    expect(r.to).toBe(addDays(START, N - 4));
  });

  it("gives no verdict on a short history", () => {
    const short = new Map(dates.slice(N - 80).map((d, i) => [d, 100 + i]));
    const r = testSignal({ key: "w", label: "Website visitors", source: "Website", values: short }, flat, TODAY);
    expect(r.verdict).toBe("thin");
    expect(r.scored).toBeLessThan(45);
  });

  it("never moves a day by more than a fifth, and learns nothing from event days", () => {
    const wild = flat.map((d, i) => ({ ...d, actual: 1000 * (1 + 3 * busy(i)) }));
    const r = testSignal({ key: "s", label: "Search clicks", source: "Google Search", values: series((i) => 200 * (1 + busy(i))) }, wild, TODAY);
    // Sales run 90% over on busy stretches; a 20% cap can't close that, so the miss stays large.
    expect(r.missWith!).toBeGreaterThan(0.2);
    const events = testSignal({ key: "s", label: "Search clicks", source: "Google Search", values: series((i) => 200 * (1 + busy(i))) }, flat.map((d) => ({ ...d, event: true })), TODAY);
    expect(events.ahead).toBeNull();
    expect(events.scored).toBe(0);
  });
});

describe("testSignals", () => {
  it("leaves out empty series and puts the ones that help first", () => {
    const out = testSignals(
      [
        { key: "n", label: "Noise", source: "Website", values: series((i) => 100 + ((i * 13) % 17)) },
        { key: "e", label: "Empty", source: "Website", values: new Map() },
        { key: "s", label: "Search clicks", source: "Google Search", values: series((i) => 200 * (1 + busy(i))) },
      ],
      flat,
      TODAY,
    );
    expect(out.map((r) => r.key)).toEqual(["s", "n"]);
  });
});

describe("linkWord", () => {
  it("puts a correlation in everyday words", () => {
    expect(linkWord(0.05)).toBe("No link");
    expect(linkWord(0.2)).toBe("Weak");
    expect(linkWord(0.3)).toBe("Some");
    expect(linkWord(0.6)).toBe("Strong");
    expect(linkWord(-0.3)).toBe("Some, opposite");
    expect(linkWord(null)).toBe("Too few days");
  });
});
