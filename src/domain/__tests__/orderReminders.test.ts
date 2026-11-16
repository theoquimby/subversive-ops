import { describe, expect, it } from "vitest";
import { cutoffRule } from "../ordering";
import { dueReminders, firstReminderMins, lastPassedCutoff, missedOrder, missedPushDue, pruneSentKeys, type ReminderInput } from "../orderReminders";

// 2026-11-16 is a Monday.
const next = { deliveryDate: "2026-11-18", cutoffDate: "2026-11-17", cutoffTime: "14:00" };
const base = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  supplierId: "s1",
  supplierName: "Driscoll",
  now: { date: "2026-11-17", time: "10:00" },
  next,
  placed: "none",
  nag: true,
  prefs: { first: "4h", lastCallMins: 60 },
  morningHour: 9,
  sent: new Set(),
  ...over,
});

describe("firstReminderMins", () => {
  it("is a day, 4 hours, or from the morning hour", () => {
    expect(firstReminderMins("24h", next, 9)).toBe(1440);
    expect(firstReminderMins("4h", next, 9)).toBe(240);
    expect(firstReminderMins("morning", next, 9)).toBe(300); // 9am → 2pm
    expect(firstReminderMins("none", next, 9)).toBeNull();
  });
  it("falls back to the evening before when the cutoff is before the morning hour", () => {
    expect(firstReminderMins("morning", { ...next, cutoffTime: "08:00" }, 9)).toBe(720);
  });
});

describe("dueReminders", () => {
  it("sends the first reminder once it's within the window", () => {
    expect(dueReminders(base({ now: { date: "2026-11-17", time: "09:30" } }))).toEqual([]);
    const r = dueReminders(base());
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "first", key: "s1|2026-11-17T14:00|first", title: "Order from Driscoll" });
    expect(r[0].body).toContain("due today 2pm");
  });
  it("doesn't repeat a reminder already sent", () => {
    expect(dueReminders(base({ sent: new Set(["s1|2026-11-17T14:00|first"]) }))).toEqual([]);
  });
  it("sends the last call in its window, and only that when both are due", () => {
    const r = dueReminders(base({ now: { date: "2026-11-17", time: "13:15" } }));
    expect(r.map((x) => x.kind)).toEqual(["lastCall"]);
    expect(r[0].title).toBe("Driscoll order not placed");
    expect(r[0].body).toContain("45 min left");
  });
  it("mentions a saved draft that isn't sent", () => {
    expect(dueReminders(base({ placed: "draft" }))[0].body).toMatch(/draft is saved but not sent/i);
  });
  it("stays quiet once sent, when the supplier doesn't need nagging, or after the cutoff", () => {
    expect(dueReminders(base({ placed: "sent" }))).toEqual([]);
    expect(dueReminders(base({ nag: false }))).toEqual([]);
    expect(dueReminders(base({ now: { date: "2026-11-17", time: "14:00" } }))).toEqual([]);
    expect(dueReminders(base({ next: null }))).toEqual([]);
  });
  it("respects no early reminder and no last call", () => {
    expect(dueReminders(base({ prefs: { first: "none", lastCallMins: 60 } }))).toEqual([]);
    expect(dueReminders(base({ now: { date: "2026-11-17", time: "13:30" }, prefs: { first: "4h", lastCallMins: null } })).map((x) => x.kind)).toEqual(["first"]);
  });
  it("a day ahead fires the day before", () => {
    expect(dueReminders(base({ now: { date: "2026-11-16", time: "15:00" }, prefs: { first: "24h", lastCallMins: 60 } }))[0].body).toContain("due tomorrow 2pm");
  });
});

describe("lastPassedCutoff", () => {
  // Delivers Wed (3) and Fri (5); orders due the day before at 2pm.
  const rule = cutoffRule({ daysBefore: 1, time: "14:00" }, 1);
  it("finds the most recent cutoff that has passed for a delivery still to come", () => {
    expect(lastPassedCutoff([3, 5], rule, "2026-11-17", "15:00")).toEqual({ deliveryDate: "2026-11-18", cutoffDate: "2026-11-17", cutoffTime: "14:00" });
    expect(lastPassedCutoff([3, 5], rule, "2026-11-18", "08:00")).toEqual({ deliveryDate: "2026-11-18", cutoffDate: "2026-11-17", cutoffTime: "14:00" });
  });
  it("is null when every coming delivery's cutoff is still ahead", () => {
    expect(lastPassedCutoff([3, 5], rule, "2026-11-17", "13:00")).toBeNull();
    expect(lastPassedCutoff([], rule, "2026-11-17", "15:00")).toBeNull();
  });
});

describe("missedOrder", () => {
  const passed = { deliveryDate: "2026-11-18", cutoffDate: "2026-11-17", cutoffTime: "14:00" };
  const nextOne = { deliveryDate: "2026-11-20", cutoffDate: "2026-11-19", cutoffTime: "14:00" };
  it("says a cutoff passed with nothing ordered, and when the next chance is", () => {
    const m = missedOrder({ supplierId: "s1", supplierName: "Kilcoyne", passed, hasOrder: false, nag: true, next: nextOne, today: "2026-11-17" });
    expect(m).toMatchObject({ key: "s1|2026-11-18|missed", title: "Missed: Kilcoyne cutoff passed with no order" });
    expect(m!.detail).toBe("Next chance Thu 2pm, for the Fri delivery");
  });
  it("is quiet when an order exists, nagging is off, or the delivery day is gone", () => {
    const a = { supplierId: "s1", supplierName: "K", passed, hasOrder: false, nag: true, next: nextOne, today: "2026-11-17" };
    expect(missedOrder({ ...a, hasOrder: true })).toBeNull();
    expect(missedOrder({ ...a, nag: false })).toBeNull();
    expect(missedOrder({ ...a, today: "2026-11-19" })).toBeNull();
    expect(missedOrder({ ...a, passed: null })).toBeNull();
  });
  it("pushes a missed cutoff once, soon after it passes", () => {
    const now = { date: "2026-11-17", time: "15:00" };
    expect(missedPushDue(passed, now, new Set(), "s1|2026-11-18|missed")).toBe(true);
    expect(missedPushDue(passed, now, new Set(["s1|2026-11-18|missed"]), "s1|2026-11-18|missed")).toBe(false);
    expect(missedPushDue(passed, { date: "2026-11-18", time: "09:00" }, new Set(), "s1|2026-11-18|missed")).toBe(false);
  });
});

describe("pruneSentKeys", () => {
  it("drops keys older than two weeks", () => {
    expect(pruneSentKeys(["a|2026-11-17T14:00|first", "b|2026-10-01|missed", "c"], "2026-11-17")).toEqual(["a|2026-11-17T14:00|first"]);
  });
});
