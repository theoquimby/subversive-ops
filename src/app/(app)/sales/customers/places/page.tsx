import { Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { zonedTime } from "@/domain/timecards";
import { pct, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { placeCheck } from "@/server/integrations/square-payments";
import { businessToday } from "@/server/services/sales";
import { isSquareConnected, requireSquareClient } from "@/server/services/square";

export const metadata = { title: "Where people come from" };
export const maxDuration = 60;
/** Days of payments looked at. */
const DAYS = 21;

const ENTRY: Record<string, string> = { EMV: "Chip", CONTACTLESS: "Tap", SWIPED: "Swipe", KEYED: "Typed in", ON_FILE: "Card on file" };

/**
 * A check, before any map is drawn: do Square's payments say where the payer
 * lives? It reads counts only and keeps nothing.
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
  const share = (n: number) => (c.payments > 0 ? pct(n / c.payments, 0) : "—");
  return (
    <>
      {header}
      <Card className="p-5 sm:p-6">
        <h2 className="max-w-3xl text-xl font-semibold tracking-tight text-balance text-ink sm:text-2xl">
          {c.payments === 0 ? "No payments in the last three weeks" : c.withPostal === 0 ? "Square doesn't pass on a postal code for these payments" : `${share(c.withPostal)} of payments carry a postal code`}
        </h2>
        <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">
          {qty(c.payments, 0)} completed payments from {shortDate(from)} to {shortDate(addDays(today, -1))}. {qty(c.withPostal, 0)} carry a postal code ({qty(c.distinctPostal, 0)} different ones), {qty(c.withCustomer, 0)} are tied to a Square customer profile, and {qty(c.withEmail, 0)} carry an email. Only these counts are read; nothing is kept.
        </p>
        <div className="mt-5">
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
        {c.areas.length > 0 && (
          <p className="mt-4 text-sm text-ink-2">
            Commonest areas (first three digits): {c.areas.map((a) => `${a.area} (${qty(a.payments, 0)})`).join(", ")}.
          </p>
        )}
      </Card>
    </>
  );
}
