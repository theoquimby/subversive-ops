import { describe, expect, it } from "vitest";
import { adoptCachedGravity, gravityFromReadings, removeReading, typedGravity, typedGravityDate, type Reading } from "../brewGravity";

const r = (on: string, sg: number, kind: Reading["kind"] = "reading"): Reading => ({ on, sg, kind, note: null });

describe("OG and FG from readings", () => {
  it("takes the first OG reading, else the brew-day log's", () => {
    expect(gravityFromReadings([r("2026-11-02", 1.06, "og"), r("2026-11-01", 1.058, "og")], {}).og).toBe(1.058);
    expect(gravityFromReadings([r("2026-11-02", 1.02)], { logOg: 1.061 }).og).toBe(1.061);
    expect(gravityFromReadings([], {}).og).toBeNull();
  });
  it("takes the latest FG reading or reading at or after packaging", () => {
    const list = [r("2026-11-01", 1.06, "og"), r("2026-11-10", 1.014, "fg"), r("2026-11-15", 1.012)];
    expect(gravityFromReadings(list, { packagedOn: null }).fg).toBe(1.014);
    expect(gravityFromReadings(list, { packagedOn: "2026-11-15" }).fg).toBe(1.012);
    expect(gravityFromReadings([r("2026-11-15", 1.012), r("2026-11-15", 1.011, "fg")], { packagedOn: "2026-11-15" }).fg).toBe(1.011);
  });
  it("falls back to the brew-day log's FG, and has none mid-ferment", () => {
    expect(gravityFromReadings([r("2026-11-05", 1.03)], { logFg: 1.01 }).fg).toBe(1.01);
    expect(gravityFromReadings([r("2026-11-05", 1.03)], {}).fg).toBeNull();
  });
});

describe("keeping older OG and FG as readings", () => {
  it("adds a reading for an OG or FG no reading explains", () => {
    const out = adoptCachedGravity([], { og: 1.06, fg: 1.012 }, { ogOn: "2026-11-01", fgOn: "2026-11-20" });
    expect(out).toEqual([
      { on: "2026-11-01", sg: 1.06, kind: "og", note: "OG typed before readings were kept" },
      { on: "2026-11-20", sg: 1.012, kind: "fg", note: "FG typed before readings were kept" },
    ]);
  });
  it("adds nothing when readings or the log already give it", () => {
    const list = [r("2026-11-01", 1.06, "og")];
    expect(adoptCachedGravity(list, { og: 1.06, fg: null }, { ogOn: "2026-11-01", fgOn: "2026-11-20" })).toEqual(list);
    expect(adoptCachedGravity([], { og: 1.061, fg: null, logOg: 1.061 }, { ogOn: "2026-11-01", fgOn: "2026-11-20" })).toEqual([]);
  });
  it("doesn't freeze an FG that came from a reading after packaging", () => {
    // Packaging moved to the 20th: the reading on the 15th no longer counts as the FG.
    const list = [r("2026-11-15", 1.012)];
    expect(adoptCachedGravity(list, { og: null, fg: 1.012, packagedOn: "2026-11-20" }, { ogOn: "2026-11-01", fgOn: "2026-11-20" })).toEqual(list);
  });
});

describe("typing OG or FG", () => {
  it("replaces the readings of that kind with one, or clears them", () => {
    const list = [r("2026-11-01", 1.058, "og"), r("2026-11-05", 1.03)];
    expect(typedGravity(list, "og", 1.06, "2026-11-01")).toEqual([r("2026-11-01", 1.06, "og"), r("2026-11-05", 1.03)].map((x, i) => (i === 0 ? { ...x, note: "Typed" } : x)));
    expect(typedGravity(list, "og", null, "2026-11-01")).toEqual([r("2026-11-05", 1.03)]);
  });
  it("dates OG on the brew day and FG last", () => {
    const list = [r("2026-11-03", 1.058, "og"), r("2026-11-18", 1.013)];
    expect(typedGravityDate(list, "og", { brewedOn: "2026-11-01", plannedOn: null, packagedOn: null, today: "2026-11-20" })).toBe("2026-11-03");
    expect(typedGravityDate([], "og", { brewedOn: "2026-11-01", plannedOn: null, packagedOn: null, today: "2026-11-20" })).toBe("2026-11-01");
    expect(typedGravityDate(list, "fg", { brewedOn: "2026-11-01", plannedOn: null, packagedOn: "2026-11-15", today: "2026-11-20" })).toBe("2026-11-18");
    expect(typedGravityDate([], "fg", { brewedOn: "2026-11-01", plannedOn: null, packagedOn: null, today: "2026-11-20" })).toBe("2026-11-20");
  });
  it("removes one reading", () => {
    const list = [r("2026-11-01", 1.06, "og"), r("2026-11-05", 1.03)];
    expect(removeReading(list, r("2026-11-05", 1.03))).toEqual([r("2026-11-01", 1.06, "og")]);
    expect(removeReading(list, r("2026-11-06", 1.03))).toEqual(list);
  });
});
