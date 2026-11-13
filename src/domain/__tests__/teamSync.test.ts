import { describe, expect, it } from "vitest";
import { describeDiff, mergePositionRate, mergeTeamMember, parseTeamDiffs } from "../teamSync";

const sq = { name: "Jamie Rivera", email: "jamie@sq.com", phone: "(518) 555-0101", hourlyRate: 16, active: true };

describe("Square team merge", () => {
  it("creates new people straight from Square", () => {
    expect(mergeTeamMember(null, sq, false).data).toEqual(sq);
  });
  it("only fills blanks and reports differences", () => {
    const m = mergeTeamMember({ name: "Jamie R.", email: null, phone: "518-555-0101", hourlyRate: 18, active: true }, sq, false);
    expect(m.data).toEqual({ email: "jamie@sq.com" });
    expect(m.diffs.map((d) => d.field)).toEqual(["name", "hourlyRate"]);
    expect(describeDiff(m.diffs[1])).toBe("Rate: $18.00 here, $16.00 in Square");
  });
  it("fills a missing rate but never overwrites one", () => {
    expect(mergeTeamMember({ ...sq, hourlyRate: null }, sq, false).data).toEqual({ hourlyRate: 16 });
    expect(mergeTeamMember({ ...sq, hourlyRate: 16.001 }, sq, false).diffs).toEqual([]);
  });
  it("carries deactivation over but doesn't undo a deactivation made in Ops", () => {
    const off = mergeTeamMember(sq, { ...sq, active: false }, false);
    expect(off.data.active).toBe(false);
    expect(off.deactivatedBySync).toBe(true);
    expect(mergeTeamMember({ ...sq, active: false }, sq, false).data.active).toBeUndefined();
    const back = mergeTeamMember({ ...sq, active: false }, sq, true);
    expect(back.data.active).toBe(true);
    expect(back.reactivated).toBe(true);
  });
  it("merges per-position rates the same way", () => {
    expect(mergePositionRate(null, 15, "Server")).toEqual({ rate: 15 });
    expect(mergePositionRate(17, 15, "Server").diff).toEqual({ field: "hourlyRate", position: "Server", ops: "$17.00", square: "$15.00" });
    expect(mergePositionRate(17, null, "Server")).toEqual({});
  });
  it("parses stored differences defensively", () => {
    expect(parseTeamDiffs(JSON.stringify({ e1: [{ field: "email", ops: "a", square: "b" }, { nope: 1 }], e2: "x" }))).toEqual({ e1: [{ field: "email", ops: "a", square: "b" }] });
    expect(parseTeamDiffs("[")).toEqual({});
  });
});
