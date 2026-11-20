import { describe, expect, it } from "vitest";
import { addDays, weekday } from "../dates";
import { about, dayProfit, dayProfitStory, hourLabel, hourProfit, seasonOf, type HourInput, type ProfitDayInput } from "../dayProfit";

/** A year of days from a Monday: closed Tuesdays, each weekday with its own sales and crew. */
const START = "2025-11-17"; // a Monday
const SALES = [2800, 700, 0, 1300, 1400, 3000, 5000]; // Sun..Sat
const LABOR = [800, 450, 0, 450, 450, 700, 1000];
function year(over: (d: ProfitDayInput, i: number) => Partial<ProfitDayInput> = () => ({})): ProfitDayInput[] {
  const out: ProfitDayInput[] = [];
  for (let i = 0; i < 364; i++) {
    const date = addDays(START, i);
    const wd = weekday(date);
    const d: ProfitDayInput = { date, sales: SALES[wd], goods: SALES[wd] * 0.3, labor: LABOR[wd], fees: SALES[wd] * 0.025 };
    out.push({ ...d, ...over(d, i) });
  }
  return out;
}
const openOf = (days: ProfitDayInput[]) => new Set(days.filter((d) => d.sales > 0).map((d) => d.date));

describe("dayProfit", () => {
  const days = year();
  const p = dayProfit({ days, open: openOf(days), fixedMonthly: 8000 });

  it("works out what a typical open day of each weekday leaves", () => {
    expect(p.weekdays.map((w) => w.wd)).toEqual([1, 3, 4, 5, 6, 0]);
    const mon = p.weekdays.find((w) => w.wd === 1)!;
    expect(mon.openDays).toBe(52);
    expect(mon.sales).toBeCloseTo(700);
    expect(mon.goods).toBeCloseTo(210);
    expect(mon.fees).toBeCloseTo(17.5);
    expect(mon.left).toBeCloseTo(700 - 210 - 450 - 17.5);
    expect(mon.yearLeft).toBeCloseTo(52 * 22.5);
    expect(mon.laborPct).toBeCloseTo(450 / 700);
    // The crew is covered at 450 / (1 - 0.325) in sales.
    expect(mon.breakEven).toBeCloseTo(450 / 0.675);
    // Closing pays only if left / (left + labor) of its sales moved to other days.
    expect(mon.moveShare).toBeCloseTo(22.5 / 472.5);
    expect(mon.verdict).toBe("thin");
    expect(p.weekdays.find((w) => w.wd === 6)!.verdict).toBe("pays");
  });

  it("spreads rent over the days the place opens, as a yardstick only", () => {
    expect(p.typical!.openDays).toBe(312);
    expect(p.fixedPerOpenDay).toBeCloseTo((8000 * 12) / ((312 * 365) / 364));
    expect(p.weekdays.find((w) => w.wd === 6)!.coversFixed).toBe(true);
    expect(p.weekdays.find((w) => w.wd === 1)!.coversFixed).toBe(false);
    expect(dayProfit({ days, open: openOf(days) }).weekdays[0].coversFixed).toBeNull();
  });

  it("calls a day that loses money on average a loss, and counts the days that did", () => {
    const hard = year((d) => (weekday(d.date) === 1 ? { labor: 520 } : {}));
    const q = dayProfit({ days: hard, open: openOf(hard) });
    const mon = q.weekdays.find((w) => w.wd === 1)!;
    expect(mon.left).toBeLessThan(0);
    expect(mon.verdict).toBe("loses");
    expect(mon.lostDays).toBe(52);
    expect(mon.moveShare).toBe(0);
  });

  it("estimates card fees at the usual rate on days Square hasn't given them", () => {
    const partial = year((_, i) => (i < 300 ? { fees: null } : {}));
    const q = dayProfit({ days: partial, open: openOf(partial) });
    expect(q.feeRate).toBeCloseTo(0.025);
    expect(q.feesEstimated).toBe(partial.filter((d, i) => i < 300 && d.sales > 0).length);
    expect(q.weekdays.find((w) => w.wd === 1)!.fees).toBeCloseTo(17.5);
    const none = year(() => ({ fees: null }));
    const z = dayProfit({ days: none, open: openOf(none) });
    expect(z.feeRate).toBeNull();
    expect(z.weekdays.find((w) => w.wd === 1)!.fees).toBe(0);
  });

  it("keeps wages on closed days out of every weekday, and reports them", () => {
    const prep = year((d) => (weekday(d.date) === 2 ? { labor: 200 } : {}));
    const q = dayProfit({ days: prep, open: openOf(prep) });
    expect(q.closedLabor).toEqual({ days: 52, total: 52 * 200 });
    expect(q.weekdays.some((w) => w.wd === 2)).toBe(false);
  });

  it("leaves out a weekday that's rarely open, and doesn't advise on one open now and then", () => {
    const some = year((d, i) => (weekday(d.date) === 2 && i < 70 ? { sales: 600, goods: 180, labor: 300, fees: 15 } : {}));
    const q = dayProfit({ days: some, open: openOf(some) });
    const tue = q.weekdays.find((w) => w.wd === 2)!;
    expect(tue.openDays).toBe(10);
    expect(tue.regular).toBe(false);
    expect(q.seasons.some((c) => c.wd === 2)).toBe(false);
    const few = year((d, i) => (weekday(d.date) === 2 && i < 30 ? { sales: 600 } : {}));
    expect(dayProfit({ days: few, open: openOf(few) }).weekdays.some((w) => w.wd === 2)).toBe(false);
  });

  it("splits each regular weekday by season", () => {
    expect(seasonOf("2026-01-10")).toBe(0);
    expect(seasonOf("2026-12-10")).toBe(0);
    expect(seasonOf("2026-03-01")).toBe(1);
    expect(seasonOf("2026-08-31")).toBe(2);
    expect(seasonOf("2026-11-30")).toBe(3);
    const winter = year((d) => (weekday(d.date) === 1 && seasonOf(d.date) === 0 ? { sales: 400, goods: 120, fees: 10 } : {}));
    const q = dayProfit({ days: winter, open: openOf(winter) });
    const cell = (s: number) => q.seasons.find((c) => c.wd === 1 && c.season === s)!;
    expect(cell(0).left).toBeCloseTo(400 - 120 - 450 - 10);
    expect(cell(2).left).toBeCloseTo(22.5);
    expect(q.seasons).toHaveLength(6 * 4);
  });

  it("leaves a one-off day out of the typical day, but keeps it in the year's total", () => {
    const mondays = days.filter((d) => weekday(d.date) === 1).map((d) => d.date);
    const big = mondays[30];
    // One Monday takes five times the usual: a private event, say.
    const odd = days.map((d) => (d.date === big ? { ...d, sales: 3700, goods: 1110, fees: 92.5 } : d));
    const q = dayProfit({ days: odd, open: openOf(odd) });
    expect(q.days.filter((d) => d.oneOff).map((d) => d.date)).toEqual([big]);
    const mon = q.weekdays.find((w) => w.wd === 1)!;
    expect(mon.openDays).toBe(51);
    expect(mon.oneOffs).toBe(1);
    expect(mon.sales).toBeCloseTo(700);
    expect(mon.left).toBeCloseTo(22.5);
    expect(mon.yearLeft).toBeCloseTo(51 * 22.5 + (3700 - 1110 - 450 - 92.5));
    expect(q.typical!.openDays).toBe(311);
    // A good day isn't a one-off: under twice the usual stays in.
    const busy = days.map((d) => (d.date === big ? { ...d, sales: 1300 } : d));
    expect(dayProfit({ days: busy, open: openOf(busy) }).days.some((d) => d.oneOff)).toBe(false);
    // Nor is a whole busy season: summer Saturdays at double winter's are judged against each other.
    const summer = year((d) => (weekday(d.date) === 6 && seasonOf(d.date) === 2 ? { sales: 11000, goods: 3300, fees: 275 } : {}));
    expect(dayProfit({ days: summer, open: openOf(summer) }).days.filter((d) => d.oneOff).length).toBeLessThanOrEqual(4);
  });

  it("copes with nothing", () => {
    const q = dayProfit({ days: [], open: new Set() });
    expect(q.typical).toBeNull();
    expect(q.weekdays).toEqual([]);
    expect(dayProfitStory(q)).toBeNull();
  });
});

describe("hourProfit", () => {
  const days = year();
  const p = dayProfit({ days, open: openOf(days) });
  // Mondays: set up at 3pm, trade 4pm to 9pm, the last two hours slow.
  const rows: HourInput[] = [];
  for (const d of p.days.filter((x) => x.wd === 1)) {
    rows.push({ date: d.date, hour: 15, sales: 0, labor: 50 });
    for (const [hour, sales] of [[16, 120], [17, 180], [18, 180], [19, 130], [20, 60], [21, 30]] as const) rows.push({ date: d.date, hour, sales, labor: hour === 21 ? 60 : 68 });
  }
  const h = hourProfit(rows, p);

  it("shows a typical day hour by hour, from the first person in to the last one out", () => {
    const mon = h.find((x) => x.wd === 1)!;
    expect(mon.hours.map((c) => c.hour)).toEqual([15, 16, 17, 18, 19, 20, 21]);
    expect(mon.hours[0].trading).toBe(false);
    const six = mon.hours.find((c) => c.hour === 18)!;
    expect(six.sales).toBeCloseTo(180);
    expect(six.kept).toBeCloseTo(180 * 0.675);
    expect(six.left).toBeCloseTo(180 * 0.675 - 68);
  });

  it("flags closing hours that cost more in wages than their sales leave", () => {
    const late = h.find((x) => x.wd === 1)!.late!;
    // 8pm keeps 40.5 against 68 of wages; 9pm keeps 20.25 against 60.
    expect(late.from).toBe(20);
    expect(late.hours).toBe(2);
    expect(late.left).toBeCloseTo(40.5 - 68 + 20.25 - 60);
    expect(late.yearLeft).toBeCloseTo(late.left * 52);
    // A weekday with no hourly rows isn't listed.
    expect(h.some((x) => x.wd === 6)).toBe(false);
  });

  it("doesn't flag a day whose last hour pays", () => {
    const good = rows.map((r) => (r.hour >= 20 ? { ...r, sales: 150 } : r));
    expect(hourProfit(good, p).find((x) => x.wd === 1)!.late).toBeNull();
  });
});

describe("dayProfitStory", () => {
  it("says so when every day pays, and names the thinnest", () => {
    const days = year((d) => (weekday(d.date) === 1 ? { sales: 1200, goods: 360, fees: 30 } : {}));
    // $12,000 a month over about 313 open days is some $460 a day: Mondays and Wednesdays leave less.
    const s = dayProfitStory(dayProfit({ days, open: openOf(days), fixedMonthly: 12000 }))!;
    expect(s.level).toBe("good");
    expect(s.headline).toBe("Every day you open pays for itself");
    expect(s.points[0].key).toBe("weakest");
    expect(s.points[0].title).toContain("Monday");
    expect(s.points[0].action).toContain("Keep it open");
    expect(s.points.find((x) => x.key === "rent")!.title).toContain("pay the rent");
  });

  it("names the days that only just pay, and the ones that lose", () => {
    const days = year();
    const thin = dayProfitStory(dayProfit({ days, open: openOf(days) }))!;
    expect(thin.level).toBe("warn");
    expect(thin.headline).toBe("Every day you open pays for itself, but Mondays only just");
    expect(thin.points.find((x) => x.key === "labor")!.title).toBe("Wages take 64% of sales on a Monday and 20% on a Saturday");
    const hard = year((d) => (weekday(d.date) === 1 ? { labor: 600 } : {}));
    const bad = dayProfitStory(dayProfit({ days: hard, open: openOf(hard) }))!;
    expect(bad.level).toBe("bad");
    expect(bad.headline).toBe("Mondays cost more to open than they bring in");
    expect(bad.points[0].title).toBe("A typical Monday loses about $130");
    expect(bad.points[0].action).toContain("would save about $6,600 a year");
  });

  it("points at a season when a weekday only loses then, and at wages on closed days", () => {
    const days = year((d) => (weekday(d.date) === 1 && seasonOf(d.date) === 0 ? { sales: 400, goods: 120, fees: 10 } : weekday(d.date) === 2 ? { labor: 150 } : {}));
    const s = dayProfitStory(dayProfit({ days, open: openOf(days) }))!;
    expect(s.points.find((x) => x.key === "season")!.title).toBe("Mondays in winter lose money");
    expect(s.points.find((x) => x.key === "closed")!.title).toBe("$7,800 of wages fell on days you were closed");
  });

  it("says when the last couple of months are worse than the year", () => {
    // The last 8 Mondays took half as much: each lost money, though the year's average is fine.
    const base = year((d) => (weekday(d.date) === 1 ? { sales: 1200, goods: 360, fees: 30 } : {}));
    const mondays = base.filter((d) => weekday(d.date) === 1).map((d) => d.date);
    const slow = new Set(mondays.slice(-8));
    const days = base.map((d) => (slow.has(d.date) ? { ...d, sales: 500, goods: 150, fees: 12.5 } : d));
    const p = dayProfit({ days, open: openOf(days) });
    const mon = p.weekdays.find((w) => w.wd === 1)!;
    expect(mon.left).toBeGreaterThan(0);
    expect(mon.recent).toEqual({ days: 8, left: 500 - 150 - 450 - 12.5, lost: 8 });
    const s = dayProfitStory(p)!;
    expect(s.level).toBe("warn");
    expect(s.headline).toBe("Every day paid for itself over the year, but lately Mondays haven't");
    const r = s.points.find((x) => x.key === "recent")!;
    expect(r.tone).toBe("bad");
    expect(r.title).toBe("Lately Mondays have been losing money");
    expect(r.detail).toContain("lost about $110 each on average");
    // A steady year says nothing about lately.
    expect(dayProfitStory(dayProfit({ days: base, open: openOf(base) }))!.points.some((x) => x.key === "recent")).toBe(false);
  });

  it("words dollars and hours the way they're said", () => {
    expect(about(1234)).toBe("$1,200");
    expect(about(87)).toBe("$90");
    expect(about(-15400)).toBe("−$15,000");
    expect(hourLabel(0)).toBe("12am");
    expect(hourLabel(12)).toBe("12pm");
    expect(hourLabel(20)).toBe("8pm");
  });
});
