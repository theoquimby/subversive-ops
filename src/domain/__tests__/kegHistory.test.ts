import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, historyDatePresets, historyFiltered, pageOf, parseHistoryParams, searchTokens, WHO_IMPORTED, WHO_NOBODY, whoKey, whoLabel } from "../kegHistory";

describe("parseHistoryParams", () => {
  it("reads the old links: one action, one keg by code or id", () => {
    expect(parseHistoryParams({ action: "KICKED" })).toMatchObject({ actions: ["KICKED"], q: "", keg: null });
    expect(parseHistoryParams({ q: " K7Q-3M " }).q).toBe("K7Q-3M");
    expect(parseHistoryParams({ keg: "cm1abcdef0001" }).keg).toBe("cm1abcdef0001");
  });
  it("reads lists and drops junk", () => {
    const p = parseHistoryParams(new URLSearchParams("action=kicked,TAPPED,bad action!,,TAPPED&beer=b1,b2&who=Max,_import&account=a1"));
    expect(p.actions).toEqual(["KICKED", "TAPPED"]);
    expect(p.beers).toEqual(["b1", "b2"]);
    expect(p.who).toEqual(["Max", WHO_IMPORTED]);
    expect(p.accounts).toEqual(["a1"]);
    expect(parseHistoryParams({ keg: "x'; drop" }).keg).toBeNull();
  });
  it("keeps real days only and puts them in order", () => {
    expect(parseHistoryParams({ from: "2026-11-01", to: "2026-10-01" })).toMatchObject({ from: "2026-10-01", to: "2026-11-01" });
    expect(parseHistoryParams({ from: "2026-13-45", to: "soon" })).toMatchObject({ from: null, to: null });
    expect(parseHistoryParams({ to: "2026-11-16" })).toMatchObject({ from: null, to: "2026-11-16" });
  });
  it("knows when anything narrows the list", () => {
    expect(historyFiltered(parseHistoryParams({}))).toBe(false);
    expect(historyFiltered(parseHistoryParams({ from: "2026-11-01" }))).toBe(true);
  });
});

describe("who", () => {
  it("keys people by name, imports and the app apart", () => {
    expect(whoKey({ userName: " Max ", importKey: null })).toBe("Max");
    expect(whoKey({ userName: null, importKey: "dbw:1" })).toBe(WHO_IMPORTED);
    expect(whoKey({ userName: "", importKey: null })).toBe(WHO_NOBODY);
    expect(whoLabel(WHO_IMPORTED)).toBe("Imported");
    expect(whoLabel("Max")).toBe("Max");
  });
});

describe("search", () => {
  it("splits into a few words", () => expect(searchTokens("  catskill   ipa a b c ")).toEqual(["catskill", "ipa", "a", "b"]));
});

describe("paging", () => {
  const ev = (i: number) => ({ id: `ev${String(i).padStart(6, "0")}`, at: new Date(Date.UTC(2026, 10, 16, 12, 0, 0) - i * 60_000) });
  it("cuts a page and points past its last row", () => {
    const fetched = [0, 1, 2].map(ev);
    const p = pageOf(fetched, 2);
    expect(p.rows.map((r) => r.id)).toEqual(["ev000000", "ev000001"]);
    expect(decodeCursor(p.next)).toEqual({ at: ev(1).at.toISOString(), id: "ev000001" });
    expect(pageOf([0, 1].map(ev), 2).next).toBeNull();
  });
  it("round-trips and rejects bad cursors", () => {
    const c = { at: "2026-11-16T12:00:00.000Z", id: "cm1abc123" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    for (const bad of [null, 4, "", "nope", "2026-11-16T12:00:00Z|x", "2026-11-16T12:00:00Z|cm1abc123|more", "notadate|cm1abc123"]) expect(decodeCursor(bad)).toBeNull();
  });
});

describe("date presets", () => {
  it("end today", () => {
    const p = historyDatePresets("2026-11-16");
    expect(p.map((x) => [x.id, x.from, x.to])).toEqual([
      ["today", "2026-11-16", "2026-11-16"],
      ["7", "2026-11-10", "2026-11-16"],
      ["30", "2026-10-18", "2026-11-16"],
      ["year", "2026-01-01", "2026-11-16"],
    ]);
  });
});
