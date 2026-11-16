import { describe, expect, it } from "vitest";
import { opsAttentionItems } from "../opsAttention";
import { periodOf } from "../beerTax";

const base = { today: "2026-11-16", closes: [], overdueJobs: [], down: [], taxes: [] };

describe("ops attention", () => {
  it("is empty when everything is fine", () => {
    expect(opsAttentionItems(base)).toEqual([]);
  });
  it("flags an unfinished close", () => {
    const [i] = opsAttentionItems({ ...base, closes: [{ templateId: "a", name: "Closing — bar", done: 3, total: 8, signedOff: false }] });
    expect(i.title).toContain("Closing — bar");
    expect(i.detail).toBe("3 of 8 ticked, not signed off");
    expect(i.href).toBe("/checklists#history");
  });
  it("flags overdue jobs, red after a week", () => {
    const [one] = opsAttentionItems({ ...base, overdueJobs: [{ id: "x", title: "Clean draft lines", due: "2026-11-14" }] });
    expect(one).toMatchObject({ title: "Clean draft lines is overdue", detail: "2 days late", tone: "warn" });
    const [many] = opsAttentionItems({ ...base, overdueJobs: [{ id: "x", title: "A", due: "2026-11-01" }, { id: "y", title: "B", due: "2026-11-15" }] });
    expect(many).toMatchObject({ title: "2 upkeep jobs overdue", tone: "bad" });
  });
  it("flags equipment that's down", () => {
    const [d] = opsAttentionItems({ ...base, down: [{ title: "Compressor dead", equipment: "Walk-in cooler", since: "2026-11-14" }] });
    expect(d).toMatchObject({ title: "Walk-in cooler is down", tone: "bad" });
  });
  it("flags tax returns due", () => {
    const p = periodOf("2026-10-01", "month");
    const [t] = opsAttentionItems({ ...base, taxes: [{ form: "ny", period: p, due: "2026-11-20", filed: false, state: "due-soon" }] });
    expect(t).toMatchObject({ title: "NY beer tax for Oct 2026", detail: "Due in 4 days", href: "/beer-tax?form=ny" });
  });
});

describe("ops attention, several late periods", () => {
  it("rolls periods of one return into one item", () => {
    const q2 = periodOf("2026-04-01", "quarter");
    const q3 = periodOf("2026-07-01", "quarter");
    const items = opsAttentionItems({ ...base, taxes: [
      { form: "federal", period: q3, due: "2026-10-14", filed: false, state: "overdue" },
      { form: "federal", period: q2, due: "2026-07-14", filed: false, state: "overdue" },
    ] });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Federal excise for Q2 2026 and Q3 2026");
    expect(items[0].tone).toBe("bad");
  });
});
