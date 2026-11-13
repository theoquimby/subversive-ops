import { HelpZone } from "@/components/help";
import { Card, EmptyState, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { buildBill } from "@/domain/accountingExport";
import { money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { approvedBills, ingredientCategories, loadAccounts, loadTaxRate, revenueCategories, salesDays } from "@/server/services/accounting";
import { businessToday } from "@/server/services/sales";
import { Download } from "lucide-react";
import Link from "next/link";
import { AccountCell, RangePicker, TaxRateCell, TermsCell } from "./exports-client";
import { BillsTable, SalesDaysTable } from "./exports-tables";
import { readRange } from "./range";

export const metadata = { title: "Accounting exports" };

export default async function ExportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; detail?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const { from, to, toExclusive } = readRange(sp, businessToday());
  const detail = sp.detail === "1";
  const [rows, accounts, sales, ingCats, revCats, taxRate] = await Promise.all([
    approvedBills(from, toExclusive),
    loadAccounts(),
    salesDays(from, toExclusive),
    ingredientCategories(),
    revenueCategories(),
    loadTaxRate(),
  ]);
  const bills = rows.map((r) => buildBill(r, accounts, !detail));
  const billTotal = bills.reduce((s, b) => s + b.total, 0);
  const days = sales.days.map((d) => {
    const net = d.byCategory.reduce((s, c) => s + c.net, 0);
    return { ...d, net, total: net + (d.tax ?? 0) + (d.tips ?? 0) };
  }).filter((d) => d.net !== 0 || d.tips);
  const totals = days.reduce((a, d) => ({ net: a.net + d.net, tax: a.tax + (d.tax ?? 0), tips: a.tips + (d.tips ?? 0) }), { net: 0, tax: 0, tips: 0 });
  const q = (extra: Record<string, string>) => new URLSearchParams({ from, to, ...(detail ? { detail: "1" } : {}), ...extra }).toString();
  const noTax = days.length > 0 && days.every((d) => d.tax == null);

  return (
    <>
      <PageHeader
        help="invoices.exports"
        title="Accounting exports"
        description="Approved invoices as bills, and a daily sales journal, ready to import into QuickBooks Online or Xero. Nothing is paid or posted from here."
        back={{ href: "/invoices", label: "Invoices" }}
        actions={<HelpZone id="invoices.exports.range"><RangePicker from={from} to={to} /></HelpZone>}
      />

      <HelpZone id="invoices.exports.summary" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Approved bills" value={bills.length} hint={`${shortDate(from)} – ${shortDate(to)}`} />
        <Stat label="Bills total" value={money(billTotal)} />
        <Stat label="Net sales" value={money(totals.net, { whole: true })} hint={`${days.length} trading day${days.length === 1 ? "" : "s"}`} />
        <Stat label="Tips owed" value={money(totals.tips, { whole: true })} hint={noTax ? "no sales tax recorded" : `tax ${money(totals.tax, { whole: true })}${sales.taxEstimated ? " (estimated)" : ""}`} />
      </HelpZone>

      <Section
        help="invoices.exports.bills"
        title="Bills"
        description={detail ? "One line per invoice line." : "One line per expense account on each bill, so your ledger stays tidy."}
        actions={
          <div className="flex flex-nowrap gap-2">
            <Link href={`?${new URLSearchParams({ from, to, ...(detail ? {} : { detail: "1" }) })}`} scroll={false} className="flex h-10 items-center px-2 text-sm text-ink-2 hover:text-ink sm:h-8">
              {detail ? "Summarize by account" : "Show every line"}
            </Link>
            <LinkButton href={`/invoices/exports/bills?${q({ format: "qbo" })}`} prefetch={false} size="sm" className="h-10 sm:h-8"><Download className="size-4" />QuickBooks</LinkButton>
            <LinkButton href={`/invoices/exports/bills?${q({ format: "xero" })}`} prefetch={false} size="sm" className="h-10 sm:h-8"><Download className="size-4" />Xero</LinkButton>
          </div>
        }
      >
        {bills.length === 0 ? (
          <EmptyState title="No approved invoices in this range">Approve invoices on the invoices page and they&apos;ll be ready to export here.</EmptyState>
        ) : (
          <BillsTable rows={bills.map((b) => ({ id: b.id, supplier: b.supplier, billNo: b.billNo, date: b.date, dueDate: b.dueDate, accounts: [...new Set(b.lines.map((l) => l.account))], total: b.total }))} />
        )}
      </Section>

      <Section
        help="invoices.exports.sales"
        title="Daily sales journal"
        description="One balanced journal per day: net sales by category, sales tax and tips, against your undeposited funds account. Gift cards and other items marked ignored are left out."
        actions={
          <div className="flex flex-nowrap gap-2">
            <LinkButton href={`/invoices/exports/sales?${q({ format: "qbo" })}`} prefetch={false} size="sm" className="h-10 sm:h-8"><Download className="size-4" />QuickBooks</LinkButton>
            <LinkButton href={`/invoices/exports/sales?${q({ format: "xero" })}`} prefetch={false} size="sm" className="h-10 sm:h-8"><Download className="size-4" />Xero</LinkButton>
          </div>
        }
      >
        {days.length === 0 ? (
          <EmptyState title="No sales in this range">Sales come in from Square every night.</EmptyState>
        ) : (
          <SalesDaysTable rows={days.map((d) => ({ date: d.date, categories: d.byCategory.filter((c) => Math.abs(c.net) >= 0.5).map((c) => `${c.category} ${money(c.net, { whole: true })}`).join(" · "), net: d.net, tax: d.tax ?? null, tips: d.tips ?? null, total: d.total }))} />
        )}
        {noTax && <p className="mt-2 text-xs text-muted">Square&apos;s sales tax isn&apos;t stored yet. Set your sales tax rate below to include an estimate, or leave it out and post tax from Square&apos;s own report.</p>}
      </Section>

      <Section help="invoices.exports.accounts" title="Accounts" description="Names must match accounts in your chart of accounts exactly. Leave a category blank to use the default.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="divide-y divide-border">
            <div className="px-4 py-2.5 text-[0.8rem] font-medium text-muted">Bills · expense account by ingredient category</div>
            <AccountRow label="Default"><AccountCell field="billsDefault" value={accounts.billsDefault} label="Default expense account" /></AccountRow>
            {ingCats.map((c) => (
              <AccountRow key={c} label={c}><AccountCell field={{ bills: c }} value={accounts.billsByCategory[c] ?? ""} placeholder={accounts.billsDefault} label={`Expense account for ${c}`} /></AccountRow>
            ))}
            <AccountRow label="Fees, tax, rounding" hint="Gap between lines and invoice total"><AccountCell field="billsOther" value={accounts.billsOther} label="Account for other charges" /></AccountRow>
            <AccountRow label="Payment terms (days)"><TermsCell value={accounts.termsDays} /></AccountRow>
          </Card>
          <Card className="divide-y divide-border">
            <div className="px-4 py-2.5 text-[0.8rem] font-medium text-muted">Sales journal · income account by menu category</div>
            <AccountRow label="Default"><AccountCell field="salesDefault" value={accounts.salesDefault} label="Default income account" /></AccountRow>
            {revCats.map((c) => (
              <AccountRow key={c} label={c}><AccountCell field={{ sales: c }} value={accounts.salesByCategory[c] ?? ""} placeholder={accounts.salesDefault} label={`Income account for ${c}`} /></AccountRow>
            ))}
            <AccountRow label="Sales tax"><AccountCell field="salesTax" value={accounts.salesTax} label="Sales tax account" /></AccountRow>
            <AccountRow label="Sales tax rate (%)" hint="Only used when Square's tax isn't stored"><TaxRateCell value={taxRate} /></AccountRow>
            <AccountRow label="Tips"><AccountCell field="tips" value={accounts.tips} label="Tips payable account" /></AccountRow>
            <AccountRow label="Takings land in"><AccountCell field="clearing" value={accounts.clearing} label="Clearing account" /></AccountRow>
          </Card>
        </div>
      </Section>
    </>
  );
}

function AccountRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 px-4 py-1.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="truncate text-sm">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
