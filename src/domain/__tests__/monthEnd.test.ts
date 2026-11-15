import { describe, expect, it } from "vitest";
import {
  actualCogs,
  addMonths,
  checklistProgress,
  closeChecklist,
  closePeriod,
  customPeriod,
  inventoryValue,
  lastFullMonth,
  latestCounts,
  monthEnd,
  monthPeriod,
  monthsIn,
  parseSalesTaxSettings,
  previousPeriod,
  recentQuarters,
  salesTaxReport,
  taxQuarter,
  tipsPayable,
  usualDueDate,
  type ChecklistInput,
} from "../monthEnd";

describe("periods", () => {
  it("does month arithmetic across years and leap Februaries", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(lastFullMonth("2026-11-15")).toBe("2026-10");
  });

  it("builds a month period", () => {
    expect(monthPeriod("2026-10")).toEqual({ kind: "month", from: "2026-10-01", to: "2026-10-31", toExclusive: "2026-11-01", label: "Oct 2026" });
  });

  it("finds NY sales tax quarters (Mar–May, Jun–Aug, Sep–Nov, Dec–Feb)", () => {
    expect(taxQuarter("2026-03-01")).toMatchObject({ from: "2026-03-01", to: "2026-05-31", label: "Mar–May 2026" });
    expect(taxQuarter("2026-08-31")).toMatchObject({ from: "2026-06-01", to: "2026-08-31", label: "Jun–Aug 2026" });
    expect(taxQuarter("2026-11-15")).toMatchObject({ from: "2026-09-01", to: "2026-11-30", label: "Sep–Nov 2026" });
    // Dec–Feb crosses the year, from either side.
    expect(taxQuarter("2026-12-10")).toMatchObject({ from: "2026-12-01", to: "2027-02-28", label: "Dec 2026 – Feb 2027" });
    expect(taxQuarter("2028-02-29")).toMatchObject({ from: "2027-12-01", to: "2028-02-29" });
  });

  it("supports calendar quarters as a setting", () => {
    expect(taxQuarter("2026-05-02", 1)).toMatchObject({ from: "2026-04-01", to: "2026-06-30" });
    expect(taxQuarter("2026-05-02", 99)).toMatchObject({ from: "2026-03-01" }); // junk falls back to March
  });

  it("gives a usual due date: the 20th after the period", () => {
    expect(usualDueDate("2026-11-30")).toBe("2026-12-20");
    expect(usualDueDate("2027-02-28")).toBe("2027-03-20");
  });

  it("reads the period from the query, defaulting to the last full month or quarter", () => {
    expect(closePeriod(undefined, "2026-11-15", {})).toMatchObject({ kind: "month", from: "2026-10-01" });
    expect(closePeriod("month", "2026-11-15", { month: "2026-13" })).toMatchObject({ from: "2026-10-01" });
    expect(closePeriod("quarter", "2026-11-15", {})).toMatchObject({ from: "2026-06-01", to: "2026-08-31" });
    expect(closePeriod("quarter", "2026-11-15", { quarter: "2026-10-04" })).toMatchObject({ from: "2026-09-01", to: "2026-11-30" });
    expect(closePeriod("custom", "2026-11-15", { from: "2026-10-20", to: "2026-10-05" })).toMatchObject({ from: "2026-10-05", to: "2026-10-20", toExclusive: "2026-10-21" });
    expect(closePeriod("custom", "2026-11-15", { from: "2020-01-01", to: "2026-10-31" }).from).toBe("2025-09-26");
  });

  it("steps back one period", () => {
    expect(previousPeriod(monthPeriod("2026-01")).from).toBe("2025-12-01");
    expect(previousPeriod(taxQuarter("2026-03-15"))).toMatchObject({ from: "2025-12-01", to: "2026-02-28" });
    expect(previousPeriod(customPeriod("2026-10-11", "2026-10-20"))).toMatchObject({ from: "2026-10-01", to: "2026-10-10" });
  });

  it("lists recent quarters and the months in a period", () => {
    expect(recentQuarters("2026-11-15", 3).map((q) => q.from)).toEqual(["2026-09-01", "2026-06-01", "2026-03-01"]);
    expect(monthsIn({ from: "2026-09-15", to: "2026-11-02" })).toEqual([
      { month: "2026-09", from: "2026-09-15", to: "2026-09-30" },
      { month: "2026-10", from: "2026-10-01", to: "2026-10-31" },
      { month: "2026-11", from: "2026-11-01", to: "2026-11-02" },
    ]);
  });
});

describe("sales tax", () => {
  it("defaults to 8% quarterly from March, and rejects junk", () => {
    expect(parseSalesTaxSettings(null)).toEqual({ rate: 0.08, filing: "quarterly", quarterStartMonth: 3, jurisdiction: "Greene County, NY" });
    expect(parseSalesTaxSettings({ rate: 0.0875, filing: "monthly", quarterStartMonth: 1, jurisdiction: " Catskill " })).toEqual({ rate: 0.0875, filing: "monthly", quarterStartMonth: 1, jurisdiction: "Catskill" });
    expect(parseSalesTaxSettings({ rate: 8, filing: "weekly", quarterStartMonth: 0 })).toMatchObject({ rate: 0.08, filing: "quarterly", quarterStartMonth: 3 });
  });

  it("splits taxable and non-taxable from the tax collected", () => {
    const r = salesTaxReport(
      [
        { date: "2026-10-01", sales: 1000, tax: 72 }, // 900 taxable, 100 not
        { date: "2026-10-02", sales: 500, tax: null }, // not stored
        { date: "2026-10-03", sales: 100, tax: 9 }, // 112.50 at 8% > sales: rate too low → capped
        { date: "2026-10-04", sales: 0, tax: null }, // closed, not "missing"
      ],
      0.08,
    );
    expect(r.rows[0]).toEqual({ date: "2026-10-01", sales: 1000, tax: 72, taxable: 900, nonTaxable: 100 });
    expect(r.rows[1].taxable).toBeNull();
    expect(r.rows[2]).toMatchObject({ taxable: 100, nonTaxable: 0 });
    expect(r.missingTax).toEqual(["2026-10-02"]);
    expect(r.overRate).toEqual(["2026-10-03"]);
    expect(r.totals).toMatchObject({ sales: 1600, tax: 81, taxable: 1000, nonTaxable: 100 });
    expect(r.totals.effectiveRate).toBeCloseTo(81 / 1600);
  });
});

describe("inventory value and actual cost of goods", () => {
  const lines = [
    { ingredientId: "beef", qtyBase: 1000, countedOn: "2026-09-30" },
    { ingredientId: "beef", qtyBase: 2000, countedOn: "2026-10-31" },
    { ingredientId: "beef", qtyBase: 5000, countedOn: "2026-11-02" }, // after the as-of date
    { ingredientId: "ipa", qtyBase: 58_670, countedOn: "2026-10-30" },
    { ingredientId: "salt", qtyBase: 500, countedOn: "2026-08-01" }, // stale but still the latest
    { ingredientId: "saffron", qtyBase: 2, countedOn: "2026-10-31" }, // no price
    { ingredientId: "gone", qtyBase: 3, countedOn: "2026-10-31" }, // ingredient deleted
  ];
  const info = (id: string) =>
    ({
      beef: { name: "Ground beef", category: "Meat", group: "food" as const, baseUnit: "g", unitCost: 0.011 },
      ipa: { name: "House IPA keg", category: "Beer", group: "beverage" as const, baseUnit: "ml", unitCost: 0.0035 },
      salt: { name: "Salt", category: "Dry goods", group: "food" as const, baseUnit: "g", unitCost: 0.002 },
      saffron: { name: "Saffron", category: "Spices", group: "food" as const, baseUnit: "g", unitCost: null },
    })[id] ?? null;

  it("takes each ingredient's latest count on or before the date", () => {
    expect(latestCounts(lines, "2026-10-31").get("beef")?.qtyBase).toBe(2000);
    expect(latestCounts(lines, "2026-10-15").get("beef")?.qtyBase).toBe(1000);
    expect(latestCounts(lines, "2026-09-01").has("beef")).toBe(false);
  });

  it("values the count at the date's prices, split food and beverage", () => {
    const v = inventoryValue(lines, "2026-10-31", info);
    expect(v.total).toBe(22 + 205.35 + 1);
    expect(v.food).toBe(23);
    expect(v.beverage).toBe(205.35);
    expect(v.unpriced).toEqual(["Saffron"]);
    expect(v.stale).toBe(1);
    expect(v.oldest).toBe("2026-08-01");
    expect(v.newest).toBe("2026-10-31");
    expect(v.items[0].name).toBe("House IPA keg");
  });

  it("works out actual cost of goods", () => {
    expect(actualCogs(10_000, 25_000.5, 9_500.25)).toBe(25_500.25);
  });
});

describe("tips payable", () => {
  const collected = new Map([
    ["2026-10-01", 100],
    ["2026-10-02", 100],
    ["2026-10-03", 50],
  ]);
  it("compares card tips collected with what payroll paid", () => {
    // Pool Sep 30 – Oct 2 (3 days, $300 card) → $100/day; Oct 3 not pooled.
    const t = tipsPayable(collected, [{ start: "2026-09-30", end: "2026-10-02", card: 300 }], [{ start: "2026-09-28", end: "2026-10-01" }], "2026-10-01", "2026-10-03");
    expect(t).toEqual({ collected: 250, allocated: 200, paid: 100, owed: 150, unpooled: ["2026-10-03"], unpaid: ["2026-10-02"] });
  });
  it("is all owed with no pools", () => {
    expect(tipsPayable(collected, [], [], "2026-10-01", "2026-10-31")).toMatchObject({ collected: 250, paid: 0, owed: 250 });
  });
});

describe("closing checklist", () => {
  const base: ChecklistInput = {
    period: { from: "2026-10-01", to: "2026-10-31" },
    today: "2026-11-15",
    invoices: { inPeriod: 12, unapproved: 0 },
    quickbooks: { waiting: 0, failed: 0 },
    countDates: ["2026-11-01", "2026-09-30"],
    tips: { daysWithTips: 30, unpooled: 0 },
    payroll: { uncoveredDays: 0 },
    sales: { daysWithoutSales: 0, feesMissing: 0, taxMissing: 0 },
    journal: null,
  };
  it("is all done when everything is in", () => {
    const items = closeChecklist(base);
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ["invoices", "done"],
      ["quickbooks", "done"],
      ["count", "done"],
      ["tips", "done"],
      ["payroll", "done"],
      ["sales", "done"],
    ]);
    expect(checklistProgress(items)).toEqual({ done: 6, total: 6, open: 0 });
  });
  it("says what's left, with links", () => {
    const items = closeChecklist({
      ...base,
      invoices: { inPeriod: 12, unapproved: 2 },
      quickbooks: null,
      countDates: ["2026-10-20"],
      tips: { daysWithTips: 30, unpooled: 4 },
      payroll: { uncoveredDays: 10 },
      sales: { daysWithoutSales: 4, feesMissing: 2, taxMissing: 0 },
      journal: { notSent: 3, changed: 1, notReady: 0 },
    });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.invoices).toMatchObject({ status: "todo", detail: "2 invoices still to check and approve." });
    expect(by.quickbooks.status).toBe("na");
    expect(by.count).toMatchObject({ status: "todo", href: "/count" });
    expect(by.count.detail).toContain("Last count was Oct 20. Count within 3 days of Oct 31");
    expect(by.tips.detail).toBe("4 days with card tips aren't in a finalized tip pool.");
    expect(by.payroll.status).toBe("todo");
    expect(by.sales).toMatchObject({ status: "todo", detail: "Card fees missing on 2 days. Import those days again from Square." });
    expect(by.journal).toMatchObject({ status: "todo", detail: "3 entries to send, 1 changed since sent." });
    expect(checklistProgress(items).open).toBe(6);
  });
  it("doesn't nag about a count before the month is near its end", () => {
    const items = closeChecklist({ ...base, period: { from: "2026-11-01", to: "2026-11-30" }, countDates: [] });
    expect(items.find((i) => i.id === "count")?.status).toBe("na");
  });
});
