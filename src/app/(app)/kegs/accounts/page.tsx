import { Badge, cx, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { accountsList } from "@/server/services/kegAccounts";
import { ChartColumn } from "lucide-react";
import Link from "next/link";
import { AddAccount } from "./accounts-client";
import { Chip, dated, daysWord, kegsWord, kindLabel } from "./bits";

export const metadata = { title: "Keg accounts" };

export default async function KegAccountsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const r = await accountsList();
  const showAll = sp.show === "all";
  // An account that's no longer used stays in view while it still has kegs.
  const quiet = r.rows.filter((a) => !a.active && a.kegsOut === 0).length;
  const rows = showAll ? r.rows : r.rows.filter((a) => a.active || a.kegsOut > 0);
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

          <Section
            title="Every account"
            description={`The most kegs out first. A wait is flagged once a keg has been there more than ${daysWord(r.overdueDays)}; change that number on Setup.`}
            actions={quiet > 0 ? <Chip href={showAll ? "/kegs/accounts" : "/kegs/accounts?show=all"} active={showAll}>{showAll ? "Hide accounts no longer used" : `Show ${quiet} no longer used`}</Chip> : undefined}
          >
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th className="hidden sm:table-cell">Type</Th>
                  <Th align="right">Kegs there</Th>
                  <Th align="right">Longest wait</Th>
                  <Th align="right" className="hidden md:table-cell">Deliveries, 12 months</Th>
                  <Th className="hidden md:table-cell">Last delivery</Th>
                  <Th align="right" className="hidden lg:table-cell">All deliveries</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <Tr key={a.id} className={a.active ? "" : "opacity-60"}>
                    <Td className="py-0">
                      <Link href={`/kegs/accounts/${a.id}`} className="block py-3 hover:underline">
                        <span className="block font-medium">{a.name}</span>
                        <span className="block text-xs text-muted sm:hidden">{kindLabel(a.kind)}{a.active ? "" : " · no longer used"}</span>
                      </Link>
                    </Td>
                    <Td className="hidden text-ink-2 sm:table-cell">{kindLabel(a.kind)}{!a.active && <Badge className="ml-2">No longer used</Badge>}</Td>
                    <Td align="right" className={cx(a.kegsOut ? "font-medium" : "text-muted")}>{a.kegsOut}</Td>
                    <Td align="right" className="whitespace-nowrap">
                      {a.longestDays == null ? <span className="text-muted">—</span> : a.overdue ? <Badge tone="warn">{daysWord(a.longestDays)}</Badge> : <span className="text-ink-2">{daysWord(a.longestDays)}</span>}
                    </Td>
                    <Td align="right" className={cx("hidden md:table-cell", !a.deliveries12 && "text-muted")}>{a.deliveries12}</Td>
                    <Td className="hidden whitespace-nowrap text-ink-2 md:table-cell">{a.lastDelivery ? dated(a.lastDelivery) : <span className="text-muted">None scanned</span>}</Td>
                    <Td align="right" className={cx("hidden lg:table-cell", !a.deliveries && "text-muted")}>{a.deliveries}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {r.noAccount > 0 && <p className="mt-2 text-xs text-muted">{kegsWord(r.noAccount)} marked out with no account recorded; {r.noAccount === 1 ? "it is" : "they are"} on no row here. See <Link href="/kegs/reports#at-accounts" className="underline hover:text-ink">Kegs at accounts</Link>.</p>}
            <div className="mt-4"><AddAccount /></div>
          </Section>
        </>
      )}
    </>
  );
}
