import { describe, expect, it } from "vitest";
import {
  abv,
  costPerPint,
  findClashes,
  needsDoing,
  nextBatchCode,
  occupancy,
  overlaps,
  planBrew,
  plansFor,
  stayIntervals,
  suggestBrews,
  tankFloor,
  tooSmall,
  type PlanBatch,
  type PlanStay,
  type PlanTank,
} from "../tankPlan";

const today = "2026-11-16";

const FV1: PlanTank = { id: "fv1", name: "FV1", kind: "FERMENTER", capacityBbl: 7, sort: 1, active: true };
const FV2: PlanTank = { id: "fv2", name: "FV2", kind: "FERMENTER", capacityBbl: 15, sort: 2, active: true };
const BT1: PlanTank = { id: "bt1", name: "BT1", kind: "BRITE", capacityBbl: 15, sort: 3, active: true };
const tanks = [FV1, FV2, BT1];

const batch = (id: string, over: Partial<PlanBatch> = {}): PlanBatch => ({ id, code: `26-${id}`, name: `Beer ${id}`, status: "FERMENTING", bbl: 7, fermentDays: 14, conditionDays: 7, ...over });
const stay = (id: string, tankId: string, batchId: string, start: string, end: string | null, planned = false): PlanStay => ({ id, tankId, batchId, start, end, planned });

describe("plansFor", () => {
  it("plans brews for active beers", () => {
    expect(plansFor({ active: true })).toBe(true);
    expect(plansFor({ active: false })).toBe(false);
  });
});

describe("stay boundaries", () => {
  it("treats end as the day the beer comes out, so a tank can be refilled that day", () => {
    expect(overlaps({ start: "2026-11-01", end: "2026-11-15" }, { start: "2026-11-15", end: "2026-11-22" })).toBe(false);
    expect(overlaps({ start: "2026-11-01", end: "2026-11-16" }, { start: "2026-11-15", end: "2026-11-22" })).toBe(true);
  });
  it("finds no clash for back-to-back stays sharing a day", () => {
    const b = [batch("a", { status: "PACKAGED" }), batch("b", { status: "PLANNED" })];
    const s = [stay("s1", "fv1", "a", "2026-11-01", "2026-11-15"), stay("s2", "fv1", "b", "2026-11-15", "2026-11-29", true)];
    expect(findClashes(stayIntervals(s, tanks, b, today))).toEqual([]);
  });
  it("flags two stays overlapping in one tank", () => {
    const b = [batch("a"), batch("b", { status: "PLANNED" })];
    const s = [stay("s1", "fv1", "a", "2026-11-10", null), stay("s2", "fv1", "b", "2026-11-20", "2026-12-04", true)];
    const clashes = findClashes(stayIntervals(s, tanks, b, today));
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ tankId: "fv1", from: "2026-11-20", to: "2026-11-24" });
  });
  it("keeps a clash only when it falls in the window asked for", () => {
    const b = [batch("a", { status: "PLANNED" }), batch("b", { status: "PLANNED" })];
    const s = [stay("s1", "fv1", "a", "2027-01-10", "2027-01-24", true), stay("s2", "fv1", "b", "2027-01-20", "2027-02-03", true)];
    const iv = stayIntervals(s, tanks, b, today);
    expect(findClashes(iv, { from: today, to: "2026-11-30" })).toEqual([]);
    expect(findClashes(iv)).toHaveLength(1);
  });
});

describe("stayIntervals", () => {
  it("runs an open stay to its expected end from the recipe days", () => {
    const [iv] = stayIntervals([stay("s1", "fv1", "a", "2026-11-10", null)], tanks, [batch("a")], today);
    expect(iv).toMatchObject({ start: "2026-11-10", end: "2026-11-24", open: true, current: true });
  });
  it("keeps an overdue open stay in the tank until at least tomorrow", () => {
    const [iv] = stayIntervals([stay("s1", "fv1", "a", "2026-10-01", null)], tanks, [batch("a")], today);
    expect(iv.end).toBe("2026-11-17");
  });
  it("drops planned stays of brews that were packaged or dumped", () => {
    const b = [batch("a", { status: "DUMPED" })];
    const s = [stay("s1", "fv1", "a", "2026-11-01", "2026-11-05"), stay("s2", "bt1", "a", "2026-11-15", "2026-11-22", true)];
    expect(stayIntervals(s, tanks, b, today).map((i) => i.stayId)).toEqual(["s1"]);
  });
  it("can leave one brew out (when moving it)", () => {
    const b = [batch("a", { status: "PLANNED" })];
    expect(stayIntervals([stay("s1", "fv1", "a", "2026-12-01", "2026-12-15", true)], tanks, b, today, { exceptBatchId: "a" })).toEqual([]);
  });
});

describe("tooSmall", () => {
  it("flags a brew bigger than the tank", () => {
    expect(tooSmall(FV1, { bbl: 15 })).toBe(true);
    expect(tooSmall(FV1, { bbl: 7 })).toBe(false);
    expect(tooSmall(FV1, { bbl: null })).toBe(false);
  });
});

describe("tankFloor", () => {
  it("is empty for an empty brewery", () => {
    expect(tankFloor([], [], [], today)).toEqual([]);
  });
  it("shows an empty tank with when it is next booked", () => {
    const b = [batch("p", { status: "PLANNED", plannedOn: "2026-11-20" })];
    const [fv1] = tankFloor([FV1], [stay("s", "fv1", "p", "2026-11-20", "2026-12-04", true)], b, today);
    expect(fv1.now).toBeNull();
    expect(fv1.next).toMatchObject({ batchId: "p", start: "2026-11-20" });
  });
  it("counts days in the tank and asks for a transfer when fermenting is done", () => {
    const [fv] = tankFloor([FV1], [stay("s", "fv1", "a", "2026-11-02", null)], [batch("a")], today);
    expect(fv.now).toMatchObject({ day: 14, of: 14, stage: "ferment", dueOn: "2026-11-16" });
    expect(fv.now?.prompt).toMatchObject({ kind: "transfer", label: "Ready to transfer?", overdueDays: 0 });
  });
  it("says how many days overdue", () => {
    const [fv] = tankFloor([FV1], [stay("s", "fv1", "a", "2026-10-30", null)], [batch("a")], today);
    expect(fv.now?.prompt).toMatchObject({ kind: "transfer", overdueDays: 3 });
  });
  it("asks to package once conditioning is done in a brite tank", () => {
    const b = [batch("a", { status: "CONDITIONING" })];
    const s = [stay("s0", "fv1", "a", "2026-10-26", "2026-11-09"), stay("s1", "bt1", "a", "2026-11-09", null)];
    const floor = tankFloor(tanks, s, b, today);
    const bt = floor.find((f) => f.tank.id === "bt1")!;
    expect(bt.now).toMatchObject({ day: 7, of: 7, stage: "condition" });
    expect(bt.now?.prompt).toMatchObject({ kind: "package", label: "Ready to package?" });
    expect(floor.find((f) => f.tank.id === "fv1")!.now).toBeNull();
  });
  it("uses a planned end on a current stay as the due day", () => {
    const [fv] = tankFloor([FV1], [stay("s", "fv1", "a", "2026-11-10", "2026-11-20")], [batch("a")], today);
    expect(fv.now).toMatchObject({ day: 6, of: 10, dueOn: "2026-11-20", prompt: null });
  });
  it("orders fermenters, then brites, then other", () => {
    const other: PlanTank = { id: "x", name: "Barrel", kind: "OTHER", capacityBbl: 2, sort: 0, active: true };
    expect(tankFloor([BT1, other, FV2, FV1], [], [], today).map((f) => f.tank.id)).toEqual(["fv1", "fv2", "bt1", "x"]);
  });
});

describe("occupancy", () => {
  it("lists each tank's bars in the range, marking clashes and too-small tanks", () => {
    const b = [batch("a"), batch("big", { status: "PLANNED", bbl: 15 })];
    const s = [stay("s1", "fv1", "a", "2026-11-10", null), stay("s2", "fv1", "big", "2026-11-20", "2026-12-04", true)];
    const rows = occupancy(tanks, s, b, today, "2027-02-08", today);
    const fv1 = rows.find((r) => r.tank.id === "fv1")!;
    expect(fv1.bars).toHaveLength(2);
    expect(fv1.bars.every((x) => x.clash)).toBe(true);
    expect(fv1.bars.find((x) => x.batchId === "big")!.tooSmall).toBe(true);
    expect(rows.find((r) => r.tank.id === "bt1")!.bars).toEqual([]);
  });
  it("leaves out stays that ended before the range", () => {
    const b = [batch("a", { status: "PACKAGED" })];
    const rows = occupancy([FV1], [stay("s1", "fv1", "a", "2026-09-01", "2026-09-15")], b, today, "2027-02-08", today);
    expect(rows[0].bars).toEqual([]);
  });
});

describe("planBrew", () => {
  const base = { brewOn: "2026-11-20", bbl: 7, fermentDays: 14, conditionDays: 7, tanks };
  it("proposes the first free fermenter and brite", () => {
    const p = planBrew({ ...base, busy: [] });
    expect(p).toMatchObject({ ok: true, fermenter: { tankId: "fv1", start: "2026-11-20", end: "2026-12-04" }, brite: { tankId: "bt1", start: "2026-12-04", end: "2026-12-11" }, packageOn: "2026-12-11", slipDays: 0 });
  });
  it("skips a fermenter that is too small", () => {
    const p = planBrew({ ...base, bbl: 12, busy: [] });
    expect(p.ok && p.fermenter.tankId).toBe("fv2");
  });
  it("skips a busy fermenter", () => {
    const p = planBrew({ ...base, busy: [{ tankId: "fv1", start: "2026-11-25", end: "2026-12-01" }] });
    expect(p.ok && p.fermenter.tankId).toBe("fv2");
  });
  it("waits for the brite and says the fermenter stay gets longer", () => {
    const p = planBrew({ ...base, busy: [{ tankId: "bt1", start: "2026-11-30", end: "2026-12-07" }] });
    expect(p).toMatchObject({ ok: true, slipDays: 3, fermenter: { end: "2026-12-07" }, brite: { start: "2026-12-07" }, packageOn: "2026-12-14" });
    if (p.ok) expect(p.notes.join(" ")).toContain("3 extra days");
  });
  it("conditions in the fermenter when there is no brite tank", () => {
    const p = planBrew({ ...base, tanks: [FV1], busy: [] });
    expect(p).toMatchObject({ ok: true, brite: null, fermenter: { end: "2026-12-11" }, packageOn: "2026-12-11" });
  });
  it("says why nothing fits and the earliest day that would", () => {
    const busy = [{ tankId: "fv1", start: "2026-11-01", end: "2026-12-01" }, { tankId: "fv2", start: "2026-11-01", end: "2026-12-05" }];
    const p = planBrew({ ...base, busy });
    expect(p).toMatchObject({ ok: false, earliest: "2026-12-01" });
    if (!p.ok) expect(p.reason).toMatch(/busy/i);
  });
  it("says when no fermenter is big enough", () => {
    const p = planBrew({ ...base, bbl: 30, busy: [] });
    expect(p).toMatchObject({ ok: false, earliest: null });
    if (!p.ok) expect(p.reason).toContain("15 bbl");
  });
  it("says when there are no fermenters", () => {
    const p = planBrew({ ...base, tanks: [BT1], busy: [] });
    expect(p).toMatchObject({ ok: false, earliest: null });
  });
});

describe("suggestBrews", () => {
  const defaults = { fermentDays: 14, conditionDays: 7 };
  const beer = (id: string, runOutOn: string | null, over = {}) => ({ id, name: id, active: true, runOutOn, fermentDays: null, conditionDays: null, ...over });
  it("works back from the run-out date by ferment and condition days", () => {
    const [s] = suggestBrews({ today, beers: [beer("Lager", "2026-12-31", { fermentDays: 21, conditionDays: 14 })], defaults, batches: [] });
    expect(s).toMatchObject({ beerId: "Lager", brewBy: "2026-11-26", leadDays: 35, state: "soon", daysToBrewBy: 10, alreadyOut: false, planned: null });
  });
  it("uses the setup defaults when the beer has no recipe", () => {
    const [s] = suggestBrews({ today, beers: [beer("IPA", "2027-01-31")], defaults, batches: [] });
    expect(s).toMatchObject({ brewBy: "2027-01-10", state: "later" });
  });
  it("ignores beers with no forecast and beers we don't plan for", () => {
    expect(suggestBrews({ today, beers: [beer("A", null), beer("B", "2026-12-01", { active: false })], defaults, batches: [] })).toEqual([]);
  });
  it("marks a beer whose run-out is already past", () => {
    const [s] = suggestBrews({ today, beers: [beer("Gose", "2026-11-10")], defaults, batches: [] });
    expect(s).toMatchObject({ alreadyOut: true, state: "late", brewBy: "2026-10-20" });
    expect(s.daysToBrewBy).toBeLessThan(0);
  });
  it("shows brews already planned or in tanks", () => {
    const batches = [
      { id: "p", code: "26-010", beerId: "A", status: "PLANNED" as const, plannedOn: "2026-11-24" },
      { id: "q", code: "26-008", beerId: "B", status: "FERMENTING" as const, plannedOn: null },
      { id: "r", code: "26-001", beerId: "C", status: "PACKAGED" as const, plannedOn: null },
    ];
    const out = suggestBrews({ today, beers: [beer("A", "2026-12-20"), beer("B", "2026-12-20"), beer("C", "2026-12-20")], defaults, batches });
    expect(out.find((s) => s.beerId === "A")!.planned).toMatchObject({ code: "26-010", on: "2026-11-24", inTanks: false });
    expect(out.find((s) => s.beerId === "A")!.state).toBe("planned");
    expect(out.find((s) => s.beerId === "B")!.planned).toMatchObject({ inTanks: true });
    expect(out.find((s) => s.beerId === "C")!.planned).toBeNull();
    // Unplanned first.
    expect(out[0].beerId).toBe("C");
  });
});

describe("needsDoing", () => {
  it("is empty for an empty brewery", () => {
    expect(needsDoing({ floor: [], clashes: [], batches: [], tanks: [], today })).toEqual([]);
  });
  it("lists transfers due, brews for today and tomorrow, and clashes", () => {
    const b = [batch("a", { name: "Lager" }), batch("p", { status: "PLANNED", plannedOn: "2026-11-17", name: "IPA" }), batch("later", { status: "PLANNED", plannedOn: "2026-11-30" })];
    const s = [stay("s", "fv1", "a", "2026-10-30", null)];
    const floor = tankFloor(tanks, s, b, today);
    const clashes = [{ tankId: "fv2", a: "x", b: "y", from: "2026-11-20", to: "2026-11-22" }];
    const items = needsDoing({ floor, clashes, batches: b, tanks, today });
    expect(items.map((i) => i.kind)).toEqual(["transfer", "clash", "brew"]);
    expect(items[0]).toMatchObject({ title: "FV1: transfer Lager", tone: "bad", detail: expect.stringContaining("3 days overdue") });
    expect(items[2]).toMatchObject({ title: "Brew IPA tomorrow" });
  });
  it("flags a planned brew whose day has passed", () => {
    const b = [batch("p", { status: "PLANNED", plannedOn: "2026-11-13", name: "IPA" })];
    const [i] = needsDoing({ floor: [], clashes: [], batches: b, tanks, today });
    expect(i).toMatchObject({ kind: "brew", tone: "warn", title: "IPA was planned for Nov 13" });
  });
});

describe("batch codes and numbers", () => {
  it("numbers brews within the year", () => {
    expect(nextBatchCode("2026-11-16", [])).toBe("26-001");
    expect(nextBatchCode("2026-11-16", ["26-001", "26-014", "25-099", "custom"])).toBe("26-015");
    expect(nextBatchCode("2027-01-02", ["26-014"])).toBe("27-001");
  });
  it("works out ABV from gravity", () => {
    expect(abv(1.05, 1.01)).toBeCloseTo(5.25, 2);
    expect(abv(null, 1.01)).toBeNull();
    expect(abv(1.01, 1.05)).toBeNull();
  });
  it("works out cost per pint", () => {
    expect(costPerPint(496, 2)).toBeCloseTo(1, 5);
    expect(costPerPint(null, 2)).toBeNull();
    expect(costPerPint(100, 0)).toBeNull();
  });
});
