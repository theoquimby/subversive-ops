import { describe, expect, it } from "vitest";
import {
  availability,
  dueTone,
  lineCollides,
  lineProgress,
  matchKeg,
  MAX_LINES,
  MAX_QUANTITY,
  mergeLines,
  orderAttentionItems,
  orderMatches,
  orderProgress,
  ORDERS_HREF,
  orderShortfalls,
  progressLabel,
  stockWarning,
  transitLabel,
  validateOrder,
  type DueOrder,
  type OrderLine,
  type ScannedKeg,
  type StockKeg,
} from "../kegOrders";

const line = (id: string, patch: Partial<OrderLine> = {}): OrderLine => ({ id, beerId: "ipa", sizeId: "half", quantity: 1, unscanned: 0, scanned: 0, sort: 0, ...patch });
const stock = (beerId: string | null, sizeId: string, patch: Partial<StockKeg> = {}): StockKeg => ({ beerId, sizeId, status: "COLD", active: true, ...patch });
const NAMES: Record<string, string> = { ipa: "Subversive IPA", stout: "Night Shift Stout", pils: "Catskill Pils" };
const nameOf = (id: string) => NAMES[id];
const scanned = (patch: Partial<ScannedKeg> = {}): ScannedKeg => ({ id: "k1", active: true, status: "COLD", beerId: "ipa", beer: "Subversive IPA", sizeId: "half", account: null, ...patch });

// 2026-11-16 is a Monday.
const TODAY = "2026-11-16";

describe("line and order progress", () => {
  it("counts scanned kegs and kegs delivered without a scan", () => {
    expect(lineProgress(line("a", { quantity: 5, scanned: 2, unscanned: 1 }))).toEqual({ sent: 3, remaining: 2, complete: false });
    expect(lineProgress(line("a", { quantity: 3, scanned: 3 }))).toEqual({ sent: 3, remaining: 0, complete: true });
    expect(lineProgress(line("a", { quantity: 2, unscanned: 2 }))).toEqual({ sent: 2, remaining: 0, complete: true });
  });
  it("never goes negative when the quantity is cut below what was sent", () => {
    expect(lineProgress(line("a", { quantity: 2, scanned: 3, unscanned: 1 }))).toEqual({ sent: 4, remaining: 0, complete: true });
    const p = orderProgress([line("a", { quantity: 2, scanned: 3 }), line("b", { quantity: 1, scanned: 1, sizeId: "sixtel" })]);
    expect(p).toEqual({ quantity: 3, sent: 4, remaining: 0, complete: true });
  });
  it("treats bad counts as zero", () => {
    expect(lineProgress({ quantity: 2, scanned: -1, unscanned: Number.NaN })).toEqual({ sent: 0, remaining: 2, complete: false });
  });
  it("sums an order's lines", () => {
    const p = orderProgress([line("a", { quantity: 3, scanned: 2 }), line("b", { quantity: 2, sizeId: "sixtel" })]);
    expect(p).toEqual({ quantity: 5, sent: 2, remaining: 3, complete: false });
    expect(progressLabel(p)).toBe("2 of 5 kegs");
    expect(progressLabel(orderProgress([line("a", { quantity: 1, scanned: 1 })]))).toBe("1 of 1 keg");
  });
  it("an over-sent line doesn't hide another line that still needs kegs", () => {
    const p = orderProgress([line("a", { quantity: 1, scanned: 3 }), line("b", { quantity: 2, sizeId: "sixtel" })]);
    expect(p).toEqual({ quantity: 3, sent: 3, remaining: 2, complete: false });
  });
  it("is complete only when every line is, and never with no lines", () => {
    expect(orderProgress([line("a", { quantity: 2, scanned: 2 }), line("b", { quantity: 1, unscanned: 1 })]).complete).toBe(true);
    expect(orderProgress([line("a", { quantity: 2, scanned: 2 }), line("b", { quantity: 1 })]).complete).toBe(false);
    expect(orderProgress([])).toEqual({ quantity: 0, sent: 0, remaining: 0, complete: false });
    expect(progressLabel(orderProgress([]))).toBe("0 of 0 kegs");
  });
});

describe("availability", () => {
  it("is empty with no kegs and no orders", () => {
    expect(availability([], [], nameOf)).toEqual([]);
  });
  it("counts only active kegs that are filled or cold, with a beer", () => {
    const kegs = [
      stock("ipa", "half"),
      stock("ipa", "half", { status: "FILLED" }),
      stock("ipa", "half", { status: "ON_TAP" }),
      stock("ipa", "half", { status: "OUT" }),
      stock("ipa", "half", { status: "EMPTY" }),
      stock("ipa", "half", { status: "KICKED" }),
      stock("ipa", "half", { status: "CLEANING" }),
      stock("ipa", "half", { active: false }),
      stock(null, "half"),
    ];
    expect(availability(kegs, [], nameOf)).toEqual([{ beerId: "ipa", beer: "Subversive IPA", sizeId: "half", full: 2, wanted: 0, reserved: 0, available: 2, preordered: 0 }]);
  });
  it("reserves full kegs for open orders and preorders the rest", () => {
    const kegs = [stock("ipa", "half"), stock("ipa", "half"), stock("ipa", "half"), stock("stout", "sixtel")];
    const orders = [
      { status: "OPEN" as const, lines: [line("a", { quantity: 2 }), line("b", { beerId: "stout", sizeId: "sixtel", quantity: 3 })] },
      { status: "OPEN" as const, lines: [line("c", { quantity: 2, scanned: 1 })] },
    ];
    expect(availability(kegs, orders, nameOf)).toEqual([
      { beerId: "stout", beer: "Night Shift Stout", sizeId: "sixtel", full: 1, wanted: 3, reserved: 1, available: 0, preordered: 2 },
      { beerId: "ipa", beer: "Subversive IPA", sizeId: "half", full: 3, wanted: 3, reserved: 3, available: 0, preordered: 0 },
    ]);
  });
  it("ignores fulfilled and cancelled orders, and lines that are already complete", () => {
    const kegs = [stock("ipa", "half")];
    const orders = [
      { status: "FULFILLED" as const, lines: [line("a", { quantity: 4 })] },
      { status: "CANCELLED" as const, lines: [line("b", { quantity: 4 })] },
      { status: "OPEN" as const, lines: [line("c", { quantity: 2, scanned: 1, unscanned: 1 })] },
    ];
    expect(availability(kegs, orders, nameOf)).toEqual([{ beerId: "ipa", beer: "Subversive IPA", sizeId: "half", full: 1, wanted: 0, reserved: 0, available: 1, preordered: 0 }]);
  });
  it("keeps sizes apart and shows a pair that is only wanted", () => {
    const kegs = [stock("ipa", "sixtel")];
    const orders = [{ status: "OPEN" as const, lines: [line("a", { quantity: 2 })] }];
    expect(availability(kegs, orders, nameOf)).toEqual([
      { beerId: "ipa", beer: "Subversive IPA", sizeId: "half", full: 0, wanted: 2, reserved: 0, available: 0, preordered: 2 },
      { beerId: "ipa", beer: "Subversive IPA", sizeId: "sixtel", full: 1, wanted: 0, reserved: 0, available: 1, preordered: 0 },
    ]);
  });
  it("leaves out a pair with nothing full and nothing wanted", () => {
    const orders = [{ status: "OPEN" as const, lines: [line("a", { quantity: 1, scanned: 1 })] }];
    expect(availability([stock("ipa", "half", { status: "EMPTY" })], orders, nameOf)).toEqual([]);
  });
  it("sorts by beer name, then by size in the usual order", () => {
    const kegs = [stock("stout", "half"), stock("pils", "sixtel"), stock("pils", "half"), stock("ipa", "quarter")];
    expect(availability(kegs, [], nameOf).map((r) => `${r.beer} ${r.sizeId}`)).toEqual(["Catskill Pils half", "Catskill Pils sixtel", "Night Shift Stout half", "Subversive IPA quarter"]);
  });
  it("names a beer it can't find", () => {
    expect(availability([stock("gone", "half")], [], nameOf)[0].beer).toBe("Unknown beer");
  });
});

describe("what an order is short of", () => {
  const rows = availability([stock("ipa", "half")], [], nameOf);
  it("is nothing when enough kegs are full", () => {
    expect(orderShortfalls([line("a", { quantity: 1 })], rows)).toEqual([{ lineId: "a", full: 1, short: 0 }]);
    expect(stockWarning([])).toBeNull();
  });
  it("counts the kegs each line still needs beyond what's full", () => {
    const lines = [line("a", { quantity: 4, scanned: 1 }), line("b", { beerId: "stout", sizeId: "sixtel", quantity: 1, sort: 1 })];
    expect(orderShortfalls(lines, rows)).toEqual([{ lineId: "a", full: 1, short: 2 }, { lineId: "b", full: 0, short: 1 }]);
  });
  it("doesn't count the same full keg for two lines", () => {
    const lines = [line("b", { quantity: 1, sort: 2 }), line("a", { quantity: 1, sort: 1 })];
    expect(orderShortfalls(lines, rows)).toEqual([{ lineId: "a", full: 1, short: 0 }, { lineId: "b", full: 0, short: 1 }]);
  });
  it("asks for nothing on a line that is complete", () => {
    expect(orderShortfalls([line("a", { quantity: 2, scanned: 2 })], [])).toEqual([{ lineId: "a", full: 0, short: 0 }]);
  });
  it("says it in one line", () => {
    expect(stockWarning([{ beer: "Subversive IPA", sizeId: "half", short: 2 }])).toBe("Not enough full kegs yet: 2 × Subversive IPA 1/2 bbl still need filling.");
    expect(stockWarning([{ beer: "Subversive IPA", sizeId: "half", short: 1 }])).toBe("Not enough full kegs yet: 1 × Subversive IPA 1/2 bbl still needs filling.");
    expect(stockWarning([{ beer: "Subversive IPA", sizeId: "half", short: 1 }, { beer: "Night Shift Stout", sizeId: "sixtel", short: 3 }, { beer: "Catskill Pils", sizeId: "half", short: 0 }])).toBe(
      "Not enough full kegs yet: 1 × Subversive IPA 1/2 bbl and 3 × Night Shift Stout 1/6 bbl still need filling.",
    );
  });
});

describe("matching a scanned keg to a line", () => {
  const lines = [line("a", { quantity: 2, sort: 1 }), line("b", { beerId: "stout", sizeId: "sixtel", quantity: 1, sort: 2 })];
  it("takes a full keg of the right beer and size", () => {
    expect(matchKeg(scanned(), lines, [])).toEqual({ lineId: "a" });
    expect(matchKeg(scanned({ status: "FILLED", beerId: "stout", beer: "Night Shift Stout", sizeId: "sixtel" }), lines, [])).toEqual({ lineId: "b" });
  });
  it("has no line to offer on an order with no lines", () => {
    expect(matchKeg(scanned(), [], [])).toEqual({ reason: "wrong-beer", error: "This order has no Subversive IPA." });
  });
  it("picks the first line by sort when two lines match", () => {
    const two = [line("late", { sort: 5, quantity: 1 }), line("early", { sort: 1, quantity: 1 })];
    expect(matchKeg(scanned(), two, [])).toEqual({ lineId: "early" });
    // Once the first is complete, the next one takes it.
    expect(matchKeg(scanned(), [two[0], { ...two[1], scanned: 1 }], [])).toEqual({ lineId: "late" });
  });
  it("refuses a retired keg before anything else", () => {
    expect(matchKeg(scanned({ active: false, status: "EMPTY" }), lines, ["k1"])).toEqual({ reason: "retired", error: "This keg is retired. A manager can bring it back." });
  });
  it("refuses a keg that is already on the order, whatever its status", () => {
    expect(matchKeg(scanned({ status: "OUT", account: "The Anchor" }), lines, new Set(["k1"]))).toEqual({ reason: "on-order", error: "Already on this order." });
  });
  it("says what a keg is when it isn't full", () => {
    const say = (patch: Partial<ScannedKeg>) => matchKeg(scanned(patch), lines, []);
    expect(say({ status: "EMPTY" })).toEqual({ reason: "not-full", error: "This keg is empty." });
    expect(say({ status: "ON_TAP" })).toEqual({ reason: "not-full", error: "This keg is on tap." });
    expect(say({ status: "KICKED" })).toEqual({ reason: "not-full", error: "This keg is kicked." });
    expect(say({ status: "CLEANING" })).toEqual({ reason: "not-full", error: "This keg is waiting to be cleaned." });
    expect(say({ status: "OUT", account: "The Anchor" })).toEqual({ reason: "not-full", error: "This keg is already out at The Anchor." });
    expect(say({ status: "OUT" })).toEqual({ reason: "not-full", error: "This keg is already out at an account." });
  });
  it("checks fullness before the beer", () => {
    expect(matchKeg(scanned({ status: "EMPTY", beerId: "pils", beer: "Catskill Pils" }), lines, [])).toMatchObject({ reason: "not-full" });
  });
  it("refuses a full keg with no beer recorded", () => {
    expect(matchKeg(scanned({ beerId: null, beer: null }), lines, [])).toEqual({ reason: "wrong-beer", error: "The app doesn't know what's in this keg, so it can't go on an order." });
  });
  it("refuses a beer the order doesn't have", () => {
    expect(matchKeg(scanned({ beerId: "pils", beer: "Catskill Pils" }), lines, [])).toEqual({ reason: "wrong-beer", error: "This order has no Catskill Pils." });
  });
  it("refuses the right beer in the wrong size, and says both sizes", () => {
    expect(matchKeg(scanned({ sizeId: "sixtel" }), lines, [])).toEqual({ reason: "wrong-size", error: "This order wants Subversive IPA in 1/2 bbl, and this keg is 1/6 bbl." });
    const both = [...lines, line("c", { sizeId: "quarter", sort: 3 })];
    expect(matchKeg(scanned({ sizeId: "sixtel" }), both, [])).toMatchObject({ error: "This order wants Subversive IPA in 1/2 bbl or 1/4 bbl, and this keg is 1/6 bbl." });
  });
  it("refuses a keg when the lines for it are complete", () => {
    const done = [line("a", { quantity: 2, scanned: 1, unscanned: 1 })];
    expect(matchKeg(scanned(), done, [])).toEqual({ reason: "complete", error: "This order already has all its Subversive IPA." });
    // The size is named when the order has the beer in more than one size.
    const sizes = [...done, line("c", { sizeId: "sixtel", quantity: 1, sort: 2 })];
    expect(matchKeg(scanned(), sizes, [])).toEqual({ reason: "complete", error: "This order already has all its Subversive IPA in 1/2 bbl." });
  });
  it("treats a line cut below what was sent as complete", () => {
    expect(matchKeg(scanned(), [line("a", { quantity: 1, scanned: 2 })], [])).toMatchObject({ reason: "complete" });
  });
});

describe("due tone", () => {
  it("is overdue before today, today on the day, and nothing otherwise", () => {
    expect(dueTone("2026-11-13", TODAY)).toEqual({ kind: "overdue", tone: "bad", daysLate: 3 });
    expect(dueTone("2026-11-15", TODAY)).toEqual({ kind: "overdue", tone: "bad", daysLate: 1 });
    expect(dueTone(TODAY, TODAY)).toEqual({ kind: "today", tone: "warn", daysLate: 0 });
    expect(dueTone("2026-11-17", TODAY)).toEqual({ kind: "none", tone: "neutral", daysLate: 0 });
  });
  it("is nothing with no date", () => {
    expect(dueTone(null, TODAY)).toEqual({ kind: "none", tone: "neutral", daysLate: 0 });
    expect(dueTone(undefined, TODAY)).toEqual({ kind: "none", tone: "neutral", daysLate: 0 });
  });
});

describe("validating an order", () => {
  const good = { accountId: "acct", transit: "DELIVERY", dueOn: "2026-11-20", lines: [{ beerId: "ipa", sizeId: "half", quantity: 2 }] };
  it("accepts a good order and tidies it", () => {
    expect(validateOrder(good)).toEqual({ order: good });
    expect(validateOrder({ ...good, accountId: " acct ", dueOn: "", transit: "PICKUP" })).toEqual({ order: { ...good, dueOn: null, transit: "PICKUP" } });
    expect(validateOrder({ ...good, dueOn: null })).toEqual({ order: { ...good, dueOn: null } });
  });
  it("needs an account", () => {
    expect(validateOrder({ ...good, accountId: "  " })).toEqual({ error: "Pick the account." });
  });
  it("needs delivery or pickup", () => {
    expect(validateOrder({ ...good, transit: "DRONE" })).toEqual({ error: "Pick delivery or pickup." });
  });
  it("needs a real date, or none", () => {
    expect(validateOrder({ ...good, dueOn: "next week" })).toEqual({ error: "That date doesn't look right." });
    expect(validateOrder({ ...good, dueOn: "2026-02-30" })).toEqual({ error: "That date doesn't look right." });
  });
  it("needs at least one line", () => {
    expect(validateOrder({ ...good, lines: [] })).toEqual({ error: "Add at least one line: a beer, a size and how many." });
  });
  it("needs a beer, a known size and a whole number from 1 to 200 on every line", () => {
    const withLine = (l: { beerId: string; sizeId: string; quantity: number }) => validateOrder({ ...good, lines: [good.lines[0], l] });
    expect(withLine({ beerId: "", sizeId: "half", quantity: 1 })).toEqual({ error: "Line 2: pick the beer." });
    expect(withLine({ beerId: "stout", sizeId: "firkin", quantity: 1 })).toEqual({ error: "Line 2: pick a keg size." });
    expect(withLine({ beerId: "stout", sizeId: "half", quantity: 0 })).toEqual({ error: `Line 2: how many kegs, from 1 to ${MAX_QUANTITY}.` });
    expect(withLine({ beerId: "stout", sizeId: "half", quantity: 201 })).toEqual({ error: "Line 2: how many kegs, from 1 to 200." });
    expect(withLine({ beerId: "stout", sizeId: "half", quantity: 1.5 })).toEqual({ error: "Line 2: how many kegs, from 1 to 200." });
    expect(withLine({ beerId: "stout", sizeId: "half", quantity: Number.NaN })).toEqual({ error: "Line 2: how many kegs, from 1 to 200." });
    expect(withLine({ beerId: "stout", sizeId: "half", quantity: 200 })).toMatchObject({ order: {} });
  });
  it("refuses two lines with the same beer and size", () => {
    expect(validateOrder({ ...good, lines: [good.lines[0], { beerId: "ipa", sizeId: "half", quantity: 1 }] })).toEqual({ error: "Two lines have the same beer and size. Put them on one line." });
    expect(validateOrder({ ...good, lines: [good.lines[0], { beerId: "ipa", sizeId: "sixtel", quantity: 1 }] })).toMatchObject({ order: {} });
  });
  it("takes at most 40 lines", () => {
    const sizes = ["half", "quarter", "sixtel", "bbl", "euro50", "euro30", "euro20", "corny"];
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ beerId: `beer${Math.floor(i / sizes.length)}`, sizeId: sizes[i % sizes.length], quantity: 1 }));
    expect(validateOrder({ ...good, lines: many(MAX_LINES) })).toMatchObject({ order: {} });
    expect(validateOrder({ ...good, lines: many(MAX_LINES + 1) })).toEqual({ error: "An order takes up to 40 lines. Split this one in two." });
  });
});

describe("merging lines", () => {
  it("is empty for no lines", () => {
    expect(mergeLines([])).toEqual([]);
  });
  it("adds up lines with the same beer and size, keeping the first one's place", () => {
    const merged = mergeLines([
      { beerId: "ipa", sizeId: "half", quantity: 2 },
      { beerId: "stout", sizeId: "half", quantity: 1 },
      { beerId: "ipa", sizeId: "half", quantity: 3 },
      { beerId: "ipa", sizeId: "sixtel", quantity: 1 },
    ]);
    expect(merged).toEqual([
      { beerId: "ipa", sizeId: "half", quantity: 5 },
      { beerId: "stout", sizeId: "half", quantity: 1 },
      { beerId: "ipa", sizeId: "sixtel", quantity: 1 },
    ]);
  });
  it("leaves unfinished lines alone, and doesn't change what it was given", () => {
    const given = [{ beerId: "", sizeId: "half", quantity: 1 }, { beerId: "", sizeId: "half", quantity: 1 }];
    expect(mergeLines(given)).toEqual(given);
    const two = [{ beerId: "ipa", sizeId: "half", quantity: 1 }, { beerId: "ipa", sizeId: "half", quantity: 1 }];
    mergeLines(two);
    expect(two[0].quantity).toBe(1);
  });
  it("spots a line that would double another", () => {
    const lines = [line("a"), line("b", { sizeId: "sixtel" })];
    expect(lineCollides(lines, { beerId: "ipa", sizeId: "half" })).toBe(true);
    expect(lineCollides(lines, { id: "a", beerId: "ipa", sizeId: "half" })).toBe(false);
    expect(lineCollides(lines, { id: "a", beerId: "ipa", sizeId: "sixtel" })).toBe(true);
    expect(lineCollides(lines, { beerId: "stout", sizeId: "half" })).toBe(false);
    expect(lineCollides([], { beerId: "ipa", sizeId: "half" })).toBe(false);
  });
});

describe("needs you", () => {
  const due = (dueOn: string | null, patch: Partial<DueOrder> = {}): DueOrder => ({ status: "OPEN", dueOn, transit: "DELIVERY", account: "The Anchor", ...patch });
  it("says nothing with no orders, or none due", () => {
    expect(orderAttentionItems(TODAY, [])).toEqual([]);
    expect(orderAttentionItems(TODAY, [due(null), due("2026-11-17")])).toEqual([]);
  });
  it("ignores orders that are fulfilled or cancelled", () => {
    expect(orderAttentionItems(TODAY, [due(TODAY, { status: "FULFILLED" }), due("2026-11-01", { status: "CANCELLED" })])).toEqual([]);
  });
  it("counts orders to deliver today", () => {
    expect(orderAttentionItems(TODAY, [due(TODAY), due(TODAY, { account: "Fred's Tavern" }), due("2026-11-18")])).toEqual([
      { key: "kegs.orders", title: "2 keg orders to deliver today", detail: "For The Anchor and Fred's Tavern", href: ORDERS_HREF, tone: "warn", urgency: 56 },
    ]);
    expect(orderAttentionItems(TODAY, [due(TODAY)])[0]).toMatchObject({ title: "1 keg order to deliver today", detail: "For The Anchor" });
  });
  it("words pickups and a mix of both", () => {
    expect(orderAttentionItems(TODAY, [due(TODAY, { transit: "PICKUP" })])[0].title).toBe("1 keg order for pickup today");
    expect(orderAttentionItems(TODAY, [due(TODAY, { transit: "PICKUP" }), due(TODAY, { transit: "PICKUP" })])[0].title).toBe("2 keg orders for pickup today");
    expect(orderAttentionItems(TODAY, [due(TODAY, { transit: "PICKUP" }), due(TODAY)])[0].title).toBe("2 keg orders due today");
  });
  it("shortens a long list of accounts", () => {
    const four = ["A", "B", "C", "D"].map((account) => due(TODAY, { account }));
    expect(orderAttentionItems(TODAY, four)[0].detail).toBe("For A, B and 2 more");
    expect(orderAttentionItems(TODAY, four.slice(0, 3))[0].detail).toBe("For A, B and C");
    // The same account twice is named once.
    expect(orderAttentionItems(TODAY, [due(TODAY), due(TODAY)])[0].detail).toBe("For The Anchor");
  });
  it("counts overdue orders, the oldest named", () => {
    expect(orderAttentionItems(TODAY, [due("2026-11-15")])).toEqual([
      { key: "kegs.orders", title: "1 keg order is overdue", detail: "The Anchor · 1 day late", href: ORDERS_HREF, tone: "warn", urgency: 62 },
    ]);
    expect(orderAttentionItems(TODAY, [due("2026-11-15"), due("2026-11-10", { account: "Fred's Tavern" })])[0]).toMatchObject({ title: "2 keg orders are overdue", detail: "Oldest: Fred's Tavern, 6 days late" });
  });
  it("makes one item when some are overdue and some are due today", () => {
    const items = orderAttentionItems(TODAY, [due("2026-11-14"), due(TODAY), due(TODAY, { account: "Fred's Tavern" })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "1 keg order is overdue", detail: "Plus 2 keg orders to deliver today", tone: "warn", urgency: 62 });
  });
});

describe("searching orders", () => {
  const o = { number: 42, account: "The Anchor", beers: ["Subversive IPA", "Night Shift Stout"] };
  it("fits everything when blank", () => {
    expect(orderMatches("", o)).toBe(true);
    expect(orderMatches("   ", o)).toBe(true);
  });
  it("finds an order by its number, with or without the #", () => {
    expect(orderMatches("42", o)).toBe(true);
    expect(orderMatches("#42", o)).toBe(true);
    expect(orderMatches("4", o)).toBe(false);
    expect(orderMatches("#421", o)).toBe(false);
  });
  it("finds an order by part of the account or a beer, in any case", () => {
    expect(orderMatches("anchor", o)).toBe(true);
    expect(orderMatches(" STOUT ", o)).toBe(true);
    expect(orderMatches("pils", o)).toBe(false);
    expect(orderMatches("7", { ...o, account: "Route 7 Diner" })).toBe(true);
  });
});

describe("labels", () => {
  it("names delivery and pickup", () => {
    expect(transitLabel("DELIVERY")).toBe("Delivery");
    expect(transitLabel("PICKUP")).toBe("Pickup");
    expect(transitLabel("anything else")).toBe("Delivery");
  });
});
