import { describe, expect, it } from "vitest";
import { cutoffColumnsPatch, cutoffRule, savedCutoff } from "../ordering";

const none = { cutoffTime: null, cutoffDaysBefore: null, autoDraft: true, cutoffPerDay: null };

describe("savedCutoff", () => {
  it("is undefined when the supplier has set nothing", () => {
    expect(savedCutoff(none)).toBeUndefined();
    expect(cutoffRule(savedCutoff(none), 2)).toEqual({ time: "14:00", daysBefore: 2, autoDraft: true });
  });
  it("reads what is set", () => {
    const s = savedCutoff({ cutoffTime: "17:00", cutoffDaysBefore: 3, autoDraft: false, cutoffPerDay: { 5: { day: 3, time: "17:00" } } });
    expect(s).toEqual({ time: "17:00", daysBefore: 3, autoDraft: false, perDay: { 5: { day: 3, time: "17:00" } } });
    expect(cutoffRule(s, 1)).toMatchObject({ time: "17:00", daysBefore: 3, autoDraft: false });
  });
  it("ignores a per-day block that isn't an object", () => {
    expect(savedCutoff({ ...none, cutoffPerDay: [1, 2] })).toBeUndefined();
    expect(savedCutoff({ ...none, cutoffPerDay: {} })).toBeUndefined();
  });
});

describe("cutoffColumnsPatch", () => {
  it("doesn't keep days before delivery twice when they match the lead time", () => {
    expect(cutoffColumnsPatch({ daysBefore: 2 }, 2)).toEqual({ cutoffDaysBefore: null });
    expect(cutoffColumnsPatch({ daysBefore: 1 }, 2)).toEqual({ cutoffDaysBefore: 1 });
  });
  it("writes only what changed", () => {
    expect(cutoffColumnsPatch({ autoDraft: false }, 1)).toEqual({ autoDraft: false });
    expect(cutoffColumnsPatch({ time: "09:30" }, 1)).toEqual({ cutoffTime: "09:30" });
    expect(cutoffColumnsPatch({ time: "25:00" }, 1)).toEqual({ cutoffTime: null });
  });
  it("clears per-day deadlines when none are left", () => {
    expect(cutoffColumnsPatch({ perDay: {} }, 1)).toEqual({ cutoffPerDay: null });
    expect(cutoffColumnsPatch({ perDay: { 2: { day: 1, time: "12:00" } } }, 1)).toEqual({ cutoffPerDay: { 2: { day: 1, time: "12:00" } } });
  });
});
