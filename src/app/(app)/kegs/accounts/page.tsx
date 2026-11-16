import { EmptyState, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { accountsList } from "@/server/services/kegAccounts";
import { ChartColumn } from "lucide-react";
import Link from "next/link";
import { AddAccount } from "./accounts-client";
import { AccountsTable } from "./accounts-table";
import { daysWord, kegsWord } from "./bits";

export const metadata = { title: "Keg accounts" };

export default async function KegAccountsPage() {
  await requireUser("MANAGER");
  const r = await accountsList();
  const withKegs = r.rows.filter((a) => a.kegsOut > 0).length;

  return (
    <>
      <PageHeader
        help="kegs.accounts"
        title="Accounts"
        back={{ href: "/kegs", label: "Kegs" }}
        description="Everywhere your kegs go out to: what's there now, how long it has been there, and how often each account takes a delivery. Counted from keg scans."
        actions={<LinkButton href="/kegs/reports" className="h-10 sm:h-9"><ChartColumn className="size-4" /> Reports</LinkButton>}
      />

      {r.rows.length === 0 ? (
        <EmptyState title="No accounts yet" action={<AddAccount />}>Add the bars, restaurants and people your kegs go out to. Staff pick one when they scan a keg out, and its history builds up here.</EmptyState>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Kegs out now" value={r.kegsOut} hint={r.kegsOut ? `At ${withKegs} account${withKegs === 1 ? "" : "s"}${r.noAccount ? ` · ${r.noAccount} with no account recorded` : ""}` : "Every keg is home"} />
            <Stat label={`Out over ${daysWord(r.overdueDays)}`} value={r.kegsOverdue} tone={r.kegsOverdue ? "warn" : "good"} hint={r.kegsOverdue ? "Worth a call or a pickup" : "Nothing out too long"} />
            <div className="col-span-2 lg:col-span-1">
              <Stat label="Deliveries, last 12 months" value={r.deliveries12} hint="Kegs scanned out to an account" />
            </div>
          </div>

          <Section title="Every account" description={`The most kegs out first. A wait is flagged once a keg has been there more than ${daysWord(r.overdueDays)}; change that number on Setup. Accounts no longer used are under their own tab.`}>
            <AccountsTable rows={r.rows} overdueDays={r.overdueDays} />
            {r.noAccount > 0 && <p className="mt-2 text-xs text-muted">{kegsWord(r.noAccount)} marked out with no account recorded; {r.noAccount === 1 ? "it is" : "they are"} on no row here. See <Link href="/kegs/reports#at-accounts" className="underline hover:text-ink">Kegs at accounts</Link>.</p>}
            <div className="mt-4"><AddAccount /></div>
          </Section>
        </>
      )}
    </>
  );
}
