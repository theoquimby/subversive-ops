/**
 * Accounting exports: approved supplier invoices as bills (QuickBooks Online
 * and Xero import formats) and a daily sales journal.
 *
 * Pure: callers pass plain rows and an account map; out come CSV strings.
 * Amounts are rounded to cents per line, and a bill whose lines don't add up to
 * the invoice total gets an "Other charges" line so the bill matches the paper.
 */

import { addDays, ISODate } from "./dates";

// ---- Accounts --------------------------------------------------------------------------

export interface AccountMap {
  /** Expense account per ingredient category; anything unmapped → `billsDefault`. */
  billsByCategory: Record<string, string>;
  billsDefault: string;
  /** Delivery fees, tax, deposits — the gap between lines and invoice total. */
  billsOther: string;
  /** Income account per revenue (recipe) category; unmapped → `salesDefault`. */
  salesByCategory: Record<string, string>;
  salesDefault: string;
  salesTax: string;
  tips: string;
  /** Where the day's takings land before the bank deposit. */
  clearing: string;
  /** Payment terms for due dates, in days. */
  termsDays: number;
}

export const DEFAULT_ACCOUNTS: AccountMap = {
  billsByCategory: {},
  billsDefault: "Cost of Goods Sold",
  billsOther: "Cost of Goods Sold",
  salesByCategory: {},
  salesDefault: "Sales",
  salesTax: "Sales Tax Payable",
  tips: "Tips Payable",
  clearing: "Undeposited Funds",
  termsDays: 30,
};

/** Merge a saved (possibly partial or stale) map over the defaults. */
export function accountMap(saved: Partial<AccountMap> | null | undefined): AccountMap {
  const s = saved ?? {};
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
  const rec = (v: unknown) => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string" && x.trim()).map(([k, x]) => [k, (x as string).trim()])) : {});
  const terms = Number(s.termsDays);
  return {
    billsByCategory: rec(s.billsByCategory),
    billsDefault: str(s.billsDefault, DEFAULT_ACCOUNTS.billsDefault),
    billsOther: str(s.billsOther, DEFAULT_ACCOUNTS.billsOther),
    salesByCategory: rec(s.salesByCategory),
    salesDefault: str(s.salesDefault, DEFAULT_ACCOUNTS.salesDefault),
    salesTax: str(s.salesTax, DEFAULT_ACCOUNTS.salesTax),
    tips: str(s.tips, DEFAULT_ACCOUNTS.tips),
    clearing: str(s.clearing, DEFAULT_ACCOUNTS.clearing),
    termsDays: Number.isInteger(terms) && terms >= 0 && terms <= 365 ? terms : DEFAULT_ACCOUNTS.termsDays,
  };
}

// ---- CSV helpers ---------------------------------------------------------------------

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export const cents = (n: number) => Math.round(n * 100) / 100;
const amt = (n: number) => cents(n).toFixed(2);
/** US date as QuickBooks and US Xero orgs expect it. */
export const usDate = (d: ISODate) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;

// ---- Bills -------------------------------------------------------------------------------

export interface BillLineInput {
  description: string;
  sku: string | null;
  qty: number;
  unitPrice: number;
  /** Ingredient category of the matched product, if any. */
  category: string | null;
}

export interface BillInput {
  id: string;
  supplier: string;
  supplierEmail: string | null;
  invoiceNumber: string | null;
  invoiceDate: ISODate;
  total: number | null;
  lines: BillLineInput[];
}

export interface BillLine {
  account: string;
  description: string;
  qty: number;
  unitAmount: number;
  amount: number;
}

export interface Bill {
  id: string;
  supplier: string;
  supplierEmail: string | null;
  billNo: string;
  date: ISODate;
  dueDate: ISODate;
  lines: BillLine[];
  total: number;
}

/** Bill number for invoices typed in without one: supplier initials + date, so re-imports stay recognisable. */
export function fallbackBillNo(supplier: string, date: ISODate) {
  const initials = supplier.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").replace(/[^A-Z0-9]/g, "").slice(0, 4) || "INV";
  return `${initials}-${date.replace(/-/g, "")}`;
}

/**
 * Turn an approved invoice into a bill. With `summarize`, lines are rolled up
 * to one line per expense account (cleaner ledgers); otherwise each invoice
 * line is kept.
 */
export function buildBill(inv: BillInput, accounts: AccountMap, summarize = true): Bill {
  const accountFor = (cat: string | null) => (cat && accounts.billsByCategory[cat]) || accounts.billsDefault;
  let lines: BillLine[];
  if (summarize) {
    const by = new Map<string, { amount: number; n: number }>();
    for (const l of inv.lines) {
      const a = accountFor(l.category);
      const cur = by.get(a) ?? { amount: 0, n: 0 };
      cur.amount += l.qty * l.unitPrice;
      cur.n++;
      by.set(a, cur);
    }
    lines = [...by].map(([account, v]) => ({ account, description: `${inv.supplier} — ${v.n} line${v.n === 1 ? "" : "s"}`, qty: 1, unitAmount: cents(v.amount), amount: cents(v.amount) }));
  } else {
    lines = inv.lines.map((l) => ({
      account: accountFor(l.category),
      description: `${l.description}${l.sku ? ` (#${l.sku})` : ""}`,
      qty: l.qty,
      unitAmount: l.unitPrice,
      amount: cents(l.qty * l.unitPrice),
    }));
  }
  const linesTotal = cents(lines.reduce((s, l) => s + l.amount, 0));
  if (inv.total != null && Math.abs(cents(inv.total) - linesTotal) >= 0.01) {
    const gap = cents(inv.total - linesTotal);
    lines.push({ account: accounts.billsOther, description: "Other charges (fees, tax, deposits, rounding)", qty: 1, unitAmount: gap, amount: gap });
  }
  return {
    id: inv.id,
    supplier: inv.supplier,
    supplierEmail: inv.supplierEmail,
    billNo: inv.invoiceNumber?.trim() || fallbackBillNo(inv.supplier, inv.invoiceDate),
    date: inv.invoiceDate,
    dueDate: addDays(inv.invoiceDate, accounts.termsDays),
    lines,
    total: cents(lines.reduce((s, l) => s + l.amount, 0)),
  };
}

/** QuickBooks Online "Import bills" CSV: one row per bill line, grouped by Bill No. */
export function qboBillsCsv(bills: readonly Bill[], termsDays: number): string {
  const rows: (string | number)[][] = [["Bill No", "Supplier", "Bill Date", "Due Date", "Terms", "Memo", "Account", "Line Description", "Line Amount"]];
  for (const b of bills) {
    for (const l of b.lines) rows.push([b.billNo, b.supplier, usDate(b.date), usDate(b.dueDate), termsDays ? `Net ${termsDays}` : "Due on receipt", `Subversive Ops invoice ${b.billNo}`, l.account, l.description, amt(l.amount)]);
  }
  return toCsv(rows);
}

/** Xero "Import bills" (accounts payable) CSV. Required columns carry Xero's asterisk. */
export function xeroBillsCsv(bills: readonly Bill[], taxType = "Tax Exempt"): string {
  const rows: (string | number)[][] = [["*ContactName", "EmailAddress", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType", "Currency"]];
  for (const b of bills) {
    for (const l of b.lines) {
      // Xero recomputes qty × unit; keep the line total exact by billing odd amounts as 1 × amount.
      const exact = Math.abs(cents(l.qty * l.unitAmount) - l.amount) < 0.005;
      rows.push([b.supplier, b.supplierEmail ?? "", b.billNo, "Subversive Ops", usDate(b.date), usDate(b.dueDate), l.description, exact ? l.qty : 1, exact ? l.unitAmount : amt(l.amount), l.account, taxType, "USD"]);
    }
  }
  return toCsv(rows);
}

// ---- Daily sales journal ---------------------------------------------------------------

export interface SalesDay {
  date: ISODate;
  /** Net sales (after discounts, before tax and tips) by revenue category. */
  byCategory: { category: string; net: number }[];
  tax: number | null;
  tips: number | null;
}

export interface JournalLine {
  date: ISODate;
  account: string;
  debit: number;
  credit: number;
  description: string;
}

/**
 * One balanced journal per day: credit income per revenue category, sales tax
 * and tips; debit the clearing account for the total taken.
 */
export function salesJournal(days: readonly SalesDay[], accounts: AccountMap): JournalLine[][] {
  return days
    .map((d) => {
      const credits = new Map<string, { amount: number; description: string }>();
      const add = (account: string, amount: number, description: string) => {
        if (Math.abs(cents(amount)) < 0.005) return;
        const cur = credits.get(account) ?? { amount: 0, description };
        cur.amount += amount;
        credits.set(account, cur);
      };
      for (const c of d.byCategory) add(accounts.salesByCategory[c.category] || accounts.salesDefault, c.net, `Net sales — ${c.category}`);
      if (d.tax) add(accounts.salesTax, d.tax, "Sales tax collected");
      if (d.tips) add(accounts.tips, d.tips, "Card tips owed to staff");
      const lines: JournalLine[] = [...credits].map(([account, v]) => ({
        date: d.date,
        account,
        debit: v.amount < 0 ? cents(-v.amount) : 0,
        credit: v.amount > 0 ? cents(v.amount) : 0,
        description: v.description,
      }));
      if (lines.length === 0) return [];
      const net = cents(lines.reduce((s, l) => s + l.credit - l.debit, 0));
      lines.unshift({ date: d.date, account: accounts.clearing, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, description: "Takings for the day" });
      return lines;
    })
    .filter((j) => j.length > 0);
}

/** QuickBooks Online journal entry import CSV (one Journal No per day). */
export function qboJournalCsv(journals: readonly JournalLine[][]): string {
  const rows: (string | number)[][] = [["Journal No", "Journal Date", "Account", "Debits", "Credits", "Description", "Name"]];
  for (const j of journals) {
    const no = `SALES-${j[0].date.replace(/-/g, "")}`;
    for (const l of j) rows.push([no, usDate(l.date), l.account, l.debit ? amt(l.debit) : "", l.credit ? amt(l.credit) : "", l.description, ""]);
  }
  return toCsv(rows);
}

/** Xero manual journal import CSV: debits positive, credits negative. */
export function xeroJournalCsv(journals: readonly JournalLine[][], taxRate = "Tax Exempt"): string {
  const rows: (string | number)[][] = [["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount"]];
  for (const j of journals) {
    const narration = `Daily sales ${j[0].date}`;
    for (const l of j) rows.push([narration, usDate(l.date), l.description, l.account, taxRate, amt(l.debit - l.credit)]);
  }
  return toCsv(rows);
}
