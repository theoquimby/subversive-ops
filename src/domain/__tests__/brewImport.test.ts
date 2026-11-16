import { describe, expect, it } from "vitest";
import { brewStatusFor, hopTiming, mapBackup, matchBeer, parseAmount, parseBbl, parseBoilMinutes, platoToSg, previewBackup, tankKind, type MappedBackup } from "../brewImport";

// Hand-built in the shape Brew Manager's "Export backup JSON" writes: { recipes, batches, exportedAt }.
const recipe = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Hazy Example",
  style: "NEIPA",
  batch: "7-8",
  abv: "6.5%",
  boilTime: "1hr",
  strike: 180,
  mashTemp: 152,
  mashDur: 60,
  mtP: "20",
  bkP: "14",
  koP: "15",
  ogP: "",
  fgP: "2.5",
  grains: [
    { o: "Example Maltings (NYS)", t: "Pils", a: "700lb" },
    { o: "Example Maltings (NYS)", t: "Flaked Oats", a: "50-100lb" },
  ],
  hops: [
    { n: "Cascade", s: "Hop Farm", a: "2lb", ti: "60 min", ty: "bittering" },
    { n: "Citra", s: "Hop Farm", a: "5.5lb", ti: "Whirlpool", ty: "flavor" },
    { n: "Mosaic", s: "", a: "11lb", ti: "DH", ty: "dry hop" },
    { n: "Pickling spice", s: "", a: "1 cup", ti: "boil", ty: "" },
  ],
  yeastSup: "Yeast Co",
  yeastStrain: "Hazy Ale",
  yeastAmt: "500g",
  notes: "Zinc at KO.",
  ...over,
});

const batch = (over: Record<string, unknown> = {}) => ({
  id: 1760000000000,
  beer: "Hazy Example",
  style: "NEIPA",
  currentTank: "",
  tankPath: "FV2 → FV4 → BBT1",
  brewDate: "2026-09-01",
  vol: "8",
  og: "15.5",
  targetFg: "2.5",
  yeast: "Hazy Ale",
  notes: "",
  status: "packaged",
  gravReadings: [{ date: "2026-09-01", reading: "15.5", note: "OG" }],
  timeline: [
    { ev: "brew", date: "2026-09-01", note: "Brewed → FV2" },
    { ev: "transfer", date: "2026-09-05", note: "FV: FV2 → FV4" },
    { ev: "brite", date: "2026-09-18", note: "To brite: FV4 → BBT1 · FG: 2.5°P" },
    { ev: "pkg", date: "2026-09-22", note: "Packaged" },
  ],
  brite: "BBT1",
  briteDate: "2026-09-18",
  pkgDate: "2026-09-22",
  fg: "2.5",
  brewLog: null,
  recipe: { id: 1, name: "Hazy Example" },
  abvOverride: null,
  pkgHalf: "10",
  pkgSixth: "6",
  ...over,
});

const ok = (json: unknown): MappedBackup => {
  const r = mapBackup(json);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

describe("small parsers", () => {
  it("reads amounts with units, ranges and kitchen measures", () => {
    expect(parseAmount("770lb")).toEqual({ qty: 770, unit: "lb", range: false });
    expect(parseAmount("5.5 lbs")).toEqual({ qty: 5.5, unit: "lb", range: false });
    expect(parseAmount("400-700lb")).toEqual({ qty: 550, unit: "lb", range: true }); // midpoint
    expect(parseAmount("500g")).toEqual({ qty: 500, unit: "g", range: false });
    expect(parseAmount("2 pouches")).toEqual({ qty: 2, unit: "pkg", range: false });
    expect(parseAmount("1 bag")).toEqual({ qty: 1, unit: "pkg", range: false });
    expect(parseAmount("1 cup")!.unit).toBe("ml"); // 236.6 ml
    expect(parseAmount("1 cup")!.qty).toBeCloseTo(236.588, 2);
    expect(parseAmount("4bbl pitch")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("lots")).toBeNull();
    expect(parseAmount("2")).toBeNull(); // no unit
  });

  it("converts Plato to specific gravity", () => {
    // SG = 1 + P / (258.6 − 0.879 P); 12 °P → 1 + 12 / 248.052 = 1.04838
    expect(platoToSg(12)).toBeCloseTo(1.04838, 5);
    expect(platoToSg("15.5")).toBeCloseTo(1.06327, 5);
    expect(platoToSg("")).toBeNull();
    expect(platoToSg("abc")).toBeNull();
    expect(platoToSg(0)).toBeNull();
  });

  it("reads batch sizes and boil times", () => {
    expect(parseBbl("8")).toBe(8);
    expect(parseBbl("7-8")).toBe(7.5);
    expect(parseBbl("8-8.5")).toBe(8.25);
    expect(parseBbl("")).toBeNull();
    expect(parseBbl(9)).toBe(9);
    expect(parseBoilMinutes("1hr")).toBe(60);
    expect(parseBoilMinutes("1.5hr")).toBe(90);
    expect(parseBoilMinutes("60min")).toBe(60);
    expect(parseBoilMinutes("")).toBeNull();
  });

  it("reads hop timing", () => {
    expect(hopTiming("60 min", "bittering", 60)).toEqual({ use: "boil", minutes: 60, guessed: false });
    expect(hopTiming("30-60 min", "bittering", 60)).toEqual({ use: "boil", minutes: 45, guessed: false });
    expect(hopTiming("Whirlpool", "flavor", 60)).toEqual({ use: "whirlpool", minutes: null, guessed: false });
    expect(hopTiming("KO", "aroma", 60)).toEqual({ use: "whirlpool", minutes: null, guessed: false });
    expect(hopTiming("DH", "dry hop", 60)).toEqual({ use: "dryhop", minutes: null, guessed: false });
    expect(hopTiming("KO/DH", "aroma", 60).use).toBe("dryhop");
    expect(hopTiming("FV", "dry hop", 60).use).toBe("dryhop");
    expect(hopTiming("1hr+KO", "", 60)).toEqual({ use: "boil", minutes: 60, guessed: false });
    expect(hopTiming("", "bittering", 90)).toEqual({ use: "boil", minutes: 90, guessed: false });
    expect(hopTiming("boil", "", 60)).toEqual({ use: "boil", minutes: 60, guessed: false });
    expect(hopTiming("", "", 60)).toEqual({ use: "boil", minutes: 60, guessed: true });
  });

  it("knows tanks and stages", () => {
    expect(tankKind("FV3")).toBe("FERMENTER");
    expect(tankKind("BBT1")).toBe("BRITE");
    expect(tankKind("BT2")).toBe("BRITE");
    expect(tankKind("Big brite")).toBe("BRITE");
    expect(tankKind("Barrel 4")).toBe("OTHER");
    expect(brewStatusFor("brewing")).toBe("FERMENTING");
    expect(brewStatusFor("fermenting")).toBe("FERMENTING");
    expect(brewStatusFor("conditioning")).toBe("FERMENTING"); // still in the fermenter in Brew Manager
    expect(brewStatusFor("brite")).toBe("CONDITIONING");
    expect(brewStatusFor("packaged")).toBe("PACKAGED");
    expect(brewStatusFor("whatever")).toBeNull();
  });

  it("matches beers by name, ignoring case and spaces", () => {
    const beers = [{ id: "b1", name: "New York Nectar" }, { id: "b2", name: "Golden Lager" }];
    expect(matchBeer("  new york nectar ", beers)?.id).toBe("b1");
    expect(matchBeer("NY Nectar", beers)).toBeNull();
    expect(matchBeer("", beers)).toBeNull();
  });
});

describe("mapping a backup", () => {
  it("rejects things that aren't a backup", () => {
    expect(mapBackup(null).ok).toBe(false);
    expect(mapBackup([1, 2]).ok).toBe(false);
    expect(mapBackup({ hello: "world" }).ok).toBe(false);
  });

  it("maps a recipe with its lines", () => {
    const d = ok({ recipes: [recipe()], batches: [], exportedAt: "2026-11-15T12:00:00.000Z" });
    expect(d.exportedAt).toBe("2026-11-15T12:00:00.000Z");
    const r = d.recipes[0];
    expect(r.sourceKey).toBe("brewmanager:1");
    expect(r.name).toBe("Hazy Example");
    expect(r.status).toBe("live");
    expect(r.batchBbl).toBe(7.5);
    expect(r.boilMinutes).toBe(60);
    expect(r.targetOg).toBe(1.0611); // no OG target: the knockout gravity (15 °P = 1.06112) stands in, to 4 places
    expect(r.targetFg).toBe(1.0098); // 2.5 °P = 1.00975
    expect(r).toMatchObject({ targetMt: 1.083, targetBk: 1.0568, targetKo: 1.0611, strikeF: 180, mashF: 152, mashMinutes: 60, artworkDone: null });
    expect(r.notes).toBe("Zinc at KO.");
    expect(r.lines.map((l) => [l.kind, l.name, l.qty, l.unit])).toEqual([
      ["grain", "Pils, Example Maltings (NYS)", 700, "lb"],
      ["grain", "Flaked Oats, Example Maltings (NYS)", 75, "lb"],
      ["hop", "Cascade, Hop Farm", 2, "lb"],
      ["hop", "Citra, Hop Farm", 5.5, "lb"],
      ["hop", "Mosaic", 11, "lb"],
      ["other", "Pickling spice", expect.closeTo(236.588, 2), "ml"],
      ["yeast", "Hazy Ale, Yeast Co", 500, "g"],
    ]);
    expect(r.lines[2]).toMatchObject({ use: "boil", minutes: 60 });
    expect(r.lines[4]).toMatchObject({ use: "dryhop", minutes: null });
    expect(r.extra).toMatchObject({ brewManager: { id: 1, abv: "6.5%", strike: 180, mashTemp: 152, plato: { mt: "20", bk: "14", ko: "15", og: "", fg: "2.5" } } });
    expect(d.warnings.join(" ")).toMatch(/range/);
  });

  it("is tolerant of missing fields", () => {
    const d = ok({ recipes: [{ id: 7, name: "Bare" }, { name: "" }, "junk"], batches: [{ id: 3 }] });
    expect(d.recipes).toHaveLength(1);
    const r = d.recipes[0];
    expect(r.lines).toEqual([]);
    expect(r.batchBbl).toBeNull();
    expect(r.boilMinutes).toBeNull();
    expect(r.style).toBeNull();
    expect(d.batches).toHaveLength(0); // a batch with no beer name can't be placed
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("collects amounts it can't read, keeping the text", () => {
    const d = ok({ recipes: [recipe({ yeastAmt: "4bbl pitch", grains: [{ t: "Pils", a: "" }] })] });
    expect(d.unknownUnits).toContain("4bbl pitch");
    const y = d.recipes[0].lines.find((l) => l.kind === "yeast")!;
    expect(y.qty).toBe(0);
    expect(y.raw).toBe("4bbl pitch");
    expect(d.recipes[0].lines[0]).toMatchObject({ name: "Pils", qty: 0, unit: "lb" });
  });

  it("archives archived recipes and keeps names unique", () => {
    const d = ok({ recipes: [recipe({ id: 1, archived: true }), recipe({ id: 2 })] });
    expect(d.recipes[0].status).toBe("archived");
    expect(d.recipes[1].name).toBe("Hazy Example (2)");
  });

  it("maps a batch with its tank history", () => {
    const d = ok({ recipes: [recipe()], batches: [batch()] });
    const b = d.batches[0];
    expect(b.sourceKey).toBe("brewmanager:1760000000000");
    expect(b.code).toBe("BM-260901-HE");
    expect(b.beerName).toBe("Hazy Example");
    expect(b.recipeSourceKey).toBe("brewmanager:1");
    expect(b.status).toBe("PACKAGED");
    expect(b.brewedOn).toBe("2026-09-01");
    expect(b.packagedOn).toBe("2026-09-22");
    expect(b.bbl).toBe(8);
    expect(b.og).toBe(1.0633); // 15.5 °P = 1.06327, stored to 4 places
    expect(b.fg).toBe(1.0098);
    expect(b).toMatchObject({ halfKegs: 10, sixthKegs: 6, cases: null, brewLog: null });
    expect(b.stays).toEqual([
      { tank: "FV2", start: "2026-09-01", end: "2026-09-05" },
      { tank: "FV4", start: "2026-09-05", end: "2026-09-18" },
      { tank: "BBT1", start: "2026-09-18", end: "2026-09-22" },
    ]);
    expect(b.extra).toMatchObject({ brewManager: { id: 1760000000000, tankPath: "FV2 → FV4 → BBT1", packaged: { half: "10", sixth: "6" } } });
  });

  it("leaves the last stay open while the beer is still in a tank", () => {
    const d = ok({ batches: [batch({ status: "fermenting", currentTank: "FV2", tankPath: "FV2", timeline: [], pkgDate: null, briteDate: null, recipe: null })] });
    expect(d.batches[0].status).toBe("FERMENTING");
    expect(d.batches[0].stays).toEqual([{ tank: "FV2", start: "2026-09-01", end: null }]);
    expect(d.batches[0].recipeSourceKey).toBeNull(); // no recipe in the file by that name
  });

  it("uses the brite date when the timeline has no move", () => {
    const d = ok({ batches: [batch({ status: "brite", tankPath: "FV1 → BBT2", currentTank: "BBT2", timeline: [], briteDate: "2026-09-15", pkgDate: null })] });
    expect(d.batches[0].stays).toEqual([
      { tank: "FV1", start: "2026-09-01", end: "2026-09-15" },
      { tank: "BBT2", start: "2026-09-15", end: null },
    ]);
  });

  it("finds the recipe by name when the batch has no copy of it", () => {
    const d = ok({ recipes: [recipe({ id: 9 })], batches: [batch({ recipe: null, beer: "hazy example" })] });
    expect(d.batches[0].recipeSourceKey).toBe("brewmanager:9");
  });

  it("keeps batch codes unique", () => {
    const d = ok({ batches: [batch({ id: 1 }), batch({ id: 2 })] });
    expect(d.batches.map((b) => b.code)).toEqual(["BM-260901-HE", "BM-260901-HE-2"]);
  });

  it("skips a tank history it can't date", () => {
    const d = ok({ batches: [batch({ brewDate: "", timeline: [] })] });
    expect(d.batches[0].stays).toEqual([]);
    expect(d.warnings.join(" ")).toMatch(/no brew date/);
  });
});

describe("preview", () => {
  it("counts what will happen and matches beers", () => {
    const d = ok({ recipes: [recipe({ id: 1 }), recipe({ id: 2, name: "Pils Thing", style: "Pilsner" })], batches: [batch()] });
    const p = previewBackup(d, {
      beers: [{ id: "b1", name: "hazy example" }],
      existingRecipeKeys: ["brewmanager:2"],
      existingBatchKeys: [],
      tanks: [{ name: "fv2" }],
    });
    expect(p.recipes).toBe(2);
    expect(p.newRecipes).toBe(1);
    expect(p.updatedRecipes).toBe(1);
    expect(p.lines).toBe(14);
    expect(p.batches).toBe(1);
    expect(p.newBatches).toBe(1);
    expect(p.stays).toBe(3);
    expect(p.beerMatches).toEqual([{ recipe: "Hazy Example", beer: "hazy example" }]);
    expect(p.unmatchedRecipes).toEqual(["Pils Thing"]);
    expect(p.tanks).toEqual([
      { name: "FV2", kind: "FERMENTER", exists: true, capacityBbl: 8 },
      { name: "FV4", kind: "FERMENTER", exists: false, capacityBbl: 8 },
      { name: "BBT1", kind: "BRITE", exists: false, capacityBbl: 8 },
    ]);
  });

  it("falls back to the recipe's batch size for a tank's capacity", () => {
    const d = ok({ recipes: [recipe()], batches: [batch({ vol: "" })] });
    expect(previewBackup(d, { beers: [], existingRecipeKeys: [], existingBatchKeys: [], tanks: [] }).tanks[0].capacityBbl).toBe(7.5);
  });
});
