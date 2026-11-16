import { describe, expect, it } from "vitest";
import {
  brewLead,
  brewOrderAttention,
  detectBrewSupplier,
  orderBucket,
  orderByDate,
  parseLeadRefs,
  placedOnFor,
  planBrewOrders,
  withPlaced,
  type BrewOrder,
  type OrderSupplier,
  type PlannedBrew,
} from "../brewOrdering";

const SUPPLIERS: OrderSupplier[] = [
  { id: "hvm", name: "Hudson Valley Malt", leadDays: 14, ref: "brew", deliveryDays: [] },
  { id: "nyhg", name: "NY Hop Guild", leadDays: 7, ref: "dryHop", deliveryDays: [] },
  { id: "yak", name: "Yakima Quality Hops", leadDays: 10, ref: "dryHop", deliveryDays: [] },
  { id: "omega", name: "Omega Yeast", leadDays: 10, ref: "brew", deliveryDays: [2, 3, 4, 5] },
  { id: "labels", name: "Labels", leadDays: 10, ref: "pkg", deliveryDays: [] },
];

const NO_LABELS = SUPPLIERS.filter((s) => s.ref !== "pkg");

const brew = (over: Partial<PlannedBrew> & Pick<PlannedBrew, "id" | "brewOn" | "lines">): PlannedBrew => ({
  code: over.id,
  name: over.id,
  dryHopOn: null,
  packageOn: null,
  ordered: {},
  ...over,
});

describe("order-by dates", () => {
  it("is the lead time before the reference day", () => {
    expect(orderByDate("2026-12-10", 14, [])).toBe("2026-11-26");
  });
  it("moves back so an overnight delivery lands on a delivery day", () => {
    // Dec 10 2026 is a Thursday; 10 days before is Mon Nov 30 → arrives Tue: fine
    expect(orderByDate("2026-12-10", 10, [2, 3, 4, 5])).toBe("2026-11-30");
    // Dec 14 (Mon) − 10 = Fri Dec 4 → would arrive Sat; back to Thu Dec 3 (arrives Fri)
    expect(orderByDate("2026-12-14", 10, [2, 3, 4, 5])).toBe("2026-12-03");
  });
  it("ignores delivery days when every day is one", () => {
    expect(orderByDate("2026-12-14", 10, [0, 1, 2, 3, 4, 5, 6])).toBe("2026-12-04");
  });
});

describe("lead references", () => {
  it("reads the saved setting and drops anything unknown", () => {
    expect(parseLeadRefs('{"a":"dryHop","b":"pkg","c":"soon","d":3}')).toEqual({ a: "dryHop", b: "pkg" });
    expect(parseLeadRefs("not json")).toEqual({});
    expect(parseLeadRefs(null)).toEqual({});
  });
  it("reads a supplier's own brewery lead, falling back to its lead time and brew day", () => {
    expect(brewLead({ brewLeadDays: 7, brewLeadRef: "dryHop", leadTimeDays: 1 })).toEqual({ leadDays: 7, ref: "dryHop" });
    expect(brewLead({ brewLeadDays: null, brewLeadRef: null, leadTimeDays: 14 })).toEqual({ leadDays: 14, ref: "brew" });
    expect(brewLead({ brewLeadDays: 0, brewLeadRef: "soon", leadTimeDays: 14 })).toEqual({ leadDays: 0, ref: "brew" });
  });
});

describe("placed orders, kept by supplier id", () => {
  const hvm = { id: "hvm", name: "Hudson Valley Malt" };
  it("finds a placed order by id, or an older one under the name", () => {
    expect(placedOnFor({ hvm: "2026-11-10" }, hvm)).toBe("2026-11-10");
    expect(placedOnFor({ "Hudson Valley Malt": "2026-11-09" }, hvm)).toBe("2026-11-09");
    expect(placedOnFor({ hvm: "2026-11-10", "Hudson Valley Malt": "2026-11-09" }, hvm)).toBe("2026-11-10");
    expect(placedOnFor({}, hvm)).toBeNull();
  });
  it("writes by id and drops the old name entry", () => {
    expect(withPlaced({ "Hudson Valley Malt": "2026-11-09", omega: "2026-11-01" }, hvm, "2026-11-12")).toEqual({ hvm: "2026-11-12", omega: "2026-11-01" });
    expect(withPlaced({ hvm: "2026-11-12", "Hudson Valley Malt": "2026-11-09" }, hvm, null)).toEqual({});
  });
  it("still shows a placed order after the supplier is renamed", () => {
    const [o] = planBrewOrders({ today: "2026-11-01", suppliers: [{ ...SUPPLIERS[0], name: "HV Malt Co." }], onHand: new Map(), brews: [brew({ id: "a", brewOn: "2026-12-01", ordered: { hvm: "2026-10-30" }, lines: [{ ingredientId: "pils", name: "Pils", qtyBase: 5, dryHop: false, supplierId: "hvm" }] })] });
    expect(o.placedOn).toBe("2026-10-30");
  });
});

describe("guessing a supplier from a line", () => {
  const list = SUPPLIERS.map(({ id, name }) => ({ id, name }));
  it("knows Brew Manager's short names", () => {
    expect(detectBrewSupplier("Pils, Hudson Valley Malt (NYS)", list)).toBe("hvm");
    expect(detectBrewSupplier("Cascade NYHG", list)).toBe("nyhg");
    expect(detectBrewSupplier("Citra (Yakima)", list)).toBe("yak");
    expect(detectBrewSupplier("Omega OYL-200", list)).toBe("omega");
  });
  it("matches a supplier's own name, and nothing when unsure", () => {
    expect(detectBrewSupplier("Labels for cans", list)).toBe("labels");
    expect(detectBrewSupplier("Flaked oats", list)).toBeNull();
    expect(detectBrewSupplier("Pils HVM", [{ id: "x", name: "Other" }])).toBeNull(); // HVM not set up here
  });
});

describe("what to order when", () => {
  const today = "2026-11-16";
  const pils = (qtyBase: number) => ({ ingredientId: "pils", name: "Pils", qtyBase, dryHop: false, supplierId: "hvm", pack: { qtyBase: 50, unit: "sack" } });
  const citraDh = (qtyBase: number) => ({ ingredientId: "citra", name: "Citra", qtyBase, dryHop: true, supplierId: "yak" });

  it("gives stock to the earliest brew first; later brews order the rest", () => {
    const orders = planBrewOrders({
      today,
      suppliers: NO_LABELS,
      onHand: new Map([["pils", 120]]),
      brews: [brew({ id: "late", brewOn: "2027-01-10", lines: [pils(100)] }), brew({ id: "early", brewOn: "2026-12-10", lines: [pils(100)] })],
    });
    const early = orders.find((o) => o.brewId === "early")!;
    const late = orders.find((o) => o.brewId === "late")!;
    expect(early.lines[0]).toMatchObject({ needBase: 100, fromStockBase: 100, shortBase: 0, packs: 0 });
    expect(early.needsOrder).toBe(false);
    expect(late.lines[0]).toMatchObject({ needBase: 100, fromStockBase: 20, shortBase: 80, packs: 2 });
    expect(late.needsOrder).toBe(true);
    expect(late.orderBy).toBe("2026-12-27");
    expect(orders[0].brewId).toBe("early"); // sorted by order-by date
  });

  it("orders dry-hop suppliers for the dry-hop day, unless their hops go in on brew day too", () => {
    const orders = planBrewOrders({
      today,
      suppliers: NO_LABELS,
      onHand: new Map(),
      brews: [
        brew({ id: "a", brewOn: "2026-12-10", dryHopOn: "2026-12-15", lines: [citraDh(10)] }),
        brew({ id: "b", brewOn: "2026-12-10", dryHopOn: "2026-12-15", lines: [citraDh(10), { ingredientId: "citra", name: "Citra", qtyBase: 5, dryHop: false, supplierId: "yak" }] }),
      ],
    });
    expect(orders.find((o) => o.brewId === "a")).toMatchObject({ ref: "dryHop", refOn: "2026-12-15", orderBy: "2026-12-05" });
    expect(orders.find((o) => o.brewId === "b")).toMatchObject({ ref: "brew", refOn: "2026-12-10", orderBy: "2026-11-30" });
  });

  it("uses brew day for a dry-hop supplier when the brew has no dry-hop day", () => {
    const [o] = planBrewOrders({ today, suppliers: NO_LABELS, onHand: new Map(), brews: [brew({ id: "a", brewOn: "2026-12-10", lines: [citraDh(10)] })] }).filter((x) => x.supplierId === "yak");
    expect(o.refOn).toBe("2026-12-10");
  });

  it("dry hops are needed on the dry-hop day, so an earlier brew-day need gets the stock first", () => {
    const orders = planBrewOrders({
      today,
      suppliers: NO_LABELS,
      onHand: new Map([["citra", 10]]),
      brews: [
        brew({ id: "a", brewOn: "2026-12-01", dryHopOn: "2026-12-12", lines: [citraDh(10)] }),
        brew({ id: "b", brewOn: "2026-12-08", lines: [{ ingredientId: "citra", name: "Citra", qtyBase: 10, dryHop: false, supplierId: "yak" }] }),
      ],
    });
    expect(orders.find((o) => o.brewId === "b")!.lines[0].shortBase).toBe(0);
    expect(orders.find((o) => o.brewId === "a")!.lines[0].shortBase).toBe(10);
  });

  it("adds labels for every brew, ten days before packaging", () => {
    const orders = planBrewOrders({ today, suppliers: SUPPLIERS, onHand: new Map(), brews: [brew({ id: "a", brewOn: "2026-12-01", packageOn: "2026-12-22", lines: [] })] });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ supplierId: "labels", ref: "pkg", refOn: "2026-12-22", orderBy: "2026-12-12", labelsOnly: true, needsOrder: true });
  });

  it("merges the same ingredient at the same stage, and says when an order is placed or late", () => {
    const orders = planBrewOrders({
      today,
      suppliers: NO_LABELS,
      onHand: new Map(),
      brews: [brew({ id: "a", brewOn: "2026-11-25", ordered: { hvm: "2026-11-10" }, lines: [pils(30), pils(20)] }), brew({ id: "b", brewOn: "2026-11-26", lines: [pils(10)] })],
    }).filter((o) => o.supplierId === "hvm");
    expect(orders[0].lines).toHaveLength(1);
    expect(orders[0].lines[0].needBase).toBe(50);
    expect(orders[0]).toMatchObject({ placedOn: "2026-11-10", overdue: false });
    expect(orders[1]).toMatchObject({ placedOn: null, overdue: true, orderBy: "2026-11-12" });
  });

  it("puts lines with no brewery supplier together, assuming two weeks", () => {
    const [o] = planBrewOrders({ today, suppliers: NO_LABELS, onHand: new Map(), brews: [brew({ id: "a", brewOn: "2026-12-10", lines: [{ ingredientId: "oats", name: "Oats", qtyBase: 5, dryHop: false, supplierId: null }] })] });
    expect(o).toMatchObject({ supplierId: null, supplier: "No supplier set", orderBy: "2026-11-26", needsOrder: true });
  });
});

describe("grouping and the Overview", () => {
  const today = "2026-11-18"; // a Wednesday
  const order = (over: Partial<BrewOrder>): BrewOrder => ({
    key: "k",
    supplierId: "hvm",
    supplier: "Hudson Valley Malt",
    brewId: "a",
    brewCode: "26-040",
    brewName: "NY Nectar",
    brewOn: "2026-12-10",
    ref: "brew",
    refOn: "2026-12-10",
    orderBy: "2026-11-26",
    placedOn: null,
    needsOrder: true,
    overdue: false,
    labelsOnly: false,
    lines: [],
    ...over,
  });

  it("groups by order-by week", () => {
    expect(orderBucket(order({ orderBy: "2026-11-17", overdue: true }), today)).toBe("overdue");
    expect(orderBucket(order({ orderBy: "2026-11-22" }), today)).toBe("thisWeek"); // Sunday
    expect(orderBucket(order({ orderBy: "2026-11-23" }), today)).toBe("nextWeek");
    expect(orderBucket(order({ orderBy: "2026-11-30" }), today)).toBe("later");
    expect(orderBucket(order({ placedOn: "2026-11-01" }), today)).toBe("placed");
    expect(orderBucket(order({ needsOrder: false }), today)).toBe("covered");
  });

  it("says what to order by when, within three days or late", () => {
    const items = brewOrderAttention([order({ orderBy: "2026-11-20" }), order({ orderBy: "2026-11-25" }), order({ orderBy: "2026-11-19", placedOn: "2026-11-18" })], today);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Order Hudson Valley Malt by Fri Nov 20 for NY Nectar", href: "/brewery/ordering", tone: "warn" });
  });

  it("flags late orders red", () => {
    const [i] = brewOrderAttention([order({ orderBy: "2026-11-16", overdue: true })], today);
    expect(i.tone).toBe("bad");
    expect(i.detail).toMatch(/2 days late/);
  });

  it("rolls more than three into one item", () => {
    const many = ["2026-11-18", "2026-11-19", "2026-11-19", "2026-11-20"].map((d, n) => order({ orderBy: d, brewId: `b${n}`, key: `k${n}` }));
    const items = brewOrderAttention(many, today);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("4 brewery orders to place");
    expect(items[0].detail).toMatch(/^Hudson Valley Malt by today for NY Nectar/);
  });

  it("leaves out orders with no supplier set", () => {
    expect(brewOrderAttention([order({ supplierId: null, orderBy: today })], today)).toEqual([]);
  });
});
