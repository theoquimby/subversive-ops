import { Badge, Card, cx, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { displayCode } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { accountPage, type AccountRange } from "@/server/services/kegAccounts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BeerDot, sizeShort } from "../../bits";
import { AccountDetails } from "../accounts-client";
import { bbl, Chip, dated, daysWord, gal, kindLabel } from "../bits";
import { DeliveryBars } from "../charts";

export const metadata = { title: "Keg account" };

const NO_BEER = "Beer not recorded";

export default async function KegAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> }) {
  await requireUser("MANAGER");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const range: AccountRange = sp.range === "all" ? "all" : "12m";
  const r = await accountPage(id, range);
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

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Kegs here now" value={n.kegsOut} tone={late ? "warn" : undefined} hint={longest == null ? "None out here" : late ? `${late} here more than ${daysWord(r.overdueDays)}` : `Longest ${daysWord(longest)}`} />
        <Stat label="Deliveries" value={n.deliveries12} hint={`In the last 12 months, ${since}`} />
        <Stat label="Barrels delivered" value={bbl(n.gallons12)} hint={`${gal(n.gallons12)} gallons, last 12 months`} />
        <Stat label="Days a keg stays" value={n.medianDays ?? "—"} hint={n.returns ? `The middle of ${n.returns} scanned return${n.returns === 1 ? "" : "s"}, all time` : "Shows once a keg is scanned back"} />
      </div>

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
              <tbody>
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
              </tbody>
            </Table>
          )}
        </Section>
      </div>

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
            <tbody>
              {r.beers.map((b) => (
                <Tr key={b.beerId ?? "none"}>
                  <Td><span className="flex items-center gap-2">{b.color && <BeerDot color={b.color} />}<span className={cx(!b.name && "text-muted")}>{b.name ?? NO_BEER}</span></span></Td>
                  <Td align="right">{b.deliveries}</Td>
                  <Td align="right">{bbl(b.gallons)}</Td>
                  <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{dated(b.last)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="Delivery history" description={r.history.total > r.history.rows.length ? `The latest ${r.history.rows.length} of ${r.history.total} deliveries.` : r.history.total ? `${r.history.total === 1 ? "The one delivery" : `All ${r.history.total} deliveries`} on record, the latest first.` : undefined}>
        {r.history.rows.length === 0 ? (
          <p className="text-sm text-muted">No keg has been scanned out to this account yet.</p>
        ) : (
          <Table>
            <thead><tr><Th>Delivered</Th><Th>Keg</Th><Th className="hidden sm:table-cell">Beer</Th><Th className="hidden md:table-cell">Size</Th><Th className="hidden sm:table-cell">Came back</Th><Th align="right">Days kept</Th></tr></thead>
            <tbody>
              {r.history.rows.map((h) => {
                const open = h.state === "there" ? "Still there" : h.state === "back" ? null : "No return scan";
                return (
                  <Tr key={`${h.kegId}-${h.at}`}>
                    <Td className="whitespace-nowrap">{dated(h.out)}</Td>
                    <Td className="py-0">
                      {h.code ? (
                        <Link href={`/kegs/k/${h.code}`} className="block py-3 hover:underline">
                          <span className="num font-medium whitespace-nowrap">{displayCode(h.code)}</span>
                          <span className="block text-xs text-muted sm:hidden">{h.beer ?? NO_BEER}</span>
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td className="hidden text-ink-2 sm:table-cell">{h.beer ?? <span className="text-muted">{NO_BEER}</span>}</Td>
                    <Td className="hidden whitespace-nowrap text-muted md:table-cell">{h.sizeId ? sizeShort(h.sizeId) : "—"}</Td>
                    <Td className="hidden whitespace-nowrap sm:table-cell">{h.state === "back" && h.back ? <span className="text-ink-2">{dated(h.back)}</span> : h.state === "there" ? "Still there" : <span className="text-muted" title={h.state === "resent" && h.back ? `Next seen going out again on ${dated(h.back)}` : undefined}>No return scan</span>}</Td>
                    <Td align="right" className="whitespace-nowrap">
                      {h.daysKept == null ? <span className="hidden text-muted sm:inline">—</span> : <>{h.daysKept}{h.state === "there" && <span className="hidden text-muted sm:inline"> so far</span>}</>}
                      {open && <span className="block text-xs font-normal text-muted sm:hidden">{open}</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
