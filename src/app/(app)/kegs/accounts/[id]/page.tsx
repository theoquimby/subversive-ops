import { Verdict } from "@/components/chapter";
import { Badge, Card, cx, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { displayCode } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { accountPage, type AccountRange } from "@/server/services/kegAccounts";
import { accountOrders } from "@/server/services/kegOrders";
import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BeerDot, sizeShort } from "../../bits";
import { AccountDetails } from "../accounts-client";
import { bbl, Chip, dated, daysWord, gal, kegsWord, kindLabel } from "../bits";
import { DeliveryBars } from "../charts";
import { OrderTable } from "../../orders/bits";
import { ShowMore } from "@/components/show-more";
import { DeliveriesTable } from "./deliveries-table";

export const metadata = { title: "Keg account" };

const NO_BEER = "Beer not recorded";

export default async function KegAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> }) {
  await requireUser("MANAGER");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const range: AccountRange = sp.range === "all" ? "all" : "12m";
  const [r, orders] = await Promise.all([
    accountPage(id, range),
    // A problem with orders leaves the section out; the rest of the page still shows.
    accountOrders(id).catch((e) => {
      console.error("keg account: orders skipped", (e as Error).message);
      return null;
    }),
  ]);
  if (!r) notFound();

  const { account: a, numbers: n } = r;
  const longest = r.here[0]?.days ?? null;
  const late = r.here.filter((k) => k.days > r.overdueDays).length;
  const delivered = r.months.reduce((sum, m) => sum + m.kegs, 0);
  const rangeWords = range === "all" ? "on record" : "in the last 12 months";
  const since = `since ${dated(r.yearFrom)}`;

  return (
    <>
      <PageHeader
        help="kegs.accounts.page"
        title={a.name}
        back={{ href: "/kegs/accounts", label: "Accounts" }}
        description={`${kindLabel(a.kind)}${a.active ? "" : ", no longer used"}. Every number here is counted from keg scans, so a keg that left or came back without a scan is missing.`}
        actions={<div className="flex gap-1.5"><Chip href={`/kegs/accounts/${a.id}`} active={range === "12m"}>12 months</Chip><Chip href={`/kegs/accounts/${a.id}?range=all`} active={range === "all"}>All time</Chip></div>}
      />

      <Verdict
        badge={late ? { tone: "warn" } : undefined}
        title={late ? `${kegsWord(late)} of the ${kegsWord(n.kegsOut)} here ${late === 1 ? "has" : "have"} been out more than ${daysWord(r.overdueDays)}` : n.kegsOut ? `${kegsWord(n.kegsOut)} here now, the longest for ${daysWord(longest ?? 0)}` : "No kegs out here right now"}
        line={late ? "Ask for the empties back on the next delivery." : undefined}
        stats={[
          { label: "Deliveries", value: n.deliveries12, hint: `In the last 12 months, ${since}` },
          { label: "Barrels delivered", value: bbl(n.gallons12), hint: `${gal(n.gallons12)} gallons, last 12 months` },
          { label: "Days a keg stays", value: n.medianDays ?? "Not known yet", tone: n.medianDays == null ? "unknown" : "neutral", hint: n.returns ? `The middle of ${n.returns} scanned return${n.returns === 1 ? "" : "s"}, all time` : "Shows once a keg is scanned back" },
        ]}
      />

      <div className="grid gap-x-8 lg:grid-cols-2">
        <Section title="Details" description="Type in a field to change it. It saves when you leave the field.">
          <AccountDetails account={a} />
        </Section>

        <Section title="Kegs here now" description={r.here.length ? `Flagged once a keg has been here more than ${daysWord(r.overdueDays)}.` : undefined}>
          {r.here.length === 0 ? (
            <p className="text-sm text-muted">No kegs are out here right now.</p>
          ) : (
            <Table>
              <thead><tr><Th>Keg</Th><Th className="hidden sm:table-cell">Beer</Th><Th className="hidden sm:table-cell lg:hidden xl:table-cell">Since</Th><Th align="right">Here for</Th></tr></thead>
              <ShowMore as="tbody" limit={10} noun={["keg", "kegs"]}>
                {r.here.map((k) => (
                  <Tr key={k.id}>
                    <Td className="py-0">
                      <Link href={`/kegs/k/${k.code}`} className="block py-3 hover:underline">
                        <span className="num font-medium whitespace-nowrap">{displayCode(k.code)}</span> <span className="text-xs whitespace-nowrap text-muted">{sizeShort(k.sizeId)}</span>
                        <span className="block text-xs text-muted sm:hidden">{k.beer ?? NO_BEER}</span>
                      </Link>
                    </Td>
                    <Td className="hidden text-ink-2 sm:table-cell">{k.beer ?? <span className="text-muted">{NO_BEER}</span>}</Td>
                    <Td className="hidden whitespace-nowrap text-muted sm:table-cell lg:hidden xl:table-cell">{dated(k.since)}</Td>
                    <Td align="right" className="whitespace-nowrap">{k.days > r.overdueDays ? <Badge tone="warn">{daysWord(k.days)}</Badge> : <span className="text-ink-2">{daysWord(k.days)}</span>}</Td>
                  </Tr>
                ))}
              </ShowMore>
            </Table>
          )}
        </Section>
      </div>

      {orders && (
        <Section
          title="Orders"
          description={orders.open.length || orders.closed.length ? "Open orders, then the last few fulfilled. Tap one to open it." : undefined}
          actions={a.active ? <LinkButton href={`/kegs/orders/new?account=${a.id}`} size="sm" className="h-10 sm:h-8"><Plus className="size-4" /> New order</LinkButton> : undefined}
        >
          {orders.open.length === 0 && orders.closed.length === 0 ? (
            <p className="text-sm text-muted">No orders for this account yet.</p>
          ) : (
            <div className="space-y-4">
              {orders.open.length > 0 ? <OrderTable rows={orders.open} today={orders.today} account={false} /> : <p className="text-sm text-muted">No open orders.</p>}
              {orders.closed.length > 0 && <OrderTable rows={orders.closed} today={orders.today} closed account={false} />}
            </div>
          )}
        </Section>
      )}

      <Section title="Deliveries per month" description={`Kegs scanned out here each month, ${range === "all" ? `since ${dated(r.from)}` : "for the last 12 months"}. Hover a month for barrels.`}>
        {delivered === 0 ? (
          <p className="text-sm text-muted">
            No deliveries here were scanned {rangeWords}.
            {range === "12m" && r.history.total > 0 && <> <Link href={`/kegs/accounts/${a.id}?range=all`} scroll={false} className="underline hover:text-ink">See all time</Link>.</>}
          </p>
        ) : (
          <Card className="p-4"><DeliveryBars rows={r.months} account={a.name} /></Card>
        )}
      </Section>

      <Section title="What they take" description={`Deliveries by beer, ${rangeWords}.`}>
        {r.beers.length === 0 ? (
          <p className="text-sm text-muted">No deliveries here were scanned {rangeWords}.</p>
        ) : (
          <Table>
            <thead><tr><Th>Beer</Th><Th align="right">Deliveries</Th><Th align="right">Barrels</Th><Th className="hidden sm:table-cell">Last delivery</Th></tr></thead>
            <ShowMore as="tbody" limit={10} noun={["beer", "beers"]}>
              {r.beers.map((b) => (
                <Tr key={b.beerId ?? "none"}>
                  <Td><span className="flex items-center gap-2">{b.color && <BeerDot color={b.color} />}<span className={cx(!b.name && "text-muted")}>{b.name ?? NO_BEER}</span></span></Td>
                  <Td align="right">{b.deliveries}</Td>
                  <Td align="right">{bbl(b.gallons)}</Td>
                  <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{dated(b.last)}</Td>
                </Tr>
              ))}
            </ShowMore>
          </Table>
        )}
      </Section>

      <Section title="Delivery history" description={r.history.total > r.history.rows.length ? `The latest ${r.history.rows.length} of ${r.history.total} deliveries. Search a keg or beer, or filter by whether it came back.` : r.history.total ? `${r.history.total === 1 ? "The one delivery" : `All ${r.history.total} deliveries`} on record, the latest first.` : undefined}>
        {r.history.rows.length === 0 ? (
          <p className="text-sm text-muted">No keg has been scanned out to this account yet.</p>
        ) : (
          <DeliveriesTable
            account={a.name}
            rows={r.history.rows.map((h) => ({ key: `${h.kegId}-${h.at}`, out: h.out, at: h.at, code: h.code, display: h.code ? displayCode(h.code) : null, beer: h.beer, size: h.sizeId ? sizeShort(h.sizeId) : null, state: h.state, back: h.back, daysKept: h.daysKept }))}
          />
        )}
      </Section>
    </>
  );
}
