import { describe, expect, it } from "vitest";
import { isBuyout } from "../privateEvents";
import { feedEvent, PRIVATE_CLOSURE_TITLE, privateClosureEvent } from "../websiteEvents";

const spaces = [
  { name: "Whole taproom", buyout: true, capacity: 120 },
  { name: "Back room", buyout: false, capacity: 40 },
];

describe("isBuyout", () => {
  it("follows the space when it's one of ours", () => {
    expect(isBuyout({ space: "Whole taproom", type: "PARTY" }, spaces)).toBe(true);
    expect(isBuyout({ space: "Back room", type: "BUYOUT" }, spaces)).toBe(false);
  });
  it("falls back to the booking type with no known space", () => {
    expect(isBuyout({ space: null, type: "BUYOUT" }, spaces)).toBe(true);
    expect(isBuyout({ space: "Somewhere", type: "WEDDING" }, spaces)).toBe(false);
  });
});

describe("a buyout on the website", () => {
  it("is a closure with its hours and nothing about the booking", () => {
    const e = privateClosureEvent({ id: "ev1", date: "2026-12-05", startTime: "18:00", endTime: "23:00", updatedAt: "2026-11-16T12:00:00.000Z" });
    expect(e).toEqual({ id: "ev1", date: "2026-12-05", title: PRIVATE_CLOSURE_TITLE, kind: "CLOSURE", closed: true, startTime: "18:00", endTime: "23:00", description: null, updatedAt: "2026-11-16T12:00:00.000Z" });
    expect(JSON.stringify(e)).not.toMatch(/Smith|guests|Private event:/);
  });
  it("drops a time that isn't HH:MM", () => {
    expect(privateClosureEvent({ id: "ev1", date: "2026-12-05", startTime: "6pm", endTime: null, updatedAt: "x" })).toMatchObject({ startTime: null, endTime: null });
  });
  it("the ordinary feed still never sends a private booking", () => {
    expect(feedEvent({ id: "ev1", date: "2026-12-05", title: "Private event: Smith wedding", kind: "PRIVATE", startTime: null, endTime: null, notes: "80 guests", updatedAt: "x" }, null, { holidaysClosed: false })).toBeNull();
  });
});
