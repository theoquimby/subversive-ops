import { describe, expect, it } from "vitest";
import { accountMap, buildBill, fallbackBillNo, qboBillsCsv, qboJournalCsv, salesJournal, xeroBillsCsv, xeroJournalCsv } from "../accountingExport";

const accounts = accountMap({ billsByCategory: { Produce: "COGS:Food" }, salesByCategory: { Beer: "Sales:Beer" }, termsDays: 14 });
const inv = {
  id: "i1",
  supplier: "Hudson Valley Foodservice",
  supplierEmail: "orders@hvf.example",
  invoiceNumber: "A-100",
  invoiceDate: "2026-11-02",
  total: 105.5,
  lines: [
    { description: "Romaine, 24 ct", sku: "R24", qty: 2, unitPrice: 30, category: "Produce" },
    { description: "Fryer oil", sku: null, qty: 1, unitPrice: 40, category: "Dry goods" },
  ],
};

describe("accountMap", () => {
  it("fills defaults and rejects bad terms", () => {
    const a = accountMap({ termsDays: -3, salesDefault: "  " } as never);
    expect(a.termsDays).toBe(30);
    expect(a.salesDefault).toBe("Sales");
  });
});

describe("bills", () => {
  it("rolls lines up by account and adds the gap to the total as other charges", () => {
    const b = buildBill(inv, accounts);
    expect(b.dueDate).toBe("2026-11-16");
    expect(b.lines.map((l) => [l.account, l.amount])).toEqual([["COGS:Food", 60], ["Cost of Goods Sold", 40], ["Cost of Goods Sold", 5.5]]);
    expect(b.total).toBe(105.5);
  });
  it("keeps each line when not summarizing and names bills without a number", () => {
    const b = buildBill({ ...inv, invoiceNumber: null, total: null }, accounts, false);
    expect(b.lines).toHaveLength(2);
    expect(b.billNo).toBe(fallbackBillNo("Hudson Valley Foodservice", "2026-11-02"));
    expect(b.billNo).toBe("HVF-20261102");
  });
  it("writes QuickBooks and Xero bill CSVs", () => {
    const b = buildBill(inv, accounts);
    const q = qboBillsCsv([b], 14).split("\r\n");
    expect(q[0]).toBe("Bill No,Supplier,Bill Date,Due Date,Terms,Memo,Account,Line Description,Line Amount");
    expect(q[1]).toBe("A-100,Hudson Valley Foodservice,11/02/2026,11/16/2026,Net 14,Subversive Ops invoice A-100,COGS:Food,Hudson Valley Foodservice — 1 line,60.00");
    const x = xeroBillsCsv([buildBill(inv, accounts, false)]).split("\r\n");
    expect(x[0].startsWith("*ContactName,EmailAddress,*InvoiceNumber")).toBe(true);
    expect(x[1]).toContain("Romaine, 24 ct (#R24)");
    expect(x[1]).toContain(",2,30,COGS:Food,Tax Exempt,USD");
  });
});

describe("sales journal", () => {
  const days = [
    { date: "2026-11-10", byCategory: [{ category: "Food", net: 1000 }, { category: "Beer", net: 800.255 }], tax: 144.02, tips: 210 },
    { date: "2026-11-11", byCategory: [], tax: null, tips: null },
  ];
  it("balances each day and skips empty ones", () => {
    const j = salesJournal(days, accounts);
    expect(j).toHaveLength(1);
    const debit = j[0].reduce((s, l) => s + l.debit, 0);
    const credit = j[0].reduce((s, l) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(j[0][0]).toMatchObject({ account: "Undeposited Funds", debit: 2154.28 });
    expect(j[0].find((l) => l.account === "Sales:Beer")?.credit).toBe(800.26);
  });
  it("writes QuickBooks and Xero journal CSVs", () => {
    const j = salesJournal(days, accounts);
    const q = qboJournalCsv(j).split("\r\n");
    expect(q[1]).toBe("SALES-20261110,11/10/2026,Undeposited Funds,2154.28,,Takings for the day,");
    const x = xeroJournalCsv(j).split("\r\n");
    expect(x[1]).toBe("Daily sales 2026-11-10,11/10/2026,Takings for the day,Undeposited Funds,Tax Exempt,2154.28");
    expect(x[2]).toContain("-1000.00");
  });
});
