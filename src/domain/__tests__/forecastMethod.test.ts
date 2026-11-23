import { describe, expect, it } from "vitest";
import { addDays, dateRange, weekday } from "../dates";
import { forecastSeries } from "../forecast";
import { CAP_HIGH, checkHistory, checkMethod, parseStoredMethod, realOpenDays, toStoredMethod } from "../forecastMethod";

describe("realOpenDays", () => {
  // Open Wednesday to Sunday at about $1,500; closed Monday and Tuesday.
  const dates = dateRange("2026-01-01", "2026-06-01");
  const base = new Map(dates.filter((d) => ![1, 2].includes(weekday(d))).map((d, i) => [d, 1300 + (i % 5) * 100]));

  it("leaves out a day with only a stray sale", () => {
    const sales = new Map(base).set("2026-04-14", 40).set("2026-04-21", 320);
    const open = realOpenDays(sales);
    // A $40 Tuesday is a gift card, not an open day; a $320 one clears a tenth of the usual $1,500.
    expect(open.has("2026-04-14")).toBe(false);
    expect(open.has("2026-04-21")).toBe(true);
    expect(open.has("2026-04-15")).toBe(true);
    expect(open.size).toBe(base.size + 1);
  });

  it("goes by the weeks before, so a small business's ordinary days aren't thrown out", () => {
    // $150 days are a tenth of today's, but they were the whole business back then.
    const small = new Map(dates.map((d, i) => [d, d < "2026-03-01" ? 150 + (i % 4) * 10 : 1500]));
    expect(realOpenDays(small).size).toBe(small.size);
  });

  it("counts any sale until there are a couple of weeks to go by, and never a day with none", () => {
    const first = new Map([["2026-01-01", 5], ["2026-01-02", 900], ["2026-01-03", 0]]);
    expect([...realOpenDays(first)]).toEqual(["2026-01-01", "2026-01-02"]);
  });

  it("keeps a floor: a few dollars is never an open day once there's history", () => {
    const tiny = new Map(dates.map((d) => [d, 60]));
    tiny.set("2026-05-20", 20);
    expect(realOpenDays(tiny).has("2026-05-20")).toBe(false);
    expect(realOpenDays(tiny).has("2026-05-21")).toBe(true);
  });
});

describe("capHigh in forecastSeries", () => {
  const mondays = Array.from({ length: 8 }, (_, i) => addDays("2026-09-07", 7 * i)); // Sep 7 (Labor Day) to Oct 26
  const history = new Map(mondays.map((d) => [d, d === "2026-09-07" ? 5000 : 1000]));
  const input = { history, openDays: new Set(mondays), asOf: "2026-11-01", dates: ["2026-11-02"] };
  const opts = { trendDampening: 0, seasonality: false };

  it("counts one freak day as at most one-and-a-half usual days", () => {
    const [plain] = forecastSeries(input, opts);
    const [capped] = forecastSeries(input, { ...opts, capHigh: CAP_HIGH });
    // Eight Mondays weighted 8…1, the freak one oldest: (35×1000 + 5000) ÷ 36 against (35×1000 + 1500) ÷ 36.
    expect(plain.baseline).toBeCloseTo(40000 / 36);
    expect(capped.baseline).toBeCloseTo(36500 / 36);
    expect(capped.samples).toBe(8);
  });

  it("leaves ordinary weeks alone, and doesn't cap with fewer than three days to go by", () => {
    const steady = new Map(mondays.map((d, i) => [d, 900 + i * 40]));
    const a = forecastSeries({ ...input, history: steady }, opts)[0].baseline;
    const b = forecastSeries({ ...input, history: steady }, { ...opts, capHigh: CAP_HIGH })[0].baseline;
    expect(b).toBeCloseTo(a);
    const two = { ...input, openDays: new Set(["2026-09-07", "2026-10-26"]) };
    expect(forecastSeries(two, { ...opts, capHigh: CAP_HIGH })[0].baseline).toBeCloseTo(forecastSeries(two, opts)[0].baseline);
  });
});

describe("checkMethod", () => {
  const days = dateRange("2025-06-01", "2026-11-18");
  const scored = (miss: (d: string, i: number) => number) => days.map((date, i) => ({ date, actual: 1000, f1: 1000 * (1 + miss(date, i)) }));
  const before = scored(() => 0.3);

  it("switches the refinements on when they're closer over all the history and no worse lately", () => {
    const c = checkMethod(before, scored(() => 0.25), "2026-11-18", 12);
    expect(c.all).toMatchObject({ days: days.length, before: 0.3, after: 0.25 });
    expect(c.recent!.days).toBe(365);
    expect(c).toMatchObject({ strayDays: 12, use: true });
  });

  it("leaves them off when the gain is under 1%, or the last twelve months got worse", () => {
    expect(checkMethod(before, scored(() => 0.299), "2026-11-18", 0).use).toBe(false);
    expect(checkMethod(before, scored((d) => (d >= "2025-11-18" ? 0.31 : 0.1)), "2026-11-18", 0).use).toBe(false);
  });

  it("compares only the days both forecast, so stray-sale days drop out", () => {
    const after = scored(() => 0.25).filter((_, i) => i % 10 !== 0);
    expect(checkMethod(before, after, "2026-11-18", 0).all!.days).toBe(after.length);
    expect(checkMethod([], [], "2026-11-18", 0)).toMatchObject({ all: null, recent: null, use: false });
    expect(checkMethod(before.slice(0, 50), scored(() => 0.1).slice(0, 50), "2026-11-18", 0).use).toBe(false);
  });

  it("keeps the verdict between runs, and drops what older rules stored", () => {
    const stored = toStoredMethod(checkMethod(before, scored(() => 0.25), "2026-11-18", 12), "2026-11-18");
    expect(stored.refined).toBe(true);
    expect(parseStoredMethod(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredMethod(JSON.stringify({ ...stored, rules: 0 }))).toBeNull();
    expect(parseStoredMethod("junk")).toBeNull();
  });
});

describe("checkHistory", () => {
  const days = dateRange("2025-06-01", "2026-11-18");
  const scored = (miss: (d: string) => number, from = "0000") => days.filter((d) => d >= from).map((date) => ({ date, actual: 1000, f1: 1000 * (1 + miss(date)) }));
  const hourly = scored(() => 0.3, "2025-09-01");

  it("switches to the full history only when it lands closer on the days the live forecast scores", () => {
    const c = checkHistory(hourly, scored(() => 0.25), "2026-11-18", 92);
    // Item-only days before September are in the full replay but not the hourly one, so they don't count.
    expect(c.all).toMatchObject({ days: hourly.length, before: 0.3, after: 0.25 });
    expect(c).toMatchObject({ itemOnlyDays: 92, use: true });
  });

  it("stays on hourly sales when the gain is small, the last year is worse, or there's nothing to test", () => {
    expect(checkHistory(hourly, scored(() => 0.299), "2026-11-18", 92).use).toBe(false);
    expect(checkHistory(hourly, scored((d) => (d >= "2025-11-18" ? 0.31 : 0.1)), "2026-11-18", 92).use).toBe(false);
    expect(checkHistory([], [], "2026-11-18", 0)).toMatchObject({ all: null, recent: null, itemOnlyDays: 0, use: false });
  });

  it("is kept with the method, and a verdict stored before it existed reads as hourly sales only", () => {
    const method = checkMethod(hourly, hourly, "2026-11-18", 0);
    const stored = toStoredMethod(method, "2026-11-18", checkHistory(hourly, scored(() => 0.25), "2026-11-18", 92));
    expect(stored.fullHistory).toBe(true);
    expect(parseStoredMethod(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredMethod(JSON.stringify({ rules: 1, learnedOn: "2026-11-18", refined: true }))).toEqual({ rules: 1, learnedOn: "2026-11-18", refined: true, fullHistory: false });
    expect(toStoredMethod(method, "2026-11-18").fullHistory).toBe(false);
  });
});
