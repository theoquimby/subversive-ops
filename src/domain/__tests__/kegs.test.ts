import { describe, expect, it } from "vitest";
import { applyKegAction, checkChar, displayCode, guessBeerColor, isOurCode, kegOz, legacyCandidates, newKegCode, nextActions, normalizeCode, parseKegSize, parseScan, placeLabel, sinceLabel, type KegState } from "../kegs";

const base: KegState = { status: "COLD", beerId: "b1", area: "Walk-in", spotId: "s1", spotNote: null, tapLine: null, accountId: null };

describe("keg sizes", () => {
  it("knows how much a keg holds", () => {
    expect(kegOz("half")).toBeCloseTo(1984, 0);
    expect(kegOz("sixtel")).toBeCloseTo(660.5, 0);
    expect(kegOz("euro50")).toBeCloseTo(1690.7, 0);
  });
  it("reads sizes written different ways", () => {
    expect(parseKegSize("1/2 bbl")).toBe("half");
    expect(parseKegSize("Half Barrel")).toBe("half");
    expect(parseKegSize("15.5 gal")).toBe("half");
    expect(parseKegSize("1/6")).toBe("sixtel");
    expect(parseKegSize("Sixtel")).toBe("sixtel");
    expect(parseKegSize("pony keg")).toBe("quarter");
    expect(parseKegSize("50L")).toBe("euro50");
    expect(parseKegSize("30 litre")).toBe("euro30");
    expect(parseKegSize("Cornelius / corny")).toBe("corny");
    expect(parseKegSize("mystery")).toBeNull();
    expect(parseKegSize("")).toBeNull();
  });
});

describe("keg codes", () => {
  it("makes short codes with a check character", () => {
    let i = 0;
    const seq = [0.1, 0.5, 0.9, 0.3];
    const code = newKegCode(() => seq[i++ % seq.length]);
    expect(code).toHaveLength(5);
    expect(isOurCode(code)).toBe(true);
    expect(code[4]).toBe(checkChar(code.slice(0, 4)));
  });
  it("catches a typo", () => {
    const code = newKegCode(() => 0.42);
    const typo = (code[0] === "2" ? "3" : "2") + code.slice(1);
    expect(isOurCode(typo)).toBe(false);
  });
  it("normalizes what people type", () => {
    expect(normalizeCode(" 7q3-mx ")).toBe("7Q3MX");
    expect(displayCode("7Q3MX")).toBe("7Q3-MX");
  });
  it("reads our sticker URL, a bare code and another app's QR", () => {
    expect(parseScan("https://ops.example.com/kegs/k/7Q3MX")?.code).toBe("7Q3MX");
    expect(parseScan("7q3-mx")?.code).toBe("7Q3MX");
    expect(parseScan("https://oldapp.example.com/keg/AB-1234")?.code).toBe("AB1234");
    expect(parseScan("   ")).toBeNull();
    expect(legacyCandidates("https://oldapp.example.com/keg/AB-1234")).toContain("AB1234");
  });
});

describe("keg actions", () => {
  it("offers the right buttons first", () => {
    expect(nextActions("ON_TAP")[0]).toBe("KICK");
    expect(nextActions("COLD")).toEqual(["TAP", "MOVE", "OUT"]);
    expect(nextActions("FILLED")[0]).toBe("STORE");
    expect(nextActions("OUT")).toEqual(["RETURN"]);
  });
  it("taps a full keg and kicks it", () => {
    const tapped = applyKegAction(base, { action: "TAP", tapLine: 4, tapArea: "Bar" });
    if ("error" in tapped) throw new Error(tapped.error);
    expect(tapped.next).toMatchObject({ status: "ON_TAP", tapLine: 4, area: "Bar", spotId: null });
    expect(tapped.fill).toBe("tap");
    const kicked = applyKegAction(tapped.next, { action: "KICK" });
    if ("error" in kicked) throw new Error(kicked.error);
    expect(kicked.next).toMatchObject({ status: "KICKED", tapLine: null });
    expect(kicked.event).toBe("KICKED");
  });
  it("explains what doesn't make sense", () => {
    expect(applyKegAction(base, { action: "KICK" })).toEqual({ error: "Only a keg on tap can kick." });
    expect(applyKegAction(base, { action: "TAP" })).toEqual({ error: "Pick a tap line." });
    expect(applyKegAction({ ...base, beerId: null }, { action: "TAP", tapLine: 2 })).toMatchObject({ error: expect.stringContaining("Fill") });
    expect(applyKegAction({ ...base, status: "EMPTY" }, { action: "OUT", accountId: "a" })).toMatchObject({ error: expect.any(String) });
    expect(applyKegAction({ ...base, status: "KICKED" }, { action: "FILL", beerId: "b" })).toEqual({ error: "Clean it first." });
  });
  it("moves within the walk-in and clears the spot when the area changes", () => {
    const same = applyKegAction(base, { action: "MOVE", area: "Walk-in", spotId: "s2" });
    if ("error" in same) throw new Error(same.error);
    expect(same.next.spotId).toBe("s2");
    const other = applyKegAction(base, { action: "MOVE", area: "Keg cooler" });
    if ("error" in other) throw new Error(other.error);
    expect(other.next).toMatchObject({ area: "Keg cooler", spotId: null });
  });
  it("sends out, gets back, cleans and fills", () => {
    const out = applyKegAction(base, { action: "OUT", accountId: "acc" });
    if ("error" in out) throw new Error(out.error);
    expect(out.next).toMatchObject({ status: "OUT", accountId: "acc", area: null });
    const back = applyKegAction(out.next, { action: "RETURN", area: "Brewhouse" });
    if ("error" in back) throw new Error(back.error);
    expect(back.next).toMatchObject({ status: "CLEANING", accountId: null, beerId: null, area: "Brewhouse" });
    const clean = applyKegAction(back.next, { action: "CLEANED" });
    if ("error" in clean) throw new Error(clean.error);
    const fill = applyKegAction(clean.next, { action: "FILL", beerId: "b2" });
    if ("error" in fill) throw new Error(fill.error);
    expect(fill.next).toMatchObject({ status: "FILLED", beerId: "b2" });
    expect(fill.fill).toBe("start");
  });
});

describe("labels", () => {
  it("says where a keg is", () => {
    expect(placeLabel({ area: "Walk-in", spot: "Back left", spotNote: "stack 2" })).toBe("Walk-in · Back left · stack 2");
    expect(placeLabel({ area: "Bar", status: "ON_TAP", tapLine: 3 })).toBe("Tap 3");
    expect(placeLabel({ area: null, status: "OUT", account: "Brew Pub" })).toBe("Out at Brew Pub");
  });
  it("says how long", () => {
    const now = new Date("2026-11-13T20:00:00Z");
    expect(sinceLabel(new Date("2026-11-13T19:40:00Z"), now)).toBe("20 min");
    expect(sinceLabel(new Date("2026-11-13T15:00:00Z"), now)).toBe("5 hours");
    expect(sinceLabel(new Date("2026-11-10T20:00:00Z"), now)).toBe("3 days");
  });
  it("guesses a board color", () => {
    expect(guessBeerColor("Oatmeal Stout")).toBe("black");
    expect(guessBeerColor("Golden Lager")).toBe("straw");
    expect(guessBeerColor("New York Nectar")).toBe("haze");
  });
});

describe("insight kind", () => {
  it("files keg run-outs under ordering", async () => {
    const { kindMeta } = await import("../lab");
    expect(kindMeta("kegs.runout")).toEqual({ area: "ordering", effort: "easy", vector: "save" });
  });
});

describe("spot notes", () => {
  it("drop the old note when a keg changes spot", () => {
    const r = applyKegAction({ ...base, spotNote: "stack 2" }, { action: "MOVE", area: "Walk-in", spotId: "s9" });
    if ("error" in r) throw new Error(r.error);
    expect(r.next.spotNote).toBeNull();
    const same = applyKegAction({ ...base, spotNote: "stack 2" }, { action: "MOVE", area: "Walk-in", spotId: "s1" });
    if ("error" in same) throw new Error(same.error);
    expect(same.next.spotNote).toBe("stack 2");
  });
});
