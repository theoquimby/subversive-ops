import { describe, expect, it } from "vitest";
import { displayUnitFor, entryUnitsFor, fromBase, onHand, scaleBrewQty, STATUS_LABEL, stockStatus, usedBetween, weeksOfCover, type StockMove } from "../brewStock";

const LB = 453.59237;
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const mv = (kind: StockMove["kind"], qtyBase: number, day: string, batchId: string | null = null): StockMove => ({ kind, qtyBase, at: at(day), batchId });

describe("on hand", () => {
  it("is the latest count plus received, less used, plus fixes since that count", () => {
    const moves = [
      mv("received", 1000, "2026-10-01"), // before the count: ignored
      mv("count", 5000, "2026-10-05"),
      mv("used", 1200, "2026-10-08"),
      mv("received", 2000, "2026-10-10"),
      mv("adjust", -300, "2026-10-11"),
    ];
    const r = onHand(moves);
    expect(r.qtyBase).toBe(5000 - 1200 + 2000 - 300);
    expect(r.countedAt?.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(r.counted).toBe(true);
  });

  it("uses only the newest count, whatever order the moves come in", () => {
    const moves = [mv("used", 100, "2026-10-20"), mv("count", 900, "2026-10-15"), mv("count", 5000, "2026-10-01")];
    expect(onHand(moves).qtyBase).toBe(800);
  });

  it("starts from nothing when never counted", () => {
    const r = onHand([mv("received", 2000, "2026-10-01"), mv("used", 500, "2026-10-02")]);
    expect(r.qtyBase).toBe(1500);
    expect(r.counted).toBe(false);
    expect(r.countedAt).toBeNull();
  });

  it("can go below zero (brewed more than was recorded): shown, never hidden", () => {
    expect(onHand([mv("count", 100, "2026-10-01"), mv("used", 300, "2026-10-02")]).qtyBase).toBe(-200);
  });

  it("a move at the same moment as the count is already in the count", () => {
    const t = at("2026-10-05");
    expect(onHand([{ kind: "count", qtyBase: 100, at: t, batchId: null }, { kind: "used", qtyBase: 40, at: t, batchId: null }]).qtyBase).toBe(100);
  });
});

describe("used between", () => {
  it("adds what brews used in the window", () => {
    const moves = [mv("used", 100, "2026-09-01"), mv("used", 200, "2026-10-20"), mv("used", 50, "2026-11-10"), mv("received", 999, "2026-11-01")];
    expect(usedBetween(moves, at("2026-10-17"), at("2026-11-16"))).toBe(250);
  });
});

describe("units", () => {
  it("shows malt and hops in lb, yeast in packs or grams, liquids in gallons", () => {
    expect(displayUnitFor("Malt", "g")).toBe("lb");
    expect(displayUnitFor("Hops", "g")).toBe("lb");
    expect(displayUnitFor("Yeast", "g")).toBe("g");
    expect(displayUnitFor("Yeast", "each")).toBe("pkg");
    expect(displayUnitFor("Brewing", "ml")).toBe("gal");
  });

  it("converts from the base unit for display", () => {
    expect(fromBase(LB * 50, "lb", "g", [])).toBeCloseTo(50, 6);
    expect(fromBase(3, "pkg", "each", [])).toBe(3);
    expect(fromBase(1000, "pkg", "g", [{ unit: "pkg", baseQty: 500 }])).toBe(2);
    expect(fromBase(1000, "pkg", "g", [])).toBeNull(); // a package of a weighed thing needs a conversion
  });

  it("offers units that fit, the ingredient's own first", () => {
    expect(entryUnitsFor("g", [{ unit: "sack", baseQty: 50 * LB }])).toEqual(["sack", "lb", "oz", "kg", "g"]);
    expect(entryUnitsFor("each", [])).toEqual(["pkg"]);
    expect(entryUnitsFor("ml", [])).toEqual(["gal", "l", "ml"]);
  });
});

describe("scaling a recipe line to a brew", () => {
  it("scales weights exactly", () => {
    expect(scaleBrewQty(700, "lb", 7, 15)).toBeCloseTo(1500, 6);
  });
  it("rounds packages up to whole ones", () => {
    expect(scaleBrewQty(2, "pkg", 7, 15)).toBe(5); // 4.29 → 5
    expect(scaleBrewQty(2, "pkg", 7, 7)).toBe(2);
    expect(scaleBrewQty(1.5, "each", 7, 7)).toBe(2);
  });
  it("leaves the amount alone when a size is missing", () => {
    expect(scaleBrewQty(10, "lb", 0, 7)).toBe(10);
  });
});

describe("weeks of cover", () => {
  it("divides on hand by the faster of recent use and planned need", () => {
    // used 300 in 30 days (70/week); planned 800 over 8 weeks (100/week) → 100/week
    expect(weeksOfCover(500, 300, 800)).toBeCloseTo(5, 6);
  });
  it("is null when nothing is used or planned", () => {
    expect(weeksOfCover(500, 0, 0)).toBeNull();
  });
  it("is zero when nothing is on hand", () => {
    expect(weeksOfCover(-10, 300, 0)).toBe(0);
  });
});

describe("status", () => {
  const today = "2026-11-16";
  it("is short when a brew in the next three weeks can't be covered", () => {
    const s = stockStatus({ onHandBase: 100, needs: [{ on: "2026-11-20", qtyBase: 60 }, { on: "2026-11-30", qtyBase: 60 }], today });
    expect(s.status).toBe("short");
    expect(s.firstShortOn).toBe("2026-11-30");
    expect(s.neededBase).toBe(120);
  });
  it("is order soon when the first brew it can't cover is further out", () => {
    const s = stockStatus({ onHandBase: 100, needs: [{ on: "2026-11-20", qtyBase: 60 }, { on: "2026-12-20", qtyBase: 60 }], today });
    expect(s.status).toBe("soon");
    expect(s.firstShortOn).toBe("2026-12-20");
  });
  it("allocates to the earliest brew first, whatever order needs come in", () => {
    const s = stockStatus({ onHandBase: 100, needs: [{ on: "2026-12-20", qtyBase: 60 }, { on: "2026-11-20", qtyBase: 60 }], today });
    expect(s.firstShortOn).toBe("2026-12-20");
  });
  it("is short when below zero", () => {
    expect(stockStatus({ onHandBase: -5, needs: [], today }).status).toBe("short");
  });
  it("is fine when every planned brew is covered", () => {
    expect(stockStatus({ onHandBase: 200, needs: [{ on: "2026-11-20", qtyBase: 60 }], today })).toEqual({ status: "fine", firstShortOn: null, neededBase: 60, shortBase: 0 });
  });
  it("ignores needs past the eight-week window", () => {
    expect(stockStatus({ onHandBase: 0, needs: [{ on: "2027-03-01", qtyBase: 60 }], today }).status).toBe("fine");
  });
  it("counts an overdue planned brew as due now", () => {
    expect(stockStatus({ onHandBase: 0, needs: [{ on: "2026-11-10", qtyBase: 60 }], today }).status).toBe("short");
  });
  it("is not counted, never fine, when the shelf has never been counted", () => {
    expect(stockStatus({ onHandBase: 0, needs: [], today, counted: false }).status).toBe("uncounted");
  });
  it("stays not counted even when a planned brew looks uncovered: the shelf is unknown, not empty", () => {
    const s = stockStatus({ onHandBase: 0, needs: [{ on: "2026-11-20", qtyBase: 60 }], today, counted: false });
    expect(s.status).toBe("uncounted");
    expect(s.neededBase).toBe(60);
  });
  it("is not counted even when deliveries were logged since nothing was counted", () => {
    expect(stockStatus({ onHandBase: 500, needs: [], today, counted: false }).status).toBe("uncounted");
  });
  it("reads as counted when not told otherwise", () => {
    expect(stockStatus({ onHandBase: 0, needs: [], today }).status).toBe("fine");
  });
  it("labels the not-counted status in plain words", () => {
    expect(STATUS_LABEL.uncounted).toBe("Not counted");
  });
});
