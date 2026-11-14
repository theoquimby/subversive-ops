import { describe, expect, it } from "vitest";
import { cutoffRule } from "../ordering";
import { capPerKind, clock, compareByDeadline, countdownLabel, countdownTone, deadlineBucket, deadlineSummary, isGuessed, needsOrder, supplierState, todayCounts, todayItems, type BoardOrder, type TodaySupplier } from "../orderingBoard";

const TODAY = "2026-11-14"; // a Saturday
const po = (over: Partial<BoardOrder>): BoardOrder => ({ id: "o", supplierId: "s", status: "DRAFT", deliveryDate: TODAY, total: 100, lines: 3, ...over });

describe("supplierState", () => {
  it("is none with no orders", () => {
    expect(supplierState("2026-11-17", [], TODAY)).toEqual({ kind: "none", order: null, forNext: false });
  });
  it("uses the order for the next delivery", () => {
    const o = po({ id: "a", status: "SENT", deliveryDate: "2026-11-17" });
    expect(supplierState("2026-11-17", [o], TODAY)).toMatchObject({ kind: "sent", order: { id: "a" }, forNext: true });
  });
  it("prefers the least finished order when there are several for the same delivery", () => {
    const orders = [po({ id: "r", status: "RECEIVED", deliveryDate: "2026-11-17" }), po({ id: "d", status: "DRAFT", deliveryDate: "2026-11-17" })];
    expect(supplierState("2026-11-17", orders, TODAY).order?.id).toBe("d");
  });
  it("falls back to an open draft for another date, then a sent order still to come", () => {
    expect(supplierState("2026-11-17", [po({ id: "d", status: "DRAFT", deliveryDate: "2026-11-20" })], TODAY)).toMatchObject({ kind: "draft", forNext: false });
    expect(supplierState("2026-11-17", [po({ id: "s", status: "SENT", deliveryDate: "2026-11-15" })], TODAY)).toMatchObject({ kind: "sent", order: { id: "s" } });
  });
  it("ignores past drafts and received orders for other dates", () => {
    const orders = [po({ status: "DRAFT", deliveryDate: "2026-11-10" }), po({ status: "RECEIVED", deliveryDate: "2026-11-13" })];
    const s = supplierState("2026-11-17", orders, TODAY);
    expect(s.kind).toBe("none");
    expect(needsOrder(s, { deliveryDate: "2026-11-17", cutoffDate: "2026-11-15", cutoffTime: "14:00" })).toBe(true);
    expect(needsOrder(s, null)).toBe(false);
  });
  it("works without a next delivery", () => {
    expect(supplierState(null, [po({ status: "DRAFT", deliveryDate: "2026-11-16" })], TODAY).kind).toBe("draft");
  });
});

describe("deadlines", () => {
  it("buckets by business date", () => {
    expect(deadlineBucket(TODAY, TODAY)).toBe("today");
    expect(deadlineBucket("2026-11-15", TODAY)).toBe("tomorrow");
    expect(deadlineBucket("2026-11-20", TODAY)).toBe("week");
    expect(deadlineBucket("2026-11-21", TODAY)).toBe("later");
    expect(deadlineBucket(null, TODAY)).toBe("none");
  });
  it("sorts soonest first, by time on the same day, with no deadline last", () => {
    const rows = [
      { name: "C", next: null },
      { name: "B", next: { deliveryDate: "2026-11-17", cutoffDate: "2026-11-15", cutoffTime: "17:00" } },
      { name: "A", next: { deliveryDate: "2026-11-17", cutoffDate: "2026-11-15", cutoffTime: "09:00" } },
      { name: "D", next: { deliveryDate: "2026-11-16", cutoffDate: "2026-11-14", cutoffTime: "20:00" } },
      { name: "E", next: null },
    ];
    expect([...rows].sort(compareByDeadline).map((r) => r.name)).toEqual(["D", "A", "B", "C", "E"]);
  });
  it("counts down in plain units", () => {
    expect(countdownLabel(-1)).toBe("passed");
    expect(countdownLabel(30_000)).toBe("1m");
    expect(countdownLabel(45 * 60_000)).toBe("45m");
    expect(countdownLabel(5 * 3600_000 + 20 * 60_000)).toBe("5h 20m");
    expect(countdownLabel(3 * 3600_000)).toBe("3h");
    expect(countdownLabel(52 * 3600_000)).toBe("2d 4h");
    expect(countdownLabel(48 * 3600_000)).toBe("2d");
  });
  it("gets louder as the deadline nears", () => {
    expect(countdownTone(2 * 3600_000)).toBe("bad");
    expect(countdownTone(20 * 3600_000)).toBe("warn");
    expect(countdownTone(30 * 3600_000)).toBe("neutral");
  });
  it("summarises per-day deadlines Monday first and spots guessed ones", () => {
    const rule = cutoffRule({ perDay: { 5: { day: 3, time: "17:00" } } }, 1);
    expect(deadlineSummary([5, 2], rule)).toBe("Tue ← Mon 2pm · Fri ← Wed 5pm");
    expect(isGuessed(rule, "2026-11-20")).toBe(false); // Friday
    expect(isGuessed(rule, "2026-11-17")).toBe(true); // Tuesday
    expect(clock("09:30")).toBe("9:30am");
    expect(clock("00:00")).toBe("12am");
  });
});

describe("todayItems", () => {
  const sup = (over: Partial<TodaySupplier>): TodaySupplier => ({ id: "s", name: "S", next: null, hoursToCutoff: null, state: { kind: "none", order: null, forNext: false }, ...over });
  const next = (cutoffDate: string, deliveryDate = "2026-11-17") => ({ deliveryDate, cutoffDate, cutoffTime: "14:00" });

  it("buckets deadlines, drafts, check-ins and tomorrow's trucks, most urgent first", () => {
    const suppliers = [
      sup({ id: "a", name: "Alpha", next: next("2026-11-15"), hoursToCutoff: 30 }),
      sup({ id: "b", name: "Bravo", next: next(TODAY), hoursToCutoff: 3 }),
      sup({ id: "c", name: "Charlie", next: next("2026-11-20"), hoursToCutoff: 140 }), // too far
      sup({ id: "d", name: "Delta", next: next("2026-11-15", "2026-11-16"), hoursToCutoff: 20, state: { kind: "draft", order: null, forNext: true } }),
    ];
    const orders = [
      { ...po({ id: "d1", supplierId: "d", status: "DRAFT", deliveryDate: "2026-11-16" }), supplierName: "Delta" },
      { ...po({ id: "x1", supplierId: "x", status: "DRAFT", deliveryDate: "2026-11-12" }), supplierName: "Old" }, // past draft: not today's job
      { ...po({ id: "s1", supplierId: "e", status: "SENT", deliveryDate: TODAY }), supplierName: "Echo" },
      { ...po({ id: "s2", supplierId: "f", status: "SENT", deliveryDate: "2026-11-12" }), supplierName: "Fox" },
      { ...po({ id: "s3", supplierId: "g", status: "SENT", deliveryDate: "2026-11-15" }), supplierName: "Golf" },
      { ...po({ id: "s4", supplierId: "h", status: "SENT", deliveryDate: "2026-10-01" }), supplierName: "Ancient" }, // too old
      { ...po({ id: "r1", supplierId: "e", status: "RECEIVED", deliveryDate: TODAY }), supplierName: "Echo" },
    ];
    const items = todayItems({ today: TODAY, suppliers, orders });
    expect(items.map((i) => i.key)).toEqual(["deadline:b", "deadline:a", "draft:d1", "checkin:s2", "checkin:s1", "arriving:s3"]);
    expect(items.find((i) => i.key === "draft:d1")).toMatchObject({ hoursToCutoff: 20, deadline: { cutoffDate: "2026-11-15" } });
    expect(items.find((i) => i.key === "checkin:s2")?.late).toBe(true);
    expect(items.find((i) => i.key === "checkin:s1")?.late).toBe(false);
    expect(todayCounts(items)).toEqual({ deadline: 2, draft: 1, checkin: 2, arriving: 1 });
  });

  it("drops deadlines that already passed or already have an order", () => {
    const suppliers = [
      sup({ id: "a", name: "A", next: next(TODAY), hoursToCutoff: -1 }),
      sup({ id: "b", name: "B", next: next(TODAY), hoursToCutoff: 5, state: { kind: "sent", order: null, forNext: true } }),
    ];
    expect(todayItems({ today: TODAY, suppliers, orders: [] })).toEqual([]);
  });

  it("respects a custom window", () => {
    const suppliers = [sup({ id: "a", name: "A", next: next("2026-11-15"), hoursToCutoff: 30 })];
    expect(todayItems({ today: TODAY, suppliers, orders: [], windowHours: 24 })).toEqual([]);
  });
});

describe("capPerKind", () => {
  it("keeps a few of each kind in order", () => {
    const items = ["deadline", "deadline", "deadline", "draft", "checkin", "checkin"].map((kind, i) => ({ kind: kind as "deadline" | "draft" | "checkin", i }));
    expect(capPerKind(items, { deadline: 2, checkin: 1 }).map((x) => x.i)).toEqual([0, 1, 3, 4]);
    expect(capPerKind(items)).toHaveLength(6);
  });
});
