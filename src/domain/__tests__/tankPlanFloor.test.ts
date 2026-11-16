import { describe, expect, it } from "vitest";
import { weekday } from "../dates";
import {
  floorLayout,
  needsDoing,
  nextAction,
  planBrew,
  splitCode,
  STARTER_TANKS,
  tankFloor,
  type PlanBatch,
  type PlanStay,
  type PlanTank,
  type TankNow,
} from "../tankPlan";

const today = "2026-11-16"; // a Monday

const now = (over: Partial<TankNow> = {}): TankNow => ({ stayId: "s", batchId: "b", start: "2026-11-06", dueOn: "2026-11-26", day: 10, of: 20, stage: "ferment", prompt: null, ...over });

describe("nextAction", () => {
  it("packages from a brite, turning amber when due and red three days over", () => {
    expect(nextAction({ now: now({ stage: "condition" }), status: "CONDITIONING", today, dryHopOn: null, lastReadingOn: null, fg: null })).toMatchObject({ kind: "package", label: "Package", tone: "neutral" });
    expect(nextAction({ now: now({ stage: "condition", prompt: { kind: "package", label: "", overdueDays: 0 } }), status: "CONDITIONING", today, dryHopOn: null, lastReadingOn: null, fg: null })).toMatchObject({ label: "Package", tone: "warn" });
    expect(nextAction({ now: now({ stage: "condition", prompt: { kind: "package", label: "", overdueDays: 3 } }), status: "CONDITIONING", today, dryHopOn: null, lastReadingOn: null, fg: null })).toMatchObject({ tone: "bad" });
  });

  it("says transfer to brite for a brew marked conditioning in its fermenter", () => {
    expect(nextAction({ now: now(), status: "CONDITIONING", today, dryHopOn: null, lastReadingOn: null, fg: 1.012 })).toMatchObject({ kind: "brite", label: "Transfer to brite" });
  });

  it("asks to check for a transfer when the fermenting days are up", () => {
    expect(nextAction({ now: now({ prompt: { kind: "transfer", label: "", overdueDays: 1 } }), status: "FERMENTING", today, dryHopOn: null, lastReadingOn: null, fg: null })).toMatchObject({ kind: "transfer", label: "Check: transfer?", tone: "warn" });
  });

  it("reminds about the dry hop on the day and the day after", () => {
    expect(nextAction({ now: now(), status: "FERMENTING", today, dryHopOn: today, lastReadingOn: today, fg: null })).toMatchObject({ kind: "dryhop", label: "Dry hop" });
    expect(nextAction({ now: now(), status: "FERMENTING", today, dryHopOn: "2026-11-15", lastReadingOn: today, fg: null })).toMatchObject({ label: "Dry hop" });
    expect(nextAction({ now: now(), status: "FERMENTING", today, dryHopOn: "2026-11-14", lastReadingOn: today, fg: null })).toBeNull();
    expect(nextAction({ now: now(), status: "FERMENTING", today, dryHopOn: "2026-11-17", lastReadingOn: today, fg: null })).toBeNull();
  });

  it("asks for a gravity check from day 7 when there's no recent reading and no FG yet", () => {
    expect(nextAction({ now: now({ day: 7 }), status: "FERMENTING", today, dryHopOn: null, lastReadingOn: null, fg: null })).toMatchObject({ kind: "gravity", label: "Grav check" });
    expect(nextAction({ now: now({ day: 6 }), status: "FERMENTING", today, dryHopOn: null, lastReadingOn: null, fg: null })).toBeNull();
    expect(nextAction({ now: now({ day: 9 }), status: "FERMENTING", today, dryHopOn: null, lastReadingOn: "2026-11-14", fg: null })).toBeNull();
    expect(nextAction({ now: now({ day: 9 }), status: "FERMENTING", today, dryHopOn: null, lastReadingOn: "2026-11-12", fg: null })).toMatchObject({ label: "Grav check" });
    expect(nextAction({ now: now({ day: 9 }), status: "FERMENTING", today, dryHopOn: null, lastReadingOn: null, fg: 1.01 })).toBeNull();
  });
});

describe("floorLayout", () => {
  const t = (name: string, zone: string | null, row: number | null, col: number | null, sort = 0) => ({ id: name, name, zone, layoutRow: row, layoutCol: col, sort });

  it("groups tanks by zone and places them by row and column", () => {
    const z = floorLayout([t("FV4", "Back wall", 2, 5, 4), t("BBT1", "Back wall", 1, 1, 9), t("FV1", "Back wall", 1, 3, 1), t("FV7", "Separate room", 1, 1, 7), t("FV6", "Front", 1, 1, 6)]);
    expect(z.map((x) => x.zone)).toEqual(["Back wall", "Front", "Separate room"]);
    expect(z[0]).toMatchObject({ rows: 2, cols: 5 });
    expect(z[0].cells).toEqual(expect.arrayContaining([{ tankId: "FV4", row: 2, col: 5 }, { tankId: "BBT1", row: 1, col: 1 }]));
  });

  it("puts tanks with no zone last, and tanks with no place after the placed ones in their zone", () => {
    const z = floorLayout([t("FV9", null, null, null, 1), t("FV1", "Front", 1, 2, 2), t("FV2", "Front", null, null, 3), t("FV3", "Front", null, null, 4)]);
    expect(z.map((x) => x.zone)).toEqual(["Front", null]);
    expect(z[0].cells).toEqual([{ tankId: "FV1", row: 1, col: 2 }, { tankId: "FV2", row: 2, col: 1 }, { tankId: "FV3", row: 2, col: 2 }]);
    expect(z[1].cells).toEqual([{ tankId: "FV9", row: 1, col: 1 }]);
  });

  it("moves a tank off a cell another tank already holds", () => {
    const z = floorLayout([t("A", "Front", 1, 1, 1), t("B", "Front", 1, 1, 2)]);
    expect(z[0].cells).toEqual([{ tankId: "A", row: 1, col: 1 }, { tankId: "B", row: 2, col: 1 }]);
  });
});

describe("Brew Manager's tanks", () => {
  it("are the 11 tanks with sizes and places", () => {
    expect(STARTER_TANKS).toHaveLength(11);
    const by = new Map(STARTER_TANKS.map((x) => [x.name, x]));
    expect(by.get("FV1")).toMatchObject({ kind: "FERMENTER", capacityBbl: 9, zone: "Back wall", layoutRow: 1, layoutCol: 3 });
    expect(by.get("FV4")).toMatchObject({ zone: "Back wall", layoutRow: 2, layoutCol: 5 });
    expect(by.get("FV5")).toMatchObject({ zone: "Back wall", layoutRow: 3, layoutCol: 5 });
    expect(by.get("FV6")).toMatchObject({ capacityBbl: 5, zone: "Front" });
    expect(by.get("FV8")).toMatchObject({ capacityBbl: 4, zone: "Separate room" });
    expect(by.get("BBT3")).toMatchObject({ kind: "BRITE", capacityBbl: 10, zone: "Front" });
    expect(by.get("BBT1")).toMatchObject({ kind: "BRITE", capacityBbl: 7, layoutRow: 1, layoutCol: 1 });
  });
});

describe("planBrew on brewery weekdays", () => {
  const FV1: PlanTank = { id: "fv1", name: "FV1", kind: "FERMENTER", capacityBbl: 9, sort: 1, active: true };
  const BT1: PlanTank = { id: "bt1", name: "BT1", kind: "BRITE", capacityBbl: 9, sort: 2, active: true };

  it("waits for a brite only until another transfer day, and packages on a packaging day", () => {
    // Brew Mon Nov 16, transfer Mon Nov 30, but BT1 is busy until Wed Dec 2.
    const p = planBrew({ brewOn: today, bbl: 7, fermentDays: 14, conditionDays: 9, tanks: [FV1, BT1], busy: [{ tankId: "bt1", start: "2026-11-20", end: "2026-12-02" }], snap: { transferDays: [1, 2], packageDays: [3] } });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.brite?.start).toBe("2026-12-07"); // next Monday, not Wed Dec 2
    expect(weekday(p.packageOn)).toBe(3);
    expect(p.packageOn > p.brite!.start).toBe(true);
  });
});

describe("dry hops in Needs doing", () => {
  it("lists a dry hop due today for a brew in a tank", () => {
    const tanks: PlanTank[] = [{ id: "fv1", name: "FV1", kind: "FERMENTER", capacityBbl: 9, sort: 1, active: true }];
    const batches: PlanBatch[] = [{ id: "b", code: "26-001", name: "Nectar", status: "FERMENTING", bbl: 7, fermentDays: 20, conditionDays: 3, dryHopOn: today }];
    const stays: PlanStay[] = [{ id: "s", tankId: "fv1", batchId: "b", start: "2026-11-09", end: null, planned: false }];
    const todos = needsDoing({ floor: tankFloor(tanks, stays, batches, today), clashes: [], batches, tanks, today });
    expect(todos).toEqual([expect.objectContaining({ kind: "dryhop", title: "FV1: dry hop Nectar", detail: "Today · day 7", tankId: "fv1" })]);
  });
});

describe("splitCode", () => {
  it("adds the next letter to the parent's code", () => {
    expect(splitCode("26-014", [])).toBe("26-014B");
    expect(splitCode("26-014", ["26-014B"])).toBe("26-014C");
    expect(splitCode("26-014", ["26-014B", "26-014C", "26-015"])).toBe("26-014D");
  });
});
