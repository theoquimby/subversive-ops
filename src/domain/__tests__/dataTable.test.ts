import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  compareValues,
  emptyView,
  facetCounts,
  filterRows,
  groupRows,
  matchScore,
  normalize,
  paramsToView,
  parseView,
  selectRange,
  serializeView,
  sortRows,
  toCsv,
  toggleFilterValue,
  toggleSort,
  viewToParams,
  type FilterSpec,
} from "../dataTable";

type P = { id: string; name: string; supplier: string; price: number | null; linked: boolean; tags: string[] };
const rows: P[] = [
  { id: "a", name: "Chicken breast boneless", supplier: "Driscoll", price: 42.5, linked: true, tags: ["meat"] },
  { id: "b", name: "Jalapeño peppers", supplier: "Driscoll", price: 18, linked: false, tags: ["produce"] },
  { id: "c", name: "Ground beef 80/20", supplier: "Kilcoyne", price: null, linked: false, tags: ["meat", "frozen"] },
  { id: "d", name: "Beer clean", supplier: "Amazon", price: 9.99, linked: true, tags: [] },
];
const items = rows.map((r) => ({ row: r, text: normalize(`${r.name} ${r.supplier}`) }));
const specs: FilterSpec<P>[] = [
  { id: "supplier", kind: "facet", values: (r) => r.supplier },
  { id: "tag", kind: "facet", values: (r) => r.tags },
  { id: "unlinked", kind: "toggle", test: (r) => !r.linked },
];

describe("search", () => {
  it("normalizes accents and spaces", () => expect(normalize("  Jalapeño   PEPPERS ")).toBe("jalapeno peppers"));
  it("needs every token", () => {
    expect(matchScore("beef ground", normalize("Ground beef 80/20"))).not.toBeNull();
    expect(matchScore("beef chicken", normalize("Ground beef 80/20"))).toBeNull();
  });
  it("matches abbreviations of one word but not scattered letters", () => {
    expect(matchScore("chkn", normalize("Chicken breast"))).not.toBeNull();
    expect(matchScore("bf", normalize("Ground beef"))).toBeNull(); // short tokens must be substrings
    expect(matchScore("cbr", normalize("Chicken breast"))).toBeNull(); // letters across words don't count
  });
  it("ranks word starts above mid-word hits", () => {
    expect(matchScore("bee", normalize("Beer clean"))!).toBeGreaterThan(matchScore("bee", normalize("Ground xbeef"))!);
  });
  it("finds by accentless query", () => expect(filterRows(items, "jalapeno", specs, {}).map((r) => r.row.id)).toEqual(["b"]));
});

describe("filters", () => {
  it("ORs values within a facet and ANDs facets", () => {
    expect(filterRows(items, "", specs, { supplier: ["Driscoll", "Amazon"] }).map((r) => r.row.id)).toEqual(["a", "b", "d"]);
    expect(filterRows(items, "", specs, { supplier: ["Driscoll"], unlinked: ["1"] }).map((r) => r.row.id)).toEqual(["b"]);
    expect(filterRows(items, "", specs, { tag: ["frozen"] }).map((r) => r.row.id)).toEqual(["c"]);
  });
  it("counts facet values ignoring that facet's own choice", () => {
    const c = facetCounts(items, "", specs, { supplier: ["Amazon"], unlinked: ["1"] }, "supplier");
    expect(Object.fromEntries(c)).toEqual({ Driscoll: 1, Kilcoyne: 1 });
    expect(facetCounts(items, "", specs, {}, "unlinked").get("1")).toBe(2);
  });
  it("toggles values and drops empty facets", () => {
    let s = toggleFilterValue({}, "supplier", "Driscoll");
    s = toggleFilterValue(s, "supplier", "Amazon");
    expect(s).toEqual({ supplier: ["Driscoll", "Amazon"] });
    expect(toggleFilterValue(s, "supplier", "Kilcoyne", true)).toEqual({ supplier: ["Kilcoyne"] });
    expect(toggleFilterValue({ supplier: ["Driscoll"] }, "supplier", "Driscoll")).toEqual({});
    expect(activeFilterCount({ a: ["1"], b: [] })).toBe(1);
  });
});

describe("sort", () => {
  const val = (r: P, id: string) => (id === "price" ? r.price : id === "supplier" ? r.supplier : r.name);
  it("puts empty values last in both directions", () => {
    expect(sortRows(rows, [{ id: "price", dir: "asc" }], val).map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
    expect(sortRows(rows, [{ id: "price", dir: "desc" }], val).map((r) => r.id)).toEqual(["a", "b", "d", "c"]);
  });
  it("sorts by several keys, stably", () => {
    expect(sortRows(rows, [{ id: "supplier", dir: "asc" }, { id: "price", dir: "desc" }], val).map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
    expect(sortRows(rows, [], val)).toBe(rows);
  });
  it("compares numbers inside text naturally", () => expect(compareValues("Item 10", "Item 9", "asc")).toBeGreaterThan(0));
  it("cycles a header asc → desc → off, shift adds keys", () => {
    expect(toggleSort([], "name", false)).toEqual([{ id: "name", dir: "asc" }]);
    expect(toggleSort([{ id: "name", dir: "asc" }], "name", false)).toEqual([{ id: "name", dir: "desc" }]);
    expect(toggleSort([{ id: "name", dir: "desc" }], "name", false)).toEqual([]);
    expect(toggleSort([{ id: "name", dir: "asc" }], "price", true)).toEqual([{ id: "name", dir: "asc" }, { id: "price", dir: "asc" }]);
    expect(toggleSort([{ id: "name", dir: "asc" }, { id: "price", dir: "asc" }], "price", true)).toEqual([{ id: "name", dir: "asc" }, { id: "price", dir: "desc" }]);
    expect(toggleSort([{ id: "name", dir: "asc" }, { id: "price", dir: "desc" }], "price", true)).toEqual([{ id: "name", dir: "asc" }]);
    expect(toggleSort([{ id: "a", dir: "asc" }, { id: "b", dir: "asc" }], "b", false)).toEqual([{ id: "b", dir: "asc" }]);
    expect(toggleSort([], "price", false, "desc")).toEqual([{ id: "price", dir: "desc" }]);
  });
});

describe("groups", () => {
  it("groups in key order with blanks last, keeping row order", () => {
    const g = groupRows([...rows, { ...rows[0], id: "e", supplier: "" }], (r) => r.supplier);
    expect(g.map((x) => x.key)).toEqual(["Amazon", "Driscoll", "Kilcoyne", ""]);
    expect(g[1].rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("selection", () => {
  const ids = ["a", "b", "c", "d", "e"];
  it("selects a range from the anchor", () => expect([...selectRange(new Set(["a"]), ids, "b", "d")].sort()).toEqual(["a", "b", "c", "d"]));
  it("clears a range when the target was selected", () => expect([...selectRange(new Set(["a", "b", "c", "d"]), ids, "a", "c")]).toEqual(["d"]));
  it("falls back to a single toggle without an anchor", () => expect([...selectRange(new Set(), ids, null, "c")]).toEqual(["c"]));
});

describe("saved views", () => {
  const defaults = emptyView({ sort: [{ id: "name", dir: "asc" }], hidden: ["pack"] });
  it("round-trips", () => {
    const v = emptyView({ q: "beef", filters: { supplier: ["x"] }, sort: [{ id: "price", dir: "desc" }], group: "supplier", hidden: [], density: "compact", widths: { name: 240 }, collapsed: ["Amazon"] });
    expect(parseView(serializeView(v), defaults)).toEqual(v);
  });
  it("falls back on bad input and drops bad parts", () => {
    expect(parseView("{oops", defaults)).toBe(defaults);
    expect(parseView(null, defaults)).toBe(defaults);
    const v = parseView(JSON.stringify({ sort: [{ id: 1 }, { id: "a", dir: "up" }, { id: "b", dir: "desc" }], filters: { x: [1, "y"], z: [] }, widths: { a: 5, b: 300 }, density: "huge" }), defaults);
    expect(v.sort).toEqual([{ id: "b", dir: "desc" }]);
    expect(v.filters).toEqual({ x: ["y"] });
    expect(v.widths).toEqual({ b: 300 });
    expect(v.density).toBe("comfortable");
    expect(v.hidden).toEqual(["pack"]);
  });
  it("maps filters to URL params and back, keeping other params", () => {
    const p = viewToParams({ q: " beef ", filters: { supplier: ["a", "b"], link: ["unlinked"], local: ["1"] } }, { supplier: "supplier", link: "filter" }, new URLSearchParams("tour=x&supplier=old"));
    expect(p.toString()).toBe("tour=x&q=beef&supplier=a%2Cb&filter=unlinked");
    expect(paramsToView(p, { supplier: "supplier", link: "filter" })).toEqual({ q: "beef", filters: { supplier: ["a", "b"], link: ["unlinked"] } });
    expect(paramsToView(new URLSearchParams("tour=x"), { supplier: "supplier" })).toBeNull();
  });
});

describe("csv", () => {
  it("escapes quotes, commas and formulas", () => {
    const csv = toCsv([{ a: 'Say "hi", ok', b: 1.23456789, c: "=SUM(A1)", d: -4 }], [
      { header: "A", value: (r) => r.a },
      { header: "B", value: (r) => r.b },
      { header: "C", value: (r) => r.c },
      { header: "D", value: (r) => r.d },
    ]);
    expect(csv).toBe('A,B,C,D\r\n"Say ""hi"", ok",1.2346,\'=SUM(A1),-4\r\n');
  });
});
