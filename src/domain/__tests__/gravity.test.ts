import { describe, expect, it } from "vitest";
import { abvAlternate, abvFromText, abvStandard, formatGravity, gravityInputText, gravityUnitOf, parseGravity, platoToSg, roundSg, sgToPlato } from "../gravity";

/** ASBC polynomial, the usual published SG → °P conversion, to check ours against. */
const asbc = (sg: number) => -616.868 + 1111.14 * sg - 630.272 * sg ** 2 + 135.997 * sg ** 3;

describe("Plato and specific gravity", () => {
  it("converts °P to SG with Brew Manager's formula", () => {
    expect(platoToSg(0)).toBe(1);
    expect(platoToSg(12)).toBeCloseTo(1.04838, 5);
    expect(platoToSg(15.5)).toBeCloseTo(1.06327, 5);
    expect(platoToSg(2.5)).toBeCloseTo(1.00975, 5);
  });

  it("round-trips 0–30 °P within 0.05 °P, also through the 4 stored decimals", () => {
    let worst = 0;
    let worstStored = 0;
    for (let p = 0; p <= 30; p += 0.1) {
      worst = Math.max(worst, Math.abs(sgToPlato(platoToSg(p)) - p));
      worstStored = Math.max(worstStored, Math.abs(sgToPlato(roundSg(platoToSg(p))) - p));
    }
    expect(worst).toBeLessThan(1e-9);
    expect(worstStored).toBeLessThan(0.05);
    expect(worstStored).toBeLessThan(0.02);
  });

  it("agrees with the ASBC polynomial within 0.1 °P from 1.000 to 1.100", () => {
    for (let sg = 1; sg <= 1.1; sg += 0.005) expect(Math.abs(sgToPlato(sg) - asbc(sg))).toBeLessThan(0.1);
  });

  it("formats in the chosen unit", () => {
    expect(formatGravity(1.06327, "plato")).toBe("15.5 °P");
    expect(formatGravity(1.06327, "plato", { label: false })).toBe("15.5");
    expect(formatGravity(1.06327, "sg")).toBe("1.063");
    expect(formatGravity(1, "plato")).toBe("0.0 °P");
    expect(formatGravity(null, "sg")).toBe("");
    expect(gravityInputText(roundSg(platoToSg(15.5)), "plato")).toBe("15.5");
    expect(gravityInputText(1.0633, "sg")).toBe("1.0633");
    expect(gravityInputText(undefined, "plato")).toBe("");
  });

  it("reads typed gravities", () => {
    const p155 = roundSg(platoToSg(15.5));
    expect(parseGravity("15.5", "plato")).toBe(p155);
    expect(parseGravity("15.5P", "sg")).toBe(p155);
    expect(parseGravity("15.5 °P", "sg")).toBe(p155);
    expect(parseGravity("15,5", "plato")).toBe(p155);
    expect(parseGravity("1.063", "plato")).toBe(1.063);
    expect(parseGravity("1.0633", "plato")).toBe(1.0633);
    expect(parseGravity("1.063", "sg")).toBe(1.063);
    expect(parseGravity("1.05", "sg")).toBe(1.05);
    expect(parseGravity("1.05", "plato")).toBe(roundSg(platoToSg(1.05)));
    expect(parseGravity("12", "sg")).toBe(roundSg(platoToSg(12)));
    expect(parseGravity("1.050 SG", "plato")).toBe(1.05);
    expect(parseGravity(15.5, "plato")).toBe(p155);
  });

  it("refuses things that aren't gravities", () => {
    for (const bad of ["", "  ", "abc", "-2", "55", "1.5 SG", "1.2.3", null, undefined]) expect(parseGravity(bad as string, "plato")).toBeNull();
    expect(parseGravity("0.9", "sg")).toBe(roundSg(platoToSg(0.9)));
  });

  it("defaults to Plato", () => {
    expect(gravityUnitOf(undefined)).toBe("plato");
    expect(gravityUnitOf("sg")).toBe("sg");
    expect(gravityUnitOf("brix")).toBe("plato");
  });
});

describe("ABV", () => {
  it("standard and alternate, as Brew Manager shows them", () => {
    const og = platoToSg(15.5);
    const fg = platoToSg(2.5);
    expect(abvStandard(og, fg)).toBeCloseTo(7.0, 1);
    expect(abvStandard(og, fg).toFixed(2)).toBe("7.02");
    expect(abvAlternate(og, fg).toFixed(2)).toBe("7.28");
    expect(abvStandard(1.05, 1.01)).toBeCloseTo(5.25, 6);
  });

  it("from typed text in either unit", () => {
    const r = abvFromText("15.5", "2.5", "plato")!;
    expect(r.standard).toBeCloseTo(abvStandard(roundSg(platoToSg(15.5)), roundSg(platoToSg(2.5))), 6);
    expect(abvFromText("1.050", "1.010", "sg")!.standard).toBeCloseTo(5.25, 6);
    expect(abvFromText("2", "15", "plato")).toBeNull();
    expect(abvFromText("", "2", "plato")).toBeNull();
  });
});
