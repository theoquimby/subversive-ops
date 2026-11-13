import { HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { fixedTotal } from "@/domain/analytics";
import { DEFAULT_TOLERANCE } from "@/domain/invoiceMatch";
import { money } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { loadAccounts, loadTaxRate } from "@/server/services/accounting";
import { getFixedCosts } from "@/server/services/analytics";
import { autoApproveEnabled, loadTolerance, pricesOnApproveEnabled } from "@/server/services/invoices";
import { quickbooksStatus } from "@/server/services/quickbooks";
import { LinkRow, SettingGroup, SettingRow } from "../controls";
import { AutoApproveSwitch, PricesOnApproveSwitch, FixedInput, PriceTolInput, QtyTolInput, TaxInput, TermsInput } from "./money-client";

export const metadata = { title: "Money & accounting" };

const FIXED = [
  { field: "rent", label: "Rent or mortgage", hint: "Including property tax and CAM if you pay them monthly." },
  { field: "utilities", label: "Utilities", hint: "Electric, gas, water, internet, trash — a typical month." },
  { field: "insurance", label: "Insurance", hint: "Liability, liquor, property — the yearly premium ÷ 12." },
  { field: "other", label: "Everything else", hint: "Loan payments, software, salaries not on timecards, accounting." },
] as const;

export default async function MoneySettingsPage() {
  await requireUser("MANAGER");
  const [tax, tol, auto, accounts, fixed, qbo, pricesOnApprove] = await Promise.all([loadTaxRate(), loadTolerance(), autoApproveEnabled(), loadAccounts(), getFixedCosts(), quickbooksStatus(), pricesOnApproveEnabled()]);
  const total = fixedTotal(fixed);

  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Money & accounting" description="Sales tax, how invoices are checked, when bills are due, and the monthly costs that don't move with sales." />

      <SettingGroup id="tax" title="Sales tax">
        <SettingRow label="Sales tax rate" help="settings.money.tax" what="Used for the sales journal on days Square didn't record the tax. Leave blank to rely on Square." defaultNote="Default: from Square. Greene County, NY is 8%.">
          <TaxInput value={tax} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup id="invoices" title="Invoices & bills" description="Changing a limit re-checks every invoice that isn't approved yet.">
        <SettingRow label="Price can be off by" help="settings.money.tolerance" what="Per unit, before a line is flagged as a price mismatch." defaultNote={`Default ${money(DEFAULT_TOLERANCE.price)}`}>
          <PriceTolInput value={tol.price} />
        </SettingRow>
        <SettingRow label="Quantity can be off by" what="Cases or units, before a line is flagged as short or over." defaultNote={`Default ${DEFAULT_TOLERANCE.qty} — any difference is flagged`}>
          <QtyTolInput value={tol.qty} />
        </SettingRow>
        <SettingRow label="Auto-approve clean invoices" help="settings.money.autoApprove" what="An invoice that matches its order and delivery approves itself. Anything off still waits for you." defaultNote="Default off">
          <AutoApproveSwitch on={auto} />
        </SettingRow>
        <SettingRow label="Approving updates prices" help="settings.money.pricesOnApprove" what="Approved invoices and receipts record their prices in costing, dated the invoice day. Price-jump alerts still go out." defaultNote="Default on">
          <PricesOnApproveSwitch on={pricesOnApprove} />
        </SettingRow>
        <SettingRow label="Payment terms" help="settings.money.terms" what="Days after the invoice date a bill is due — 30 is net 30, 0 is due on receipt." defaultNote="Default 30 days">
          <TermsInput value={accounts.termsDays} />
        </SettingRow>
      </SettingGroup>

      <HelpZone id="settings.money.fixed">
        <SettingGroup id="fixed" title="Fixed monthly costs" description={`Insights uses these for break-even and profit. ${total > 0 ? `${money(total, { whole: true })} a month in total.` : "Not set yet."}`}>
          {FIXED.map((f) => (
            <SettingRow key={f.field} label={f.label} what={f.hint}>
              <FixedInput field={f.field} value={fixed?.[f.field] ?? null} label={f.label} />
            </SettingRow>
          ))}
        </SettingGroup>
      </HelpZone>

      <SettingGroup title="Budgets & accounting">
        <LinkRow href="/budgets" label="Weekly budgets" what="Sales, food cost and labor targets by week." help="budgets.page" />
        <LinkRow href="/invoices/exports" label="Account mapping & exports" what="Which account bills and sales go to, and the QuickBooks / Xero export files." help="settings.money.accounts" />
        <LinkRow href={qbo.connected ? "/settings/quickbooks" : "/settings/connections?open=quickbooks"} label="QuickBooks Online" what="Approved invoices go over as bills." value={qbo.connected ? "Live" : "Not set up"} help="settings.quickbooks" />
      </SettingGroup>
    </div>
  );
}
