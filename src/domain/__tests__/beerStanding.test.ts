import { describe, expect, it } from "vitest";
import {
  byStanding,
  kegsBySize,
  nagsAbout,
  showCoreHelper,
  standingFlags,
  standingOf,
  stockListing,
  stockRows,
  suggestStanding,
  suggestionReason,
  type Standing,
} from "../beerStanding";
import { addDays } from "../dates";

const today = "2026-11-16";
const ago = (n: number) => addDays(today, -n);

describe("standing from the two flags", () => {
  it("reads core, in rotation and retired", () => {
    expect(standingOf({ active: true, core: true })).toBe("core");
    expect(standingOf({ active: true, core: false })).toBe("rotation");
    expect(standingOf({ active: false, core: false })).toBe("retired");
    // A retired beer is retired whatever its core flag says.
    expect(standingOf({ active: false, core: true })).toBe("retired");
  });
  it("writes the flags back, and round-trips", () => {
    expect(standingFlags("core")).toEqual({ active: true, core: true });
    expect(standingFlags("rotation")).toEqual({ active: true, core: false });
    expect(standingFlags("retired")).toEqual({ active: false, core: false });
    for (const s of ["core", "rotation", "retired"] as Standing[]) expect(standingOf(standingFlags(s))).toBe(s);
  });
  it("only nags about core beers", () => {
    expect(nagsAbout({ active: true, core: true })).toBe(true);
    expect(nagsAbout({ active: true, core: false })).toBe(false);
    expect(nagsAbout({ active: false, core: true })).toBe(false);
  });
  it("sorts core first, then in rotation, then retired, then by name", () => {
    const beers = [
      { name: "Old Ale", active: false, core: false },
      { name: "Stout", active: true, core: false },
      { name: "Lager", active: true, core: true },
      { name: "IPA", active: true, core: true },
      { name: "Gose", active: true, core: false },
    ];
    expect([...beers].sort(byStanding).map((b) => b.name)).toEqual(["IPA", "Lager", "Gose", "Stout", "Old Ale"]);
  });
});

describe("which beers a stock list shows", () => {
  const none = { full: 0, onTap: 0, out: 0 };
  it("always lists a core beer, and marks one with nothing full", () => {
    expect(stockListing("core", none)).toEqual({ show: true, retired: false, noneFull: true });
    expect(stockListing("core", { full: 2, onTap: 1, out: 0 })).toEqual({ show: true, retired: false, noneFull: false });
  });
  it("lists a beer in rotation only with full kegs or one on tap", () => {
    expect(stockListing("rotation", none).show).toBe(false);
    expect(stockListing("rotation", { full: 0, onTap: 0, out: 3 }).show).toBe(false);
    expect(stockListing("rotation", { full: 1, onTap: 0, out: 0 })).toEqual({ show: true, retired: false, noneFull: false });
    expect(stockListing("rotation", { full: 0, onTap: 1, out: 0 })).toEqual({ show: true, retired: false, noneFull: true });
  });
  it("keeps a retired beer while any keg still holds it, tagged retired", () => {
    expect(stockListing("retired", none).show).toBe(false);
    expect(stockListing("retired", { full: 0, onTap: 0, out: 1 })).toEqual({ show: true, retired: true, noneFull: true });
    expect(stockListing("retired", { full: 1, onTap: 0, out: 0 })).toEqual({ show: true, retired: true, noneFull: false });
  });
  it("builds the list: core beers with no kegs at all included, the rest only while they hold beer", () => {
    const rows = stockRows([
      { beerId: "lager", name: "Lager", active: true, core: true, full: 0, onTap: 0, out: 0 },
      { beerId: "ipa", name: "IPA", active: true, core: true, full: 3, onTap: 1, out: 0 },
      { beerId: "stout", name: "Stout", active: true, core: false, full: 0, onTap: 0, out: 0 },
      { beerId: "gose", name: "Gose", active: true, core: false, full: 1, onTap: 0, out: 0 },
      { beerId: "old", name: "Old Ale", active: false, core: false, full: 0, onTap: 0, out: 1 },
      { beerId: "gone", name: "Gone", active: false, core: false, full: 0, onTap: 0, out: 0 },
    ]);
    expect(rows.map((r) => r.beerId)).toEqual(["ipa", "lager", "gose", "old"]);
    expect(rows.find((r) => r.beerId === "lager")).toMatchObject({ standing: "core", noneFull: true, retired: false });
    expect(rows.find((r) => r.beerId === "old")).toMatchObject({ standing: "retired", retired: true });
  });
});

describe("kegs of a beer by size", () => {
  it("counts full, on tap and out per size, with a total", () => {
    const r = kegsBySize([
      { sizeId: "half", status: "COLD" },
      { sizeId: "half", status: "FILLED" },
      { sizeId: "half", status: "ON_TAP" },
      { sizeId: "sixtel", status: "COLD" },
      { sizeId: "sixtel", status: "OUT" },
      { sizeId: "sixtel", status: "OUT" },
      // Kicked and empty kegs hold no beer.
      { sizeId: "half", status: "KICKED" },
      { sizeId: "quarter", status: "CLEANING" },
    ]);
    expect(r.rows).toEqual([
      { sizeId: "half", full: 2, onTap: 1, out: 0, total: 3 },
      { sizeId: "sixtel", full: 1, onTap: 0, out: 2, total: 3 },
    ]);
    expect(r.total).toEqual({ full: 3, onTap: 1, out: 2, total: 6 });
  });
  it("is empty for a core beer with no kegs at all", () => {
    expect(kegsBySize([])).toEqual({ rows: [], total: { full: 0, onTap: 0, out: 0, total: 0 } });
  });
  it("counts a retired beer's one keg still out at an account", () => {
    const r = kegsBySize([{ sizeId: "half", status: "OUT" }]);
    expect(r.rows).toEqual([{ sizeId: "half", full: 0, onTap: 0, out: 1, total: 1 }]);
  });
  it("lists sizes in the usual order, 1/2 bbl before 1/6", () => {
    const r = kegsBySize([{ sizeId: "sixtel", status: "COLD" }, { sizeId: "half", status: "COLD" }]);
    expect(r.rows.map((x) => x.sizeId)).toEqual(["half", "sixtel"]);
  });
});

describe("suggesting a standing", () => {
  it("suggests core for a beer filled lately and several times this year", () => {
    const s = suggestStanding({ fills: [ago(10), ago(60), ago(150), ago(300)], pints90: 300, today });
    expect(s).toMatchObject({ standing: "core", why: "regular", fills12: 4, lastFill: ago(10) });
  });
  it("suggests in rotation for a beer filled in the last year but not often or not lately", () => {
    expect(suggestStanding({ fills: [ago(200)], pints90: 0, today })).toMatchObject({ standing: "rotation", why: "lately", fills12: 1 });
    // Several fills, but none in the last 90 days.
    expect(suggestStanding({ fills: [ago(120), ago(200), ago(250)], pints90: 0, today })).toMatchObject({ standing: "rotation", why: "lately" });
    // Filled lately, but only twice this year.
    expect(suggestStanding({ fills: [ago(20), ago(200)], pints90: 80, today })).toMatchObject({ standing: "rotation", why: "lately" });
  });
  it("suggests retired for a beer filled once three years ago, however well it sold then", () => {
    // Strong old sales don't count; only the last 90 days of sales do.
    const s = suggestStanding({ fills: [ago(3 * 365)], pints90: 0, today });
    expect(s).toMatchObject({ standing: "retired", why: "stale", lastFill: ago(3 * 365), fills12: 0 });
  });
  it("suggests retired for a beer never filled and not selling", () => {
    expect(suggestStanding({ fills: [], pints90: 0, today, addedOn: ago(400) })).toMatchObject({ standing: "retired", why: "never", lastFill: null });
    expect(suggestStanding({ fills: [], pints90: 0, today })).toMatchObject({ standing: "retired", why: "never" });
  });
  it("keeps a beer in rotation that was never filled but was just added, or is still selling", () => {
    expect(suggestStanding({ fills: [], pints90: 0, today, addedOn: ago(5) })).toMatchObject({ standing: "rotation", why: "new" });
    expect(suggestStanding({ fills: [], pints90: 120, today })).toMatchObject({ standing: "rotation", why: "selling" });
    expect(suggestStanding({ fills: [ago(800)], pints90: 120, today })).toMatchObject({ standing: "rotation", why: "selling" });
  });
  it("ignores a few stray sales", () => {
    expect(suggestStanding({ fills: [ago(800)], pints90: 3, today })).toMatchObject({ standing: "retired" });
  });
  it("says why in plain words, with the dates", () => {
    const d = (x: string) => `[${x}]`;
    expect(suggestionReason(suggestStanding({ fills: [ago(10), ago(60), ago(150)], pints90: 300, today }), d)).toBe(`Filled 3 times in the last year, last on [${ago(10)}]`);
    expect(suggestionReason(suggestStanding({ fills: [ago(200)], pints90: 0, today }), d)).toBe(`Filled once in the last year, on [${ago(200)}]`);
    expect(suggestionReason(suggestStanding({ fills: [ago(1095)], pints90: 0, today }), d)).toBe(`Last filled [${ago(1095)}], over a year ago`);
    expect(suggestionReason(suggestStanding({ fills: [], pints90: 0, today }), d)).toBe("Never filled, as far as the keg history goes");
    expect(suggestionReason(suggestStanding({ fills: [], pints90: 0, today, addedOn: ago(3) }), d)).toBe("Added lately, not filled yet");
    expect(suggestionReason(suggestStanding({ fills: [ago(800)], pints90: 120.4, today }), d)).toBe(`Last filled [${ago(800)}], but about 120 pints sold in the last 90 days`);
    expect(suggestionReason(suggestStanding({ fills: [], pints90: 40, today }), d)).toBe("No fill on record, but about 40 pints sold in the last 90 days");
  });
});

describe("the first-time helper", () => {
  it("shows until a beer is core or it is put away", () => {
    expect(showCoreHelper({ anyCore: false, dismissed: false, activeBeers: 4 })).toBe(true);
    expect(showCoreHelper({ anyCore: true, dismissed: false, activeBeers: 4 })).toBe(false);
    expect(showCoreHelper({ anyCore: false, dismissed: true, activeBeers: 4 })).toBe(false);
    expect(showCoreHelper({ anyCore: false, dismissed: false, activeBeers: 0 })).toBe(false);
  });
});
