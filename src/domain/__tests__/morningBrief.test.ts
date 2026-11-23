import { describe, expect, it } from "vitest";
import { activeSpan, busyWindow, crewCheck, dedupeBySubject, hourLabel, hourRange, isMondayEdition, morningDue, morningPush, parseMorningHour, subjectOf, weekWrap, yesterdaySummary } from "../morningBrief";

describe("the short list before tonight", () => {
  it("reads what a line is about from its name", () => {
    expect(subjectOf("Brew Golden Lager as soon as you can")).toBe("golden lager");
    expect(subjectOf("Golden Lager runs out in ~1 day; 0 full kegs in the walk-in")).toBe("golden lager");
    expect(subjectOf("Order from Greene County Beef")).toBe("county beef");
    expect(subjectOf("Missed: Hudson Valley Foodservice cutoff passed with no order")).toBe("valley foodservice");
    expect(subjectOf("Federal excise for Q3 2026")).toBeNull();
    expect(subjectOf("NY beer tax for Oct 2026")).toBeNull();
    expect(subjectOf("Brewer's report for Q3 2026")).toBeNull();
    expect(subjectOf("1 certificate expired")).toBeNull();
  });
  it("keeps the first line per subject and every line that names nothing", () => {
    const items = [{ title: "Brew Golden Lager as soon as you can" }, { title: "Federal excise for Q3 2026" }, { title: "Golden Lager kegs are out" }, { title: "Brewer's report for Q3 2026" }];
    expect(dedupeBySubject(items).map((i) => i.title)).toEqual(["Brew Golden Lager as soon as you can", "Federal excise for Q3 2026", "Brewer's report for Q3 2026"]);
  });
  it("can skip subjects already shown elsewhere on the page", () => {
    const seen = new Set(["golden lager"]);
    expect(dedupeBySubject([{ title: "Golden Lager runs out in ~1 day" }, { title: "Reprice the Smash Burger" }], seen).map((i) => i.title)).toEqual(["Reprice the Smash Burger"]);
  });
});

const hours = (pairs: Record<number, number>) => Array.from({ length: 24 }, (_, h) => pairs[h] ?? 0);

describe("hour words", () => {
  it("labels hours and ranges the way people say them", () => {
    expect(hourLabel(0)).toBe("12am");
    expect(hourLabel(12)).toBe("12pm");
    expect(hourLabel(17)).toBe("5pm");
    expect(hourRange(17, 20)).toBe("5–8pm");
    expect(hourRange(11, 14)).toBe("11am–2pm");
    expect(hourRange(9, 12)).toBe("9am–12pm");
    expect(hourRange(21, 24)).toBe("9pm–12am");
  });
});

describe("yesterdaySummary", () => {
  it("says sales against forecast, labor and profit in one line", () => {
    const y = yesterdaySummary({ sales: 4210, forecast: 3900, labor: 1010, laborTarget: 0.25, profit: 1380 });
    expect(y.line).toBe("$4,210 in sales, 8% over forecast. Labor 24% (target 25%), about $1,380 profit.");
    expect(y.tone).toBe("good");
    expect(y.flags).toEqual([]);
  });
  it("calls a near miss 'right on forecast'", () => {
    expect(yesterdaySummary({ sales: 1000, forecast: 1010, labor: 0, laborTarget: null, profit: null }).line).toBe("$1,000 in sales, right on forecast.");
  });
  it("flags what was unusual, worst first", () => {
    const y = yesterdaySummary({
      sales: 2000,
      forecast: 3000,
      labor: 700,
      laborTarget: 0.25,
      profit: -50,
      notes: { eightySixed: 2, compsAmount: 40, cashOverShort: -20, issues: 1, maintenance: 1 },
    });
    expect(y.tone).toBe("bad");
    expect(y.flags.map((f) => f.key)).toEqual(["loss", "cash", "forecast", "labor"]);
    expect(y.flags.find((f) => f.key === "forecast")!.text).toBe("Quieter than expected: $1,000 under forecast");
    expect(y.line).toContain("about $50 lost after food and labor");
  });
  it("treats a day with no sales as closed", () => {
    const y = yesterdaySummary({ sales: 0, forecast: 0, labor: 0, laborTarget: null, profit: null });
    expect(y.closed).toBe(true);
    expect(y.flags).toEqual([]);
  });
});

describe("busyWindow", () => {
  it("finds the three hours with most forecast sales", () => {
    const w = busyWindow(hours({ 12: 200, 13: 250, 17: 300, 18: 500, 19: 450, 20: 200 }))!;
    expect([w.from, w.toExclusive, w.peak]).toEqual([17, 20, 18]);
    expect(w.label).toBe("5–8pm");
    expect(w.share).toBeCloseTo(1250 / 1900);
  });
  it("is null when nothing is forecast", () => {
    expect(busyWindow(hours({}))).toBeNull();
  });
  it("finds the span of hours with anything on", () => {
    expect(activeSpan(hours({ 11: 1, 21: 5 }), hours({ 10: 2 }))).toEqual([10, 22]);
    expect(activeSpan(hours({}))).toBeNull();
  });
});

describe("crewCheck", () => {
  const d = (rows: [number, number, number][]) => rows.map(([hour, need, have]) => ({ hour, need, have }));
  it("matches when everyone needed is on", () => {
    const c = crewCheck(d([[16, 2, 2], [17, 3.2, 4], [18, 3, 3]]));
    expect(c.line).toBe("The crew matches what the forecast needs.");
    expect(c.needPeak).toBe(4);
    expect(c.tone).toBe("good");
  });
  it("names the worst short stretch", () => {
    const c = crewCheck(d([[16, 2, 2], [17, 4, 3], [18, 5, 3], [19, 4, 3], [21, 2, 1]]));
    expect(c.short.map((s) => [s.from, s.toExclusive, s.diff])).toEqual([[17, 20, 2], [21, 22, 1]]);
    expect(c.line).toBe("Short 2 people 5–8pm and 1 other stretch.");
    expect(c.tone).toBe("warn");
  });
  it("notices nobody's on yet", () => {
    expect(crewCheck(d([[17, 3, 0]])).tone).toBe("bad");
    expect(crewCheck([]).tone).toBe("neutral");
  });
  it("mentions a lot more people than needed", () => {
    expect(crewCheck(d([[14, 1, 3], [15, 1, 3]])).line).toBe("Covered, with 2 more than the forecast needs 2–4pm.");
  });
});

describe("morningDue", () => {
  const base = { today: "2026-11-16", sendHour: 9, lastSent: null };
  it("sends at the chosen hour once a day", () => {
    expect(morningDue({ ...base, localHour: 8 })).toBe(false);
    expect(morningDue({ ...base, localHour: 9 })).toBe(true);
    expect(morningDue({ ...base, localHour: 9, lastSent: "2026-11-16" })).toBe(false);
    expect(morningDue({ ...base, localHour: 9, lastSent: "2026-11-15" })).toBe(true);
  });
  it("catches up a missed run for a couple of hours, then gives up", () => {
    expect(morningDue({ ...base, localHour: 11 })).toBe(true);
    expect(morningDue({ ...base, localHour: 12 })).toBe(false);
  });
  it("only accepts the hours the crons cover", () => {
    expect(parseMorningHour("8")).toBe(8);
    expect(parseMorningHour("3")).toBe(9);
    expect(parseMorningHour(null)).toBe(9);
  });
});

describe("weekWrap", () => {
  it("sums the week and finds the best day", () => {
    const w = weekWrap({
      from: "2026-11-09",
      days: [
        { date: "2026-11-09", sales: 0, forecast: 0, profit: null },
        { date: "2026-11-12", sales: 2000, forecast: 1800, profit: 500 },
        { date: "2026-11-13", sales: 3000, forecast: 3100, profit: 900 },
        { date: "2026-11-14", sales: 5000, forecast: 4600, profit: 1800 },
      ],
      labor: 2500,
      budget: 9500,
      prevSales: 9000,
    });
    expect(w.sales).toBe(10000);
    expect(w.to).toBe("2026-11-15");
    expect(w.lines).toEqual(["$10,000 in sales, 5% over budget.", "Labor 25%, about $3,200 profit before fixed costs.", "Best day: Saturday, $5,000."]);
  });
  it("holds the comparison back while days aren't in yet", () => {
    const w = weekWrap({ from: "2026-11-16", days: [{ date: "2026-11-16", sales: 2940, forecast: 3000, profit: 900 }], labor: 0, budget: 12800, prevSales: 20580, notIn: 6 });
    expect(w.vsBudget).toBeNull();
    expect(w.vsPrev).toBeNull();
    expect(w.notIn).toBe(6);
    expect(w.lines).toEqual(["$2,940 in sales so far, with 6 days not in yet. The comparison with budget waits for the rest."]);
  });
  it("falls back to the week before when there's no budget", () => {
    expect(weekWrap({ from: "2026-11-09", days: [{ date: "2026-11-10", sales: 900, forecast: null, profit: null }], labor: 0, budget: null, prevSales: 1000 }).lines[0]).toBe("$900 in sales, 10% down on the week before.");
  });
  it("runs on Mondays", () => {
    expect(isMondayEdition("2026-11-16")).toBe(true);
    expect(isMondayEdition("2026-11-17")).toBe(false);
  });
});

describe("morningPush", () => {
  it("leads with today's forecast and busy hours", () => {
    const p = morningPush({ weekdayName: "Friday", forecast: 4200, busy: "5–8pm", tonight: 2, yesterday: "$3,100, 4% over forecast", closed: false });
    expect(p.title).toBe("Friday: $4,200 forecast, busiest 5–8pm");
    expect(p.body).toBe("Yesterday $3,100, 4% over forecast · 2 things before tonight");
  });
  it("says when the place is closed", () => {
    expect(morningPush({ weekdayName: "Monday", forecast: 0, busy: null, tonight: 0, yesterday: null, closed: true }).title).toBe("Monday: closed today");
  });
});
