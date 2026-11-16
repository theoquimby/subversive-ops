import { describe, expect, it } from "vitest";
import { brewMoves, CASE_GALLONS, DEFAULT_TAX_SETTINGS, dumpedOnOf, kegCountCheck, worksheet, type BrewIn } from "../beerTax";

const brew = (over: Partial<BrewIn>): BrewIn => ({ id: "b1", code: "26-031", beerId: "ipa", beer: "IPA", status: "PACKAGED", packagedOn: "2026-10-08", cases: null, bbl: 7, dumpedOn: null, ...over });

describe("beer tax from the brewery", () => {
  it("counts a case as 24 twelve-ounce cans: 2.25 gallons", () => {
    expect(CASE_GALLONS).toBe(2.25);
  });

  it("adds packaged cases on the packaging day and dumped brews as a loss", () => {
    const r = brewMoves([brew({ cases: 40 }), brew({ id: "b2", code: "26-032", status: "DUMPED", packagedOn: null, dumpedOn: "2026-10-20", bbl: 3.5 })], "2026-10-01", "2026-10-31");
    expect(r.moves).toEqual([
      { date: "2026-10-08", kind: "packaged", gallons: 90, beerId: "ipa", beer: "IPA", brewId: "b1", code: "26-031" },
      { date: "2026-10-20", kind: "loss", gallons: 108.5, beerId: "ipa", beer: "IPA", brewId: "b2", code: "26-032" },
    ]);
    const w = worksheet(r.moves, DEFAULT_TAX_SETTINGS);
    expect(w.packagedGal).toBe(90);
    expect(w.lossGal).toBe(108.5);
    // Packaging and losses are not removals: nothing taxable changes.
    expect(w.taxableGal).toBe(0);
  });

  it("leaves out brews outside the period, kegs-only brews and dumped brews with no day", () => {
    const r = brewMoves([brew({ cases: 10, packagedOn: "2026-09-30" }), brew({ cases: null }), brew({ status: "DUMPED", dumpedOn: null })], "2026-10-01", "2026-10-31");
    expect(r.moves).toEqual([]);
  });

  it("holds back anything in a period already marked filed", () => {
    const r = brewMoves([brew({ cases: 10 })], "2026-10-01", "2026-12-31", [{ start: "2026-10-01", end: "2026-10-31" }]);
    expect(r.moves).toEqual([]);
    expect(r.heldBack).toHaveLength(1);
  });

  it("names a brew with no beer by its code", () => {
    expect(brewMoves([brew({ cases: 1, beerId: null, beer: null })], "2026-10-01", "2026-10-31").moves[0].beer).toBe("Brew 26-031");
  });

  it("reads the dump day from the brew's note", () => {
    expect(dumpedOnOf({ dumped: { on: "2026-10-20", reason: "infected" } })).toBe("2026-10-20");
    expect(dumpedOnOf({ dumped: { on: 5 } })).toBeNull();
    expect(dumpedOnOf(null)).toBeNull();
  });
});

describe("brew keg counts against scanned fills", () => {
  const b = { id: "b1", code: "26-031", name: "IPA", packagedOn: "2026-10-08", halfKegs: 6, sixthKegs: 4, kegBatchId: "kb1" };
  it("matches when the scans agree", () => {
    const fills = [...Array(6)].map(() => ({ batchId: "kb1", sizeId: "half" })).concat([...Array(4)].map(() => ({ batchId: "kb1", sizeId: "sixtel" })));
    expect(kegCountCheck([b], fills)).toEqual([{ brewId: "b1", code: "26-031", name: "IPA", packagedOn: "2026-10-08", brewHalf: 6, brewSixth: 4, scannedHalf: 6, scannedSixth: 4, scannedOther: 0, linked: true, differs: false }]);
  });
  it("flags a difference, first", () => {
    const rows = kegCountCheck([{ ...b, id: "ok", code: "26-001", halfKegs: 1, sixthKegs: 0 }, b], [{ batchId: "kb1", sizeId: "half" }, { batchId: "kb1", sizeId: "quarter" }, { batchId: "other", sizeId: "half" }]);
    expect(rows[0]).toMatchObject({ brewId: "b1", scannedHalf: 1, scannedSixth: 0, scannedOther: 1, differs: true });
  });
  it("shows a brew with kegs but no keg batch as not linked, without flagging it", () => {
    expect(kegCountCheck([{ ...b, kegBatchId: null }], [])).toEqual([expect.objectContaining({ linked: false, differs: false, scannedHalf: 0 })]);
  });
  it("leaves out brews with no kegs either way", () => {
    expect(kegCountCheck([{ ...b, halfKegs: null, sixthKegs: 0 }], [])).toEqual([]);
  });
});
