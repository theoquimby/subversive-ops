import { Badge, Card, LinkButton, PageHeader, Section } from "@/components/ui";
import { businessDateTime, relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import Link from "next/link";
import type { TestResult } from "../connections/actions";
import { loadQuickBooksData } from "./data";
import { AccountMapping, ClearProblems, EnvironmentPicker, QboConnectButton, QboDisconnect, QboTestButton, SendOptions, SupplierVendors } from "./quickbooks-client";

export const metadata = { title: "QuickBooks" };
// "Send all" runs as server actions from this page.
export const maxDuration = 60;

export default async function QuickBooksPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requireUser("MANAGER");
  const { connected: justConnected, error } = await searchParams;
  const [d, testRow] = await Promise.all([loadQuickBooksData(), db.setting.findUnique({ where: { key: "connections.test.quickbooks" } })]);
  const s = d.status;
  let lastTest: TestResult | null = null;
  try {
    lastTest = testRow ? (JSON.parse(testRow.value) as TestResult) : null;
  } catch {
    lastTest = null;
  }
  const defaultName = d.accounts.find((a) => a.id === s.mapping.defaultAccountId)?.fullName ?? null;

  return (
    <>
      <PageHeader
        help="settings.quickbooks"
        back={{ href: "/settings", label: "Settings" }}
        title="QuickBooks"
        description="Approved supplier invoices go to QuickBooks Online as bills, with the photo attached. Nothing is ever paid from here."
        actions={<LinkButton href="/settings/connections?open=quickbooks">Set-up guide</LinkButton>}
      />

      {(justConnected || error) && (
        <Card role="status" className={`mb-8 p-4 text-sm ${error ? "border-bad/40 text-bad" : "border-good/40 text-good"}`}>
          {error ? error : `Connected to ${justConnected}. Next, choose which accounts bills go to below.`}
        </Card>
      )}

      <Section help="settings.quickbooks.connection" title="Connection">
        <Card className="divide-y divide-border">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <div className="text-base font-semibold">{s.connected ? s.companyName ?? "QuickBooks company" : s.needsReconnect ? "Needs connecting again" : "Not connected"}</div>
              <div className="mt-1 text-sm text-muted">
                {s.connected
                  ? [
                      s.connectedAt && `connected ${businessDateTime(s.connectedAt, env.BUSINESS_TIMEZONE)}${s.connectedBy ? ` by ${s.connectedBy}` : ""}`,
                      s.lastSync ? `last sent ${relativeTime(new Date(s.lastSync))}` : "nothing sent yet",
                    ].filter(Boolean).join(" · ")
                  : s.needsReconnect ?? (s.appReady ? "Part 1 is done. Press Connect to QuickBooks, sign in and pick the company." : "Register the app with Intuit first — the set-up guide shows every step.")}
              </div>
              {s.connected && s.refreshDaysLeft != null && s.refreshDaysLeft < 21 && (
                <div className="mt-1 text-sm text-warn">QuickBooks signs the app out in {s.refreshDaysLeft} day{s.refreshDaysLeft === 1 ? "" : "s"} unless something is sent. Press Test connection to keep it signed in.</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {s.environment === "sandbox" && <Badge tone="warn">Test company</Badge>}
              <Badge tone={s.connected ? "good" : "warn"}>{s.connected ? "Live" : "Setup needed"}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-3 p-5">
            {s.connected ? (
              <>
                <QboTestButton last={lastTest} />
                <a href="/api/quickbooks/oauth/start?back=/settings/quickbooks" className="inline-flex h-10 items-center rounded-lg px-3.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-9">Reconnect</a>
                <div className="ml-auto"><QboDisconnect /></div>
              </>
            ) : s.appReady ? (
              <div className="space-y-3">
                <EnvironmentPicker value={s.environment} locked={false} />
                <QboConnectButton back="/settings/quickbooks" label={s.needsReconnect ? "Connect to QuickBooks again" : "Connect to QuickBooks"} />
              </div>
            ) : (
              <LinkButton href="/settings/connections?open=quickbooks" variant="primary" size="lg">Set up QuickBooks</LinkButton>
            )}
          </div>
        </Card>
      </Section>

      {s.connected && (
        <>
          <Section help="settings.quickbooks.accounts" title="Choose accounts" description="Which account in your chart of accounts each kind of purchase goes to. Lines are added up per account, so each bill stays short.">
            <AccountMapping accounts={d.accounts} accountsAt={d.accountsAt} mapping={s.mapping} categories={d.categories} suggestions={d.suggestions} defaultSuggestion={d.defaultSuggestion} missing={d.missing} />
            <p className="mt-3 text-xs text-muted">
              Bills are due {d.termsDays} day{d.termsDays === 1 ? "" : "s"} after the invoice date — change it under <Link href="/invoices/exports" className="text-ink underline underline-offset-2">Invoices → Exports → Payment terms</Link>.
            </p>
          </Section>

          <Section help="settings.quickbooks.sending" title="Sending">
            <Card className="p-5">
              <SendOptions autoSend={s.mapping.autoSend} sendFrom={d.sendFrom} waiting={d.waiting} ready={s.mappingReady} />
            </Card>
          </Section>

          <Section help="settings.quickbooks.vendors" title="Suppliers and vendors" description="Each supplier here is a vendor in QuickBooks. Leave one unset and it's matched by name — or created — the first time one of its invoices is sent.">
            {d.suppliers.length ? (
              <SupplierVendors rows={d.suppliers} vendors={d.vendors} accounts={d.accounts} defaultAccountName={defaultName} />
            ) : (
              <p className="text-sm text-muted">No suppliers yet.</p>
            )}
          </Section>
        </>
      )}

      {d.problems.length > 0 && (
        <Section help="settings.quickbooks.problems" title="Recent problems" actions={<ClearProblems />}>
            <Card className="divide-y divide-border text-sm">
              {d.problems.map((p, i) => (
                <div key={`${p.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5">
                  <span className="min-w-0">{p.message}</span>
                  <span className="shrink-0 text-xs text-muted">{relativeTime(new Date(p.at))}</span>
                </div>
              ))}
            </Card>
        </Section>
      )}
    </>
  );
}
