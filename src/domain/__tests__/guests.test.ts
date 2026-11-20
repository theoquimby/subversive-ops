import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { guestDays, guestRhythm, guestStory, guestSummary, kindOf, quietAfter, rhythmPoints, type GuestAgg, type RhythmRow } from "../guests";

const TODAY = "2026-11-19";

describe("guestDays", () => {
  const dateOf = (iso: string) => iso.slice(0, 10);
  const pay = (createdAt: string, cardKey: string | null, amountCents: number, status = "COMPLETED") => ({ createdAt, cardKey, amountCents, status });

  it("makes one row per card per day, and counts how much of the day carried a card", () => {
    const { visits, days } = guestDays(
      [pay("2026-11-14T18:00:00Z", "a", 2400), pay("2026-11-14T21:00:00Z", "a", 1250), pay("2026-11-14T19:00:00Z", "b", 4000), pay("2026-11-14T19:30:00Z", null, 1500), pay("2026-11-15T19:00:00Z", "a", 900)],
      ["2026-11-14", "2026-11-15", "2026-11-16"],
      dateOf,
    );
    expect(visits).toEqual([
      { date: "2026-11-14", guest: "a", payments: 2, amount: 36.5 },
      { date: "2026-11-14", guest: "b", payments: 1, amount: 40 },
      { date: "2026-11-15", guest: "a", payments: 1, amount: 9 },
    ]);
    expect(days).toEqual([
      { date: "2026-11-14", payments: 4, identified: 3, amount: 91.5, identifiedAmount: 76.5 },
      { date: "2026-11-15", payments: 1, identified: 1, amount: 9, identifiedAmount: 9 },
      { date: "2026-11-16", payments: 0, identified: 0, amount: 0, identifiedAmount: 0 },
    ]);
  });

  it("leaves out payments that didn't complete, refunds to zero, and days outside the window", () => {
    const { visits, days } = guestDays([pay("2026-11-14T18:00:00Z", "a", 2400, "FAILED"), pay("2026-11-14T18:05:00Z", "a", 0), pay("2026-11-13T18:00:00Z", "a", 500)], ["2026-11-14"], dateOf);
    expect(visits).toEqual([]);
    expect(days[0].payments).toBe(0);
  });
});

const g = (over: Partial<GuestAgg> = {}): GuestAgg => ({ first: "2026-06-01", second: null, last: "2026-06-01", days: 1, months: 1, amount: 40, days365: 1, amount365: 40, daysPrior: 0, amountPrior: 0, ...over });

describe("kindOf", () => {
  it("reads a card's timing: local, visitor, now and then, or too new", () => {
    expect(kindOf(g({ months: 5, days: 9, last: "2026-10-30" }), TODAY)).toBe("local");
    expect(kindOf(g({ first: "2026-07-03", last: "2026-07-05", days: 3 }), TODAY)).toBe("visitor");
    expect(kindOf(g({ first: "2026-07-03", last: "2026-08-20", days: 2, months: 2 }), TODAY)).toBe("occasional");
    expect(kindOf(g({ first: addDays(TODAY, -20), last: addDays(TODAY, -20) }), TODAY)).toBe("new");
    // A local stays a local even if they first came recently and have already been in three separate months.
    expect(kindOf(g({ first: addDays(TODAY, -70), months: 3, days: 5 }), TODAY)).toBe("local");
  });
});

describe("guestSummary", () => {
  // 700 one-time visitors, 200 who came back, 80 regulars, 20 core regulars.
  const guests: GuestAgg[] = [
    ...Array.from({ length: 700 }, (_, i) => g({ first: addDays("2026-01-01", i % 280), last: addDays("2026-01-01", i % 280) })),
    ...Array.from({ length: 200 }, (_, i) => g({ first: addDays("2026-01-01", i), second: addDays("2026-01-01", i + (i % 2 ? 40 : 200)), last: addDays("2026-01-01", i + 40), days: 2, months: 2, amount: 90, days365: 2, amount365: 90 })),
    ...Array.from({ length: 80 }, (_, i) => g({ first: "2024-03-01", second: "2024-03-08", last: i < 30 ? "2026-05-01" : i < 50 ? "2026-08-15" : "2026-11-10", days: 30, months: 14, amount: 1500, days365: 6, amount365: 300, daysPrior: 6, amountPrior: 310 })),
    ...Array.from({ length: 20 }, () => g({ first: "2023-05-01", second: "2023-05-04", last: "2026-11-15", days: 150, months: 30, amount: 9000, days365: 40, amount365: 2400, daysPrior: 38, amountPrior: 2300 })),
  ];
  const days = [{ payments: 1000, identified: 850, amount: 50000, identifiedAmount: 45000 }];
  const s = guestSummary({ guests, days, today: TODAY });

  it("counts who came once, who came back, and how much regulars carry", () => {
    expect(s.guests).toBe(1000);
    expect(s.bands.once).toMatchObject({ guests: 700, guestShare: 0.7 });
    expect(s.bands.few.guests).toBe(200);
    expect(s.regulars.guests).toBe(100);
    expect(s.regulars.guestShare).toBeCloseTo(0.1);
    // 80 × 300 + 20 × 2400 = 72,000 of 118,000.
    expect(s.sales).toBe(118000);
    expect(s.regulars.salesShare).toBeCloseTo(72000 / 118000);
    expect(s.from).toBe("2023-05-01");
    expect(s.coverage).toEqual({ payments: 0.85, amount: 0.9 });
  });

  it("follows first-timers only once they've had the whole window to come back", () => {
    const r90 = s.returns.find((r) => r.within === 90)!;
    // Everyone first seen in 2026 up to 90 days ago; half of the 200 came back within 40 days.
    expect(r90.firstTimers).toBeGreaterThan(600);
    expect(r90.returned).toBe(100);
    expect(r90.rate!).toBeGreaterThan(0.1);
    const r365 = s.returns.find((r) => r.within === 365)!;
    // Nobody first seen in the last two years has had a full year yet, except none here: too few to quote.
    expect(r365.rate).toBeNull();
    expect(s.shallow).toBe(false);
  });

  it("sorts cards into locals and visitors by timing, and spots regulars who've gone quiet", () => {
    expect(s.kinds.local.guests).toBe(100);
    expect(s.kinds.visitor.guests).toBeGreaterThan(600);
    // Six visits a year means a usual gap of two months, so quiet starts at about five months away: the 30 not
    // seen since May count, the 20 not seen since mid-August don't yet.
    expect(quietAfter(6)).toBe(152);
    expect(quietAfter(4)).toBe(228);
    expect(quietAfter(52)).toBe(60);
    expect(s.quiet).toEqual({ guests: 30, sales: 9300, of: 100 });
  });

  it("copes with nothing on file", () => {
    const none = guestSummary({ guests: [], days: [], today: TODAY });
    expect(none).toMatchObject({ guests: 0, sales: 0, from: null, coverage: null, shallow: true });
    expect(guestStory(none)).toBeNull();
  });

  it("tells it plainly, with what to do", () => {
    const story = guestStory(s)!;
    expect(story.headline).toBe("A small group of regulars carries 61% of card sales");
    expect(story.line).toContain("1,000 different cards paid here. 100 of them (10%) came on four or more days and brought 61% of card sales.");
    const quiet = story.points.find((p) => p.key === "quiet")!;
    expect(quiet.title).toBe("30 regulars have gone quiet");
    expect(quiet.detail).toContain("about $9,300");
    expect(quiet.action).toMatch(/membership or an email list/);
    expect(story.points.find((p) => p.key === "returns")!.title).toMatch(/of first-time cards come back within three months/);
    expect(story.points.find((p) => p.key === "kinds")!.action).toMatch(/Locals bring the bigger share/);
    expect(story.points.find((p) => p.key === "coverage")!.title).toBe("90% of what's paid carries a card Ops can recognise again");
  });
});

describe("guestRhythm", () => {
  // Open Wednesday to Sunday, 50 of each in the year. Locals: 12 cards every open day. Visitors: 4 on a
  // Wednesday or Thursday, 30 on a Friday, 60 on a Saturday or Sunday; and four times as many from July to October.
  const rows: RhythmRow[] = [];
  const open: { wd: number; month: number; days: number }[] = [];
  for (let month = 1; month <= 12; month++) {
    const peak = month >= 7 && month <= 10;
    for (const wd of [3, 4, 5, 6, 0]) {
      const days = 4;
      open.push({ wd, month, days });
      const visitors = (wd === 3 || wd === 4 ? 4 : wd === 5 ? 30 : 60) * (peak ? 2 : 0.5);
      const locals = month <= 3 ? 6 : 12;
      rows.push({ wd, month, kind: "local", visits: locals * days, sales: locals * days * 45 });
      rows.push({ wd, month, kind: "visitor", visits: visitors * days, sales: visitors * days * 55 });
      rows.push({ wd, month, kind: "occasional", visits: 2 * days, sales: 2 * days * 50 });
    }
  }
  const r = guestRhythm(rows, open);

  it("gives a typical open day for each weekday and month: cards, sales, and who brought them", () => {
    expect(r.weekdays.map((c) => c.key)).toEqual([3, 4, 5, 6, 0]);
    const wed = r.weekdays[0];
    const sat = r.weekdays[3];
    expect(wed.openDays).toBe(48);
    expect(wed.localsPerDay).toBeCloseTo((6 * 3 + 12 * 9) / 12);
    expect(wed.localShare).toBeGreaterThan(0.5);
    expect(sat.localShare).toBeLessThan(0.2);
    expect(sat.visitorsPerDay).toBeGreaterThan(wed.visitorsPerDay * 10);
    expect(r.months).toHaveLength(12);
    expect(r.months[0].localsPerDay).toBeCloseTo(6);
    expect(r.months[7].salesPerDay).toBeGreaterThan(r.months[0].salesPerDay * 2);
  });

  it("leaves out weekdays hardly ever open and months with almost no days", () => {
    const thin = guestRhythm([...rows, { wd: 1, month: 9, kind: "local", visits: 5, sales: 300 }], [...open, { wd: 1, month: 9, days: 1 }]);
    expect(thin.weekdays.some((c) => c.key === 1)).toBe(false);
    expect(guestRhythm([], [])).toEqual({ weekdays: [], months: [] });
  });

  it("says which day is the locals' and what the quiet months look like", () => {
    const p = rhythmPoints(r);
    const days = p.find((x) => x.key === "weekdays")!;
    expect(days.title).toMatch(/^(Wednesday|Thursday)s are your most local day; (Saturday|Sunday)s belong to visitors$/);
    expect(days.detail).toMatch(/Locals bring \d+% of card sales on a (Wednesday|Thursday) and \d+% on a (Saturday|Sunday)\./);
    expect(days.action).toMatch(/^Midweek is where locals decide your night/);
    const season = p.find((x) => x.key === "season")!;
    // January to March: half the locals of the busy months.
    expect(season.title).toBe("In your quietest months even locals come 50% less");
    expect(season.detail).toContain("In January, February and March a typical open day has about 6 local cards");
    expect(season.detail).toContain("12 local cards");
    expect(season.action).toMatch(/winter membership or a standing weekly night/);
  });

  it("only speaks about weekdays that are regularly open", () => {
    // Ten Tuesdays in the year, all visitors: it's in the table but not in the summary.
    const tue = guestRhythm([...rows, { wd: 2, month: 8, kind: "visitor", visits: 80, sales: 5000 }, { wd: 2, month: 8, kind: "local", visits: 2, sales: 100 }], [...open, { wd: 2, month: 8, days: 10 }]);
    expect(tue.weekdays.some((c) => c.key === 2)).toBe(true);
    expect(rhythmPoints(tue).find((x) => x.key === "weekdays")!.title).not.toMatch(/Tuesday/);
  });

  it("says so when locals hold steady and only visitors fall away, and stays quiet with too little to go on", () => {
    const steady = guestRhythm(rows.map((x) => (x.kind === "local" ? { ...x, visits: 12 * 4, sales: 12 * 4 * 45 } : x)), open);
    expect(rhythmPoints(steady).find((x) => x.key === "season")!.title).toBe("Locals hold steady through your quietest months; it's visitors who fall away");
    expect(rhythmPoints({ weekdays: [], months: [] })).toEqual([]);
  });

  it("joins the main story after the points about regulars", () => {
    const summary = guestSummary({ guests: Array.from({ length: 300 }, () => g({ months: 4, days: 6, days365: 6, amount365: 300 })), days: [], today: TODAY });
    const story = guestStory(summary, r)!;
    expect(story.points.map((x) => x.key)).toEqual(expect.arrayContaining(["weekdays", "season"]));
    expect(guestStory(summary)!.points.some((x) => x.key === "weekdays")).toBe(false);
  });
});
