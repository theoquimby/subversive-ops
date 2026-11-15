/**
 * The accountant pack: one workbook, one tidy tab per subject, built from
 * plain rows. Pure — the server turns the sheets into an .xlsx file.
 *
 * Every tab starts with a title row and a "period" row, then a header row,
 * then data. Money columns are numbers (formatted as currency by the writer),
 * never pre-formatted strings, so the accountant can add them up.
 */

import { WEEKDAYS, weekday, type ISODate } from "./dates";

export type Cell = string | number | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Column widths in characters. */
  widths: number[];
  /** Zero-based columns holding dollars (formatted $#,##0.00). */
  money: number[];
  /** Zero-based columns holding percentages as fractions. */
  percent?: number[];
  /** Row index of the header row (bold in spirit; the writer freezes nothing, but tests check it). */
  header: number;
}

export interface PackDay {
  date: ISODate;
  orders: number | null;
  pnlSales: number;
  allSales: number;
  food: number;
  beverage: number;
  other: number;
  discounts: number | null;
  tax: number | null;
  taxable: number | null;
  nonTaxable: number | null;
  tips: number | null;
  cardVolume: number | null;
  cardFeesCharged: number | null;
  feesReturned: number | null;
  cardFees: number | null;
}

export interface PackInput {
  business: string;
  period: { from: ISODate; to: ISODate; label: string };
  generatedAt: string;
  pnl: {
    sales: number;
    foodSales: number;
    beverageSales: number;
    otherSales: number;
    theoreticalCogs: number;
    actualCogs: number | null;
    labor: number;
    cardFees: number | null;
    discounts: number | null;
    fixedShare: number | null;
    days: number;
  };
  days: PackDay[];
  tax: {
    jurisdiction: string;
    rate: number;
    filing: string;
    dueNote: string | null;
    byMonth: { month: string; sales: number; taxable: number; nonTaxable: number; tax: number }[];
    totals: { sales: number; taxable: number; nonTaxable: number; tax: number };
    missingDays: number;
  };
  tips: { collected: number; allocated: number; paid: number; owed: number; pools: { start: ISODate; end: ISODate; card: number }[]; byDay: { date: ISODate; card: number }[] };
  inventory: {
    end: { asOf: ISODate; total: number; food: number; beverage: number; items: { name: string; category: string; group: string; countedOn: ISODate; qty: number; unit: string; unitCost: number | null; value: number }[] };
    start: { asOf: ISODate; total: number };
    purchases: number;
    actualCogs: number | null;
  };
  invoices: { date: ISODate; supplier: string; number: string | null; kind: string; status: string; total: number | null; due: ISODate | null; quickbooks: string }[];
  comps: { byReason: { label: string; cls: string; lines: number; amount: number }[]; byClass: { label: string; amount: number }[]; total: number } | null;
  journal: { key: string; date: ISODate; account: string; posting: string; amount: number; description: string; state: string }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: (number | null)[]) => r2(xs.reduce<number>((s, x) => s + (x ?? 0), 0));
const usDate = (d: ISODate) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const day = (d: ISODate) => WEEKDAYS[weekday(d)];

function sheet(name: string, title: string, input: PackInput, header: string[], data: Cell[][], opts: { widths?: number[]; money?: number[]; percent?: number[]; notes?: string[]; totals?: Cell[] } = {}): Sheet {
  const top: Cell[][] = [[title], [`${input.business} · ${input.period.label} (${usDate(input.period.from)} to ${usDate(input.period.to)})`]];
  for (const n of opts.notes ?? []) top.push([n]);
  top.push([]);
  const headerIdx = top.length;
  const rows = [...top, header, ...data, ...(opts.totals ? [opts.totals] : [])];
  return { name: name.slice(0, 31), rows, header: headerIdx, widths: opts.widths ?? header.map((h) => Math.max(12, h.length + 2)), money: opts.money ?? [], percent: opts.percent };
}

/** The workbook's tabs, in the order an accountant reads them. */
export function accountantPack(input: PackInput): Sheet[] {
  const p = input.pnl;
  const cogs = p.actualCogs ?? p.theoreticalCogs;
  const profit = r2(p.sales - cogs - p.labor - (p.cardFees ?? 0) - (p.fixedShare ?? 0));
  const sheets: Sheet[] = [];

  sheets.push(
    sheet(
      "Summary",
      "Month-end summary",
      input,
      ["Item", "Amount", "Where it comes from"],
      [
        ["Net sales", p.sales, "Square, after discounts, before tax and tips (items marked Ignore left out)"],
        ["Sales tax collected", input.tax.totals.tax, "Square, per day"],
        ["Tips collected", sum(input.days.map((d) => d.tips)), "Square, per day (card and order tips)"],
        ["Card tips not yet paid through payroll", input.tips.owed, "Tips tab"],
        ["Card processing fees", p.cardFees, "Square payments, less fees returned on refunds"],
        ["Comps & discounts", p.discounts, "Square orders"],
        ["Purchases (approved invoices)", input.inventory.purchases, "Invoices tab"],
        ["Inventory at start", input.inventory.start.total, `Counts on or before ${usDate(input.inventory.start.asOf)}`],
        ["Inventory at end", input.inventory.end.total, `Counts on or before ${usDate(input.inventory.end.asOf)}`],
        ["Actual cost of goods", p.actualCogs, "Opening + purchases − closing inventory"],
        ["Labor (wages + employer burden)", p.labor, "Timecards × pay rates"],
      ],
      {
        widths: [40, 16, 70],
        money: [1],
        notes: [`Made by Subversive Ops on ${input.generatedAt}. Figures come from Square, counts, invoices and timecards; check them against the bank and QuickBooks before filing.`],
      },
    ),
  );

  sheets.push(
    sheet(
      "P&L",
      "Profit and loss (management view)",
      input,
      ["Line", "Amount", "% of sales", "Note"],
      [
        ["Food sales", p.foodSales, p.sales ? p.foodSales / p.sales : null, "Items linked to food recipes"],
        ["Beverage sales", p.beverageSales, p.sales ? p.beverageSales / p.sales : null, "Beer and other drinks"],
        ["Other sales", p.otherSales, p.sales ? p.otherSales / p.sales : null, "Retail and items not linked to a recipe"],
        ["Net sales", p.sales, 1, `${p.days} days`],
        [p.actualCogs != null ? "Cost of goods (actual, from counts)" : "Cost of goods (theoretical)", cogs, p.sales ? cogs / p.sales : null, p.actualCogs != null ? `Theoretical was ${r2(p.theoreticalCogs).toFixed(2)}` : "No count at both ends of the period, so recipe cost × items sold"],
        ["Labor", p.labor, p.sales ? p.labor / p.sales : null, "Wages plus employer burden"],
        ["Card fees", p.cardFees, p.sales && p.cardFees != null ? p.cardFees / p.sales : null, "Square processing fees"],
        ["Fixed costs (share)", p.fixedShare, p.sales && p.fixedShare != null ? p.fixedShare / p.sales : null, "Settings → Money, spread over the days"],
        ["Profit before other overheads", profit, p.sales ? profit / p.sales : null, "Not a tax figure"],
        ["Comps & discounts (memo)", p.discounts, p.sales && p.discounts != null ? p.discounts / p.sales : null, "Already out of net sales"],
      ],
      { widths: [38, 16, 12, 60], money: [1], percent: [2] },
    ),
  );

  const d = input.days;
  sheets.push(
    sheet(
      "Sales by day",
      "Sales by day",
      input,
      ["Date", "Day", "Orders", "Net sales", "All sales incl. ignored", "Food", "Beverage", "Other", "Comps & discounts", "Sales tax", "Tips", "Card payments", "Card fees"],
      d.map((x) => [usDate(x.date), day(x.date), x.orders, x.pnlSales, x.allSales, x.food, x.beverage, x.other, x.discounts, x.tax, x.tips, x.cardVolume, x.cardFees]),
      {
        widths: [12, 6, 8, 13, 14, 12, 12, 12, 13, 12, 12, 14, 12],
        money: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        totals: ["Total", "", sum(d.map((x) => x.orders)), sum(d.map((x) => x.pnlSales)), sum(d.map((x) => x.allSales)), sum(d.map((x) => x.food)), sum(d.map((x) => x.beverage)), sum(d.map((x) => x.other)), sum(d.map((x) => x.discounts)), sum(d.map((x) => x.tax)), sum(d.map((x) => x.tips)), sum(d.map((x) => x.cardVolume)), sum(d.map((x) => x.cardFees))],
      },
    ),
  );

  const t = input.tax;
  sheets.push(
    sheet(
      "Sales tax",
      `Sales tax · ${t.jurisdiction} · ${(t.rate * 100).toFixed(3).replace(/\.?0+$/, "")}% combined (setting)`,
      input,
      ["Month / date", "Sales", "Taxable (worked out)", "Non-taxable (worked out)", "Tax collected"],
      [
        ...t.byMonth.map((m): Cell[] => [m.month, m.sales, m.taxable, m.nonTaxable, m.tax]),
        ["Total", t.totals.sales, t.totals.taxable, t.totals.nonTaxable, t.totals.tax],
        [],
        ["By day"],
        ...d.map((x): Cell[] => [usDate(x.date), x.allSales, x.taxable, x.nonTaxable, x.tax]),
      ],
      {
        widths: [16, 14, 20, 22, 14],
        money: [1, 2, 3, 4],
        notes: [
          "Square stores the tax collected per day, not which items were taxed, so taxable = tax ÷ rate and the rest is non-taxable.",
          `Filing: ${t.filing} (a setting).${t.dueNote ? ` ${t.dueNote}` : ""} Rates and periods are defaults to check with your accountant, not legal advice.`,
          ...(t.missingDays ? [`${t.missingDays} day(s) with sales have no tax stored and are left out of the taxable split.`] : []),
        ],
      },
    ),
  );

  const tp = input.tips;
  sheets.push(
    sheet(
      "Tips",
      "Tips payable (card tips)",
      input,
      ["Item", "Amount"],
      [
        ["Collected by card", tp.collected],
        ["In finalized tip pools", tp.allocated],
        ["Paid through payroll (approved pay periods)", tp.paid],
        ["Still owed at period end", tp.owed],
        [],
        ["Card tips by day", null],
        ...tp.byDay.map((x): Cell[] => [usDate(x.date), x.card]),
        [],
        ["Finalized tip pools (card tips)", null],
        ...tp.pools.map((x): Cell[] => [`${usDate(x.start)} to ${usDate(x.end)}`, x.card]),
      ],
      { widths: [44, 14], money: [1], notes: ["Pools that cross the period edge are counted by days. Paid = pool days inside an approved pay period."] },
    ),
  );

  const inv = input.inventory;
  sheets.push(
    sheet(
      "Inventory",
      `Inventory value at ${usDate(inv.end.asOf)}`,
      input,
      ["Ingredient", "Category", "Food / beverage", "Counted on", "Quantity", "Unit", "Cost per unit", "Value"],
      inv.end.items.map((x) => [x.name, x.category, x.group, usDate(x.countedOn), r2(x.qty * 1000) / 1000, x.unit, x.unitCost, x.value]),
      {
        widths: [32, 18, 14, 12, 12, 7, 14, 14],
        money: [7],
        notes: [
          `Each ingredient's latest count on or before the date, at prices on file for that date. Start of period (${usDate(inv.start.asOf)}): ${inv.start.total.toFixed(2)}. Purchases: ${inv.purchases.toFixed(2)}.`,
          inv.actualCogs != null ? `Actual cost of goods = ${inv.start.total.toFixed(2)} + ${inv.purchases.toFixed(2)} − ${inv.end.total.toFixed(2)} = ${inv.actualCogs.toFixed(2)}` : "Actual cost of goods needs a count at both ends of the period.",
        ],
        totals: ["Total", "", `Food ${inv.end.food.toFixed(2)} · Beverage ${inv.end.beverage.toFixed(2)}`, "", null, "", null, inv.end.total],
      },
    ),
  );

  sheets.push(
    sheet(
      "Invoices",
      "Supplier invoices dated in the period",
      input,
      ["Date", "Supplier", "Number", "Type", "Status", "Total", "Due", "QuickBooks"],
      input.invoices.map((x) => [usDate(x.date), x.supplier, x.number, x.kind === "receipt" ? "Receipt" : "Invoice", x.status === "APPROVED" ? "Approved" : "Not approved", x.total, x.due ? usDate(x.due) : "", x.quickbooks]),
      { widths: [12, 28, 16, 10, 14, 13, 12, 16], money: [5], totals: ["Total", "", "", "", "", sum(input.invoices.map((x) => x.total)), "", ""] },
    ),
  );

  sheets.push(
    sheet(
      "Card fees",
      "Card processing fees (Square)",
      input,
      ["Date", "Card payments", "Fees charged", "Fees returned", "Net fees", "Rate"],
      d.filter((x) => x.cardFees != null).map((x) => [usDate(x.date), x.cardVolume, x.cardFeesCharged, x.feesReturned, x.cardFees, x.cardVolume ? (x.cardFeesCharged ?? 0) / x.cardVolume : null]),
      {
        widths: [12, 15, 14, 14, 12, 8],
        money: [1, 2, 3, 4],
        percent: [5],
        totals: ["Total", sum(d.map((x) => (x.cardFees != null ? x.cardVolume : null))), sum(d.map((x) => x.cardFeesCharged)), sum(d.map((x) => x.feesReturned)), sum(d.map((x) => x.cardFees)), null],
      },
    ),
  );

  const c = input.comps;
  sheets.push(
    sheet(
      "Comps & discounts",
      "Comps & discounts (Square)",
      input,
      ["Reason", "Counts as", "Lines", "Amount"],
      c ? [...c.byReason.map((x): Cell[] => [x.label, x.cls, x.lines, x.amount]), [], ...c.byClass.map((x): Cell[] => [`All ${x.label.toLowerCase()}`, x.label, null, x.amount])] : [["Not synced from Square yet", "", null, null]],
      { widths: [30, 14, 8, 13], money: [3], totals: c ? ["Total", "", null, c.total] : undefined, notes: ["Already taken out of net sales. Items marked Ignore are left out."] },
    ),
  );

  if (input.journal.length) {
    sheets.push(
      sheet(
        "Sales journal",
        "Sales journal (as sent, or as it would be sent, to QuickBooks)",
        input,
        ["Entry", "Date", "Account", "Debit", "Credit", "Description", "Status"],
        input.journal.map((x) => [x.key, usDate(x.date), x.account, x.posting === "Debit" ? x.amount : null, x.posting === "Credit" ? x.amount : null, x.description, x.state]),
        { widths: [16, 12, 30, 12, 12, 48, 12], money: [3, 4] },
      ),
    );
  }
  return sheets;
}

/** "subversive-month-end-2026-10.xlsx" */
export const packFileName = (p: { from: ISODate; to: ISODate }) => {
  const sameMonth = p.from.slice(0, 7) === p.to.slice(0, 7) && p.from.endsWith("-01");
  return `subversive-month-end-${sameMonth ? p.from.slice(0, 7) : `${p.from}-to-${p.to}`}.xlsx`;
};
