import { describe, expect, it } from "vitest";
import { dayList, weekStory, type StoryDay } from "../scheduleStory";

// Mon Nov 23 2026 to Sun Nov 29; Thanksgiving is Thu Nov 26.
const day = (n: number, x: Partial<StoryDay> = {}): StoryDay => ({
  date: `2026-11-${String(n).padStart(2, "0")}`, sales: 3000, cost: 700, hours: 40, requiredHours: 40, open: true, openShifts: 0, ...x,
});

describe("dayList", () => {
  it("names runs of days plainly", () => {
    expect(dayList(["2026-11-27", "2026-11-28", "2026-11-29"])).toBe("Fri to Sun");
    expect(dayList(["2026-11-27", "2026-11-28"])).toBe("Fri and Sat");
    expect(dayList(["2026-11-23", "2026-11-25", "2026-11-27"])).toBe("Mon, Wed and Fri");
    expect(dayList(["2026-11-23"])).toBe("Mon");
  });
});

describe("weekStory", () => {
  // The week the critique saw: green labor % next to 70 hours over need and 12 open shifts.
  const week = [
    day(23, { sales: 3002, cost: 650, hours: 40, requiredHours: 40, openShifts: 1 }),
    day(24, { sales: 3060, cost: 0, hours: 0, requiredHours: 0, open: false }),
    day(25, { sales: 3590, cost: 681, hours: 40, requiredHours: 41 }),
    day(26, { sales: 0, cost: 712, hours: 44, requiredHours: 24, openShifts: 1 }),
    day(27, { sales: 3060, cost: 1081, hours: 66, requiredHours: 43, openShifts: 3 }),
    day(28, { sales: 3519, cost: 1358, hours: 82.5, requiredHours: 66, openShifts: 3 }),
    day(29, { sales: 3060, cost: 1004, hours: 61.5, requiredHours: 50, openShifts: 4 }),
  ];
  const s = weekStory({ days: week, laborTarget: 0.3, today: "2026-11-23" });

  it("leaves a closed day's forecast and a day with no forecast out of the labor %", () => {
    expect(s.sales).toBe(3002 + 3590 + 3060 + 3519 + 3060);
    expect(s.laborPct).toBeCloseTo((650 + 681 + 1081 + 1358 + 1004) / s.sales, 5);
    expect(s.unforecastCost).toBe(712);
  });
  it("leads with the hours over need and what to do with the open shifts on those days", () => {
    expect(s.tone).toBe("warn");
    expect(s.title).toBe("71h more than the forecast needs, on Thu to Sun");
    expect(s.line).toContain("11 of the 12 open shifts are on those days: delete them rather than fill them");
    expect(s.line).toContain("Fri and Sat run at 35% and 39% labor");
  });
  it("flags the holiday, the closed day with a forecast and the day with none", () => {
    expect(s.flags["2026-11-26"]!.map((f) => f.kind)).toEqual(["holiday", "no-forecast"]);
    expect(s.flags["2026-11-26"]![0].label).toBe("Thanksgiving");
    expect(s.flags["2026-11-24"]!.map((f) => f.kind)).toEqual(["closed-forecast"]);
    expect(s.flags["2026-11-23"]).toBeUndefined();
  });
  it("says to fill open shifts from over-staffed days when they sit on other days", () => {
    const w = week.map((d) => ({ ...d, openShifts: d.date === "2026-11-23" ? 2 : 0 }));
    expect(weekStory({ days: w, laborTarget: 0.3, today: "2026-11-23" }).line).toContain("Fill the 2 open shifts on Mon from the people over need on Thu to Sun");
  });
  it("calls a short week short, and a fitting week good", () => {
    const short = weekStory({ days: [day(23, { hours: 20 }), day(24, { hours: 22 }), day(25)], laborTarget: null, today: "2026-11-23" });
    expect(short.title).toBe("38h short of what the forecast needs, on Mon and Tue");
    const fine = weekStory({ days: [day(23), day(24), day(25)], laborTarget: 0.3, today: "2026-11-23" });
    expect(fine.tone).toBe("good");
    expect(fine.title).toBe("The crew fits the forecast");
    expect(fine.line).toBe("23% labor against a 30% budget, 120h scheduled for 120h needed.");
  });
  it("has nothing to judge with no shifts", () => {
    const empty = weekStory({ days: [day(23, { hours: 0, cost: 0 })], laborTarget: null, today: "2026-11-23" });
    expect(empty.tone).toBe("neutral");
    expect(empty.title).toBe("No shifts on the schedule yet");
  });
});
