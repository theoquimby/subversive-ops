import { describe, expect, it } from "vitest";
import { accountantPack, packFileName, type PackInput } from "../accountantPack";

const input: PackInput = {
  business: "Subversive",
  period: { from: "2026-10-01", to: "2026-10-31", label: "Oct 2026" },
  generatedAt: "2026-11-15",
  pnl: { sales: 100_000, foodSales: 40_000, beverageSales: 55_000, otherSales: 5_000, theoreticalCogs: 26_000, actualCogs: 28_000, labor: 30_000, cardFees: 2_400, discounts: 2_000, fixedShare: 9_000, days: 31 },
  days: [
    { date: "2026-10-01", orders: 120, pnlSales: 3000, allSales: 3050, food: 1200, beverage: 1800, other: 50, discounts: 60, tax: 240, taxable: 3000, nonTaxable: 50, tips: 500, cardVolume: 3400, cardFeesCharged: 90, feesReturned: 1, cardFees: 89 },
    { date: "2026-10-02", orders: null, pnlSales: 0, allSales: 0, food: 0, beverage: 0, other: 0, discounts: null, tax: null, taxable: null, nonTaxable: null, tips: null, cardVolume: null, cardFeesCharged: null, feesReturned: null, cardFees: null },
  ],
  tax: { jurisdiction: "Greene County, NY", rate: 0.08, filing: "quarterly", dueNote: null, byMonth: [{ month: "2026-10", sales: 3050, taxable: 3000, nonTaxable: 50, tax: 240 }], totals: { sales: 3050, taxable: 3000, nonTaxable: 50, tax: 240 }, missingDays: 0 },
  tips: { collected: 500, allocated: 400, paid: 300, owed: 200, pools: [{ start: "2026-09-28", end: "2026-10-04", card: 700 }], byDay: [{ date: "2026-10-01", card: 500 }] },
  inventory: { end: { asOf: "2026-10-31", total: 12_000, food: 5_000, beverage: 7_000, items: [{ name: "IPA keg", category: "Beer", group: "Beverage", countedOn: "2026-10-31", qty: 58670, unit: "ml", unitCost: 0.0035, value: 205.35 }] }, start: { asOf: "2026-09-30", total: 11_000 }, purchases: 29_000, actualCogs: 28_000 },
  invoices: [{ date: "2026-10-03", supplier: "Sysco", number: "A1", kind: "invoice", status: "APPROVED", total: 1234.5, due: "2026-11-02", quickbooks: "Sent" }],
  comps: { byReason: [{ label: "Comp", cls: "Comp", lines: 4, amount: 40 }], byClass: [{ label: "Comp", amount: 40 }], total: 40 },
  journal: [{ key: "day:2026-10-01", date: "2026-10-01", account: "Food Sales", posting: "Credit", amount: 1230, description: "Square 2026-10-01: food sales", state: "In QuickBooks" }],
};

describe("accountant pack", () => {
  const sheets = accountantPack(input);
  const by = Object.fromEntries(sheets.map((s) => [s.name, s]));

  it("has a tab per subject, with Excel-safe names", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "P&L", "Sales by day", "Sales tax", "Tips", "Inventory", "Invoices", "Card fees", "Comps & discounts", "Sales journal"]);
    for (const s of sheets) {
      expect(s.name.length).toBeLessThanOrEqual(31);
      expect(s.name).not.toMatch(/[\\/?*[\]:]/);
    }
  });

  it("labels every tab with the business and period, then a header row", () => {
    for (const s of sheets) {
      expect(String(s.rows[1][0])).toContain("Subversive · Oct 2026 (10/01/2026 to 10/31/2026)");
      expect(s.rows[s.header].every((c) => typeof c === "string" && c.length > 0)).toBe(true);
      expect(s.widths.length).toBeGreaterThanOrEqual(s.rows[s.header].length);
    }
  });

  it("keeps money as numbers and totals the days", () => {
    const d = by["Sales by day"];
    const total = d.rows.at(-1)!;
    expect(total[0]).toBe("Total");
    expect(total[3]).toBe(3000);
    expect(total[9]).toBe(240);
    for (const col of d.money) for (const row of d.rows.slice(d.header + 1)) expect(row[col] == null || typeof row[col] === "number").toBe(true);
  });

  it("uses actual cost of goods for profit when there is one", () => {
    const pnl = by["P&L"];
    const profit = pnl.rows.find((r) => r[0] === "Profit before other overheads")!;
    expect(profit[1]).toBe(100_000 - 28_000 - 30_000 - 2_400 - 9_000);
  });

  it("explains the tax split and points to the accountant", () => {
    const text = by["Sales tax"].rows.flat().join(" ");
    expect(text).toContain("taxable = tax ÷ rate");
    expect(text).toMatch(/check with your accountant/);
    expect(by["Sales tax"].rows[0][0]).toBe("Sales tax · Greene County, NY · 8% combined (setting)");
  });

  it("only lists card fee days that are synced, and skips an empty journal", () => {
    expect(by["Card fees"].rows.filter((r) => r[0] === "10/02/2026")).toHaveLength(0);
    expect(accountantPack({ ...input, journal: [] }).some((s) => s.name === "Sales journal")).toBe(false);
  });

  it("names the file after the period", () => {
    expect(packFileName({ from: "2026-10-01", to: "2026-10-31" })).toBe("subversive-month-end-2026-10.xlsx");
    expect(packFileName({ from: "2026-09-01", to: "2026-11-30" })).toBe("subversive-month-end-2026-09-01-to-2026-11-30.xlsx");
  });
});
