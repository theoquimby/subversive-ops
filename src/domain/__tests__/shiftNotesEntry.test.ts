import { describe, expect, it } from "vitest";
import { repairFromNote, resumeDraftPrompt, type NoteLike } from "../shiftNotes";

const note = (o: Partial<NoteLike> = {}): NoteLike => ({ date: "2026-11-17", shift: "close", authorName: "Sam", eightySixed: [], issues: null, comps: null, compsAmount: null, cash: null, cashOverShort: null, maintenance: null, notes: null, tags: [], handledAt: null, ...o });

describe("resumeDraftPrompt", () => {
  it("names a recent day by its weekday", () => {
    expect(resumeDraftPrompt("2026-11-17", "2026-11-20")).toBe("Resume your Tue note?");
  });
  it("says yesterday for yesterday", () => {
    expect(resumeDraftPrompt("2026-11-19", "2026-11-20")).toBe("Resume yesterday's note?");
  });
  it("uses the date when it's a week or more back", () => {
    expect(resumeDraftPrompt("2026-11-10", "2026-11-20")).toBe("Resume your Nov 10 note?");
  });
});

describe("repairFromNote", () => {
  it("takes the first line of what was typed as the title", () => {
    const r = repairFromNote(note({ maintenance: "Tap 4 is foaming\nline cleaner due too" }));
    expect(r).toEqual({ title: "Tap 4 is foaming", date: "2026-11-17", note: "From Sam's close note: Tap 4 is foaming\nline cleaner due too" });
  });
  it("falls back to the maintenance chips", () => {
    const r = repairFromNote(note({ tags: ["Slammed", "Draft lines", "Plumbing"] }));
    expect(r?.title).toBe("Draft lines, Plumbing");
    expect(r?.note).toBe("From Sam's close note.");
  });
  it("is null when the note has nothing to fix", () => {
    expect(repairFromNote(note({ issues: "Loud table" }))).toBeNull();
  });
  it("keeps the title short", () => {
    expect(repairFromNote(note({ maintenance: "x".repeat(300) }))?.title.length).toBe(120);
  });
});
