import { describe, expect, it } from "vitest";
import {
  brewLogFromBrewManager,
  detectBrewManagerFile,
  mapAppData,
  matchName,
  previewAppData,
  recipeChoices,
  recipeKeyAliases,
  resolveSchedule,
  type AppImportContext,
  type MappedAppData,
} from "../brewImport";

// Hand-built in the shape of brewmanager-app-data.json (made from Brew Manager's own page). Not real data.
const file = (over: Record<string, unknown> = {}) => ({
  source: "brewmanager-app-file",
  tanks: [
    { id: "FV1", size: 9, kind: "FERMENTER" },
    { id: "FV4", size: 9, kind: "FERMENTER" },
    { id: "FV7", size: 4, kind: "FERMENTER" },
    { id: "BBT3", size: 10, kind: "BRITE" },
    { id: "Barrel", size: 2 },
  ],
  recipes: [
    { id: 1, name: "Example Hazy", style: "NEIPA", batch: "7-8", abv: "7%", boilTime: "1hr", strike: 185, mashTemp: 155, mashDur: 60, mtP: "21", bkP: "15", koP: "15.5", ogP: "15.5", fgP: "2.5", grains: [{ o: "Maltster", t: "Pils", a: "700lb" }], hops: [{ n: "Citra", s: "Hop Co", a: "5lb", ti: "KO", ty: "aroma" }], yeastSup: "Yeast Co", yeastStrain: "Hazy Ale", yeastAmt: "2 pouches", notes: "Zinc." },
    { id: 6, name: "Mountain Marzen", style: "Märzen", batch: "8", boilTime: "1.5hr", ogP: "13.5", fgP: "3", grains: [], hops: [] },
    { id: 7, name: "Old Thing", archived: true, grains: [], hops: [] },
  ],
  devbeers: [{ id: 9001, name: "Single Hop Trial", style: "IPA", abv: "6.8%", status: "dev", grains: [{ o: "HVM", t: "Pale Malt", a: "750lb" }], hops: [{ n: "Simcoe", a: "6-8lb", ti: "DH" }], yeast: "Clean ale", notes: "Needs supplier + gravity targets.", artworkDone: true }],
  schedule: [
    { id: 1000, beer: "Example Hazy", brewDate: "2026-01-16", style: "NEIPA", abv: "7%", profile: "hazy", locked: false },
    { id: 1024, beer: "Marzen", brewDate: "2026-12-03", style: "Märzen", abv: "5.8%", profile: "lager", locked: true, lockedReason: "Oktoberfest release" },
    { id: 1030, beer: "Mystery Beer", brewDate: "2026-12-10", style: "", abv: "", profile: "pale", locked: false },
    { id: 1031, beer: "Example Hazy", brewDate: "2026-12-17", profile: "weird", locked: false },
  ],
  profiles: { hazy: { label: "Hazy IPA", dryHop: 7, brite: 20, pkg: 23, tap: 30, briteDay: [1, 2], pkgDay: [3] } },
  supplierLeadTimes: { "Example Maltings": { leadDays: 14, ref: "brew" }, "Hop Co": { leadDays: 7, ref: "dryHop" }, Labels: { leadDays: 10, ref: "pkg" }, Odd: { leadDays: "x", ref: "nope" } },
  ...over,
});

const ok = (json: unknown): MappedAppData => {
  const r = mapAppData(json);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

const ctx = (over: Partial<AppImportContext> = {}): AppImportContext => ({
  today: "2026-11-16",
  includePast: false,
  picks: {},
  beers: [{ id: "b1", name: "Example Hazy" }, { id: "b2", name: "Märzen" }],
  opsRecipes: [],
  batches: [],
  tanks: [],
  suppliers: [],
  ...over,
});

describe("telling the two files apart", () => {
  it("knows the app data and the backup", () => {
    expect(detectBrewManagerFile(file())).toBe("app");
    expect(detectBrewManagerFile({ schedule: [], devbeers: [] })).toBe("app");
    expect(detectBrewManagerFile({ recipes: [], batches: [] })).toBe("backup");
    expect(detectBrewManagerFile({ recipes: [] })).toBe("backup");
    expect(detectBrewManagerFile({ hello: 1 })).toBeNull();
    expect(detectBrewManagerFile(null)).toBeNull();
    expect(mapAppData({ recipes: [], batches: [] }).ok).toBe(false);
  });

  it("treats a recipe's two keys as one", () => {
    expect(recipeKeyAliases("brewmanager:recipe:5")).toEqual(["brewmanager:recipe:5", "brewmanager:5"]);
    expect(recipeKeyAliases("brewmanager:5")).toEqual(["brewmanager:5", "brewmanager:recipe:5"]);
    expect(recipeKeyAliases("brewmanager:dev:9")).toEqual(["brewmanager:dev:9"]);
  });
});

describe("mapping the app data", () => {
  it("places tanks on the floor plan", () => {
    const d = ok(file());
    expect(d.tanks).toEqual([
      { name: "FV1", kind: "FERMENTER", capacityBbl: 9, zone: "Back wall", layoutRow: 0, layoutCol: 2 },
      { name: "FV4", kind: "FERMENTER", capacityBbl: 9, zone: "Back wall", layoutRow: 1, layoutCol: 4 },
      { name: "FV7", kind: "FERMENTER", capacityBbl: 4, zone: "Separate room", layoutRow: 0, layoutCol: 0 },
      { name: "BBT3", kind: "BRITE", capacityBbl: 10, zone: "Front", layoutRow: 0, layoutCol: 2 },
      { name: "Barrel", kind: "OTHER", capacityBbl: 2, zone: null, layoutRow: null, layoutCol: null },
    ]);
  });

  it("maps recipes with their brew-day targets in SG", () => {
    const d = ok(file());
    const r = d.recipes[0];
    expect(r).toMatchObject({ sourceKey: "brewmanager:recipe:1", name: "Example Hazy", status: "live", batchBbl: 7.5, boilMinutes: 60, targetOg: 1.0633, targetFg: 1.0098, targetMt: 1.0874, targetBk: 1.0611, targetKo: 1.0633, strikeF: 185, mashF: 155, mashMinutes: 60 });
    expect(r.lines.map((l) => [l.kind, l.name, l.qty, l.unit])).toEqual([
      ["grain", "Pils, Maltster", 700, "lb"],
      ["hop", "Citra, Hop Co", 5, "lb"],
      ["yeast", "Hazy Ale, Yeast Co", 2, "pkg"],
    ]);
    expect(d.recipes.find((x) => x.name === "Old Thing")!.status).toBe("archived");
  });

  it("brings development beers in as recipes in development, yeast text as a yeast line", () => {
    const dev = ok(file()).recipes.find((r) => r.status === "dev")!;
    expect(dev).toMatchObject({ sourceKey: "brewmanager:dev:9001", name: "Single Hop Trial", artworkDone: true, targetOg: null, batchBbl: null, notes: "Needs supplier + gravity targets." });
    expect(dev.lines.map((l) => [l.kind, l.name, l.qty, l.unit, l.use])).toEqual([
      ["grain", "Pale Malt, HVM", 750, "lb", null],
      ["hop", "Simcoe", 7, "lb", "dryhop"],
      ["yeast", "Clean ale", 0, "pkg", null],
    ]);
    expect(dev.extra.brewManager).toMatchObject({ devBeer: true, abv: "6.8%", devStatus: "dev" });
  });

  it("maps the schedule with profile dates and locks", () => {
    const d = ok(file());
    expect(d.schedule.map((s) => s.sourceKey)).toEqual(["brewmanager:sched:1000", "brewmanager:sched:1024", "brewmanager:sched:1030", "brewmanager:sched:1031"]);
    const hazy = d.schedule[0];
    expect(hazy.forecast).toEqual({ brewDay: "2026-01-16", dryHop: "2026-01-23", fvTransfer: null, brite: "2026-02-03", pkg: "2026-02-11", tap: "2026-02-15" });
    const marzen = d.schedule[1];
    expect(marzen).toMatchObject({ locked: true, lockedReason: "Oktoberfest release", profile: "lager" });
    expect(marzen.forecast!.tap).toBe("2027-02-01");
    expect(d.schedule[3]).toMatchObject({ profile: null, forecast: null });
    expect(d.warnings.join(" ")).toMatch(/unknown timing profile "weird"/);
  });

  it("reads suppliers' lead times", () => {
    expect(ok(file()).suppliers).toEqual([
      { name: "Example Maltings", leadDays: 14, ref: "brew" },
      { name: "Hop Co", leadDays: 7, ref: "dryHop" },
      { name: "Labels", leadDays: 10, ref: "pkg" },
      { name: "Odd", leadDays: 7, ref: "brew" },
    ]);
  });

  it("refuses an empty file", () => {
    expect(mapAppData({ source: "brewmanager-app-file" }).ok).toBe(false);
  });
});

describe("matching schedule names", () => {
  const items = [{ name: "Mountain Marzen" }, { name: "Golden Lime Lager" }, { name: "Saison / Farmhouse" }, { name: "Verdant Voyage" }, { name: "Dry Irish Stout" }, { name: "Splendid Stout" }, { name: "NY Nectar" }];

  it("by name, alias, then a unique close match", () => {
    expect(matchName("ny nectar", items)).toEqual({ item: items[6], how: "exact" });
    expect(matchName("Marzen", items)).toEqual({ item: items[0], how: "alias" });
    expect(matchName("Märzen", items)!.item).toBe(items[0]);
    expect(matchName("Golden Lime", items)!.item).toBe(items[1]);
    expect(matchName("Saison", items)!.item).toBe(items[2]);
    expect(matchName("Verdant", items)!.item).toBe(items[3]);
    expect(matchName("Stout", items)).toBeNull(); // two stouts, and "stout" alone says nothing
    expect(matchName("NY Nectar Double", items)).toEqual({ item: items[6], how: "close" });
    expect(matchName("Xmas Beer", items)).toBeNull();
    expect(matchName("", items)).toBeNull();
  });
});

describe("previewing the app data", () => {
  it("skips past brews unless asked, matches recipes and beers, lists the unmatched", () => {
    const d = ok(file());
    const p = previewAppData(d, ctx());
    expect(p.kind).toBe("app");
    expect(p.recipes).toBe(3);
    expect(p.devBeers).toBe(1);
    expect(p.newRecipes).toBe(3);
    expect(p.scheduleCounts).toEqual({ total: 4, future: 3, past: 1, included: 3, brewed: 0 });
    const [jan, marzen, mystery] = p.schedule;
    expect(jan).toMatchObject({ past: true, included: false, recipeName: "Example Hazy", how: "exact" });
    expect(marzen).toMatchObject({ recipeName: "Mountain Marzen", how: "alias", beerMatch: "Märzen", locked: true, tapOn: "2027-02-01" });
    expect(mystery).toMatchObject({ recipeRef: null, beerMatch: null, profileLabel: "Pale / Clear IPA" });
    expect(p.unmatched).toEqual(["Mystery Beer"]);
    expect(previewAppData(d, ctx({ includePast: true })).scheduleCounts.included).toBe(4);
    expect(p.suppliers.map((s) => s.exists)).toEqual([false, false, false, false]);
    expect(p.unmatchedRecipes).toEqual([]); // Mountain Marzen matches the beer Märzen by alias; archived ones aren't listed
  });

  it("uses a recipe picked for an unmatched name, from the file or from Ops", () => {
    const d = ok(file());
    const ops = [{ id: "r9", name: "House Pale", sourceKey: null }];
    const rows = resolveSchedule(d, ctx({ opsRecipes: ops, picks: { "Mystery Beer": "ops:r9" } }));
    expect(rows[2]).toMatchObject({ recipeRef: "ops:r9", recipeName: "House Pale", how: "picked" });
    expect(previewAppData(d, ctx({ opsRecipes: ops, picks: { "Mystery Beer": "ops:r9" } })).unmatched).toEqual(["Mystery Beer"]);
  });

  it("knows what came in before and leaves brews made since alone", () => {
    const d = ok(file());
    const p = previewAppData(d, ctx({
      opsRecipes: [{ id: "r1", name: "Example Hazy", sourceKey: "brewmanager:1" }, { id: "r2", name: "Something Else", sourceKey: null }],
      batches: [{ sourceKey: "brewmanager:sched:1024", status: "FERMENTING" }, { sourceKey: "brewmanager:sched:1030", status: "PLANNED" }],
      tanks: [{ name: "fv1", capacityBbl: 7, guessed: true }, { name: "FV4", capacityBbl: 7, guessed: false }],
      suppliers: [{ name: "labels" }],
    }));
    expect(p.updatedRecipes).toBe(1); // the backup's key for recipe 1
    expect(p.newRecipes).toBe(2);
    expect(p.schedule[1]).toMatchObject({ state: "brewed", included: false });
    expect(p.schedule[2]).toMatchObject({ state: "update", included: true });
    expect(p.scheduleCounts.brewed).toBe(1);
    expect(p.tanks[0]).toMatchObject({ exists: true, sizeFrom: 7 }); // guessed size gets Brew Manager's
    expect(p.tanks[1]).toMatchObject({ exists: true, sizeFrom: null }); // a size set in Ops stays
    expect(p.suppliers.find((s) => s.name === "Labels")!.exists).toBe(true);
    expect(recipeChoices(d, [{ id: "r1", name: "Example Hazy", sourceKey: "brewmanager:1" }, { id: "r2", name: "Something Else", sourceKey: null }]).map((c) => c.ref)).toEqual([
      "file:brewmanager:recipe:1",
      "file:brewmanager:recipe:6",
      "file:brewmanager:recipe:7",
      "file:brewmanager:dev:9001",
      "ops:r2",
    ]);
  });
});

describe("Brew Manager's brew-day log", () => {
  it("becomes an Ops brew-day log in SG, finished on the brew day", () => {
    const log = brewLogFromBrewManager(
      { stages: { Mash: { strike: "165", mashTemp: "152", mtPlato: "20", ph: "5.3", startTime: "07:30", strikeVol: "", notes: "Smooth", logs: [] }, Boil: { ogPlato: "15.5", postboilVol: "8" }, Packaging: { halfKegs: "10", co2: "2.5" } } },
      "2026-09-01",
    )!;
    expect(log.finishedAt).toBe("2026-09-01T12:00:00.000Z");
    expect(log.values.mash).toEqual({ strikeF: 165, mashF: 152, mtSg: 1.083, ph: 5.3, startTime: "07:30" });
    expect(log.notes.mash).toBe("Smooth");
    expect(log.values.boil).toEqual({ ogSg: 1.0633, postboilBbl: 8 });
    expect(log.values.package).toEqual({ halfKegs: 10, co2Vols: 2.5 });
    expect(brewLogFromBrewManager({ stages: { Mash: { logs: [] } } }, "2026-09-01")).toBeNull();
    expect(brewLogFromBrewManager(null, null)).toBeNull();
  });
});
