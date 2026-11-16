import { describe, expect, it } from "vitest";
import {
  areaOfItem,
  elsewhereGroups,
  FOCUS_IDS,
  FOCUS_INFO,
  focusKey,
  focusLabels,
  isUrgent,
  overviewBlocks,
  parseFocus,
  showSection,
  splitByFocus,
  URGENT_URGENCY,
} from "../focus";

describe("focus ids and words", () => {
  it("has six areas, each with a label, a short description and a page", () => {
    expect(FOCUS_IDS).toEqual(["business", "brewery", "kegs", "kitchen", "people", "online"]);
    for (const id of FOCUS_IDS) {
      expect(FOCUS_INFO[id].label.length).toBeGreaterThan(2);
      expect(FOCUS_INFO[id].description.length).toBeLessThan(70);
      expect(FOCUS_INFO[id].href).toMatch(/^\//);
    }
  });

  it("parseFocus keeps known ids once, in the person's order", () => {
    expect(parseFocus(["kitchen", "business", "kitchen", "beer", 3, null])).toEqual(["kitchen", "business"]);
    expect(parseFocus("brewery")).toEqual([]);
    expect(parseFocus(undefined)).toEqual([]);
  });

  it("labels and a stable key for caching per focus", () => {
    expect(focusLabels(["brewery", "kegs"])).toEqual(["Brewery", "Kegs"]);
    expect(focusKey([])).toBe("");
    expect(focusKey(["kitchen", "business"])).toBe("kitchen,business");
  });
});

describe("areaOfItem", () => {
  const cases: [string, string][] = [
    // Overview "Needs you" (domain/attention, opsAttention, kegSignals, kegOrders, breweryAttention, brewOrdering, privateEvents)
    ["missed.sup1", "kitchen"],
    ["order.sup1", "kitchen"],
    ["orders", "kitchen"],
    ["invoices", "kitchen"],
    ["kegs", "kegs"],
    ["kegs.out", "kegs"],
    ["kegs.idle", "kegs"],
    ["kegs.orders", "kegs"],
    ["requests", "people"],
    ["schedule", "people"],
    ["certs", "people"],
    ["checklists", "people"],
    ["reviews", "online"],
    ["upkeep", "business"],
    ["upkeep.down", "business"],
    ["beertax.federal", "business"],
    ["beertax.brop", "business"],
    ["beertax.ny", "business"],
    ["private.deposit.b1", "business"],
    ["brewery.transfer", "brewery"],
    ["brewery.package", "brewery"],
    ["brewery.clash", "brewery"],
    ["brewery.suggest", "brewery"],
    ["brewery.orders", "brewery"],
    ["brewery.order.sup.brew", "brewery"],
    // Morning brief "Before tonight" extras (domain/orderingBoard todayItems, tap lines)
    ["deadline:sup1", "kitchen"],
    ["draft:po1", "kitchen"],
    ["checkin:po1", "kitchen"],
    ["arriving:po1", "kitchen"],
    ["tap-3", "kegs"],
    // Weekly brief cards and decisions
    ["order-sup1", "kitchen"],
    ["draft-sup1", "kitchen"],
    ["orders-drafted", "kitchen"],
    ["prices", "kitchen"],
    ["menu", "kitchen"],
    ["gap", "kitchen"],
    ["counts", "kitchen"],
    ["unmapped", "kitchen"],
    ["waste", "kitchen"],
    ["autoOrders", "kitchen"],
    ["invoiceIssues", "kitchen"],
    ["training", "people"],
    ["timeOff", "people"],
    ["swaps", "people"],
    ["rating", "online"],
    ["badReviews", "online"],
  ];
  it.each(cases)("%s → %s", (key, area) => {
    expect(areaOfItem(key)).toBe(area);
  });

  it("anything unknown lands with the business, so it never disappears", () => {
    expect(areaOfItem("something.new")).toBe("business");
    expect(areaOfItem("")).toBe("business");
  });

  it("does not mistake look-alike prefixes", () => {
    expect(areaOfItem("ordering")).toBe("business");
    expect(areaOfItem("kegsy")).toBe("business");
    expect(areaOfItem("breweryx")).toBe("business");
  });
});

describe("urgent items", () => {
  it("red items and anything at or above the urgency line are urgent", () => {
    expect(URGENT_URGENCY).toBe(90);
    expect(isUrgent({ tone: "bad" })).toBe(true);
    expect(isUrgent({ tone: "warn", urgency: 90 })).toBe(true);
    expect(isUrgent({ tone: "warn", urgency: 89 })).toBe(false);
    expect(isUrgent({ tone: "neutral" })).toBe(false);
    expect(isUrgent({})).toBe(false);
  });
});

describe("splitByFocus", () => {
  const items = [
    { key: "missed.s1", tone: "bad" as const, urgency: 110 },
    { key: "order.s2", tone: "warn" as const, urgency: 92 },
    { key: "brewery.package", tone: "warn" as const, urgency: 52 },
    { key: "invoices", tone: "neutral" as const, urgency: 40 },
    { key: "upkeep.down", tone: "bad" as const, urgency: 70 },
    { key: "kegs.out", tone: "neutral" as const, urgency: 26 },
  ];

  it("no focus: everything is mine, in the same order", () => {
    const r = splitByFocus(items, []);
    expect(r.mine).toEqual(items);
    expect(r.elsewhere).toEqual([]);
  });

  it("brewery only: brewery items plus everything urgent, order kept", () => {
    const r = splitByFocus(items, ["brewery"]);
    expect(r.mine.map((i) => i.key)).toEqual(["missed.s1", "order.s2", "brewery.package", "upkeep.down"]);
    expect(r.elsewhere.map((i) => i.key)).toEqual(["invoices", "kegs.out"]);
  });

  it("business and kitchen: their items and urgent ones; brewery and kegs go elsewhere", () => {
    const r = splitByFocus(items, ["business", "kitchen"]);
    expect(r.mine.map((i) => i.key)).toEqual(["missed.s1", "order.s2", "invoices", "upkeep.down"]);
    expect(r.elsewhere.map((i) => i.key)).toEqual(["brewery.package", "kegs.out"]);
  });

  it("an explicit area on the item wins over its key", () => {
    const r = splitByFocus([{ key: "x", area: "kegs" as const }], ["kegs"]);
    expect(r.mine).toHaveLength(1);
  });
});

describe("elsewhereGroups", () => {
  const items = [
    { key: "invoices", title: "2 invoices to approve" },
    { key: "order.s1", title: "Order from Sysco" },
    { key: "kegs.out", title: "3 kegs out too long" },
  ];

  it("one group per area not looked after, in the usual order, with a count and a line", () => {
    const g = elsewhereGroups(items, ["brewery"]);
    expect(g.map((x) => x.area)).toEqual(["business", "kegs", "kitchen", "people", "online"]);
    const kitchen = g.find((x) => x.area === "kitchen")!;
    expect(kitchen.items).toHaveLength(2);
    expect(kitchen.line).toBe("2 invoices to approve, and 1 more");
    expect(kitchen.href).toBe("/ordering");
    expect(g.find((x) => x.area === "kegs")!.line).toBe("3 kegs out too long");
    expect(g.find((x) => x.area === "people")!.line).toBe("Nothing waiting");
  });

  it("a note stands in when an area has nothing waiting", () => {
    const g = elsewhereGroups([], ["brewery"], { business: "Today: $3,150 forecast" });
    expect(g.find((x) => x.area === "business")!.line).toBe("Today: $3,150 forecast");
  });

  it("no focus means no elsewhere", () => {
    expect(elsewhereGroups(items, [])).toEqual([]);
  });

  it("items from an area the person looks after are never listed (urgent ones stay in mine)", () => {
    const g = elsewhereGroups(items, ["kitchen"]);
    expect(g.some((x) => x.area === "kitchen")).toBe(false);
    expect(g.flatMap((x) => x.items).map((i) => i.key)).toEqual(["kegs.out"]);
  });
});

describe("showSection", () => {
  it("everything shows with no focus", () => {
    for (const s of ["yesterday", "today", "team", "insight", "notes", "wrap", "lastWeek", "kegs", "forecast", "brewery"] as const) expect(showSection(s, [])).toBe(true);
  });
  it("brewery only: the brewery card, nothing from the business side", () => {
    expect(showSection("brewery", ["brewery"])).toBe(true);
    expect(showSection("yesterday", ["brewery"])).toBe(false);
    expect(showSection("today", ["brewery"])).toBe(false);
    expect(showSection("kegs", ["brewery"])).toBe(false);
  });
  it("today's forecast and crew show for business or people", () => {
    expect(showSection("today", ["people"])).toBe(true);
    expect(showSection("today", ["business"])).toBe(true);
    expect(showSection("team", ["people"])).toBe(true);
    expect(showSection("wrap", ["people"])).toBe(false);
  });
  it("the Brewery card only shows when brewery is chosen (no focus keeps today's Overview)", () => {
    expect(overviewBlocks([])).not.toContain("brewery");
  });
});

describe("overviewBlocks", () => {
  it("no focus: today's Overview, unchanged", () => {
    expect(overviewBlocks([])).toEqual(["today", "needs", "notes", "insights", "week", "costs", "deliveries"]);
  });
  it("brewery only: Needs you, the Brewery card, then Elsewhere", () => {
    expect(overviewBlocks(["brewery"])).toEqual(["needs", "brewery", "elsewhere"]);
  });
  it("business then kitchen: Today leads, Needs you right under it, then the rest in their order", () => {
    expect(overviewBlocks(["business", "kitchen"])).toEqual(["today", "needs", "notes", "insights", "week", "costs", "deliveries", "elsewhere"]);
  });
  it("kitchen then business: kitchen sections first", () => {
    expect(overviewBlocks(["kitchen", "business"])).toEqual(["needs", "costs", "deliveries", "today", "notes", "insights", "week", "elsewhere"]);
  });
  it("areas with no Overview section of their own still get Needs you and Elsewhere", () => {
    expect(overviewBlocks(["people", "online"])).toEqual(["needs", "elsewhere"]);
  });
  it("all six chosen: everything, plus the Brewery card, and no Elsewhere", () => {
    expect(overviewBlocks([...FOCUS_IDS])).toEqual(["today", "needs", "notes", "insights", "week", "brewery", "costs", "deliveries"]);
  });
});
