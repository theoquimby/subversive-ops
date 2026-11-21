import { describe, expect, it } from "vitest";
import { canUndoWasteEntry, mergeIntoDraft, parseQty, pushRecent, receiptLine, stepQty, wasteLoggedAt, wasteStamp } from "../purchasing";

describe("stepQty", () => {
  it("adds and takes away whole packs", () => {
    expect(stepQty(2, 1)).toBe(3);
    expect(stepQty(2, -1)).toBe(1);
  });
  it("never goes below zero", () => {
    expect(stepQty(0, -1)).toBe(0);
    expect(stepQty(0.5, -1)).toBe(0);
  });
  it("keeps a part pack", () => {
    expect(stepQty(1.5, 1)).toBe(2.5);
    expect(stepQty(1.5, -1)).toBe(0.5);
  });
  it("doesn't drift on decimals", () => {
    expect(stepQty(0.1 + 0.2, 1)).toBe(1.3);
  });
});

describe("parseQty", () => {
  it("reads quantities the way people type them", () => {
    expect(parseQty("3")).toBe(3);
    expect(parseQty("1.5")).toBe(1.5);
    expect(parseQty("1 1/2")).toBe(1.5);
    expect(parseQty("½")).toBe(0.5);
    expect(parseQty(" 4 ")).toBe(4);
  });
  it("blank is zero", () => {
    expect(parseQty("")).toBe(0);
  });
  it("rounds to cents", () => {
    expect(parseQty("1/3")).toBe(0.33);
  });
  it("refuses words and negatives", () => {
    expect(parseQty("two")).toBeNull();
    expect(parseQty("-2")).toBeNull();
  });
  it("refuses amounts too big to store", () => {
    expect(parseQty("100000000")).toBeNull();
  });
});

describe("mergeIntoDraft", () => {
  const existing = [
    { id: "l1", supplierProductId: "a", qty: 2, suggestedQty: 2, unitPrice: 10 },
    { id: "l2", supplierProductId: "b", qty: 1, suggestedQty: 1, unitPrice: null },
  ];
  it("the new order's quantity wins for items on both", () => {
    const r = mergeIntoDraft(existing, [{ supplierProductId: "a", qty: 5, suggestedQty: 4, unitPrice: 11 }]);
    expect(r.update).toEqual([{ id: "l1", qty: 5, suggestedQty: 4, unitPrice: 11 }]);
    expect(r.create).toEqual([]);
    expect(r.kept).toBe(1);
  });
  it("adds new items and keeps the rest", () => {
    const r = mergeIntoDraft(existing, [{ supplierProductId: "c", qty: 3, suggestedQty: 3, unitPrice: 4 }]);
    expect(r.update).toEqual([]);
    expect(r.create).toEqual([{ supplierProductId: "c", qty: 3, suggestedQty: 3, unitPrice: 4 }]);
    expect(r.kept).toBe(2);
  });
  it("keeps a known price when the new line has none", () => {
    const r = mergeIntoDraft(existing, [{ supplierProductId: "a", qty: 1, suggestedQty: 1, unitPrice: null }]);
    expect(r.update[0].unitPrice).toBe(10);
  });
  it("skips lines with nothing to order", () => {
    const r = mergeIntoDraft(existing, [{ supplierProductId: "a", qty: 0, suggestedQty: 0, unitPrice: 10 }]);
    expect(r.update).toEqual([]);
    expect(r.kept).toBe(2);
  });
  it("leaves unchanged lines alone", () => {
    const r = mergeIntoDraft(existing, [{ supplierProductId: "a", qty: 2, suggestedQty: 2, unitPrice: 10 }]);
    expect(r.update).toEqual([]);
    expect(r.kept).toBe(2);
  });
});

describe("receiptLine", () => {
  it("as ordered", () => {
    expect(receiptLine(3, 3)).toEqual({ short: 0, over: 0, changed: false });
  });
  it("short", () => {
    expect(receiptLine(3, 1)).toEqual({ short: 2, over: 0, changed: true });
  });
  it("over", () => {
    expect(receiptLine(3, 4.5)).toEqual({ short: 0, over: 1.5, changed: true });
  });
  it("ignores rounding dust", () => {
    expect(receiptLine(0.3, 0.1 + 0.2)).toEqual({ short: 0, over: 0, changed: false });
  });
});

describe("pushRecent", () => {
  it("puts the newest first without repeats", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });
  it("keeps six", () => {
    expect(pushRecent(["a", "b", "c", "d", "e", "f"], "g")).toEqual(["g", "a", "b", "c", "d", "e"]);
  });
  it("copes with junk from storage", () => {
    expect(pushRecent(null, "a")).toEqual(["a"]);
    expect(pushRecent(["a", 3 as unknown as string], "b")).toEqual(["b", "a"]);
  });
});

describe("wasteLoggedAt", () => {
  const now = new Date("2026-11-20T14:30:00Z");
  const tz = "America/New_York";
  it("uses when the phone logged it", () => {
    const at = now.getTime() - 3600_000;
    expect(wasteLoggedAt("today", at, now, tz).getTime()).toBe(at);
  });
  it("a phone clock ahead of ours or days old falls back to now", () => {
    expect(wasteLoggedAt("today", now.getTime() + 600_000, now, tz)).toEqual(now);
    expect(wasteLoggedAt("today", now.getTime() - 5 * 86400_000, now, tz)).toEqual(now);
    expect(wasteLoggedAt("today", undefined, now, tz)).toEqual(now);
  });
  it("yesterday is the day before the one it was logged on", () => {
    // Logged offline at 11pm Nov 19 (New York), sent the next morning: yesterday is still Nov 18.
    const at = new Date("2026-11-20T04:00:00Z").getTime();
    expect(wasteLoggedAt("yesterday", at, now, tz).toISOString()).toBe("2026-11-19T04:59:00.000Z");
  });
});

describe("canUndoWasteEntry", () => {
  const now = new Date("2026-11-20T14:30:00Z").getTime();
  const me = { name: "Line", role: "STAFF" };
  it("your own entry, just logged", () => {
    expect(canUndoWasteEntry({ loggedBy: "Line", loggedAt: new Date(now - 60_000) }, me, now)).toBe(true);
  });
  it("your own entry logged for yesterday", () => {
    expect(canUndoWasteEntry({ loggedBy: "Line", loggedAt: new Date("2026-11-20T04:59:00Z") }, me, now)).toBe(true);
  });
  it("not someone else's", () => {
    expect(canUndoWasteEntry({ loggedBy: "Sam", loggedAt: new Date(now - 60_000) }, me, now)).toBe(false);
  });
  it("not days later", () => {
    expect(canUndoWasteEntry({ loggedBy: "Line", loggedAt: new Date(now - 3 * 86400_000) }, me, now)).toBe(false);
  });
  it("managers can", () => {
    expect(canUndoWasteEntry({ loggedBy: "Sam", loggedAt: new Date(now - 3 * 86400_000) }, { name: "Max", role: "MANAGER" }, now)).toBe(true);
  });
});

describe("wasteStamp", () => {
  const now = new Date("2026-11-20T14:30:00Z"); // 9:30am in New York
  it("today is now", () => {
    expect(wasteStamp("today", now, "America/New_York")).toEqual(now);
  });
  it("yesterday is the last minute of the business day before", () => {
    // Midnight Nov 20 in New York is 05:00Z; one minute before.
    expect(wasteStamp("yesterday", now, "America/New_York").toISOString()).toBe("2026-11-20T04:59:00.000Z");
  });
  it("yesterday follows the business timezone, not UTC", () => {
    // 11pm Nov 19 in New York is already Nov 20 in UTC.
    const late = new Date("2026-11-20T04:00:00Z");
    expect(wasteStamp("yesterday", late, "America/New_York").toISOString()).toBe("2026-11-19T04:59:00.000Z");
  });
});
