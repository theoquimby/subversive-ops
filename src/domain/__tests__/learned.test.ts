import { describe, expect, it } from "vitest";
import { addDays, dateRange, weekday, type ISODate } from "../dates";
import {
  applyHoursChanges,
  bufferFromPlan,
  distanceKm,
  fingerprint,
  hoursChanges,
  inferDeadlines,
  inferDeliveryDays,
  inferHoursFromSales,
  isDismissed,
  longestGap,
  salesWeek,
  squareWeek,
  suggestPar,
  townFromAddress,
  type HourSale,
} from "../learned";
import type { WeekHours } from "../openingHours";

const FROM = "2026-08-17"; // a Monday
const TO = addDays(FROM, 12 * 7 - 1);

/** Synthetic Subversive: closed Tuesdays, a busy middle, a trickle of tabs after close. */
function week(hours: WeekHours, opts: { tabs?: number; stray?: boolean; late?: boolean; noisyFrom?: number } = {}): HourSale[] {
  const rows: HourSale[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const d of dateRange(FROM, addDays(TO, 1))) {
    const h = hours[weekday(d)];
    if (!h) {
      if (opts.stray && weekday(d) === 2 && d < addDays(FROM, 14)) rows.push({ date: d, hour: 14, sales: 22 }); // a stray sale on a closed day
      continue;
    }
    const [o, c] = h;
    for (let x = o; x < c; x++) {
      const mid = (o + c) / 2;
      const shape = 1 - Math.abs(x + 0.5 - mid) / (c - o); // 0.5 at the edges, 1 in the middle
      rows.push({ date: d, hour: x % 24 === x ? x : x - 24, sales: Math.round(400 * shape * (0.8 + rand() * 0.4)) });
    }
    // People settling tabs just after close.
    if (opts.tabs) rows.push({ date: d, hour: c, sales: opts.tabs * (0.5 + rand()) });
    // A late tab paid at 1am belongs to the night before.
    if (opts.late) rows.push({ date: addDays(d, 1), hour: 1, sales: 30 });
  }
  return rows;
}

const SUBVERSIVE: WeekHours = { 0: [12, 19], 1: [16, 20], 3: [16, 20], 4: [16, 20], 5: [16, 21], 6: [12, 21] };

describe("opening hours from sales by hour", () => {
  it("finds open hours and the closed Tuesday", () => {
    const r = inferHoursFromSales(week(SUBVERSIVE), { from: FROM, to: TO });
    expect(salesWeek(r).week).toEqual(SUBVERSIVE);
    expect(r.days[2]).toMatchObject({ status: "closed", openDays: 0, seen: 12 });
    expect(r.weeks).toBe(12);
  });

  it("doesn't let tabs settled after close or a stray sale move the hours", () => {
    const r = inferHoursFromSales(week(SUBVERSIVE, { tabs: 40, stray: true, late: true }), { from: FROM, to: TO });
    expect(salesWeek(r).week).toEqual(SUBVERSIVE);
    expect(r.days[2].status).toBe("closed");
  });

  it("counts a busy late night toward the night before, closing at midnight", () => {
    const rows = week({ 5: [17, 24] });
    // Busy until 1am every Friday: sales at 00:00–00:59 recorded on Saturday's date.
    for (const d of dateRange(FROM, addDays(TO, 1))) if (weekday(d) === 6) rows.push({ date: d, hour: 0, sales: 300 });
    const r = inferHoursFromSales(rows, { from: FROM, to: TO });
    expect(r.days[5]).toMatchObject({ status: "open", hours: [17, 24] });
    expect(r.days[6].status).toBe("closed");
  });

  it("won't guess a weekday that's open only some weeks, or with too little history", () => {
    const rows = week(SUBVERSIVE).filter((r) => !(weekday(r.date) === 1 && Number(r.date.slice(8)) % 2 === 0));
    const r = inferHoursFromSales(rows, { from: FROM, to: TO });
    expect(["unsure", "open"]).toContain(r.days[1].status);
    const short = inferHoursFromSales(week(SUBVERSIVE), { from: FROM, to: addDays(FROM, 13) });
    expect(short.days[1].status).toBe("unsure");
  });

  it("uses the median day, so one private party doesn't change the hours", () => {
    const rows = week(SUBVERSIVE);
    rows.push({ date: "2026-09-02", hour: 22, sales: 5000 }, { date: "2026-09-02", hour: 12, sales: 2000 }); // a Wednesday party
    expect(salesWeek(inferHoursFromSales(rows, { from: FROM, to: TO })).week[3]).toEqual([16, 20]);
  });

  it("can leave out dates that run on other hours (a season)", () => {
    const rows = week(SUBVERSIVE);
    const r = inferHoursFromSales(rows, { from: FROM, to: TO }, (d) => d >= addDays(FROM, 28));
    expect(r.weeks).toBe(8);
    expect(r.days[3].seen).toBe(8);
  });
});

describe("Square's business hours", () => {
  it("turns periods into a week; missing days are closed", () => {
    expect(squareWeek([
      { day_of_week: "WED", start_local_time: "16:00:00", end_local_time: "22:00:00" },
      { day_of_week: "SAT", start_local_time: "11:30:00", end_local_time: "14:00:00" },
      { day_of_week: "SAT", start_local_time: "17:00:00", end_local_time: "21:30:00" },
      { day_of_week: "FRI", start_local_time: "16:00:00", end_local_time: "01:00:00" },
    ])).toEqual({ 3: [16, 22], 6: [11, 22], 5: [16, 24] });
  });
  it("is null when Square has no hours", () => {
    expect(squareWeek(undefined)).toBeNull();
    expect(squareWeek([])).toBeNull();
    expect(squareWeek([{ day_of_week: "XYZ", start_local_time: "1" }])).toBeNull();
  });
});

describe("comparing hours", () => {
  const sales = inferHoursFromSales(week({ ...SUBVERSIVE, 4: [16, 21] }), { from: FROM, to: TO });
  it("lists only the days that differ, Square first", () => {
    const changes = hoursChanges(SUBVERSIVE, sales, null);
    expect(changes).toEqual([{ weekday: 4, saved: [16, 20], sales: [16, 21], next: [16, 21] }]);
    const sq = hoursChanges(SUBVERSIVE, sales, { ...SUBVERSIVE, 4: [16, 22] });
    expect(sq).toEqual([{ weekday: 4, saved: [16, 20], sales: [16, 21], square: [16, 22], next: [16, 22] }]);
    expect(hoursChanges(SUBVERSIVE, sales, { ...SUBVERSIVE, 4: [16, 22] }, "sales")[0].next).toEqual([16, 21]);
  });
  it("is empty when everything agrees, and applying keeps untouched days", () => {
    expect(hoursChanges(SUBVERSIVE, inferHoursFromSales(week(SUBVERSIVE), { from: FROM, to: TO }), SUBVERSIVE)).toEqual([]);
    const next = applyHoursChanges(SUBVERSIVE, [{ weekday: 2, saved: null, next: [16, 20] }, { weekday: 1, saved: [16, 20], next: null }]);
    expect(next).toEqual({ ...SUBVERSIVE, 2: [16, 20], 1: undefined } as unknown as WeekHours);
    expect(1 in next).toBe(false);
  });
});

describe("delivery days from invoices and orders", () => {
  const on = (wds: number[], weeks: number): { date: ISODate; source: "invoice" }[] =>
    dateRange("2026-06-01", addDays("2026-06-01", weeks * 7)).filter((d) => wds.includes(weekday(d))).map((date) => ({ date, source: "invoice" }));

  it("finds a Tue/Fri distributor with high confidence despite one odd day", () => {
    const obs = [...on([2, 5], 8), { date: "2026-06-11", source: "invoice" as const }];
    const r = inferDeliveryDays(obs);
    expect(r.days).toEqual([2, 5]);
    expect(r.confidence).toBe("high");
    expect(r.coverage).toBeCloseTo(16 / 17);
  });

  it("counts an invoice and the received order on the same date once", () => {
    const r = inferDeliveryDays([{ date: "2026-06-02", source: "invoice" }, { date: "2026-06-02", source: "order" }, { date: "2026-06-09", source: "order" }]);
    expect(r.n).toBe(2);
    expect(r.confidence).toBe("low");
  });

  it("stays low when dates are scattered (receipts from a grocery run)", () => {
    const scattered = ["2026-07-01", "2026-07-09", "2026-07-14", "2026-07-19", "2026-07-24", "2026-08-01", "2026-08-06", "2026-08-11", "2026-08-16", "2026-08-21", "2026-08-25"].map((date) => ({ date, source: "invoice" as const }));
    const r = inferDeliveryDays(scattered);
    expect(r.confidence).toBe("low");
  });

  it("is medium with a handful of deliveries", () => {
    const r = inferDeliveryDays(on([3], 5));
    expect(r).toMatchObject({ days: [3], n: 5, confidence: "medium", coverage: 1 });
    expect(inferDeliveryDays([]).confidence).toBe("low");
  });
});

describe("order deadlines from sent orders", () => {
  it("uses the usual sending day and the latest time that still worked", () => {
    const r = inferDeadlines([
      { sentDate: "2026-06-01", sentTime: "13:10", deliveryDate: "2026-06-02" }, // Mon → Tue
      { sentDate: "2026-06-08", sentTime: "15:45", deliveryDate: "2026-06-09" },
      { sentDate: "2026-06-12", sentTime: "09:00", deliveryDate: "2026-06-16" }, // an early one, odd
      { sentDate: "2026-06-03", sentTime: "11:00", deliveryDate: "2026-06-05" }, // Wed → Fri
      { sentDate: "2026-06-10", sentTime: "16:20", deliveryDate: "2026-06-12" },
    ]);
    expect(r.perDay[2]).toEqual({ day: 1, time: "15:30", n: 3 });
    expect(r.perDay[5]).toEqual({ day: 3, time: "16:00", n: 2 });
    expect(r.leadDays).toBe(2); // 1 and 2 days tie → the safer, earlier one
  });
  it("needs two orders per delivery day", () => {
    expect(inferDeadlines([{ sentDate: "2026-06-01", sentTime: "13:00", deliveryDate: "2026-06-02" }])).toEqual({ leadDays: null, perDay: {}, n: 1 });
  });
});

describe("weather location", () => {
  it("measures distance", () => {
    expect(distanceKm({ lat: 42.2173, lon: -73.8646 }, { lat: 42.2173, lon: -73.8646 })).toBe(0);
    expect(distanceKm({ lat: 42.2173, lon: -73.8646 }, { lat: 42.2529, lon: -73.7909 })).toBeGreaterThan(6); // Catskill → Hudson
  });
  it("reads the town from an address", () => {
    expect(townFromAddress("283 Main St, Catskill, NY 12414")).toBe("Catskill, NY");
    expect(townFromAddress("Catskill")).toBeNull();
    expect(townFromAddress("1 Rue X, Paris")).toBe("Paris");
  });
});

describe("minimums and buffers", () => {
  it("finds the longest wait between deliveries", () => {
    expect(longestGap([2, 5])).toBe(4);
    expect(longestGap([3])).toBe(7);
    expect(longestGap([])).toBe(7);
    expect(longestGap([0, 1, 2, 3, 4, 5, 6])).toBe(1);
  });
  it("suggests a minimum on hand from the buying rate, in whole packs", () => {
    const purchases = [{ date: "2026-08-01", qtyBase: 500 }, { date: "2026-08-15", qtyBase: 500 }, { date: "2026-09-01", qtyBase: 1000 }];
    const r = suggestPar({ purchases, windowDays: 40, deliveryDays: [2, 5], packBase: 500 });
    expect(r).toMatchObject({ qtyBase: 500, n: 3 }); // 50/day × 4 days = 200 → one pack
    expect(suggestPar({ purchases: purchases.slice(0, 2), windowDays: 40, deliveryDays: [2], packBase: 500 })).toBeNull();
  });
  it("turns the order-size model's pick into a buffer", () => {
    expect(bufferFromPlan({ onHand: 2, best: 2, pack: 6, mean: 10 })).toBe(0.4);
    expect(bufferFromPlan({ onHand: 0, best: 1, pack: 6, mean: 10 })).toBe(0);
    expect(bufferFromPlan({ onHand: 0, best: 1, pack: 6, mean: 0 })).toBeNull();
  });
});

describe("dismissing", () => {
  it("hides the same suggestion but not a new one", () => {
    const d = { hours: fingerprint({ b: [16, 21], a: 1 }) };
    expect(isDismissed(d, "hours", { a: 1, b: [16, 21] })).toBe(true);
    expect(isDismissed(d, "hours", { a: 1, b: [16, 22] })).toBe(false);
    expect(isDismissed(d, "other", { a: 1 })).toBe(false);
  });
});
