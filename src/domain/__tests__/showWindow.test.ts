import { describe, expect, it } from "vitest";
import { checkDayWindow, checkStart, dayLabel, dayState, dayStateAt, dayWindowLabel, instantState, startInstant, startLabel, startParts } from "../showWindow";

const NY = "America/New_York";

describe("dayState (website notice)", () => {
  it("is scheduled before its first day, showing on it, ended after the last", () => {
    expect(dayState("2026-11-20", "2026-11-26", "2026-11-16")).toBe("scheduled");
    expect(dayState("2026-11-20", "2026-11-26", "2026-11-20")).toBe("showing");
    expect(dayState("2026-11-20", "2026-11-26", "2026-11-26")).toBe("showing");
    expect(dayState("2026-11-20", "2026-11-26", "2026-11-27")).toBe("ended");
  });
  it("with no dates it is simply showing", () => {
    expect(dayState(null, null, "2030-01-01")).toBe("showing");
    expect(dayState(null, "2026-11-26", "2026-11-16")).toBe("showing");
    expect(dayState("2026-11-01", null, "2026-11-16")).toBe("showing");
  });
});

describe("instantState (staff announcements)", () => {
  const start = new Date("2026-11-20T21:30:00Z");
  it("is scheduled until the start minute, then showing", () => {
    expect(instantState(start, null, new Date("2026-11-20T21:29:59Z"))).toBe("scheduled");
    expect(instantState(start, null, start)).toBe("showing");
    expect(instantState(null, null, new Date())).toBe("showing");
  });
  it("ends at its end, not a minute after", () => {
    const end = new Date("2026-11-27T21:30:00Z");
    expect(instantState(start, end, new Date("2026-11-27T21:29:00Z"))).toBe("showing");
    expect(instantState(start, end, end)).toBe("ended");
  });
});

describe("timezone edge at midnight", () => {
  it("a notice starting Nov 20 waits until midnight in New York, not UTC", () => {
    // 11:59 pm Nov 19 in New York is 04:59 Nov 20 UTC.
    expect(dayStateAt("2026-11-20", null, new Date("2026-11-20T04:59:00Z"), NY)).toBe("scheduled");
    expect(dayStateAt("2026-11-20", null, new Date("2026-11-20T05:00:00Z"), NY)).toBe("showing");
  });
  it("its last day runs to midnight in New York", () => {
    expect(dayStateAt(null, "2026-11-26", new Date("2026-11-27T04:59:00Z"), NY)).toBe("showing");
    expect(dayStateAt(null, "2026-11-26", new Date("2026-11-27T05:00:00Z"), NY)).toBe("ended");
  });
  it("a start picked as midnight is local midnight, summer and winter", () => {
    expect(startInstant("2026-11-20", 0, NY).toISOString()).toBe("2026-11-20T05:00:00.000Z");
    expect(startInstant("2026-07-04", 0, NY).toISOString()).toBe("2026-07-04T04:00:00.000Z");
    expect(startParts(new Date("2026-11-20T05:00:00Z"), NY)).toEqual({ date: "2026-11-20", minutes: 0 });
    expect(startParts(new Date("2026-11-20T04:59:00Z"), NY)).toEqual({ date: "2026-11-19", minutes: 1439 });
  });
});

describe("labels", () => {
  it("says the day of the week", () => {
    expect(dayLabel("2026-11-20")).toBe("Fri Nov 20");
    expect(dayLabel("2027-01-02", "2026-11-16")).toBe("Sat Jan 2, 2027");
  });
  it("says where the notice stands", () => {
    expect(dayWindowLabel("2026-11-20", "2026-11-26", "2026-11-16")).toEqual({ state: "scheduled", label: "Scheduled: shows from Fri Nov 20 until Thu Nov 26" });
    expect(dayWindowLabel("2026-11-20", null, "2026-11-16").label).toBe("Scheduled: shows from Fri Nov 20");
    expect(dayWindowLabel(null, "2026-11-26", "2026-11-16")).toEqual({ state: "showing", label: "Showing now · until Thu Nov 26" });
    expect(dayWindowLabel(null, "2026-11-16", "2026-11-16").label).toBe("Showing now · last day today");
    expect(dayWindowLabel(null, null, "2026-11-16").label).toBe("Showing now · until you take it down");
    expect(dayWindowLabel(null, "2026-11-10", "2026-11-16")).toEqual({ state: "ended", label: "Ended" });
  });
  it("says when an announcement starts", () => {
    const now = new Date("2026-11-16T15:00:00Z");
    expect(startLabel(new Date("2026-11-16T21:30:00Z"), now, NY)).toBe("today at 4:30 pm");
    expect(startLabel(new Date("2026-11-17T14:00:00Z"), now, NY)).toBe("tomorrow at 9:00 am");
    expect(startLabel(new Date("2026-11-20T21:30:00Z"), now, NY)).toBe("Fri Nov 20 at 4:30 pm");
  });
});

describe("checks on save", () => {
  it("keeps a future start and turns a start today or earlier into now", () => {
    expect(checkDayWindow("2026-11-20", "2026-11-26", "2026-11-16")).toEqual({ from: "2026-11-20", until: "2026-11-26" });
    expect(checkDayWindow("2026-11-16", null, "2026-11-16")).toEqual({ from: null, until: null });
    expect(checkDayWindow("", "", "2026-11-16")).toEqual({ from: null, until: null });
  });
  it("rejects a start after the last day, with a plain message", () => {
    expect(checkDayWindow("2026-11-27", "2026-11-26", "2026-11-16")).toEqual({ error: expect.stringContaining("start after its last day") });
  });
  it("rejects a last day that has passed and days that aren't days", () => {
    expect(checkDayWindow(null, "2026-11-15", "2026-11-16")).toHaveProperty("error");
    expect(checkDayWindow("2026-02-30", null, "2026-11-16")).toHaveProperty("error");
  });
  it("checks an announcement's start against its end", () => {
    const now = new Date("2026-11-16T15:00:00Z");
    const later = new Date("2026-11-20T21:30:00Z");
    expect(checkStart(later, null, now)).toEqual({ startsAt: later });
    expect(checkStart(new Date("2026-11-16T14:00:00Z"), null, now)).toEqual({ startsAt: null });
    expect(checkStart(null, null, now)).toEqual({ startsAt: null });
    expect(checkStart(later, new Date("2026-11-19T00:00:00Z"), now)).toEqual({ error: expect.stringContaining("before it starts") });
    expect(checkStart(new Date("x"), null, now)).toHaveProperty("error");
  });
});
