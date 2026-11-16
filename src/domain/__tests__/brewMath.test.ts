import { describe, expect, it } from "vitest";
import {
  abv,
  batchGallons,
  brewUnit,
  convertBrewQty,
  finalGravity,
  grainDefaults,
  gravityPoints,
  hopIbu,
  mcu,
  recipeStats,
  scaleLines,
  scaleQty,
  sgFromPoints,
  srmFromMcu,
  srmHex,
  tinsethUtilisation,
  toGallons,
  toOunces,
  toPounds,
  type BrewLineInput,
} from "../brewMath";

const grain = (qty: number, unit: string, ppg: number | null, colorL: number | null, name = "Pale malt"): BrewLineInput => ({ kind: "grain", name, qty, unit, potentialPpg: ppg, colorL });
const hop = (qty: number, unit: string, alphaPct: number | null, use: BrewLineInput["use"], minutes: number | null): BrewLineInput => ({ kind: "hop", name: "Cascade", qty, unit, alphaPct, use, minutes });

describe("units", () => {
  it("reads the units brewers write", () => {
    expect(brewUnit("lbs")).toBe("lb");
    expect(brewUnit("LB")).toBe("lb");
    expect(brewUnit("#")).toBe("lb");
    expect(brewUnit("pounds")).toBe("lb");
    expect(brewUnit("Kg")).toBe("kg");
    expect(brewUnit("grams")).toBe("g");
    expect(brewUnit("litres")).toBe("l");
    expect(brewUnit("gallon")).toBe("gal");
    expect(brewUnit("pack")).toBe("pkg");
    expect(brewUnit("pouches")).toBe("pkg");
    expect(brewUnit("ea")).toBe("each");
    expect(brewUnit("cup")).toBeNull();
    expect(brewUnit("")).toBeNull();
  });

  it("converts mass to pounds and ounces", () => {
    expect(toPounds(16, "oz")).toBeCloseTo(1, 10);
    expect(toPounds(453.59237, "g")).toBeCloseTo(1, 10);
    expect(toPounds(1, "kg")).toBeCloseTo(2.20462262, 6);
    expect(toOunces(2, "lb")).toBe(32);
    expect(toPounds(1, "gal")).toBeNull(); // volume isn't weight
    expect(toPounds(1, "pkg")).toBeNull();
  });

  it("converts volume to gallons", () => {
    expect(toGallons(3.785411784, "l")).toBeCloseTo(1, 10);
    expect(toGallons(3785.411784, "ml")).toBeCloseTo(1, 10);
    expect(toGallons(1, "lb")).toBeNull();
  });

  it("converts within a dimension only", () => {
    expect(convertBrewQty(1, "lb", "oz")).toBeCloseTo(16, 10);
    expect(convertBrewQty(2, "pkg", "each")).toBe(2);
    expect(convertBrewQty(1, "lb", "l")).toBeNull();
  });

  it("turns barrels into gallons, never negative", () => {
    expect(batchGallons(7)).toBe(217); // 7 × 31
    expect(batchGallons(0)).toBe(0);
    expect(batchGallons(-3)).toBe(0);
    expect(batchGallons(Number.NaN)).toBe(0);
  });
});

describe("grain defaults", () => {
  it("guesses extract and colour from the name when they are missing", () => {
    expect(grainDefaults("Pils").ppg).toBe(37);
    expect(grainDefaults("Crystal 60").ppg).toBe(34);
    expect(grainDefaults("Caramel 40").ppg).toBe(34);
    expect(grainDefaults("Table sugar").ppg).toBe(46);
    expect(grainDefaults("Dextrose").ppg).toBe(46);
    expect(grainDefaults("Roasted barley").ppg).toBe(25);
    expect(grainDefaults("Roasted barley").colorL).toBe(500);
    expect(grainDefaults("Munich").colorL).toBe(9);
    expect(grainDefaults("Something new").ppg).toBe(37);
  });
});

describe("original gravity", () => {
  it("adds up the grain bill at the brewhouse efficiency", () => {
    // 10 lb × 37 + 1 lb × 34 = 404 lb·ppg; × 0.75 = 303; ÷ 5 gal = 60.6 points → 1.0606
    const r = gravityPoints([grain(10, "lb", 37, 2), grain(1, "lb", 34, 60)], 5, 75);
    expect(r.points).toBeCloseTo(60.6, 6);
    expect(sgFromPoints(r.points)).toBeCloseTo(1.0606, 6);
    expect(r.perLine[0]).toBeCloseTo(55.5, 6); // 370 × 0.75 / 5
  });

  it("gives the same answer for the same grain in other units", () => {
    // 4.5359237 kg = 10 lb; 16 oz = 1 lb → still 60.6 points
    const r = gravityPoints([grain(4.5359237, "kg", 37, 2), grain(16, "oz", 34, 60)], 5, 75);
    expect(r.points).toBeCloseTo(60.6, 6);
  });

  it("counts sugar in full, without mash efficiency", () => {
    // 2 lb × 46 ppg = 92; ÷ 5 gal = 18.4 points → 1.0184 (efficiency doesn't apply to the kettle)
    const r = gravityPoints([{ kind: "adjunct", name: "Table sugar", qty: 2, unit: "lb", potentialPpg: 46 }], 5, 72);
    expect(r.points).toBeCloseTo(18.4, 6);
  });

  it("uses the default extract when a grain has none, and says so", () => {
    // Pils with no ppg → 37: 10 × 37 × 0.7 / 7 = 37 points
    const r = gravityPoints([grain(10, "lb", null, null, "Pils")], 7, 70);
    expect(r.points).toBeCloseTo(37, 6);
    expect(r.defaulted).toEqual([0]);
  });

  it("is 1.000 for nothing, zero volume, or negative amounts", () => {
    expect(gravityPoints([], 5, 75).points).toBe(0);
    expect(gravityPoints([grain(10, "lb", 37, 2)], 0, 75).points).toBe(0);
    expect(gravityPoints([grain(-10, "lb", 37, 2)], 5, 75).points).toBe(0);
    expect(gravityPoints([grain(10, "lb", 37, 2)], 5, -20).points).toBe(0); // efficiency floored at 0
    expect(gravityPoints([grain(10, "gal", 37, 2)], 5, 75).points).toBe(0); // a grain in gallons can't be weighed
  });
});

describe("final gravity and ABV", () => {
  it("works out FG from attenuation and ABV from the drop", () => {
    // 60.6 points × (1 − 0.75) = 15.15 → FG 1.01515; ABV = (1.0606 − 1.01515) × 131.25 = 5.9653
    const fg = finalGravity(1.0606, 75);
    expect(fg).toBeCloseTo(1.01515, 6);
    expect(abv(1.0606, fg)).toBeCloseTo(5.9653, 3);
  });

  it("never goes negative", () => {
    expect(finalGravity(1.05, 120)).toBe(1); // attenuation capped at 100%
    expect(finalGravity(1.05, -5)).toBe(1.05);
    expect(abv(1.01, 1.02)).toBe(0);
  });
});

describe("IBU (Tinseth)", () => {
  it("matches a hand-worked 60-minute addition", () => {
    // bigness = 1.65 × 0.000125^(1.050 − 1) = 1.052769; time = (1 − e^(−0.04×60)) / 4.15 = 0.219104
    // utilisation = 0.230664; mg/L alpha = 0.10 × 1 oz × 7490 / 5 gal = 149.8; IBU = 34.55
    expect(tinsethUtilisation(1.05, 60)).toBeCloseTo(0.230664, 5);
    expect(hopIbu(hop(1, "oz", 10, "boil", 60), 5, 1.05, 60)).toBeCloseTo(34.553, 2);
  });

  it("treats first-wort hops as boiling the whole boil", () => {
    expect(hopIbu(hop(1, "oz", 10, "firstwort", null), 5, 1.05, 60)).toBeCloseTo(34.553, 2);
  });

  it("gives whirlpool hops half the utilisation of the same minutes in the boil", () => {
    // utilisation at 20 min = 0.139693; × 0.5 × 149.8 = 10.463
    expect(hopIbu(hop(1, "oz", 10, "whirlpool", 20), 5, 1.05, 60)).toBeCloseTo(10.463, 2);
    // no minutes given → 20 minutes assumed
    expect(hopIbu(hop(1, "oz", 10, "whirlpool", null), 5, 1.05, 60)).toBeCloseTo(10.463, 2);
  });

  it("gives dry hops, mash hops, missing alpha and bad inputs nothing", () => {
    expect(hopIbu(hop(1, "oz", 10, "dryhop", 3), 5, 1.05, 60)).toBe(0);
    expect(hopIbu(hop(1, "oz", 10, "mash", 60), 5, 1.05, 60)).toBe(0);
    expect(hopIbu(hop(1, "oz", null, "boil", 60), 5, 1.05, 60)).toBe(0);
    expect(hopIbu(hop(1, "oz", 10, "boil", 60), 0, 1.05, 60)).toBe(0);
    expect(hopIbu(hop(-1, "oz", 10, "boil", 60), 5, 1.05, 60)).toBe(0);
    expect(hopIbu(hop(1, "oz", 10, "boil", -10), 5, 1.05, 60)).toBe(0);
  });

  it("weighs hops in any mass unit", () => {
    // 28.349523125 g = 1 oz
    expect(hopIbu(hop(28.349523125, "g", 10, "boil", 60), 5, 1.05, 60)).toBeCloseTo(34.553, 2);
  });
});

describe("colour (Morey)", () => {
  it("matches a hand-worked grist", () => {
    // MCU = (10 lb × 2 °L + 1 lb × 60 °L) / 5 gal = 16; SRM = 1.4922 × 16^0.6859 = 9.99
    const m = mcu([grain(10, "lb", 37, 2), grain(1, "lb", 34, 60)], 5);
    expect(m.mcu).toBeCloseTo(16, 10);
    expect(srmFromMcu(m.mcu)).toBeCloseTo(9.9939, 3);
  });

  it("is zero for no grain or no volume", () => {
    expect(mcu([], 5).mcu).toBe(0);
    expect(srmFromMcu(0)).toBe(0);
    expect(mcu([grain(10, "lb", 37, 2)], 0).mcu).toBe(0);
  });

  it("gives a swatch colour for any SRM", () => {
    expect(srmHex(1)).toMatch(/^#[0-9A-F]{6}$/);
    expect(srmHex(0)).toBe(srmHex(1));
    expect(srmHex(80)).toBe(srmHex(40));
    expect(srmHex(10)).not.toBe(srmHex(30));
  });
});

describe("scaling", () => {
  it("scales amounts in proportion to the batch", () => {
    expect(scaleQty(700, 7, 10)).toBeCloseTo(1000, 10); // 700 × 10 / 7
    expect(scaleQty(5, 7, 7)).toBe(5);
  });

  it("leaves amounts alone when a size is zero or negative", () => {
    expect(scaleQty(700, 0, 10)).toBe(700);
    expect(scaleQty(700, 7, -1)).toBe(700);
  });

  it("scales whole recipes and keeps the gravity the same", () => {
    const lines = [grain(700, "lb", 37, 2), hop(2, "lb", 12, "boil", 60)];
    const scaled = scaleLines(lines, 7, 14);
    expect(scaled[0].qty).toBe(1400);
    expect(scaled[1].qty).toBe(4);
    const a = recipeStats({ batchBbl: 7, efficiencyPct: 72, boilMinutes: 60, lines });
    const b = recipeStats({ batchBbl: 14, efficiencyPct: 72, boilMinutes: 60, lines: scaled });
    expect(b.og).toBeCloseTo(a.og, 10);
    expect(b.ibu).toBeCloseTo(a.ibu, 10);
  });
});

describe("recipe stats", () => {
  it("puts it all together for a small pale ale", () => {
    // 5 gal = 5/31 bbl. Grain as above → OG 1.0606; no yeast → 75% assumed → FG 1.01515
    const s = recipeStats({
      batchBbl: 5 / 31,
      efficiencyPct: 75,
      boilMinutes: 60,
      lines: [grain(10, "lb", 37, 2), grain(1, "lb", 34, 60), hop(1, "oz", 10, "boil", 60), hop(2, "oz", 10, "dryhop", 4)],
    });
    expect(s.gallons).toBeCloseTo(5, 10);
    expect(s.og).toBeCloseTo(1.0606, 6);
    expect(s.fg).toBeCloseTo(1.01515, 6);
    expect(s.attenuationAssumed).toBe(true);
    expect(s.abv).toBeCloseTo(5.9653, 3);
    // Boil gravity taken as the OG (1.0606), so slightly under the 1.050 example above
    expect(s.ibu).toBeGreaterThan(30);
    expect(s.ibu).toBeLessThan(34.553);
    expect(s.lines[2].ibu).toBeCloseTo(s.ibu, 10);
    expect(s.lines[3].ibu).toBe(0);
    expect(s.srm).toBeCloseTo(9.9939, 3);
    // 10 of 11 lb is 90.9% of the grist
    expect(s.lines[0].gristPct).toBeCloseTo(10 / 11, 10);
    expect(s.grainLb).toBeCloseTo(11, 10);
  });

  it("uses the yeast's attenuation (the highest of several)", () => {
    const s = recipeStats({
      batchBbl: 5 / 31,
      efficiencyPct: 75,
      boilMinutes: 60,
      lines: [grain(10, "lb", 37, 2), grain(1, "lb", 34, 60), { kind: "yeast", name: "A", qty: 1, unit: "pkg", attenuationPct: 70 }, { kind: "yeast", name: "B", qty: 1, unit: "pkg", attenuationPct: 80 }],
    });
    // 60.6 × 0.2 = 12.12 → FG 1.01212
    expect(s.attenuationPct).toBe(80);
    expect(s.attenuationAssumed).toBe(false);
    expect(s.fg).toBeCloseTo(1.01212, 6);
  });

  it("handles an empty recipe", () => {
    const s = recipeStats({ batchBbl: 7, efficiencyPct: 72, boilMinutes: 60, lines: [] });
    expect(s.og).toBe(1);
    expect(s.fg).toBe(1);
    expect(s.abv).toBe(0);
    expect(s.ibu).toBe(0);
    expect(s.srm).toBe(0);
    expect(s.notes).toEqual([]);
  });

  it("handles a sugar-only recipe", () => {
    // 2 lb sugar in 5 gal = 18.4 points; 75% → FG 1.0046; ABV = 0.0138 × 131.25 = 1.81
    const s = recipeStats({ batchBbl: 5 / 31, efficiencyPct: 72, boilMinutes: 60, lines: [{ kind: "adjunct", name: "Table sugar", qty: 2, unit: "lb", potentialPpg: 46 }] });
    expect(s.og).toBeCloseTo(1.0184, 6);
    expect(s.fg).toBeCloseTo(1.0046, 6);
    expect(s.abv).toBeCloseTo(1.81125, 4);
    expect(s.srm).toBe(0);
  });

  it("says when it had to assume something", () => {
    const s = recipeStats({ batchBbl: 7, efficiencyPct: 72, boilMinutes: 60, lines: [grain(700, "lb", null, null, "Pils"), hop(2, "lb", null, "boil", 60)] });
    expect(s.notes.join(" ")).toMatch(/1 grain/);
    expect(s.notes.join(" ")).toMatch(/alpha/);
    expect(s.lines[0].defaultedPpg).toBe(true);
    expect(s.lines[0].defaultedColor).toBe(true);
  });

  it("copes with a zero-size batch", () => {
    const s = recipeStats({ batchBbl: 0, efficiencyPct: 72, boilMinutes: 60, lines: [grain(700, "lb", 37, 2), hop(2, "lb", 10, "boil", 60)] });
    expect(s.og).toBe(1);
    expect(s.ibu).toBe(0);
    expect(s.srm).toBe(0);
  });
});
