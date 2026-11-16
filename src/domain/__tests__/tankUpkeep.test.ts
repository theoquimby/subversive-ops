import { describe, expect, it } from "vitest";
import { downTanks, equipmentHref } from "../tankUpkeep";

const repair = (over: Partial<{ kind: string; down: boolean; fixedOn: string | null; date: string; title: string }> = {}) => ({ kind: "repair", down: true, fixedOn: null, date: "2026-11-10", title: "Glycol jacket leaking", ...over });

describe("downTanks", () => {
  it("marks a tank down while a repair that took it out of service is open", () => {
    const m = downTanks([{ tankId: "fv1", equipmentId: "e1", active: true, logs: [repair({ date: "2026-11-12", title: "Later" }), repair()] }]);
    expect(m.get("fv1")).toEqual({ tankId: "fv1", equipmentId: "e1", since: "2026-11-10", title: "Glycol jacket leaking" });
  });
  it("ignores fixed repairs, repairs that didn't take it down, other log kinds and unlinked equipment", () => {
    const m = downTanks([
      { tankId: "fv1", equipmentId: "e1", active: true, logs: [repair({ fixedOn: "2026-11-11" })] },
      { tankId: "fv2", equipmentId: "e2", active: true, logs: [repair({ down: false })] },
      { tankId: "fv3", equipmentId: "e3", active: true, logs: [repair({ kind: "service" })] },
      { tankId: null, equipmentId: "e4", active: true, logs: [repair()] },
      { tankId: "fv5", equipmentId: "e5", active: false, logs: [repair()] },
    ]);
    expect(m.size).toBe(0);
  });
  it("links to the equipment on Upkeep", () => {
    expect(equipmentHref("e1")).toBe("/upkeep#equipment-e1");
  });
});
