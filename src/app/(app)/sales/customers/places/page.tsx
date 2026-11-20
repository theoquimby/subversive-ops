import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { zonedTime } from "@/domain/timecards";
import { pct, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { placeCheck } from "@/server/integrations/square-payments";
import { businessToday } from "@/server/services/sales";
import { isSquareConnected, requireSquareClient } from "@/server/services/square";
import { ArrowRight } from "lucide-react";

export const metadata = { title: "Where people come from" };
export const maxDuration = 60;
/** Days of payments looked at. */
const DAYS = 21;
/** A map needs at least this share of payments placed, or it shows who typed a card in rather than who came. */
const ENOUGH = 0.3;

const ENTRY: Record<string, string> = { EMV: "Chip", CONTACTLESS: "Tap", SWIPED: "Swipe", KEYED: "Typed in", ON_FILE: "Card on file" };

/** Square's creation_source, in plain words. */
const SOURCE: Record<string, string> = {
  INSTANT_PROFILE: "Made by Square after a card payment",
  DIRECTORY: "Added by hand in Square",
  TERMINAL: "Added at the till",
  LOYALTY: "Loyalty sign-up",
  ONLINE_STORE: "Online order",
  MARKETING: "Marketing sign-up",
  EMAIL_COLLECTION: "Email sign-up",
  INVOICES: "Invoice",
  APPOINTMENTS: "Booking",
  EGIFTING: "Gift card",
  FEEDBACK: "Feedback on a receipt",
  COUPON: "Coupon",
  IMPORT: "Imported list",
  THIRD_PARTY_IMPORT: "Imported from another app",
  THIRD_PARTY: "Another app",
  MERGE: "Merged profiles",
  DELETION_RECOVERY: "Restored profile",
  UNMERGE_RECOVERY: "Restored profile",
  OTHER: "Other",
};

/**
 * A check, before any map is drawn: can Square say where payers live? It asks
 * the payments, then the customer profiles behind them. Counts only; nothing is kept.
 */
export default async function PlacesPage() {
  await requireUser("MANAGER");
  const back = { href: "/sales/customers", label: "Customers" };
  const header = <PageHeader help="sales.customers.places" title="Where people come from" back={back} description="A check of what Square knows about where each payer lives, before anything is drawn on a map." />;
  if (!(await isSquareConnected())) {
    return (
      <>
        {header}
        <EmptyState title="Square isn't connected">Connect Square under Settings › Connections first.</EmptyState>
      </>
    );
  }
  const today = businessToday();
  const from = addDays(today, -DAYS);
  const tz = env.BUSINESS_TIMEZONE;
  const c = await placeCheck(await requireSquareClient(), zonedTime(from, 0, tz).toISOString(), zonedTime(today, 0, tz).toISOString());
  const of = (n: number, d: number) => (d > 0 ? pct(n / d, 0) : "—");
  const p = c.profiles;
  const enough = !p.denied && c.payments > 0 && p.placed / c.payments >= ENOUGH;
  const title =
    c.payments === 0
      ? "No payments in the last three weeks"
      : p.denied
        ? "One step left: let Ops see the postal code on Square's customer profiles"
        : enough
          ? `${of(p.placed, c.payments)} of payments can be placed: enough for a first map`
          : `Only ${of(p.placed, c.payments)} of payments can be placed: too few for a fair map`;
  return (
    <>
      {header}
      <Card className="p-5 sm:p-6">
        {c.payments > 0 && <Badge tone={p.denied ? "warn" : enough ? "good" : "warn"}>{p.denied ? "Waiting on Square" : enough ? "Enough to map" : "Not enough to map"}</Badge>}
        <h2 className="mt-2 max-w-3xl text-xl font-semibold tracking-tight text-balance text-ink sm:text-2xl">{title}</h2>
        <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">
          {qty(c.payments, 0)} completed payments from {shortDate(from)} to {shortDate(addDays(today, -1))}. {qty(c.withPostal, 0)} carry a postal code themselves, and {qty(c.withCustomer, 0)} are tied to a Square customer profile.
          {!p.denied && c.payments > 0 && (
            <>
              {" "}
              Behind those sit {qty(p.customers, 0)} different profiles, and {qty(p.withPostal, 0)} of them ({of(p.withPostal, p.customers)}) hold a postal code.
            </>
          )}{" "}
          Only these counts are read; nothing is kept.
        </p>
        {c.payments > 0 && (
          <div className="mt-4 flex max-w-2xl flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-surface-2 px-3.5 py-3 text-sm text-ink">
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
            <div className="min-w-0 flex-1 space-y-2">
              {p.denied ? (
                <>
                  <p>
                    Square connected before Ops asked for the Customers permission. On the Square page, press <b>Reconnect</b>, sign in to Square and press <b>Allow</b>, then come back here. Your locations and everything already imported stay as they are.
                  </p>
                  <LinkButton href="/settings/square" size="sm">Open the Square page</LinkButton>
                </>
              ) : enough ? (
                <p>The areas below are where a map would put its bubbles. Say the word and it gets drawn on the Customers page.</p>
              ) : (
                <p>A map from this would mostly show who ordered online or had a card typed in. Better sources: ask for a ZIP at the till for a week, a membership or email list, or the website&apos;s visitors once it reports to Ops.</p>
              )}
            </div>
          </div>
        )}

        {!p.denied && p.areas.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-ink">Commonest areas, by people</h3>
            <p className="mt-0.5 text-sm text-muted">The first three digits of the postal code. A profile counts once however often it paid.</p>
            <ul className="mt-3 max-w-xl space-y-1.5">
              {p.areas.map((a) => (
                <li key={a.area} className="grid grid-cols-[3rem_1fr_2.5rem] items-center gap-2 text-sm">
                  <span className="num font-medium text-ink">{a.area}</span>
                  <span className="h-2.5 rounded-r-[4px] bg-[var(--series-1)]" style={{ width: `${Math.max(2, (a.people / p.areas[0].people) * 100)}%` }} />
                  <span className="num text-right text-ink-2">{qty(a.people, 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!p.denied && p.bySource.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-ink">The profiles, by how they came to be</h3>
            <Table>
              <thead>
                <tr>
                  <Th>Profile</Th>
                  <Th align="right">Profiles</Th>
                  <Th align="right">With a postal code</Th>
                </tr>
              </thead>
              <tbody>
                {p.bySource.map((s) => (
                  <Tr key={s.source}>
                    <Td><span className="font-medium text-ink">{SOURCE[s.source] ?? s.source}</span></Td>
                    <Td align="right" className="num text-ink-2">{qty(s.customers, 0)}</Td>
                    <Td align="right" className="num font-medium text-ink">{qty(s.withPostal, 0)}</Td>
                  </Tr>
                ))}
                {p.customers > p.found && (
                  <Tr>
                    <Td><span className="text-ink-2">Square didn&apos;t return the profile</span></Td>
                    <Td align="right" className="num text-ink-2">{qty(p.customers - p.found, 0)}</Td>
                    <Td align="right" className="num text-ink-2">—</Td>
                  </Tr>
                )}
              </tbody>
            </Table>
          </div>
        )}

        {c.byEntry.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-ink">The payments, by how the card was read</h3>
            <Table>
              <thead>
                <tr>
                  <Th>How the card was read</Th>
                  <Th align="right">Payments</Th>
                  <Th align="right">With a postal code</Th>
                </tr>
              </thead>
              <tbody>
                {c.byEntry.map((e) => (
                  <Tr key={e.entry}>
                    <Td><span className="font-medium text-ink">{ENTRY[e.entry] ?? e.entry}</span></Td>
                    <Td align="right" className="num text-ink-2">{qty(e.payments, 0)}</Td>
                    <Td align="right" className="num font-medium text-ink">{qty(e.withPostal, 0)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {p.denied && c.areas.length > 0 && (
          <p className="mt-4 text-sm text-ink-2">
            Commonest areas from the cards alone (first three digits): {c.areas.map((a) => `${a.area} (${qty(a.payments, 0)})`).join(", ")}.
          </p>
        )}
      </Card>
    </>
  );
}
