import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Card, cx, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { CASE_GALLONS, FEDERAL_REDUCED_BBL, FORM_INFO, FREQS, GAL_PER_BBL, nextPeriod, parsePeriod, periodKey, periodOf, previousPeriod, returnsDue, type Form, type Period } from "@/domain/beerTax";
import { money, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { beerTaxReport, brewKegCheck, filingsFor, historySince, taxSettings } from "@/server/services/beerTax";
import { businessToday } from "@/server/services/sales";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { AdjustmentForm, AdjustmentList, FiledList, ReturnsDue, TaxSettingsGrid } from "./tax-client";

export const metadata = { title: "Beer tax" };

const bbl = (gal: number) => qty(gal / GAL_PER_BBL, 2);
const gal = (n: number) => qty(n, 1);

export default async function BeerTaxPage({ searchParams }: { searchParams: Promise<{ p?: string; form?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const today = businessToday();
  const filings = await filingsFor();
  // Settings first: the default period is the return that needs Max most.
  const [s, since] = await Promise.all([taxSettings(), historySince()]);
  const due = returnsDue(today, s, filings, 10, since);
  const pressing = due.filter((d) => !d.filed && (!sp.form || d.form === sp.form)).sort((a, b) => a.due.localeCompare(b.due))[0];
  const lastFinished = previousPeriod(periodOf(today, s.freq.federal));
  const period: Period = parsePeriod(sp.p) ?? pressing?.period ?? (since && lastFinished.end < since ? periodOf(today, s.freq.federal) : lastFinished);
  const [r, beers, kegCheck] = await Promise.all([beerTaxReport(period), db.beer.findMany({ where: { house: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }), brewKegCheck(period)]);
  const w = r.worksheet;
  const href = (p: Period) => `/beer-tax?p=${periodKey(p)}`;
  const future = period.start > today;
  const ytdBbl = r.ytd.taxableGal / GAL_PER_BBL;
  const typedPackaged = r.moves.filter((m) => m.source === "typed" && m.kind === "packaged").reduce((t, m) => t + m.gallons, 0);
  const brewRows = r.moves.filter((m) => m.source === "brew");
  const brewCases = brewRows.filter((m) => m.kind === "packaged").reduce((t, m) => t + m.gallons, 0);
  const kegRows = r.moves.filter((m) => m.source === "keg");
  const kegDiffs = kegCheck.filter((k) => k.differs).length;
  const filedHere = filings.filter((f) => f.periodStart === period.start);

  const lines: { label: string; gal: number; ytd: number; strong?: boolean; sign?: "−"; help?: string }[] = [
    { label: "Kegs tapped in the taproom", gal: w.taproomGal, ytd: r.ytd.taproomGal, help: "beertax.taproom" },
    { label: "Kegs sent to accounts", gal: w.accountGal, ytd: r.ytd.accountGal, help: "beertax.accounts" },
    { label: "Other removals (typed in)", gal: w.otherGal, ytd: r.ytd.otherGal },
    { label: "Returned to the brewery", gal: w.returnedGal, ytd: r.ytd.returnedGal, sign: "−" },
    { label: "Taxable removals", gal: w.taxableGal, ytd: r.ytd.taxableGal, strong: true },
  ];

  return (
    <>
      <PageHeader
        help="beertax.page"
        title="Beer tax"
        description="Your own beer that left the brewery, from the keg history: what to put on the federal excise return, the brewer's report and the New York beer tax return, and when each is due."
      />

      <HelpZone id="beertax.disclaimer" className="mb-6">
        <Card className="border-warn/40 bg-warn-bg/40 px-4 py-3 text-sm">
          <span className="font-medium text-warn">A worksheet, not tax advice.</span>{" "}
          <span className="text-ink-2">The rates (federal ${s.federalRate.toFixed(2)}/bbl, New York ${s.nyRate.toFixed(2)}/gal with the small brewer credit) and due dates are the usual ones for a small brewery. Confirm them with your accountant and change them at the bottom of the page.</span>
        </Card>
      </HelpZone>

      <HelpZone id="beertax.returns" tour="beertax.returns" className="mb-10">
        <Section title={<span className="inline-flex items-center gap-1.5">Returns <HelpTip id="beertax.returns" /></span>} description="The last finished period of each return. Mark one filed once it's in, with what you paid.">
          {due.length === 0 ? (
            <Card className="p-4 text-sm text-ink-2">
              {since ? "Nothing due yet — returns show up here once a period with keg history has finished." : <>No keg history yet, so there&apos;s nothing to report. Returns show up here once kegs are filled, tapped or sent out in the app (or imported from your old keg app). If you file now, keep doing it the way you do today.</>}
            </Card>
          ) : <ReturnsDue
            rows={due.map((d) => ({ form: d.form, name: FORM_INFO[d.form].short, who: FORM_INFO[d.form].who, periodLabel: d.period.label, periodKey: periodKey(d.period), due: d.due, state: d.state, filing: filings.find((f) => f.form === d.form && f.periodStart === d.period.start) ?? null }))}
            today={today}
            current={periodKey(period)}
            amounts={{ federal: w.federalTax, brop: null, ny: w.nyTax }}
          />}
        </Section>
      </HelpZone>

      {/* ---- Period picker ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-2" data-tour="beertax.period">
        <div className="flex items-center rounded-lg border border-border bg-surface">
          <Link href={href(previousPeriod(period))} aria-label="Previous period" className="grid size-10 place-items-center text-muted hover:text-ink sm:size-9"><ChevronLeft className="size-4" /></Link>
          <span className="min-w-28 px-1 text-center text-sm font-semibold">{period.label}</span>
          <Link href={href(nextPeriod(period))} aria-label="Next period" className="grid size-10 place-items-center text-muted hover:text-ink sm:size-9"><ChevronRight className="size-4" /></Link>
        </div>
        <div className="flex rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="Period length">
          {FREQS.map((f) => (
            <Link key={f.value} href={href(periodOf(period.start, f.value))} aria-current={period.freq === f.value ? "true" : undefined} className={cx("inline-flex h-9 items-center rounded-md px-3 text-xs font-medium sm:h-8", period.freq === f.value ? "bg-primary text-primary-ink" : "text-muted hover:text-ink")}>
              {f.label}
            </Link>
          ))}
        </div>
        <span className="text-xs text-muted">{shortDate(period.start)} – {shortDate(period.end)}{period.end >= today && !future ? " · still running" : ""}</span>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="beertax.stats">
        <Stat help="beertax.taxable" label="Taxable removals" value={`${bbl(w.taxableGal)} bbl`} hint={`${gal(w.taxableGal)} gallons`} />
        <Stat help="beertax.federal" label="Federal excise" value={money(w.federalTax)} hint={`at $${s.federalRate.toFixed(2)} a barrel`} />
        <Stat help="beertax.ny" label="New York beer tax" value={money(w.nyTax)} hint={w.nyCredit > 0 ? `${money(w.nyGross)} less ${money(w.nyCredit)} small brewer credit` : `at $${s.nyRate.toFixed(2)} a gallon`} />
        <Stat help="beertax.packaged" label="Packaged" value={`${bbl(w.packagedGal)} bbl`} hint={`${gal(w.packagedGal)} gallons in kegs and cases`} />
      </div>

      {r.skipped > 0 && (
        <Card className="mb-6 px-4 py-3 text-sm text-ink-2">
          {r.skipped} keg movement{r.skipped === 1 ? " has" : "s have"} no beer set, so {r.skipped === 1 ? "it isn't" : "they aren't"} counted. <Link href="/kegs/history" className="font-medium text-ink underline-offset-2 hover:underline">Fix them in the keg history</Link>.
        </Card>
      )}

      <div className="mb-10 grid gap-6 lg:grid-cols-2">
        <HelpZone id="beertax.worksheet">
          <Section title={<span className="inline-flex items-center gap-1.5">Worksheet <HelpTip id="beertax.worksheet" /></span>} className="mb-0">
            <Table>
              <thead>
                <tr><Th>Removals of your beer</Th><Th align="right">{period.label}</Th><Th align="right" className="hidden sm:table-cell">Year to date</Th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={l.label} className={cx(l.strong && "bg-surface-2/50")}>
                    <Td className={cx(l.strong && "font-semibold")}>{l.label}</Td>
                    <Td align="right" className={cx(l.strong && "font-semibold")}>{l.sign && l.gal > 0 ? "−" : ""}{gal(l.gal)} gal<span className="block text-xs font-normal text-muted">{bbl(l.gal)} bbl</span></Td>
                    <Td align="right" className="hidden text-muted sm:table-cell">{gal(l.ytd)} gal</Td>
                  </Tr>
                ))}
                <Tr><Td>Federal excise at ${s.federalRate.toFixed(2)}/bbl</Td><Td align="right" className="font-semibold">{money(w.federalTax)}</Td><Td align="right" className="hidden text-muted sm:table-cell">{money(r.ytd.federalTax)}</Td></Tr>
                <Tr><Td>NY tax at ${s.nyRate.toFixed(2)}/gal</Td><Td align="right">{money(w.nyGross)}</Td><Td align="right" className="hidden text-muted sm:table-cell">{money(r.ytd.nyGross)}</Td></Tr>
                {s.nyCredit && w.nyCredit + r.ytd.nyCredit > 0 && <Tr><Td>NY small brewer credit</Td><Td align="right">−{money(w.nyCredit)}</Td><Td align="right" className="hidden text-muted sm:table-cell">−{money(r.ytd.nyCredit)}</Td></Tr>}
                <Tr className="bg-surface-2/50"><Td className="font-semibold">NY tax due</Td><Td align="right" className="font-semibold">{money(w.nyTax)}</Td><Td align="right" className="hidden text-muted sm:table-cell">{money(r.ytd.nyTax)}</Td></Tr>
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">
              {qty(ytdBbl, 1)} of the {FEDERAL_REDUCED_BBL.toLocaleString()} barrels at the reduced federal rate used this year. {brewCases > 0 && <>Cases from the brewery: {gal(brewCases)} gal. </>}{typedPackaged > 0 && <>Packaged outside kegs (typed in): {gal(typedPackaged)} gal. </>}{w.lossGal > 0 && <>Dumped or lost: {gal(w.lossGal)} gal.</>}
            </p>
          </Section>
        </HelpZone>

        <HelpZone id="beertax.byBeer">
          <Section title={<span className="inline-flex items-center gap-1.5">By beer <HelpTip id="beertax.byBeer" /></span>} className="mb-0">
            {w.byBeer.length === 0 ? (
              <Card className="p-4 text-sm text-muted">{future ? "This period hasn't started." : "No house beer was filled or removed in this period."}</Card>
            ) : (
              <Table>
                <thead><tr><Th>Beer</Th><Th align="right" className="hidden sm:table-cell">Packaged</Th><Th align="right">Taproom</Th><Th align="right" className="hidden sm:table-cell">Accounts</Th><Th align="right">Taxable bbl</Th></tr></thead>
                <tbody>
                  {w.byBeer.map((b) => (
                    <Tr key={b.beerId ?? b.beer}>
                      <Td className="font-medium">{b.beer}</Td>
                      <Td align="right" className="hidden sm:table-cell">{gal(b.packaged)}</Td>
                      <Td align="right">{gal(b.taproom)}</Td>
                      <Td align="right" className="hidden sm:table-cell">{gal(b.account)}</Td>
                      <Td align="right" className="font-medium">{bbl(b.taxable)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="mt-2 text-xs text-muted">Gallons, house beers only — guest beers are taxed by their brewery.</p>
          </Section>
        </HelpZone>
      </div>

      <HelpZone id="beertax.adjustments" className="mb-10">
        <Section title={<span className="inline-flex items-center gap-1.5">Not in a keg <HelpTip id="beertax.adjustments" /></span>} description="Crowlers or growlers filled from the tank, beer returned to the brewery, or anything else. Kegs, cases and dumped brews are counted on their own.">
          <AdjustmentForm beers={beers} defaultDate={period.end < today ? period.end : today} today={today} />
          <AdjustmentList rows={r.moves.filter((m) => m.source === "typed" && m.adjustmentId).map((m) => ({ id: m.adjustmentId!, date: m.date, kind: m.kind, gallons: m.gallons, beer: m.beer, note: m.note }))} />
        </Section>
      </HelpZone>

      <HelpZone id="beertax.brewery" className="mb-10">
        <Section title={<span className="inline-flex items-center gap-1.5">From the brewery <HelpTip id="beertax.brewery" /></span>} description={`Cases packaged (${CASE_GALLONS} gallons a case of 24 twelve-ounce cans) and brews dumped, read from each brew. Kegs come from the keg scans below.`}>
          {typedPackaged > 0 && brewCases > 0 && (
            <Card className="mb-3 border-warn/40 bg-warn-bg/40 px-4 py-3 text-sm text-ink-2">
              <span className="font-medium text-warn">Cases may be counted twice.</span> Packaged gallons were typed in under Not in a keg as well as read from the brews. If they&apos;re the same cans, delete the typed line.
            </Card>
          )}
          {brewRows.length === 0 ? (
            <Card className="p-4 text-sm text-muted">No cases packaged or brews dumped in this period.</Card>
          ) : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Brew</Th><Th className="hidden sm:table-cell">Beer</Th><Th>What</Th><Th align="right">Gal</Th></tr></thead>
              <tbody>
                {brewRows.map((m) => (
                  <Tr key={`${m.brewId}-${m.kind}`}>
                    <Td className="num whitespace-nowrap text-muted">{shortDate(m.date)}</Td>
                    <Td><Link href={`/brewery/batches/${m.brewId}`} className="num font-medium underline-offset-2 hover:underline">{m.ref}</Link><span className="block text-xs text-muted sm:hidden">{m.beer}</span></Td>
                    <Td className="hidden sm:table-cell">{m.beer}</Td>
                    <Td className="text-ink-2">{m.kind === "loss" ? "Dumped" : `${qty(m.gallons / CASE_GALLONS, 0)} cases`}</Td>
                    <Td align="right">{gal(m.gallons)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {r.heldBack.length > 0 && (
            <p className="mt-2 text-xs text-muted">{r.heldBack.length} brewery line{r.heldBack.length === 1 ? " is" : "s are"} in a period already marked filed, so {r.heldBack.length === 1 ? "it isn't" : "they aren't"} added: a filed return&apos;s numbers don&apos;t change.</p>
          )}

          <div className="mt-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Kegs: brew counts against scans</h3>
              {kegDiffs > 0 && <Badge tone="warn">{kegDiffs} to check</Badge>}
            </div>
            {kegCheck.length === 0 ? (
              <Card className="p-4 text-sm text-muted">No brews were kegged in this period.</Card>
            ) : (
              <Table>
                <thead><tr><Th>Brew</Th><Th align="right">Half kegs</Th><Th align="right">Sixtels</Th><Th className="hidden sm:table-cell">Check</Th></tr></thead>
                <tbody>
                  {kegCheck.map((k) => (
                    <Tr key={k.brewId}>
                      <Td>
                        <Link href={`/brewery/batches/${k.brewId}`} className="num font-medium underline-offset-2 hover:underline">{k.code}</Link>
                        <span className="block text-xs text-muted">{k.name}{k.packagedOn ? ` · ${shortDate(k.packagedOn)}` : ""}</span>
                        <span className="block sm:hidden">{!k.linked ? <span className="text-xs text-muted">No keg batch linked</span> : k.differs ? <Badge tone="warn">Differs</Badge> : null}</span>
                      </Td>
                      <Td align="right" className={cx(k.linked && k.brewHalf !== k.scannedHalf && "text-warn")}>{k.brewHalf}{k.linked && <span className="block text-xs text-muted">{k.scannedHalf} scanned</span>}</Td>
                      <Td align="right" className={cx(k.linked && k.brewSixth !== k.scannedSixth && "text-warn")}>{k.brewSixth}{k.linked && <span className="block text-xs text-muted">{k.scannedSixth} scanned</span>}</Td>
                      <Td className="hidden text-sm sm:table-cell">
                        {!k.linked ? <span className="text-muted">No keg batch linked, so no scans to compare</span> : k.differs ? <Badge tone="warn">Differs</Badge> : <span className="text-good">Matches</span>}
                        {k.scannedOther > 0 && <span className="block text-xs text-muted">{k.scannedOther} other size{k.scannedOther === 1 ? "" : "s"} scanned</span>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="mt-2 text-xs text-muted">The keg counts written at packaging, next to the kegs scanned as filled from that brew&apos;s keg batch. The worksheet counts the scans.</p>
          </div>
        </Section>
      </HelpZone>

      <HelpZone id="beertax.moves" className="mb-10">
        <Section title={<span className="inline-flex items-center gap-1.5">Keg by keg <HelpTip id="beertax.moves" /></span>} description="Every keg counted above, so you can check it against the cellar log.">
          {kegRows.length === 0 ? <Card className="p-4 text-sm text-muted">No keg movements in this period.</Card> : (
            <Table sticky className="max-h-[28rem]">
              <thead><tr><Th>Date</Th><Th>Keg</Th><Th>Beer</Th><Th className="hidden sm:table-cell">What</Th><Th align="right">Gal</Th></tr></thead>
              <tbody>
                {kegRows.map((m, i) => (
                  <Tr key={`${m.ref}-${m.kind}-${i}`}>
                    <Td className="num whitespace-nowrap text-muted">{shortDate(m.date)}</Td>
                    <Td><Link href={`/kegs/k/${m.ref}`} className="num font-medium underline-offset-2 hover:underline">{m.ref}</Link><span className="block text-xs text-muted">{m.size}</span></Td>
                    <Td>{m.beer}<span className="block text-xs text-muted sm:hidden">{MOVE_LABEL[m.kind]}</span></Td>
                    <Td className="hidden text-ink-2 sm:table-cell">{MOVE_LABEL[m.kind]}{m.note ? ` · ${m.note}` : ""}</Td>
                    <Td align="right">{gal(m.gallons)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      </HelpZone>

      <div className="grid gap-6 lg:grid-cols-2">
        <HelpZone id="beertax.settings">
          <Section title={<span className="inline-flex items-center gap-1.5">Rates and due dates <HelpTip id="beertax.settings" /></span>} className="mb-0">
            <TaxSettingsGrid s={s} forms={(Object.keys(FORM_INFO) as Form[]).map((f) => ({ form: f, name: FORM_INFO[f].name }))} />
          </Section>
        </HelpZone>
        <HelpZone id="beertax.filed">
          <Section title="Filed" className="mb-0" actions={filedHere.length ? <LinkButton href={href(period)} size="sm" variant="ghost">This period</LinkButton> : undefined}>
            <FiledList rows={filings.map((f) => ({ ...f, name: FORM_INFO[f.form].short, label: periodLabel(f.periodStart, f.periodEnd) }))} />
          </Section>
        </HelpZone>
      </div>
    </>
  );
}

const MOVE_LABEL: Record<string, string> = { packaged: "Filled", taproom: "Tapped in the taproom", account: "Sent to an account", removed: "Other removal", returned: "Returned", loss: "Loss" };

/** The period a filing covers, named the same way as the picker. */
function periodLabel(start: string, end: string) {
  for (const f of ["month", "quarter", "year"] as const) {
    const p = periodOf(start, f);
    if (p.start === start && p.end === end) return p.label;
  }
  return `${shortDate(start)} – ${shortDate(end)}`;
}
