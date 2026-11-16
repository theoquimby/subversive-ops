import { describe, expect, it } from "vitest";
import { CHECKLIST_PRESETS, completionRate, crewFor, dayMark, itemsOn, runDateFor, runsOn, runState, shiftOrder, unfinishedCloses } from "../checklists";

describe("checklists", () => {
  it("puts a close finished after midnight on the night before", () => {
    expect(runDateFor("close", "2026-11-16", 1)).toBe("2026-11-15");
    expect(runDateFor("close", "2026-11-16", 22)).toBe("2026-11-16");
    expect(runDateFor("open", "2026-11-16", 1)).toBe("2026-11-16");
  });
  it("runs on chosen weekdays, or every day when none are chosen", () => {
    expect(runsOn([], "2026-11-16")).toBe(true);
    expect(runsOn([1], "2026-11-16")).toBe(true); // a Monday
    expect(runsOn([0, 6], "2026-11-16")).toBe(false);
  });
  it("keeps only active items that apply that day", () => {
    const items = [
      { id: "a", weekdays: [], active: true },
      { id: "b", weekdays: [0], active: true },
      { id: "c", weekdays: [], active: false },
    ];
    expect(itemsOn(items, "2026-11-16").map((i) => i.id)).toEqual(["a"]);
    expect(itemsOn(items, "2026-11-15").map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("tells where a run is", () => {
    expect(runState(0, 5, false)).toBe("not-started");
    expect(runState(2, 5, false)).toBe("in-progress");
    expect(runState(5, 5, false)).toBe("ready");
    expect(runState(2, 5, true)).toBe("signed-off");
  });
  it("marks history days and scores completion", () => {
    expect(dayMark(false, 0, 5, false)).toBe("off");
    expect(dayMark(true, 5, 5, true)).toBe("signed");
    expect(dayMark(true, 5, 5, false)).toBe("done");
    expect(dayMark(true, 1, 5, false)).toBe("partial");
    expect(dayMark(true, 0, 5, false)).toBe("missed");
    expect(completionRate(["signed", "done", "missed", "off"])).toBeCloseTo(2 / 3);
    expect(completionRate(["off"])).toBeNull();
  });
  it("orders lists by the time of day", () => {
    expect(shiftOrder(9)[0]).toBe("open");
    expect(shiftOrder(15)[0]).toBe("mid");
    expect(shiftOrder(21)[0]).toBe("close");
    expect(shiftOrder(1)[0]).toBe("close");
  });
  it("flags closes left unfinished, including untouched ones", () => {
    const r = unfinishedCloses([
      { templateId: "a", name: "Bar", done: 8, total: 8, signedOff: false },
      { templateId: "b", name: "Kitchen", done: 3, total: 8, signedOff: false },
      { templateId: "c", name: "Patio", done: 0, total: 4, signedOff: false },
      { templateId: "d", name: "Signed", done: 2, total: 8, signedOff: true },
    ]);
    expect(r.map((x) => x.templateId)).toEqual(["b", "c"]);
  });
  it("ships presets with an opening and a closing list", () => {
    expect(CHECKLIST_PRESETS.some((p) => p.shift === "open")).toBe(true);
    expect(CHECKLIST_PRESETS.some((p) => p.shift === "close")).toBe(true);
    for (const p of CHECKLIST_PRESETS) expect(p.items.length).toBeGreaterThan(3);
  });
});

describe("crewFor", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 16, h));
  const shifts = [
    { name: "Ana", positionId: "bar", start: at(11), end: at(17) },
    { name: "Ben", positionId: "bar", start: at(16), end: at(23) },
    { name: "Cy", positionId: "kitchen", start: at(10), end: at(22) },
    { name: "Di", positionId: "bar", start: at(14), end: at(20) },
  ];
  it("finds openers, closers and the middle, by position", () => {
    expect(crewFor(shifts, "open", ["bar"])).toEqual(["Ana"]);
    expect(crewFor(shifts, "close", ["bar"])).toEqual(["Ben"]);
    expect(crewFor(shifts, "mid", ["bar"])).toEqual(["Di"]);
    expect(crewFor(shifts, "open", [])).toEqual(["Cy", "Ana"]);
    expect(crewFor([], "close", [])).toEqual([]);
  });
});

describe("weekdays typed by hand", () => {
  it("reads and writes day lists", async () => {
    const { parseWeekdays, weekdaysText } = await import("../checklists");
    expect(parseWeekdays("Sun, Wed")).toEqual([0, 3]);
    expect(parseWeekdays("monday and thursday")).toEqual([1, 4]);
    expect(parseWeekdays("weekends")).toEqual([0, 6]);
    expect(parseWeekdays("")).toEqual([]);
    expect(parseWeekdays("every day")).toEqual([]);
    expect(parseWeekdays("someday")).toBeNull();
    expect(weekdaysText([3, 0])).toBe("Sun, Wed");
    expect(weekdaysText([])).toBe("");
  });
});

describe("preset links", () => {
  it("only point at pages staff can open", async () => {
    const { CHECKLIST_PRESETS, LINKABLE_PAGES } = await import("../checklists");
    const ok = new Set(LINKABLE_PAGES.map((p) => p.href));
    for (const p of CHECKLIST_PRESETS) for (const i of p.items) if (i.href) expect(ok.has(i.href), i.href).toBe(true);
  });
});
