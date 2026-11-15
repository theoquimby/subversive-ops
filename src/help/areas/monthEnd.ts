import type { HelpEntry } from "../types";

/** Month-end: the closing checklist, sales tax, inventory value, tips payable, the accountant pack and sales to QuickBooks. */
export const monthEnd: HelpEntry[] = [
  {
    id: "accounting.page",
    area: "accounting",
    route: "/accounting",
    title: "Month-end",
    body: "Everything to close a month or a sales tax quarter on one page: what's left to do, sales tax from Square, stock value and actual cost of goods, card tips still owed, and one spreadsheet for your accountant.",
    article: `Pick a month, a sales tax quarter or any dates at the top. Everything on the page, and the accountant pack, follows that choice.

### A good close, in order
1. Approve the period's invoices (and send them to QuickBooks if it's connected).
2. Count stock on the last day, or the first morning after.
3. Finalize the tip pools and approve payroll for the period.
4. Check every day's sales came in from Square.
5. Download the accountant pack and send it on.

The figures come from Square, your counts, invoices and timecards. They're for running the business and for your accountant to check; they aren't a tax return.`,
    related: ["accounting.checklist", "accounting.pack", "accounting.salesTax", "accounting.journal"],
    tour: "month-end",
    keywords: ["close", "month end", "closing", "bookkeeping", "accountant", "books", "quarter"],
  },
  {
    id: "accounting.stats",
    area: "accounting",
    route: "/accounting",
    title: "The period at a glance",
    body: "Net sales as the P&L counts them, sales tax Square collected, actual cost of goods from your counts and invoices, and card tips not yet paid out through payroll.",
    related: ["accounting.inventory", "accounting.tips", "pnl.headline"],
  },
  {
    id: "accounting.checklist",
    area: "accounting",
    route: "/accounting",
    title: "Closing checklist",
    body: "Invoices approved and in QuickBooks, a stock count within 3 days of the period's end, tips finalized, payroll approved and every day's sales synced. Tap a line to go and fix it. Grey lines don't apply this time.",
    related: ["invoices.quickbooks", "count.home", "tips.page", "labor.payroll"],
    keywords: ["to do", "checklist", "close the month"],
  },
  {
    id: "accounting.inventory",
    area: "accounting",
    route: "/accounting",
    title: "Inventory value and actual cost of goods",
    body: "Stock is valued from each item's latest count on or before the date, at the prices on file then. Actual cost of goods = stock at the start + approved invoices − stock at the end. It needs a count at both ends.",
    related: ["variance.page", "count.home", "accounting.checklist"],
    keywords: ["stock value", "inventory value", "cogs", "opening stock", "closing stock", "purchases"],
  },
  {
    id: "accounting.salesTax",
    area: "accounting",
    route: "/accounting",
    title: "Sales tax",
    body: "Tax Square collected each day, with taxable sales worked out as tax ÷ your rate. The rate (8% for Greene County by default) and quarters (Mar–May, Jun–Aug, Sep–Nov, Dec–Feb) are settings. Check them with your accountant.",
    related: ["accounting.pack", "sales.sync"],
    keywords: ["sales tax", "nys", "new york", "quarterly", "st-100", "taxable", "non-taxable", "greene county", "rate"],
  },
  {
    id: "accounting.tips",
    area: "accounting",
    route: "/accounting",
    title: "Tips payable",
    body: "Card tips Square collected in the period, against the card tips in finalized pools on days inside an approved pay period. What's left is still owed to the team.",
    related: ["tips.page", "labor.payroll"],
    keywords: ["tips owed", "tip liability", "gratuity"],
  },
  {
    id: "accounting.pack",
    area: "accounting",
    route: "/accounting",
    title: "Accountant pack",
    body: "One Excel file for the period: summary, P&L, sales by day, sales tax, tips, inventory, invoices, card fees, comps & discounts and the sales journal. Money is in number cells so it adds up.",
    related: ["accounting.page", "accounting.salesTax"],
    keywords: ["export", "excel", "xlsx", "download", "accountant", "spreadsheet"],
  },
  {
    id: "accounting.journal",
    area: "accounting",
    route: "/accounting",
    title: "Sales to QuickBooks",
    body: "Off until you turn it on. Each day (or month) of Square sales goes in as one balanced journal entry on the accounts you pick. Preview it first. Sending again only updates an entry whose figures changed, never makes a copy.",
    article: `The entry, for each day or month:

- **Debit** card deposits clearing: card payments less Square's fees.
- **Debit** card fees.
- **Debit** cash clearing: the rest of what came in.
- **Debit** comps & discounts.
- **Credit** food, beverage and other sales, before discounts.
- **Credit** sales tax payable and tips payable.

Cash is worked out so the entry always balances. A day isn't sent until Square's tax, fees and discounts for it are in. Days before the start date are never sent, and switching between daily and monthly can't book a day twice.

Ask your accountant which accounts to use. If QuickBooks won't post to its own sales tax account, make an "Other current liability" account and use that.`,
    related: ["invoices.quickbooks", "accounting.pack"],
    keywords: ["journal entry", "quickbooks", "qbo", "sales summary", "daily sales", "clearing", "undeposited funds"],
  },
];
