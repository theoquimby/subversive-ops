import { describe, expect, it } from "vitest";
import { dueState, dueText, everyText, nextDue, parseEvery, rankTasks, spendSince, UPKEEP_PRESETS, warrantyState } from "../upkeep";

describe("upkeep", () => {
  it("works out the next due date and how urgent it is", () => {
    expect(nextDue("2026-11-01", 14)).toBe("2026-11-15");
    expect(nextDue(null, 14)).toBeNull();
    expect(dueState("2026-11-16", "2026-11-15")).toBe("overdue");
    expect(dueState("2026-11-16", "2026-11-16")).toBe("today");
    expect(dueState("2026-11-16", "2026-11-20")).toBe("soon");
    expect(dueState("2026-11-16", "2026-12-20")).toBe("ok");
    expect(dueState("2026-11-16", null)).toBe("unknown");
  });
  it("says it in plain words", () => {
    expect(dueText("2026-11-16", "2026-11-13")).toBe("3 days overdue");
    expect(dueText("2026-11-16", "2026-11-15")).toBe("1 day overdue");
    expect(dueText("2026-11-16", "2026-11-16")).toBe("Due today");
    expect(dueText("2026-11-16", "2026-11-17")).toBe("Due tomorrow");
    expect(dueText("2026-11-16", null)).toBe("Not logged yet");
    expect(everyText(14)).toBe("Every 2 weeks");
    expect(everyText(30)).toBe("Every month");
    expect(everyText(91)).toBe("Every 3 months");
    expect(everyText(182)).toBe("Every 6 months");
    expect(everyText(365)).toBe("Every year");
    expect(everyText(10)).toBe("Every 10 days");
  });
  it("reads intervals typed by hand", () => {
    expect(parseEvery("14")).toBe(14);
    expect(parseEvery("2 weeks")).toBe(14);
    expect(parseEvery("every 3 months")).toBe(91);
    expect(parseEvery("quarterly")).toBe(91);
    expect(parseEvery("yearly")).toBe(365);
    expect(parseEvery("1y")).toBe(365);
    expect(parseEvery("soon")).toBeNull();
    expect(parseEvery("0")).toBeNull();
  });
  it("ranks overdue first and never-logged last", () => {
    const r = rankTasks(
      [
        { id: "ok", lastDoneOn: "2026-11-10", everyDays: 30, active: true },
        { id: "unknown", lastDoneOn: null, everyDays: 14, active: true },
        { id: "late", lastDoneOn: "2026-10-01", everyDays: 14, active: true },
        { id: "off", lastDoneOn: "2026-10-01", everyDays: 14, active: false },
      ],
      "2026-11-16",
    );
    expect(r.map((t) => t.id)).toEqual(["late", "ok", "unknown"]);
  });
  it("adds up repair spend since a date", () => {
    const s = spendSince(
      [
        { date: "2026-01-01", kind: "repair", cost: 400, equipmentId: "a" },
        { date: "2025-01-01", kind: "repair", cost: 999, equipmentId: "a" },
        { date: "2026-05-01", kind: "service", cost: 150, equipmentId: "b" },
        { date: "2026-05-01", kind: "note", cost: 50, equipmentId: "b" },
      ],
      "2025-11-16",
    );
    expect(s.total).toBe(550);
    expect(s.byEquipment.get("a")).toBe(400);
  });
  it("knows when a warranty is running out", () => {
    expect(warrantyState("2026-11-16", null)).toBe("none");
    expect(warrantyState("2026-11-16", "2026-11-01")).toBe("over");
    expect(warrantyState("2026-11-16", "2026-12-01")).toBe("ending");
    expect(warrantyState("2026-11-16", "2027-11-01")).toBe("covered");
  });
  it("starts with draft line cleaning every two weeks", () => {
    const lines = UPKEEP_PRESETS.flatMap((e) => e.tasks).find((t) => /draft lines/i.test(t.title));
    expect(lines?.everyDays).toBe(14);
  });
});
