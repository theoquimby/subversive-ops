import { HelpZone } from "@/components/help";
import { Button, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadDemoData } from "../actions";
import { LinkRow, SettingGroup } from "../controls";
import { ClearData } from "./data-client";

export const metadata = { title: "Data" };

export default async function DataSettingsPage() {
  await requireUser("MANAGER");
  const [ingredients, recipes, sales, orders, invoices, timecards] = await Promise.all([
    db.ingredient.count(), db.recipe.count(), db.hourlySale.count(), db.purchaseOrder.count(), db.invoice.count(), db.timecard.count(),
  ]);
  const empty = ingredients === 0 && recipes === 0;
  const counts = [
    { label: "ingredients", n: ingredients }, { label: "recipes", n: recipes }, { label: "hours of sales", n: sales },
    { label: "orders", n: orders }, { label: "invoices", n: invoices }, { label: "timecards", n: timecards },
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Data" description="Bring data in, take it out, and start over." />

      <SettingGroup id="import" title="Bring data in">
        <LinkRow href="/import" label="Import sheets" what="Ingredients, prices and recipes from your existing spreadsheet." help="settings.data.import" />
        <LinkRow href="/prices" label="Supplier price sheets" what="Upload a distributor's .xlsx or .csv; every price is kept with its date." />
        <LinkRow href="/settings/square" label="Square history" what="Past sales and timecards come in from Square, a week at a time." />
        {empty && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
            <div><div className="text-sm font-medium text-ink">Demo data</div><p className="mt-0.5 text-[0.8rem] text-muted">A sample menu, prices and sales to look around with. Only offered while there's no data.</p></div>
            <form action={loadDemoData}><Button>Load demo data</Button></form>
          </div>
        )}
      </SettingGroup>

      <HelpZone id="settings.data.export">
        <SettingGroup id="export" title="Take data out" description="Most tables also have a Download button that saves exactly what you're looking at as a spreadsheet.">
          <LinkRow href="/labor" label="Payroll" what="Approve a pay period on Timecards & payroll, then download hours, overtime, tips and adjustments as a CSV." />
          <LinkRow href="/invoices/exports" label="Bills & sales journal" what="For QuickBooks or Xero." />
          <LinkRow href="/ingredients" label="Ingredients, prices and menu" what="Use Download on each table." />
        </SettingGroup>
      </HelpZone>

      <SettingGroup id="backups" title="Backups">
        <p className="px-4 py-4 text-sm text-ink-2 sm:px-5">Everything is kept in the app's database, which the hosting service backs up on its own — there's nothing to switch on here. If something is ever deleted by mistake, whoever looks after the app can restore it from that backup. Prices, counts and approved timecards are never overwritten, only added to.</p>
      </SettingGroup>

      <HelpZone id="settings.clear">
        <SettingGroup id="clear" title="Start over" description="Handy after trying the demo. Download anything you want to keep first.">
          <ClearData counts={counts} />
        </SettingGroup>
      </HelpZone>
    </div>
  );
}
