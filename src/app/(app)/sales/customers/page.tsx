import { Fold } from "@/components/fold";
import { Badge, Card, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { BANDS, KINDS, REGULAR_DAYS } from "@/domain/guests";
import { money, pct, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { guestView } from "@/server/services/guests";
import { LoadHistory } from "./load-history";

export const metadata = { title: "Customers" };
/** Loading years of card payments from Square runs in half-minute stretches. */
export const maxDuration = 60;

const dated = (d: string) => `${shortDate(d)}, ${d.slice(0, 4)}`;
const DOT = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-muted" } as const;

export default async function CustomersPage() {
  await requireUser("MANAGER");
  const v = await guestView();
  const back = { href: "/sales", label: "Sales & forecast" };
  const header = <PageHeader help="sales.customers" title="Customers" back={back} description="Who comes back, how much regulars carry, and who has stopped coming. Worked out from card payments, with no names kept." />;
  const s = v.summary;
  const loading = !!v.backfill && !v.backfill.finishedAt;
  const loadedFrom = s?.from ?? null;

  if (!v.connected && !s) {
    return (
      <>
        {header}
        <EmptyState title="Square isn't connected">This page is built from card payments in Square. Connect Square under Settings › Connections first.</EmptyState>
      </>
    );
  }

  if (!s || s.guests === 0) {
    return (
      <>
        {header}
        <Card className="p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Nothing loaded yet</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">
            Square marks each card it sees. Ops can keep a scrambled copy of that mark for each day a card paid here, which is enough to tell a regular from a one-time visitor. No name, card number, email or phone is read or kept, and the mark can&apos;t be turned back into a card.
          </p>
          <div className="mt-4">
            <LoadHistory label="Load card visits from Square" firstSale={v.firstSale} />
          </div>
        </Card>
      </>
    );
  }

  const story = v.story;
  const r90 = s.returns.find((r) => r.within === 90);
  const weeks = [...v.weekly].reverse();

  return (
    <>
      {header}

      {(loading || (v.firstSale && loadedFrom && loadedFrom > v.firstSale && !v.backfill?.finishedAt)) && (
        <Card className="mb-8 p-4 sm:p-5">
          <p className="mb-3 text-sm text-ink-2">
            Card visits are on file from {loadedFrom ? dated(loadedFrom) : "recent days"}. Your sales go back to {v.firstSale ? dated(v.firstSale) : "earlier"}; the figures below get steadier as more is loaded.
            {v.backfill?.lastError && <span className="text-bad"> Last try: {v.backfill.lastError}</span>}
          </p>
          <LoadHistory label={v.backfill ? "Carry on loading" : "Load the rest of the history"} firstSale={v.firstSale} />
        </Card>
      )}

      {story ? (
        <Card className="mb-10 p-5 sm:p-6">
          <div className="text-xs text-muted">The last 12 months · card payments only</div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-balance text-ink sm:text-2xl">{story.headline}</h2>
          <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">{story.line}</p>
          <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-border pt-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Regulars ({REGULAR_DAYS} or more days a year)</dt>
              <dd className="num mt-0.5 text-lg font-semibold tracking-tight text-ink">
                {qty(s.regulars.guests, 0)} <span className="text-sm font-normal text-muted">· {pct(s.regulars.salesShare, 0)} of card sales</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">First-timers back within 3 months</dt>
              <dd className="num mt-0.5 text-lg font-semibold tracking-tight text-ink">{r90?.rate != null ? pct(r90.rate, 0) : "Too soon to say"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Regulars gone quiet</dt>
              <dd className="num mt-0.5 text-lg font-semibold tracking-tight text-ink">
                {qty(s.quiet.guests, 0)} <span className="text-sm font-normal text-muted">of {qty(s.quiet.of, 0)}</span>
              </dd>
            </div>
          </dl>
        </Card>
      ) : (
        <Card className="mb-10 p-5 text-sm text-ink-2">Only {qty(s.guests, 0)} different cards are on file for the last 12 months, too few to say much yet. Load more history above, or give it a few weeks.</Card>
      )}

      {story && story.points.length > 0 && (
        <Section help="sales.customers.todo" title="What to do with it" description="What stands out, and what it's good for.">
          <Card className="divide-y divide-border">
            {story.points.map((p) => (
              <div key={p.key} className="flex gap-3 px-4 py-4 sm:px-5">
                <span aria-hidden className={`mt-[0.45rem] size-2 shrink-0 rounded-full ${DOT[p.tone]}`} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[0.95rem] font-semibold text-ink">{p.title}</h3>
                  <p className="mt-0.5 text-sm text-ink-2">{p.detail}</p>
                  {p.action && <p className="mt-2 text-sm font-medium text-ink">{p.action}</p>}
                </div>
              </div>
            ))}
          </Card>
        </Section>
      )}

      <Section help="sales.customers.numbers" title="The numbers behind it" description={`${qty(s.guests, 0)} different cards over the last 12 months${loadedFrom ? `, with visits on file from ${dated(loadedFrom)}` : ""}. Open any line for the detail.`}>
        <Card className="overflow-hidden">
          <Fold title="How often people come" gist={`${pct(s.bands.once.guestShare, 0)} came once; regulars are ${pct(s.regulars.guestShare, 0)} of cards and ${pct(s.regulars.salesShare, 0)} of card sales`}>
            <Table>
              <thead>
                <tr>
                  <Th>How often</Th>
                  <Th align="right">Cards</Th>
                  <Th align="right" className="hidden sm:table-cell">Of cards</Th>
                  <Th align="right" className="hidden sm:table-cell">Card sales</Th>
                  <Th align="right">Of sales</Th>
                </tr>
              </thead>
              <tbody>
                {BANDS.map((b) => (
                  <Tr key={b.key}>
                    <Td>
                      <span className="font-medium text-ink">{b.label}</span>
                      <span className="block text-xs text-muted">{b.hint}</span>
                    </Td>
                    <Td align="right" className="num text-ink-2">{qty(s.bands[b.key].guests, 0)}</Td>
                    <Td align="right" className="num hidden text-ink-2 sm:table-cell">{pct(s.bands[b.key].guestShare, 0)}</Td>
                    <Td align="right" className="num hidden text-ink-2 sm:table-cell">{money(s.bands[b.key].sales, { whole: true })}</Td>
                    <Td align="right" className="num font-medium text-ink">{pct(s.bands[b.key].salesShare, 0)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">A “day” is one card on one business day, however many rounds it bought. Sales are before tips.</p>
          </Fold>

          <Fold title="Locals and visitors" gist={`Locals ${pct(s.kinds.local.salesShare, 0)} of card sales, visitors ${pct(s.kinds.visitor.salesShare, 0)}`}>
            <Table>
              <thead>
                <tr>
                  <Th>Who</Th>
                  <Th align="right">Cards</Th>
                  <Th align="right" className="hidden sm:table-cell">Of cards</Th>
                  <Th align="right">Of sales</Th>
                </tr>
              </thead>
              <tbody>
                {KINDS.map((k) => (
                  <Tr key={k.key}>
                    <Td>
                      <span className="font-medium text-ink">{k.label}</span>
                      <span className="block text-xs text-muted">{k.hint}</span>
                    </Td>
                    <Td align="right" className="num text-ink-2">{qty(s.kinds[k.key].guests, 0)}</Td>
                    <Td align="right" className="num hidden text-ink-2 sm:table-cell">{pct(s.kinds[k.key].guestShare, 0)}</Td>
                    <Td align="right" className="num font-medium text-ink">{pct(s.kinds[k.key].salesShare, 0)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">This is a reading of timing, not of where anyone lives: a weekender with a house nearby reads as a local, and a local who came once reads as a visitor.</p>
          </Fold>

          <Fold title="Do first-timers come back?" gist={r90?.rate != null ? `${pct(r90.rate, 0)} within three months` : "Too few first-timers have had time yet"}>
            <Table>
              <thead>
                <tr>
                  <Th>Came back within</Th>
                  <Th align="right" className="hidden sm:table-cell">First-timers followed</Th>
                  <Th align="right">Came back</Th>
                  <Th align="right">Share</Th>
                </tr>
              </thead>
              <tbody>
                {s.returns.map((r) => (
                  <Tr key={r.within}>
                    <Td><span className="font-medium text-ink">{r.within === 30 ? "A month" : r.within === 90 ? "Three months" : "A year"}</span></Td>
                    <Td align="right" className="num hidden text-ink-2 sm:table-cell">{qty(r.firstTimers, 0)}</Td>
                    <Td align="right" className="num text-ink-2">{qty(r.returned, 0)}</Td>
                    <Td align="right" className="num font-medium text-ink">{r.rate != null ? pct(r.rate, 0) : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">
              Cards first seen in the last two years, counted only once they&apos;ve had the whole time to come back.
              {s.shallow && " The history on file doesn't reach far enough back to be sure a “first-timer” is new, so these run a little high until more is loaded."}
            </p>
          </Fold>

          <Fold title="New and returning, week by week" gist={weeks.length ? `Last week: ${qty(weeks[0].guests, 0)} cards, ${qty(weeks[0].newGuests, 0)} never seen before` : "Nothing in the last six months"}>
            {weeks.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Week of</Th>
                    <Th align="right">Cards</Th>
                    <Th align="right">New</Th>
                    <Th align="right" className="hidden sm:table-cell">Card sales</Th>
                    <Th align="right">Returning</Th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => (
                    <Tr key={w.week}>
                      <Td><span className="font-medium text-ink">{shortDate(w.week)}</span></Td>
                      <Td align="right" className="num text-ink-2">{qty(w.guests, 0)}</Td>
                      <Td align="right" className="num text-ink-2">{qty(w.newGuests, 0)}</Td>
                      <Td align="right" className="num hidden text-ink-2 sm:table-cell">{money(w.sales, { whole: true })}</Td>
                      <Td align="right" className="num font-medium text-ink">{w.sales > 0 ? pct(w.returningSales / w.sales, 0) : "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">No card visits in the last six months.</p>
            )}
            <p className="mt-2 text-xs text-muted">“New” means never seen before on the history that&apos;s loaded. “Returning” is the share of that week&apos;s card sales from cards that had been in before. Weeks run Monday to Sunday.</p>
          </Fold>

          <Fold title="What Ops can and can't see" gist={s.coverage ? `${pct(s.coverage.amount, 0)} of what's paid carries a card that can be recognised again` : "How this is worked out"}>
            <div className="space-y-2 text-sm text-ink-2">
              {s.coverage && (
                <p>
                  Over the last 12 months {pct(s.coverage.payments, 0)} of payments, and {pct(s.coverage.amount, 0)} of the money, carried a card mark. <Badge>Everything on this page is a floor</Badge>
                </p>
              )}
              <p>Cash leaves no mark. A phone wallet and the card behind it look like two people. So does a couple who take turns paying, or someone who got a new card. The true repeat figures are higher than the ones here; the direction they move in can be trusted.</p>
              <p>Ops keeps a scrambled copy of Square&apos;s mark for each card, the day, and the amount. No name, card number, email or phone is read or kept, and the copy can&apos;t be turned back into a card. That also means nobody here can be contacted: for that you&apos;d need people to give you their details, through a membership or an email list.</p>
            </div>
          </Fold>
        </Card>
      </Section>
    </>
  );
}
