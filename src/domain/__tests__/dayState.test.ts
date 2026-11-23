import { describe, expect, it } from "vitest";
import { changeIfIn, countStates, dayState, DAY_STATE_WORD, syncedThroughDate, type DayStateContext } from "../dayState";

// 2026-11-23 is a Monday. Tuesdays are closed in the default hours.
const ctx = (o: Partial<DayStateContext> = {}): DayStateContext => ({ today: "2026-11-23", syncedThrough: "2026-11-14", ...o });

describe("dayState", () => {
  it("a day with sales is in, whatever the sync says", () => {
    expect(dayState({ date: "2026-11-20", sales: 812 }, ctx())).toBe("in");
    expect(dayState({ date: "2026-11-10", sales: 1200 }, ctx())).toBe("in");
  });

  it("a day past the last full sync with no sales is not in yet, not closed", () => {
    expect(dayState({ date: "2026-11-20", sales: 0 }, ctx())).toBe("notIn");
    expect(dayState({ date: "2026-11-15", sales: 0 }, ctx())).toBe("notIn");
  });

  it("a day Square has synced past and found nothing is closed", () => {
    expect(dayState({ date: "2026-11-12", sales: 0 }, ctx())).toBe("closed");
  });

  it("never synced: every finished day without sales is not in yet", () => {
    expect(dayState({ date: "2026-11-12", sales: 0 }, ctx({ syncedThrough: null }))).toBe("notIn");
  });

  it("a weekday the hours skip, or a closure on the calendar, is closed even before the sync", () => {
    const open = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 2;
    expect(dayState({ date: "2026-11-17", sales: 0 }, ctx({ isOpenDay: open }))).toBe("closed"); // a Tuesday
    expect(dayState({ date: "2026-11-18", sales: 0 }, ctx({ isOpenDay: open }))).toBe("notIn");
    expect(dayState({ date: "2026-11-19", sales: 0 }, ctx({ closures: ["2026-11-19"] }))).toBe("closed");
  });

  it("today and the days ahead are their own states", () => {
    expect(dayState({ date: "2026-11-23", sales: 0 }, ctx())).toBe("today");
    expect(dayState({ date: "2026-11-23", sales: 300 }, ctx())).toBe("today");
    expect(dayState({ date: "2026-11-25", sales: 0 }, ctx())).toBe("future");
  });

  it("refunds alone still count as a day that's in", () => {
    expect(dayState({ date: "2026-11-10", sales: -40 }, ctx())).toBe("in");
  });
});

describe("syncedThroughDate", () => {
  it("is the day before the sync, and leaves out a night the sync ran too early to see close", () => {
    // 10am New York on the 16th: the 15th is complete.
    expect(syncedThroughDate("2026-11-23", "2026-11-16T15:00:00Z", "America/New_York")).toBe("2026-11-15");
    // 10pm New York on the 15th: the 15th may still be trading.
    expect(syncedThroughDate("2026-11-23", "2026-11-16T03:12:21Z", "America/New_York")).toBe("2026-11-14");
  });
  it("never runs past yesterday, and is null with no sync", () => {
    expect(syncedThroughDate("2026-11-23", "2026-11-23T18:00:00Z", "America/New_York")).toBe("2026-11-22");
    expect(syncedThroughDate("2026-11-23", null, "America/New_York")).toBeNull();
  });
});

describe("changeIfIn", () => {
  it("compares two figures only when both days are in", () => {
    expect(changeIfIn(500, "in", 1000, "in")).toBeCloseTo(-0.5);
    expect(changeIfIn(140, "in", 1000, "notIn")).toBeNull();
    expect(changeIfIn(0, "notIn", 1000, "in")).toBeNull();
    expect(changeIfIn(0, "closed", 1000, "in")).toBeNull();
    expect(changeIfIn(500, "in", 0, "in")).toBeNull();
  });
});

describe("countStates and words", () => {
  it("counts each state", () => {
    expect(countStates(["in", "in", "notIn", "closed", "today"])).toEqual({ in: 2, closed: 1, notIn: 1, today: 1, future: 0 });
  });
  it("has a word for the days that aren't plain numbers", () => {
    expect(DAY_STATE_WORD.notIn).toBe("Not in yet");
    expect(DAY_STATE_WORD.closed).toBe("Closed");
  });
});
