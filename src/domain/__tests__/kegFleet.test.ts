import { describe, expect, it } from "vitest";
import type { KegStatus } from "../kegs";
import { bucketOf, cycles, fillsByMonth, fleetStats, monthsBetween, notSeenLately, outTooLong, statusSizeGrid, weeklyFleet, weekStarts, type FleetEvent, type FleetKeg } from "../kegFleet";

const STATUS: Record<string, KegStatus | null> = { CREATED: "EMPTY", FILLED: "FILLED", STORED: "COLD", TAPPED: "ON_TAP", KICKED: "KICKED", OUT: "OUT", RETURNED: "CLEANING", CLEANED: "EMPTY", EMPTIED: "EMPTY", MOVED: null, NOTE: null };

/** ev("A", "2026-03-02", "FILLED", { beerId: "ipa" }) */
const ev = (kegId: string, day: string, action: string, extra: Partial<FleetEvent> = {}): FleetEvent => ({ kegId, day, at: `${day}T15:00:00.000Z`, action, toStatus: STATUS[action] ?? null, beerId: null, accountId: null, ...extra });
const keg = (id: string, patch: Partial<FleetKeg> = {}): FleetKeg => ({ id, code: id, sizeId: "sixtel", status: "EMPTY", active: true, beer: null, account: null, createdDay: "2026-01-01", ...patch });

describe("buckets", () => {
  it("groups the seven statuses into four", () => {
    expect((["FILLED", "COLD", "ON_TAP", "OUT", "KICKED", "CLEANING", "EMPTY"] as KegStatus[]).map(bucketOf)).toEqual(["full", "full", "out", "out", "dirty", "dirty", "clean"]);
  });
});

describe("weeks and months", () => {
  it("lists the Mondays covering a range", () => {
    // 2026-03-04 is a Wednesday.
    expect(weekStarts("2026-03-04", "2026-03-17")).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
    expect(weekStarts("2026-03-02", "2026-03-02")).toEqual(["2026-03-02"]);
  });
  it("lists the months covering a range", () => {
    expect(monthsBetween("2025-11-20", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("where the fleet was, week by week", () => {
  const weeks = weekStarts("2026-03-02", "2026-03-29");
  it("counts each keg in the bucket of its latest status by the end of the week", () => {
    const events = [ev("A", "2026-03-03", "CLEANED"), ev("A", "2026-03-10", "FILLED"), ev("A", "2026-03-17", "OUT"), ev("A", "2026-03-26", "RETURNED"), ev("B", "2026-03-12", "FILLED")];
    const out = weeklyFleet(events, [keg("A"), keg("B")], weeks);
    expect(out).toEqual([
      { week: "2026-03-02", full: 0, out: 0, dirty: 0, clean: 1 },
      { week: "2026-03-09", full: 2, out: 0, dirty: 0, clean: 0 },
      { week: "2026-03-16", full: 1, out: 1, dirty: 0, clean: 0 },
      { week: "2026-03-23", full: 1, out: 0, dirty: 1, clean: 0 },
    ]);
  });
  it("ignores notes and moves, which carry no status", () => {
    const out = weeklyFleet([ev("A", "2026-03-03", "FILLED"), ev("A", "2026-03-11", "NOTE"), ev("A", "2026-03-12", "MOVED")], [keg("A")], weeks);
    expect(out.map((w) => w.full)).toEqual([1, 1, 1, 1]);
  });
  it("counts a retired keg up to the week of its last scan, and not after", () => {
    const out = weeklyFleet([ev("A", "2026-03-03", "FILLED"), ev("A", "2026-03-11", "NOTE")], [keg("A", { active: false })], weeks);
    expect(out.map((w) => w.full)).toEqual([1, 1, 0, 0]);
  });
  it("is all zeros with no history", () => {
    expect(weeklyFleet([], [keg("A")], weeks).every((w) => w.full + w.out + w.dirty + w.clean === 0)).toBe(true);
  });
});

describe("cycles", () => {
  it("runs from a fill to the keg coming back dirty", () => {
    const cs = cycles([ev("A", "2026-03-01", "FILLED", { beerId: "ipa" }), ev("A", "2026-03-05", "STORED"), ev("A", "2026-03-08", "TAPPED"), ev("A", "2026-03-21", "RETURNED"), ev("A", "2026-03-22", "CLEANED")], [keg("A")]);
    expect(cs).toEqual([{ kegId: "A", beerId: "ipa", start: "2026-03-01", scannedFill: true, went: "tapped", end: "2026-03-21", days: 20 }]);
  });
  it("records a keg sent out, by its first destination", () => {
    const cs = cycles([ev("A", "2026-03-01", "FILLED"), ev("A", "2026-03-03", "OUT", { beerId: "pils", accountId: "acc" }), ev("A", "2026-04-02", "RETURNED")], [keg("A")]);
    expect(cs[0]).toMatchObject({ went: "out", beerId: "pils", days: 32 });
  });
  it("says 'none' when a fill came back with no tap or delivery scan", () => {
    expect(cycles([ev("A", "2026-03-01", "FILLED"), ev("A", "2026-03-20", "RETURNED")], [keg("A")])[0].went).toBe("none");
  });
  it("starts a cycle at a delivery or tap that had no fill scan before it", () => {
    const cs = cycles([ev("A", "2026-03-01", "CLEANED"), ev("A", "2026-03-04", "OUT", { beerId: "ipa" }), ev("A", "2026-03-30", "RETURNED"), ev("A", "2026-04-02", "TAPPED"), ev("A", "2026-04-09", "KICKED")], [keg("A")]);
    expect(cs.map((c) => [c.start, c.scannedFill, c.went, c.days])).toEqual([["2026-03-04", false, "out", 26], ["2026-04-02", false, "tapped", 7]]);
  });
  it("counts a fill that is still full today as stock, not as a missing scan", () => {
    const cs = cycles([ev("A", "2026-03-01", "FILLED"), ev("A", "2026-03-20", "RETURNED"), ev("A", "2026-04-01", "FILLED"), ev("A", "2026-04-02", "STORED")], [keg("A", { status: "COLD" })]);
    expect(cs.map((c) => c.went)).toEqual(["none", "stock"]);
    expect(cs[1]).toMatchObject({ end: null, days: null });
  });
  it("closes a fill that was filled over without coming back", () => {
    const cs = cycles([ev("A", "2026-03-01", "FILLED"), ev("A", "2026-03-15", "FILLED"), ev("A", "2026-03-20", "RETURNED")], [keg("A")]);
    expect(cs.map((c) => [c.start, c.end, c.went])).toEqual([["2026-03-01", null, "none"], ["2026-03-15", "2026-03-20", "none"]]);
  });
  it("keeps kegs apart and orders by time, whatever order events arrive in", () => {
    const cs = cycles([ev("B", "2026-03-09", "RETURNED"), ev("A", "2026-03-02", "FILLED"), ev("B", "2026-03-01", "FILLED"), ev("A", "2026-03-04", "RETURNED")], [keg("A"), keg("B")]);
    expect(cs.map((c) => [c.kegId, c.days]).sort()).toEqual([["A", 2], ["B", 8]]);
  });
});

describe("fills by month", () => {
  const cs = cycles(
    [
      ev("A", "2026-01-10", "FILLED", { beerId: "ipa" }), ev("A", "2026-01-12", "TAPPED"), ev("A", "2026-01-30", "RETURNED"),
      ev("A", "2026-02-03", "FILLED", { beerId: "ipa" }), ev("A", "2026-02-20", "RETURNED"),
      ev("B", "2026-02-05", "FILLED", { beerId: "pils" }), ev("B", "2026-02-07", "OUT"),
      ev("C", "2026-02-25", "FILLED", { beerId: "ipa" }),
    ],
    [keg("A"), keg("B", { status: "OUT" }), keg("C", { status: "FILLED" })],
  );
  const gallons = (id: string) => (id === "B" ? 15.5 : 5.17);
  it("counts kegs, gallons and where each fill went", () => {
    expect(fillsByMonth(cs, ["2026-01", "2026-02", "2026-03"], gallons)).toEqual([
      { month: "2026-01", kegs: 1, gallons: 5.17, tapped: 1, out: 0, none: 0, stock: 0 },
      { month: "2026-02", kegs: 3, gallons: 25.84, tapped: 0, out: 1, none: 1, stock: 1 },
      { month: "2026-03", kegs: 0, gallons: 0, tapped: 0, out: 0, none: 0, stock: 0 },
    ]);
  });
  it("can be narrowed to one beer", () => {
    expect(fillsByMonth(cs, ["2026-02"], gallons, "ipa")[0]).toMatchObject({ kegs: 2, none: 1, stock: 1, out: 0 });
  });
});

describe("fleet numbers", () => {
  it("works out turns and the middle cycle length over the last 12 months", () => {
    const cs = cycles(
      [
        ev("A", "2024-06-01", "FILLED"), ev("A", "2024-07-01", "RETURNED"), // too old to count
        ev("A", "2026-01-01", "FILLED"), ev("A", "2026-01-11", "RETURNED"),
        ev("A", "2026-02-01", "FILLED"), ev("A", "2026-02-21", "RETURNED"),
        ev("B", "2026-03-01", "FILLED"), ev("B", "2026-04-10", "RETURNED"),
        ev("B", "2026-05-01", "FILLED"),
      ],
      [keg("A"), keg("B", { status: "FILLED" })],
    );
    expect(fleetStats(cs, [keg("A"), keg("B"), keg("C", { active: false })], "2026-06-01")).toEqual({ inService: 2, fills12: 4, turns: 2, medianCycleDays: 20, cyclesMeasured: 3 });
  });
  it("has no turns or cycle length without kegs or history", () => {
    expect(fleetStats([], [], "2026-06-01")).toEqual({ inService: 0, fills12: 0, turns: null, medianCycleDays: null, cyclesMeasured: 0 });
    expect(fleetStats([], [keg("A")], "2026-06-01")).toMatchObject({ inService: 1, turns: 0, medianCycleDays: null });
  });
});

describe("fleet by status and size", () => {
  it("counts active kegs by status and size, with retired kegs on their own row", () => {
    const g = statusSizeGrid([keg("A", { status: "FILLED", sizeId: "half" }), keg("B", { status: "FILLED" }), keg("C", { status: "EMPTY" }), keg("D", { status: "FILLED", active: false })]);
    expect(g.sizes).toEqual(["half", "sixtel"]);
    expect(g.all).toEqual({ total: 4, bySize: { half: 1, sixtel: 3 } });
    expect(g.rows.find((r) => r.status === "FILLED")).toEqual({ status: "FILLED", total: 2, bySize: { half: 1, sixtel: 1 } });
    expect(g.rows.find((r) => r.status === "RETIRED")).toEqual({ status: "RETIRED", total: 1, bySize: { half: 0, sixtel: 1 } });
    expect(g.rows.find((r) => r.status === "ON_TAP")?.total).toBe(0);
  });
});

describe("needs a look", () => {
  const today = "2026-06-30";
  it("lists kegs out longer than the limit, grouped by account, longest first", () => {
    const kegs = [keg("A", { status: "OUT", account: "Rose Hill" }), keg("B", { status: "OUT", account: "Rose Hill" }), keg("C", { status: "OUT", account: "Dixon" }), keg("D", { status: "OUT", account: null }), keg("E", { status: "FILLED" })];
    const events = [ev("A", "2026-05-01", "OUT"), ev("A", "2026-06-25", "NOTE"), ev("B", "2026-06-20", "OUT"), ev("C", "2026-03-01", "OUT"), ev("D", "2026-06-01", "MOVED"), ev("E", "2026-01-01", "FILLED")];
    const groups = outTooLong(kegs, events, today, 14);
    expect(groups.map((g) => [g.account, g.longest, g.kegs.map((k) => k.code)])).toEqual([["Dixon", 121, ["C"]], ["Rose Hill", 60, ["A"]], ["No account recorded", 29, ["D"]]]);
  });
  it("lists kegs nobody has scanned lately, never ones that are out or retired", () => {
    const kegs = [keg("A", { status: "FILLED" }), keg("B", { status: "EMPTY" }), keg("C", { status: "OUT" }), keg("D", { status: "FILLED", active: false }), keg("E", { createdDay: "2026-06-20" }), keg("F", { createdDay: "2026-01-01" })];
    const events = [ev("A", "2026-02-01", "FILLED"), ev("B", "2026-06-01", "CLEANED"), ev("C", "2025-01-01", "OUT"), ev("D", "2025-01-01", "FILLED")];
    const idle = notSeenLately(kegs, events, today, 90);
    expect(idle.map((k) => [k.code, k.lastSeen, k.days])).toEqual([["F", null, 180], ["A", "2026-02-01", 149]]);
  });
});
