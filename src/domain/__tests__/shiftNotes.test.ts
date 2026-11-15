import { describe, expect, it } from "vitest";
import { chipKind, defaultShift, drawerLabel, frequentItems, lastNightNotes, matchesQuery, needsFollowUp, nightTotals, noteHighlights, noteSummary, parseAmount, parseItems, parseOverShort, shiftDateFor, type NoteLike } from "../shiftNotes";

const note = (o: Partial<NoteLike> = {}): NoteLike => ({ date: "2026-11-14", shift: "close", authorName: "Sam", eightySixed: [], issues: null, comps: null, compsAmount: null, cash: null, cashOverShort: null, maintenance: null, notes: null, tags: [], handledAt: null, ...o });

describe("shift dates", () => {
  it("counts a note written after midnight toward the night before", () => {
    expect(shiftDateFor("2026-11-15", 1)).toBe("2026-11-14");
    expect(shiftDateFor("2026-11-15", 5)).toBe("2026-11-15");
    expect(shiftDateFor("2026-11-15", 23)).toBe("2026-11-15");
  });
  it("guesses the shift from the hour", () => {
    expect(defaultShift(10)).toBe("open");
    expect(defaultShift(15)).toBe("mid");
    expect(defaultShift(22)).toBe("close");
    expect(defaultShift(1)).toBe("close");
  });
});

describe("parsing what people type", () => {
  it("splits 86'd items, trims and de-duplicates", () => {
    expect(parseItems("wings, IPA\n  fries ;wings")).toEqual(["Wings", "IPA", "Fries"]);
    expect(parseItems(["", " burger "])).toEqual(["Burger"]);
  });
  it("reads over/short however it's written", () => {
    expect(parseOverShort("")).toBeNull();
    expect(parseOverShort("even")).toBe(0);
    expect(parseOverShort("$5 short")).toBe(-5);
    expect(parseOverShort("short 5")).toBe(-5);
    expect(parseOverShort("-4.50")).toBe(-4.5);
    expect(parseOverShort("over 3")).toBe(3);
    expect(parseOverShort("+2")).toBe(2);
    expect(parseOverShort("lots")).toBe("invalid");
  });
  it("reads amounts", () => {
    expect(parseAmount("$24.50")).toBe(24.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-3")).toBe("invalid");
  });
});

describe("what a note says", () => {
  it("knows which chips are maintenance", () => {
    expect(chipKind("ice machine")).toBe("maintenance");
    expect(chipKind("Slammed")).toBe("pace");
    expect(chipKind("anything")).toBeNull();
  });
  it("labels the drawer", () => {
    expect(drawerLabel(note({ cashOverShort: 0 }))).toBe("Drawer even");
    expect(drawerLabel(note({ cashOverShort: -5 }))).toBe("Drawer $5 short");
    expect(drawerLabel(note({ cashOverShort: 2.5 }))).toBe("Drawer $2.50 over");
    expect(drawerLabel(note({ cash: "Left $200 float" }))).toBe("Drawer note");
    expect(drawerLabel(note())).toBeNull();
  });
  it("summarises in reading order", () => {
    const n = note({ tags: ["Slammed", "Ice machine"], eightySixed: ["Wings", "IPA"], compsAmount: 24, comps: "Cold burger", cashOverShort: -5, maintenance: "Leak under bar sink" });
    expect(noteSummary(n)).toBe("Slammed · 86'd Wings, IPA · Fix: Ice machine · Leak under bar sink · $24 comps: Cold burger · Drawer $5 short");
    expect(noteHighlights(n).find((h) => h.key === "cash")!.tone).toBe("bad");
    expect(noteSummary(note())).toBe("No problems");
    expect(noteSummary(note({ notes: "x".repeat(300) }), 50)).toHaveLength(50);
  });
  it("needs a manager for issues, maintenance and a short drawer, until handled", () => {
    expect(needsFollowUp(note({ tags: ["Slammed"] }))).toBe(false);
    expect(needsFollowUp(note({ tags: ["Dish machine"] }))).toBe(true);
    expect(needsFollowUp(note({ issues: "Guest slipped" }))).toBe(true);
    expect(needsFollowUp(note({ cashOverShort: -10 }))).toBe(true);
    expect(needsFollowUp(note({ cashOverShort: -2 }))).toBe(false);
    expect(needsFollowUp(note({ issues: "Guest slipped", handledAt: new Date() }))).toBe(false);
  });
  it("totals a night", () => {
    const t = nightTotals([note({ eightySixed: ["Wings", "IPA"], compsAmount: 10, cashOverShort: -5 }), note({ eightySixed: ["wings"], compsAmount: 5, maintenance: "Hood light", issues: "Late delivery" })]);
    expect(t).toEqual({ eightySixed: 2, compsAmount: 15, cashOverShort: -5, issues: 1, maintenance: 1 });
    expect(nightTotals([note()]).cashOverShort).toBeNull();
  });
});

describe("last night and history", () => {
  it("shows the most recent night with notes, plus today's", () => {
    const notes = [note({ date: "2026-11-12" }), note({ date: "2026-11-13" }), note({ date: "2026-11-13", shift: "open" }), note({ date: "2026-11-15" })];
    expect(lastNightNotes(notes, "2026-11-15").map((n) => n.date)).toEqual(["2026-11-13", "2026-11-13", "2026-11-15"]);
    expect(lastNightNotes([note({ date: "2026-11-01" })], "2026-11-15")).toEqual([]);
  });
  it("searches every field, all words", () => {
    const n = note({ eightySixed: ["Wings"], maintenance: "Ice machine leaking", authorName: "Jo" });
    expect(matchesQuery(n, "ice jo")).toBe(true);
    expect(matchesQuery(n, "wings")).toBe(true);
    expect(matchesQuery(n, "fries")).toBe(false);
    expect(matchesQuery(n, "  ")).toBe(true);
  });
  it("suggests the usual 86'd items", () => {
    expect(frequentItems([{ eightySixed: ["Wings", "IPA"] }, { eightySixed: ["wings"] }, { eightySixed: ["Fries"] }], 2)).toEqual(["Wings", "Fries"]);
  });
});
