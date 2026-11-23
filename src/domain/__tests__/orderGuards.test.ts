import { describe, expect, it } from "vitest";
import { orderWarnings, usualQty, whyLine } from "../orderGuards";

describe("usualQty", () => {
  it("is the middle of recent orders, ignoring zeros", () => {
    expect(usualQty([2, 3, 10])).toBe(3);
    expect(usualQty([2, 4])).toBe(3);
    expect(usualQty([0, 0])).toBeNull();
    expect(usualQty([])).toBeNull();
  });
});

describe("orderWarnings", () => {
  const ok = { lines: [{ name: "Butter", qty: 2, usual: 2, unit: "case" }], minsToCutoff: 300 };
  it("is quiet for a normal order before the cutoff", () => {
    expect(orderWarnings(ok)).toEqual([]);
  });
  it("warns on an empty order", () => {
    expect(orderWarnings({ ...ok, lines: [{ name: "Butter", qty: 0, usual: 2, unit: "case" }] })).toEqual([{ kind: "empty", text: "Nothing is on this order. Every quantity is zero." }]);
  });
  it("warns on a quantity far above usual, naming it", () => {
    const w = orderWarnings({ ...ok, lines: [{ name: "Butter", qty: 7, usual: 2, unit: "case" }, { name: "Salt", qty: 4, usual: null, unit: "each" }] });
    expect(w).toEqual([{ kind: "far-above", text: "Butter: 7 case is more than 3× the usual 2. Double-check it." }]);
    expect(orderWarnings({ ...ok, lines: [{ name: "Butter", qty: 6, usual: 2, unit: "case" }] })).toEqual([]);
  });
  it("warns when sending after the cutoff", () => {
    expect(orderWarnings({ ...ok, minsToCutoff: -20 })[0]).toEqual({ kind: "after-cutoff", text: "The cutoff has passed. Call or text the supplier to check they can still take it." });
    expect(orderWarnings({ ...ok, minsToCutoff: null })).toEqual([]);
  });
});

describe("whyLine", () => {
  it("says what's on hand and how much more is needed through when, in the order's unit", () => {
    // `needBase` is the shortfall the order is rounded up from, so the line and the quantity agree.
    expect(whyLine({ onHandBase: 3 * 1000, needBase: 2600, packQtyBase: 1000, unit: "case", byDate: "2026-11-20", known: true })).toBe("On hand 3 case, 2.6 more needed through Fri");
    expect(whyLine({ onHandBase: 1500, needBase: 0, packQtyBase: 1000, unit: "case", byDate: "2026-11-20", known: true })).toBe("On hand 1.5 case, enough through Fri");
  });
  it("is honest when it doesn't know", () => {
    expect(whyLine({ onHandBase: 0, needBase: 9000, packQtyBase: 1000, unit: "case", byDate: "2026-11-20", known: false })).toBe("Not counted yet, so on hand is unknown");
    expect(whyLine({ onHandBase: 3, needBase: 9, packQtyBase: null, unit: "case", byDate: "2026-11-20", known: true })).toBe("Pack size not set");
  });
});
