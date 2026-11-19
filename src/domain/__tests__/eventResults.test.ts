import { describe, expect, it } from "vitest";
import { addDays, dateRange, weekday } from "../dates";
import { describeResult, eventResults, ordinaryDay, type ResultEvent, type SeriesResult } from "../eventResults";
import { holidayKind } from "../holidays";

const TODAY = "2026-11-18";
const days = dateRange("2024-06-01", TODAY);
/** What each weekday usually does: closed Tuesday, small early in the week, big at the weekend. */
const USUAL = [2200, 1000, 0, 900, 1100, 2000, 3800];
/** A slow seasonal swing (winter 30% down, summer 30% up) and a day-to-day wobble of up to ±25%, the same every run. */
const season = (d: string) => 1 + 0.3 * Math.sin(((Number(d.slice(5, 7)) - 4) / 12) * 2 * Math.PI);
const wobble = (i: number, seed = 0) => {
  // A small fixed scrambler, so neighbouring days and weeks don't move together.
  let t = (i + 1 + seed * 104729) * 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return 0.75 + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 0.5;
};

function world(lifts: Record<string, number> = {}, seed = 0) {
  const sales = new Map<string, number>();
  days.forEach((d, i) => {
    const base = USUAL[weekday(d)];
    if (base > 0) sales.set(d, base * season(d) * wobble(i, seed) * (lifts[d] ?? 1));
  });
  return { sales, openDays: new Set(sales.keys()) };
}
const ev = (date: string, title = "Trivia night", kind = "OTHER", impact = 1): ResultEvent => ({ id: `${kind}-${title}-${date}`, date, title, kind, impact });
/** The last `n` of a weekday before today that aren't holidays. */
const lastWeekdays = (wd: number, n: number, before = TODAY) => days.filter((d) => weekday(d) === wd && d < before && holidayKind(d) == null).slice(-n);

describe("ordinaryDay", () => {
  it("is the usual for that weekday, scaled by how the other weekdays are doing now against then", () => {
    const { sales, openDays } = world();
    const e = ordinaryDay(sales, openDays, "2026-07-15")!; // a Wednesday in summer
    expect(e).toBeGreaterThan(900 * season("2026-07-15") * 0.85);
    expect(e).toBeLessThan(900 * season("2026-07-15") * 1.15);
  });
  it("needs four ordinary days of that weekday, and other weekdays to set the level", () => {
    const { sales, openDays } = world();
    expect(ordinaryDay(sales, openDays, "2024-06-12")).toBeNull();
    const wednesdaysOnly = new Set([...openDays].filter((d) => weekday(d) === 3));
    expect(ordinaryDay(sales, wednesdaysOnly, "2026-07-15")).toBeNull();
  });
});

describe("eventResults", () => {
  it("gives a verdict when the nights together clear chance, with a range and dollars a night", () => {
    // Twenty Wednesdays of trivia, each 40% up.
    const nights = lastWeekdays(3, 20);
    const { sales, openDays } = world(Object.fromEntries(nights.map((d) => [d, 1.4])));
    const r = eventResults({ sales, openDays, events: nights.map((d) => ev(d, "Trivia night", "OTHER", 1.3)), today: TODAY });
    const s = r.series[0];
    expect(s).toMatchObject({ series: "OTHER:trivia night", nights: 20, skipped: 0, verdict: "added" });
    expect(s.lift!).toBeGreaterThan(0.28);
    expect(s.lift!).toBeLessThan(0.52);
    expect(s.low!).toBeGreaterThan(0);
    expect(s.high!).toBeGreaterThan(s.lift!);
    expect(s.perNight!).toBeGreaterThan(200);
    expect(s.hoped).toBeCloseTo(0.3);
    expect(s.impact!).toBeGreaterThan(1.25);
    expect(s.moreNights).toBeNull();
    // Each night has its own reading too.
    expect(r.outcomes.get(ev(nights[19]).id)!.lift!).toBeGreaterThan(0);
  });

  it("compares a weekly night that has run for months with the same weekday from before it began", () => {
    // Every Wednesday for the last eight months: no ordinary Wednesday in sight.
    const nights = days.filter((d) => weekday(d) === 3 && d >= "2026-03-18");
    const { sales, openDays } = world(Object.fromEntries(nights.map((d) => [d, 1.4])));
    const r = eventResults({ sales, openDays, events: nights.map((d) => ev(d)), today: TODAY });
    const s = r.series[0];
    expect(s.nights).toBeGreaterThan(28);
    expect(s.verdict).toBe("added");
    // Spring to summer to autumn in between: the other weekdays carry the season.
    expect(s.lift!).toBeGreaterThan(0.25);
    expect(s.lift!).toBeLessThan(0.55);
  });

  it("says it's unclear when the nights could be chance, and what would settle it", () => {
    // Every other Wednesday, 8% up: well inside what chance does.
    const nights = lastWeekdays(3, 12).filter((_, k) => k % 2 === 1);
    const { sales, openDays } = world(Object.fromEntries(nights.map((d) => [d, 1.08])));
    const s = eventResults({ sales, openDays, events: nights.map((d) => ev(d)), today: TODAY }).series[0];
    expect(s.nights).toBe(6);
    expect(s.verdict).toBe("unclear");
    expect(s.noise!).toBeGreaterThan(0.08);
    // Nights with gaps between them bring fresh ordinary days, so it's a matter of more nights.
    expect(s.needsBreak).toBe(false);
    expect(s.moreNights!).toBeGreaterThan(5);
    // A cautious number for the next ones: less than what was seen.
    if (s.impact != null) expect(Math.abs(s.impact - 1)).toBeLessThanOrEqual(Math.abs(s.lift!) + 0.01);
  });

  it("with two nights says nothing yet, only how many more it would take", () => {
    // Two festival Saturdays a month apart, each about 80% up.
    const nights = lastWeekdays(6, 9).filter((_, k) => k % 4 === 0).slice(-2);
    const { sales, openDays } = world(Object.fromEntries(nights.map((d) => [d, 1.8])));
    const s = eventResults({ sales, openDays, events: nights.map((d) => ev(d, "Festival Saturday", "FESTIVAL")), today: TODAY }).series[0];
    expect(s).toMatchObject({ nights: 2, verdict: "tooFew", needsBreak: false, impact: null });
    expect(s.moreNights!).toBeGreaterThanOrEqual(1);
  });

  it("rarely calls an ordinary run of nights a success or a failure", () => {
    // Eighteen made-up histories where nothing happened: at most a couple of false alarms.
    let flagged = 0;
    for (let seed = 1; seed <= 18; seed++) {
      const { sales, openDays } = world({}, seed);
      const s = eventResults({ sales, openDays, events: lastWeekdays([0, 1, 3, 4, 5, 6][seed % 6], 16).map((d) => ev(d, "Open mic")), today: TODAY }).series[0];
      if (s.verdict !== "unclear") flagged++;
      expect(Math.abs(s.lift!)).toBeLessThan(0.3);
    }
    expect(flagged).toBeLessThanOrEqual(2);
  });

  it("says when more nights won't settle it: a weekly run is only ever compared with the same few ordinary days", () => {
    const { sales, openDays } = world();
    const s = eventResults({ sales, openDays, events: lastWeekdays(4, 30).map((d) => ev(d, "Open mic")), today: TODAY }).series[0];
    // Thirty nights, nothing happening: a small lift can't be ruled in or out against eight comparison days.
    expect(s).toMatchObject({ verdict: "unclear", needsBreak: true, moreNights: null });
  });

  it("spots a night that cost sales, and sales borrowed from the nights either side", () => {
    const nights = lastWeekdays(5, 16);
    const lifts: Record<string, number> = {};
    for (const d of nights) {
      lifts[d] = 0.6;
      lifts[addDays(d, -1)] = 0.8;
    }
    const { sales, openDays } = world(lifts);
    const s = eventResults({ sales, openDays, events: nights.map((d) => ev(d, "Ticketed show", "MUSIC")), today: TODAY }).series[0];
    expect(s.verdict).toBe("cost");
    expect(s.lift!).toBeLessThan(-0.25);
    expect(s.perNight!).toBeLessThan(0);
    expect(s.neighbours!.days).toBeGreaterThan(10);
    expect(s.neighbours!.lift).toBeLessThan(-0.03);
  });

  it("waits for three nights, leaves closures and holidays out, and groups a series by its name", () => {
    const { sales, openDays } = world();
    const [a, b] = lastWeekdays(6, 2);
    const r = eventResults({
      sales,
      openDays,
      events: [ev(a, "Knicks vs Nets", "GAME"), ev(b, "Knicks @ Heat", "GAME"), ev(lastWeekdays(0, 1)[0], "Closed for repairs", "CLOSURE"), ev("2026-10-31", "Halloween", "HOLIDAY"), ev(addDays(TODAY, 7), "Knicks vs Bulls", "GAME")],
      today: TODAY,
    });
    expect(r.series.map((s) => [s.series, s.nights, s.verdict])).toEqual([["GAME:knicks", 2, "tooFew"]]);
    expect(r.series[0].impact).toBeNull();
    expect(r.outcomes.has("HOLIDAY-Halloween-2026-10-31")).toBe(true);
    expect([...r.outcomes.keys()].some((k) => k.startsWith("CLOSURE"))).toBe(false);
  });

  it("says when there's nothing to compare with", () => {
    const { sales, openDays } = world();
    // Events on a Tuesday, when the place is never open.
    const s = eventResults({ sales, openDays, events: lastWeekdays(2, 5).map((d) => ev(d, "Pop-up")), today: TODAY }).series[0];
    expect(s).toMatchObject({ verdict: "noComparison", nights: 0, skipped: 5, lift: null, impact: null });
    expect(eventResults({ sales, openDays, events: [], today: TODAY }).series).toEqual([]);
  });
});

describe("describeResult", () => {
  const base: SeriesResult = { series: "OTHER:trivia night", kind: "OTHER", nights: 18, skipped: 0, first: "2026-06-03", last: "2026-11-11", lift: 0.24, low: 0.08, high: 0.42, perNight: 312, noise: 0.31, hoped: 0.3, verdict: "added", moreNights: null, needsBreak: false, neighbours: { days: 20, lift: -0.07 }, impact: 1.24 };

  it("says what happened, in dollars, with the range chance allows", () => {
    const w = describeResult(base);
    expect(w).toMatchObject({ label: "Added sales", tone: "good", next: null });
    expect(w.line).toBe("About 24% busier than an ordinary day (somewhere between 8% and 42%), roughly $310 a night over 18 nights.");
    expect(w.notes).toEqual(["You expected +30%.", "The days either side ran about 7% below ordinary, so some of the gain may be borrowed from them."]);
  });

  it("says when it can't tell, and what would settle it", () => {
    const unclear = describeResult({ ...base, verdict: "unclear", lift: 0.12, nights: 6, moreNights: 14, hoped: null, neighbours: null, impact: 1.06 });
    expect(unclear.label).toBe("Can't tell yet");
    expect(unclear.line).toBe("6 nights so far point to 12% busier, but an ordinary night swings by about 31% on its own, so that could be chance.");
    expect(unclear.next).toBe("About 14 more nights would settle a change that size.");
    expect(describeResult({ ...base, verdict: "unclear", lift: 0.02, nights: 6, moreNights: 140, hoped: null, neighbours: null }).next).toBe("More than 100 more nights would show whether there's a change of 10% or more.");
    const stuck = describeResult({ ...base, verdict: "unclear", lift: 0.01, moreNights: null, needsBreak: true });
    expect(stuck.line).toContain("no real change");
    expect(stuck.next).toMatch(/Skip it for two or three weeks, or run it every other week/);
  });

  it("covers a night that cost sales, too few nights, and nothing to compare", () => {
    expect(describeResult({ ...base, verdict: "cost", lift: -0.2, low: -0.33, high: -0.06, perNight: -410, hoped: null, neighbours: null }).line).toBe("About 20% quieter than an ordinary day (somewhere between 6% and 33%), roughly $410 a night less over 18 nights.");
    const few = describeResult({ ...base, verdict: "tooFew", nights: 1, lift: 0.5, moreNights: 3 });
    expect(few.line).toMatch(/^1 night so far, pointing to 50% busier\. One or two nights prove nothing/);
    const none = describeResult({ ...base, verdict: "noComparison", nights: 0, skipped: 5, lift: null, low: null, high: null, perNight: null, noise: null });
    expect(none).toMatchObject({ label: "Nothing to compare", notes: [] });
    expect(none.next).toMatch(/skip it for two or three weeks/);
    expect(describeResult({ ...base, verdict: "noComparison", nights: 0, skipped: 1, lift: null, low: null, high: null, perNight: null, noise: null }).next).toBeNull();
  });
});
