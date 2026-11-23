import { describe, expect, it } from "vitest";
import {
  boardLayout,
  tapLevel,
  burnInOffset,
  comingSoon,
  formatBoardPours,
  moveLine,
  orderLines,
  parseAbv,
  parseBoardPours,
  parseIbu,
  pickBoardPours,
  pourLabel,
  squareCheck,
  tapBadge,
  abvText,
  priceText,
  boardPoursShown,
} from "../taps";

describe("beer details", () => {
  it("reads ABV and IBU the way people type them", () => {
    expect(parseAbv("6.5")).toBe(6.5);
    expect(parseAbv("6,5 %")).toBe(6.5);
    expect(parseAbv("7.25% ABV")).toBe(7.3);
    expect(parseAbv("")).toBeNull();
    expect(parseAbv("40")).toEqual({ error: expect.any(String) });
    expect(parseAbv("strong")).toEqual({ error: expect.any(String) });
    expect(parseIbu("45 IBU")).toBe(45);
    expect(parseIbu(" ")).toBeNull();
    expect(parseIbu("-3")).toEqual({ error: expect.any(String) });
    expect(abvText(5)).toBe("5%");
    expect(abvText(6.5)).toBe("6.5%");
    expect(abvText(null)).toBeNull();
  });
});

describe("board pours", () => {
  it("labels pours by size, keeping names for flights", () => {
    expect(pourLabel("Full Pour", 16)).toBe("16 oz");
    expect(pourLabel("Flight", 16)).toBe("Flight");
    expect(pourLabel("Crowler", 32)).toBe("Crowler");
  });

  it("picks priced keg pours, one per size, smallest first, at most 3", () => {
    const p = pickBoardPours([
      { variation: "Full Pour", oz: 16, price: 8 },
      { variation: "Pint", oz: 16, price: 9 }, // same size: the first source wins
      { variation: "Half Pour", oz: 8, price: 5 },
      { variation: "4-pack cans", oz: 0, price: 18 },
      { variation: "Taster", oz: 4, price: 2.5 },
      { variation: "Growler", oz: 64, price: 22 },
      { variation: "Open price", oz: 10, price: null },
    ]);
    expect(p).toEqual([
      { label: "4 oz", oz: 4, price: 2.5 },
      { label: "8 oz", oz: 8, price: 5 },
      { label: "16 oz", oz: 16, price: 8 },
    ]);
  });

  it("parses typed prices and round-trips them", () => {
    const p = parseBoardPours("16 oz $8, 10oz $6.50; Flight $12");
    expect(p).toEqual([
      { label: "16 oz", oz: 16, price: 8 },
      { label: "10 oz", oz: 10, price: 6.5 },
      { label: "Flight", oz: null, price: 12 },
    ]);
    expect(formatBoardPours(p as never)).toBe("16 oz $8, 10 oz $6.50, Flight $12");
    expect(parseBoardPours("Pint 7")).toEqual([{ label: "Pint", oz: null, price: 7 }]);
    expect(parseBoardPours("")).toEqual([]);
    expect(parseBoardPours("sixteen ounces")).toEqual({ error: expect.any(String) });
    expect(parseBoardPours("a $1, b $2, c $3, d $4, e $5")).toEqual({ error: expect.any(String) });
    expect(priceText(7)).toBe("$7");
    expect(priceText(7.5)).toBe("$7.50");
  });
});

describe("pours on the board", () => {
  it("orders small to big, named pours last, and keeps the biggest when space is short", () => {
    const p = [{ label: "16 oz", oz: 16, price: 8 }, { label: "Flight", oz: null, price: 12 }, { label: "10 oz", oz: 10, price: 6 }, { label: "4 oz", oz: 4, price: 2 }];
    expect(boardPoursShown(p).map((x) => x.label)).toEqual(["10 oz", "16 oz", "Flight"]);
    expect(boardPoursShown(p, 2).map((x) => x.label)).toEqual(["16 oz", "Flight"]);
    expect(boardPoursShown([], 2)).toEqual([]);
  });
});

describe("badges", () => {
  const now = new Date("2026-11-15T20:00:00Z");
  it("says almost gone under 15% left, before anything else", () => {
    expect(tapBadge(0.14, new Date("2026-11-15T10:00:00Z"), now)).toBe("almost");
    expect(tapBadge(0.15, null, now)).toBeNull();
  });
  it("says new for 3 days after tapping", () => {
    expect(tapBadge(0.8, new Date("2026-11-13T21:00:00Z"), now)).toBe("new");
    expect(tapBadge(0.8, new Date("2026-11-12T19:00:00Z"), now)).toBeNull();
    expect(tapBadge(null, "2026-11-15T19:00:00Z", now)).toBe("new");
    expect(tapBadge(0.9, new Date("2026-11-16T19:00:00Z"), now)).toBeNull(); // clock skew: not "new" from the future
  });
});

describe("board order", () => {
  it("puts saved lines first, then the rest by number, ignoring gone lines", () => {
    expect(orderLines([1, 2, 3, 4, 5], [4, 2, 9])).toEqual([4, 2, 1, 3, 5]);
    expect(orderLines([3, 1, 2], null)).toEqual([1, 2, 3]);
    expect(orderLines([1, 2], [2, 2, 1])).toEqual([2, 1]);
  });
  it("moves a line up or down, not past the ends", () => {
    expect(moveLine([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveLine([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveLine([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveLine([1, 2, 3], 7, 1)).toEqual([1, 2, 3]);
  });
});

describe("coming soon", () => {
  const beers = [
    { id: "a", name: "Amber", comingSoon: null, active: true, fullKegs: 2 },
    { id: "b", name: "Bock", comingSoon: true, active: true, fullKegs: 0 },
    { id: "c", name: "Cider", comingSoon: false, active: true, fullKegs: 3 },
    { id: "d", name: "Dunkel", comingSoon: null, active: true, fullKegs: 1 },
    { id: "e", name: "Export", comingSoon: null, active: false, fullKegs: 4 },
    { id: "f", name: "Faro", comingSoon: null, active: true, fullKegs: 0 },
  ];
  it("shows pinned beers first, then ones with a full keg, never what's on tap", () => {
    expect(comingSoon(beers, ["d"], { auto: true }).map((b) => b.id)).toEqual(["b", "a"]);
  });
  it("shows only pinned beers when automatic is off", () => {
    expect(comingSoon(beers, new Set<string>(), { auto: false }).map((b) => b.id)).toEqual(["b"]);
  });
  it("caps the list", () => {
    expect(comingSoon(beers, [], { auto: true, max: 2 }).map((b) => b.id)).toEqual(["b", "a"]);
  });
});

describe("layout", () => {
  it("uses one column up to 8 taps on a landscape TV, two beyond", () => {
    expect(boardLayout(6)).toMatchObject({ cols: 1, rows: 6 });
    expect(boardLayout(8)).toMatchObject({ cols: 1, rows: 8 });
    expect(boardLayout(9)).toMatchObject({ cols: 2, rows: 5 });
    expect(boardLayout(16)).toMatchObject({ cols: 2, rows: 8 });
    expect(boardLayout(12, 9 / 16)).toMatchObject({ cols: 1, rows: 12 }); // portrait TV
  });
  it("scales type down as rows go up, within limits", () => {
    const s6 = boardLayout(6).scale, s8 = boardLayout(8).scale, s16 = boardLayout(16).scale, s2 = boardLayout(2).scale;
    expect(s6).toBeGreaterThan(s8);
    expect(s8).toBeGreaterThan(s16);
    expect(s16).toBeGreaterThanOrEqual(0.55);
    expect(s2).toBeLessThanOrEqual(1.15);
  });
  it("drifts a few pixels, changing every step and coming back around", () => {
    const step = 3 * 60_000;
    const seen = Array.from({ length: 8 }, (_, i) => burnInOffset(i * step));
    for (const o of seen) { expect(Math.abs(o.x)).toBeLessThanOrEqual(6); expect(Math.abs(o.y)).toBeLessThanOrEqual(6); }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toEqual(seen[i - 1]);
    expect(burnInOffset(8 * step)).toEqual(seen[0]);
    expect(burnInOffset(step + 1000)).toEqual(seen[1]);
  });
});

describe("Square check", () => {
  const link = (o: Partial<Parameters<typeof squareCheck>[0][number]> = {}) => ({ variation: "Full Pour", squarePrice: 8, archived: false, deleted: false, menuPrice: null, ...o });
  it("needs a synced catalog", () => {
    expect(squareCheck([], null, false).tone).toBe("neutral");
  });
  it("flags a missing, deleted or archived item", () => {
    expect(squareCheck([], null, true)).toEqual({ tone: "warn", text: "No Square item found" });
    expect(squareCheck([link({ deleted: true })], null, true).text).toBe("Square item was deleted");
    expect(squareCheck([link({ archived: true })], null, true).text).toBe("Archived in Square");
  });
  it("flags a recipe price that differs from Square", () => {
    const r = squareCheck([link({ menuPrice: 7 })], null, true);
    expect(r.tone).toBe("bad");
    expect(r.text).toContain("Square $8, recipe $7");
  });
  it("compares typed prices by pour name", () => {
    const r = squareCheck([link({ variation: "16 oz" })], [{ label: "16 oz", oz: 16, price: 9 }], true);
    expect(r.tone).toBe("bad");
    expect(r.text).toContain("board $9, Square $8");
  });
  it("is happy when everything lines up", () => {
    expect(squareCheck([link({ menuPrice: 8 }), link({ variation: "Half Pour", squarePrice: 5 })], null, true)).toEqual({ tone: "good", text: "In Square · 2 pours" });
  });
});

describe("one level signal per tap", () => {
  it("says should have kicked, and nothing else, when more was poured than the keg holds", () => {
    expect(tapLevel({ pctLeft: 0, daysLeft: 0, overdue: true })).toEqual({ text: "Should have kicked by now: check it", tone: "warn", almost: true });
  });
  it("says nearly out once it's nearly empty or won't last the day", () => {
    expect(tapLevel({ pctLeft: 0.02, daysLeft: 3, overdue: false })).toEqual({ text: "Nearly out", tone: "warn", almost: true });
    expect(tapLevel({ pctLeft: 0.3, daysLeft: 0.5, overdue: false })).toEqual({ text: "Nearly out", tone: "warn", almost: true });
  });
  it("says almost gone with the share and days left below the almost-gone line", () => {
    expect(tapLevel({ pctLeft: 0.1, daysLeft: 2.2, overdue: false })).toEqual({ text: "Almost gone: ~10% left, ~2 days", tone: "warn", almost: true });
  });
  it("gives the share and days left otherwise, calmly", () => {
    expect(tapLevel({ pctLeft: 0.62, daysLeft: 6, overdue: false })).toEqual({ text: "~60% left, ~6 days", tone: "neutral", almost: false });
    expect(tapLevel({ pctLeft: 0.62, daysLeft: null, overdue: false })).toEqual({ text: "~60% left", tone: "neutral", almost: false });
    expect(tapLevel({ pctLeft: 0.5, daysLeft: 1.2, overdue: false }).text).toBe("~50% left, ~1 day");
  });
  it("says it can't tell when there's no estimate", () => {
    expect(tapLevel({ pctLeft: null, daysLeft: null, overdue: false })).toEqual({ text: "Level not known yet", tone: "unknown", almost: false });
  });
});
