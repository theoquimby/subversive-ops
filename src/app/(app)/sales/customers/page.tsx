import { Badge, Card, cx, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { BANDS, KINDS, REGULAR_DAYS, type CategoryMix, type GuestPoint, type ItemPick, type RhythmCell } from "@/domain/guests";
import { mondayOf } from "@/domain/pnl";
import { money, pct, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { guestView } from "@/server/services/guests";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { ColourKey, Columns, LeanRows, PairBars, ShareBars, Waffle, type Col, type SharePart, type VizTone, type WafflePart } from "./charts";
import { LoadHistory } from "./load-history";

export const metadata = { title: "Customers" };
/** Loading years of card payments from Square runs in half-minute stretches. */
export const maxDuration = 60;

const dated = (d: string) => `${shortDate(d)}, ${d.slice(0, 4)}`;
const DOT = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-border-strong" } as const;
const FLAG = { good: "Going well", warn: "Worth a look", bad: "Needs attention" } as const;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const count = (x: number) => (x >= 10 ? qty(x, 0) : qty(x, 1));
const whole = (x: number) => money(x, { whole: true });
/** A share as a whole percent, without calling a sliver "0%". */
const p0 = (x: number) => (x > 0 && x < 0.005 ? "under 1%" : pct(x, 0));
/** A weekday the place is open most weeks: enough of them to call a pattern. */
const REGULAR_OPEN_DAYS = 26;

const BAND_TONE: Record<(typeof BANDS)[number]["key"], VizTone> = { once: "rest", few: "back-1", regular: "back-2", core: "back-3" };
const KIND_TONE: Record<(typeof KINDS)[number]["key"], VizTone> = { local: "local", visitor: "visitor", occasional: "rest", new: "rest" };

/** One finding: what it is, the picture, what to do about it, and the table underneath for anyone who wants it. */
function Chapter({ id, point, title, detail, children, numbers, className }: { id: string; point?: GuestPoint; title: string; detail?: ReactNode; children: ReactNode; numbers?: ReactNode; className?: string }) {
  const tone = point?.tone ?? "neutral";
  return (
    <Card id={id} className={cx("flex scroll-mt-24 flex-col p-4 sm:p-6", className)}>
      {tone !== "neutral" && (
        <div className="mb-2">
          <Badge tone={tone}>{FLAG[tone]}</Badge>
        </div>
      )}
      <h3 className="max-w-3xl text-base font-semibold tracking-tight text-balance text-ink sm:text-lg">{point?.title ?? title}</h3>
      {(point?.detail ?? detail) && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">{point?.detail ?? detail}</p>}
      <div className="mt-5 flex-1">{children}</div>
      {point?.action && (
        <div className="mt-5 flex gap-2.5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm text-ink">
          <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
          <p className="max-w-2xl font-medium">{point.action}</p>
        </div>
      )}
      {numbers && (
        <details className="group/num mt-4 border-t border-border pt-2">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-md pr-2 text-sm text-muted transition-colors duration-120 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden className="size-4 transition-transform duration-180 group-open/num:rotate-180" />
            The numbers
          </summary>
          <div className="mt-2">{numbers}</div>
        </details>
      )}
    </Card>
  );
}

/** A typical open day per weekday or month: sales, local and visitor cards, and locals' share of the money. */
function RhythmTable({ first, cells, name }: { first: string; cells: RhythmCell[]; name: (key: number) => string }) {
  const top = Math.max(...cells.map((c) => c.localShare));
  return (
    <Table>
      <thead>
        <tr>
          <Th>{first}</Th>
          <Th align="right" className="hidden sm:table-cell">Open days</Th>
          <Th align="right">Sales a day</Th>
          <Th align="right">Local cards</Th>
          <Th align="right" className="hidden sm:table-cell">Visitor cards</Th>
          <Th align="right">Locals&apos; share</Th>
        </tr>
      </thead>
      <tbody>
        {cells.map((c) => (
          <Tr key={c.key}>
            <Td><span className="font-medium text-ink">{name(c.key)}</span></Td>
            <Td align="right" className="num hidden text-ink-2 sm:table-cell">{qty(c.openDays, 0)}</Td>
            <Td align="right" className="num text-ink-2">{whole(c.salesPerDay)}</Td>
            <Td align="right" className="num text-ink-2">{count(c.localsPerDay)}</Td>
            <Td align="right" className="num hidden text-ink-2 sm:table-cell">{count(c.visitorsPerDay)}</Td>
            <Td align="right" className={`num ${c.localShare === top ? "font-semibold text-ink" : "font-medium text-ink"}`}>{pct(c.localShare, 0)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** A typical open day as one column: card sales, split by who brought them. */
function rhythmCols(cells: RhythmCell[], label: (key: number) => string, title: (c: RhythmCell) => string, mark: number | null, withShare: boolean): Col[] {
  return cells.map((c) => {
    const local = c.salesPerDay * c.localShare;
    const visitor = c.salesPerDay * c.visitorShare;
    const rest = Math.max(0, c.salesPerDay - local - visitor);
    return {
      key: String(c.key),
      label: label(c.key),
      sub: withShare ? pct(c.localShare, 0) : undefined,
      mark: c.key === mark,
      parts: [local, visitor, rest],
      tip: {
        title: title(c),
        rows: [
          { label: "Card sales", value: whole(c.salesPerDay), strong: true },
          { tone: "local", label: "Locals", value: `${whole(local)} · ${count(c.localsPerDay)} cards` },
          { tone: "visitor", label: "Visitors", value: `${whole(visitor)} · ${count(c.visitorsPerDay)} cards` },
          { tone: "rest", label: "Now and then", value: whole(rest) },
        ],
      },
    };
  });
}

function FavouritesTable({ title, picks, share, who }: { title: string; picks: ItemPick[]; share: (p: ItemPick) => number; who: string }) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium text-ink">{title}</h4>
      {picks.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right" className="hidden sm:table-cell">Card sales</Th>
              <Th align="right">From {who}</Th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => (
              <Tr key={p.key}>
                <Td>
                  <span className="font-medium text-ink">{p.name}</span>
                  {p.category && <span className="block text-xs text-muted">{p.category}</span>}
                </Td>
                <Td align="right" className="num hidden text-ink-2 sm:table-cell">{whole(p.sales)}</Td>
                <Td align="right" className="num font-medium text-ink">{pct(share(p), 0)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="text-sm text-muted">Nothing stands out yet.</p>
      )}
    </div>
  );
}

function MixTable({ first, rows }: { first: string; rows: CategoryMix[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{first}</Th>
          <Th align="right" className="hidden sm:table-cell">Card sales</Th>
          <Th align="right">Of locals&apos; spend</Th>
          <Th align="right">Of visitors&apos; spend</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <Tr key={c.name}>
            <Td><span className="font-medium text-ink">{c.name}</span></Td>
            <Td align="right" className="num hidden text-ink-2 sm:table-cell">{whole(c.sales)}</Td>
            <Td align="right" className="num text-ink-2">{pct(c.local, 0)}</Td>
            <Td align="right" className="num text-ink-2">{pct(c.visitor, 0)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function CustomersPage() {
  await requireUser("MANAGER");
  const v = await guestView();
  const back = { href: "/sales", label: "Sales & forecast" };
  const header = <PageHeader help="sales.customers" title="Customers" back={back} description="Who comes back, how much regulars carry, and who has stopped coming. Worked out from card payments, with no names kept." />;
  const s = v.summary;
  const loading = !!v.backfill && !v.backfill.finishedAt;
  const itemsPending = !v.itemsBackfill?.finishedAt;
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
  const point = (key: string) => story?.points.find((p) => p.key === key);
  const r30 = s.returns.find((r) => r.within === 30);
  const r90 = s.returns.find((r) => r.within === 90);
  const r365 = s.returns.find((r) => r.within === 365);
  const weeks = [...v.weekly].reverse();
  const rhythm = v.rhythm;
  const orders = v.orders;

  // ---- The pictures: everything a chart needs, as plain data ---------------------------------

  const bandParts: SharePart[] = BANDS.map((b) => ({
    key: b.key,
    label: b.label,
    tone: BAND_TONE[b.key],
    readout: `${b.label} (${b.hint.replace(" in the last year", "")}): ${p0(s.bands[b.key].guestShare)} of cards and ${p0(s.bands[b.key].salesShare)} of card sales. That's ${qty(s.bands[b.key].guests, 0)} cards and ${whole(s.bands[b.key].sales)}.`,
  }));
  const bandRows = [
    { label: "Of all the cards that paid here", shares: Object.fromEntries(BANDS.map((b) => [b.key, s.bands[b.key].guestShare])) },
    { label: "Of all the money those cards spent", shares: Object.fromEntries(BANDS.map((b) => [b.key, s.bands[b.key].salesShare])) },
  ];

  const kindParts: SharePart[] = KINDS.map((k) => ({
    key: k.key,
    label: k.label,
    tone: KIND_TONE[k.key],
    hatch: k.key === "new",
    readout: `${k.label}: ${p0(s.kinds[k.key].guestShare)} of cards and ${p0(s.kinds[k.key].salesShare)} of card sales. ${k.hint}.`,
  }));
  const kindRows = [
    { label: "Of all the cards that paid here", shares: Object.fromEntries(KINDS.map((k) => [k.key, s.kinds[k.key].guestShare])) },
    { label: "Of all the money those cards spent", shares: Object.fromEntries(KINDS.map((k) => [k.key, s.kinds[k.key].salesShare])) },
  ];

  const regularDays = rhythm?.weekdays.filter((c) => c.openDays >= REGULAR_OPEN_DAYS) ?? [];
  const mostLocal = regularDays.length ? [...regularDays].sort((a, b) => b.localShare - a.localShare)[0] : null;
  const whoSeries: { tone: VizTone; label: string }[] = [
    { tone: "local", label: "From locals" },
    { tone: "visitor", label: "From visitors" },
    { tone: "rest", label: "Now and then" },
  ];
  const dayCols = rhythm ? rhythmCols(rhythm.weekdays, (k) => DAYS[k].slice(0, 3), (c) => `A typical ${DAYS[c.key]} · open ${qty(c.openDays, 0)} times`, mostLocal?.key ?? null, true) : [];
  const monthCols = rhythm ? rhythmCols(rhythm.months, (k) => MONTHS[k - 1].slice(0, 3), (c) => `A typical open day in ${MONTHS[c.key - 1]}`, null, false) : [];

  const mixGap = point("mix");
  const topGap = orders ? [...orders.categories].filter((c) => c.name !== "Other").sort((a, b) => Math.abs(b.local - b.visitor) - Math.abs(a.local - a.visitor))[0] : null;
  const topCategory = orders?.categories[0] ?? null;

  const waffle: WafflePart[] = [];
  if (r30?.rate != null) {
    const a = Math.round(r30.rate * 100);
    const b = r90?.rate != null ? Math.max(0, Math.round(r90.rate * 100) - a) : null;
    const c = r365?.rate != null ? Math.max(0, Math.round(r365.rate * 100) - a - (b ?? 0)) : null;
    waffle.push({ key: "month", label: "back within a month", tone: "back-3", count: a });
    if (b != null) waffle.push({ key: "quarter", label: "more within three months", tone: "back-2", count: b });
    if (c != null) waffle.push({ key: "year", label: "more within a year", tone: "back-1", count: c });
    const back = a + (b ?? 0) + (c ?? 0);
    waffle.push({ key: "gone", label: c != null ? "not seen again in their first year" : "not back yet", tone: "rest", count: Math.max(0, 100 - back), note: "On a card Ops can recognise, that is." });
  }

  const weekCols: Col[] = v.weekly.map((w) => ({
    key: w.week,
    label: shortDate(w.week),
    parts: [w.returningSales, Math.max(0, w.sales - w.returningSales)],
    tip: {
      title: `Week of ${shortDate(w.week)}`,
      rows: [
        { label: "Card sales", value: whole(w.sales), strong: true },
        { tone: "back-2", label: "Been before", value: w.sales > 0 ? `${whole(w.returningSales)} · ${pct(w.returningSales / w.sales, 0)}` : "—" },
        { tone: "rest", label: "First time", value: whole(Math.max(0, w.sales - w.returningSales)) },
        { label: "Cards", value: `${qty(w.guests, 0)} · ${qty(w.newGuests, 0)} new` },
      ],
    },
  }));
  const weekSales = v.weekly.reduce((a, w) => a + w.sales, 0);
  const weekReturning = v.weekly.reduce((a, w) => a + w.returningSales, 0);
  // The newest week on file is usually still in progress; "last week" is the one before it.
  const lastWeek = weeks.find((w) => w.week < mondayOf(s.asOf)) ?? null;

  const quietParts: SharePart[] = [
    { key: "coming", label: "Still coming", tone: "back-2", readout: `${qty(s.quiet.of - s.quiet.guests, 0)} of last year's ${qty(s.quiet.of, 0)} regulars have been in about as often as is usual for them.` },
    { key: "quiet", label: "Gone quiet", tone: "quiet", readout: `${qty(s.quiet.guests, 0)} have been away at least two months, and two and a half times their own usual gap. They spent about ${whole(s.quiet.sales)} between them the year before.` },
  ];

  const seenParts: SharePart[] = s.coverage
    ? [
        { key: "seen", label: "Paid with a card Ops can recognise again", tone: "seen", readout: `${pct(s.coverage.amount, 0)} of the money, and ${pct(s.coverage.payments, 0)} of payments, carried a card mark over the last 12 months.` },
        { key: "unseen", label: "Cash, or no card mark", tone: "rest", hatch: true, readout: `${pct(1 - s.coverage.amount, 0)} of the money left no mark, so whoever paid it isn't counted anywhere on this page.` },
      ]
    : [];

  // The findings in the order the page tells them, for the list at the top.
  const contents = [
    point("kinds") && { id: "who", p: point("kinds")! },
    point("weekdays") && { id: "weekdays", p: point("weekdays")! },
    point("season") && { id: "season", p: point("season")! },
    point("orders") && { id: "orders", p: point("orders")! },
    point("mix") && { id: "mix", p: point("mix")! },
    point("returns") && { id: "returns", p: point("returns")! },
    point("quiet") && { id: "quiet", p: point("quiet")! },
    point("coverage") && { id: "worked-out", p: point("coverage")! },
  ].filter((x): x is { id: string; p: GuestPoint } => !!x);

  return (
    <>
      {header}

      {loading || (v.firstSale && loadedFrom && loadedFrom > v.firstSale && !v.backfill?.finishedAt) ? (
        <Card className="mb-8 p-4 sm:p-5">
          <p className="mb-3 text-sm text-ink-2">
            Card visits are on file from {loadedFrom ? dated(loadedFrom) : "recent days"}. Your sales go back to {v.firstSale ? dated(v.firstSale) : "earlier"}; the figures below get steadier as more is loaded.
            {v.backfill?.lastError && <span className="text-bad"> Last try: {v.backfill.lastError}</span>}
          </p>
          <LoadHistory label={v.backfill ? "Carry on loading" : "Load the rest of the history"} firstSale={v.firstSale} />
        </Card>
      ) : itemsPending ? (
        <Card className="mb-8 p-4 sm:p-5">
          <p className="mb-3 text-sm text-ink-2">
            {v.itemsBackfill ? `What each card ordered is loaded back to ${dated(v.itemsBackfill.next)}.` : "One more thing can be loaded: what each card ordered over the last two years, to see what locals and visitors buy."}
            {v.itemsBackfill?.lastError && <span className="text-bad"> Last try: {v.itemsBackfill.lastError}</span>}
          </p>
          <LoadHistory label={v.itemsBackfill ? "Carry on loading" : "Load what each card ordered"} firstSale={null} />
        </Card>
      ) : null}

      {story ? (
        <Card className="mb-4 p-5 sm:p-6">
          <h2 className="max-w-3xl text-xl font-semibold tracking-tight text-balance text-ink sm:text-2xl">{story.headline}</h2>
          <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">{story.line}</p>
          <div className="mt-6">
            <ShareBars
              parts={bandParts}
              rows={bandRows}
              ariaLabel="Cards and card sales by how often each card came"
              lead={`Follow the darker slices down: regulars are ${p0(s.regulars.guestShare)} of the cards and ${p0(s.regulars.salesShare)} of the money. Tap or point at a slice to read it.`}
            />
          </div>
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
          <details className="group/num mt-4 border-t border-border pt-2">
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-md pr-2 text-sm text-muted transition-colors duration-120 hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden className="size-4 transition-transform duration-180 group-open/num:rotate-180" />
              The numbers
            </summary>
            <div className="mt-2">
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
                      <Td align="right" className="num hidden text-ink-2 sm:table-cell">{whole(s.bands[b.key].sales)}</Td>
                      <Td align="right" className="num font-medium text-ink">{pct(s.bands[b.key].salesShare, 0)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-muted">The last 12 months, card payments only. A “day” is one card on one business day, however many rounds it bought. Sales are before tips.</p>
            </div>
          </details>
        </Card>
      ) : (
        <Card className="mb-10 p-5 text-sm text-ink-2">Only {qty(s.guests, 0)} different cards are on file for the last 12 months, too few to say much yet. Load more history above, or give it a few weeks.</Card>
      )}

      {story && (
        <div className="mb-10 px-1">
          <ColourKey
            items={[
              { tone: "local", label: "Locals", hint: "seen in three or more months" },
              { tone: "visitor", label: "Visitors", hint: "a few days, then gone" },
              { tone: "back-2", label: "Came back", hint: "the darker, the more often" },
              { tone: "rest", label: "Everyone else", hint: "" },
            ]}
          />
        </div>
      )}

      {contents.length > 0 && (
        <Section help="sales.customers.todo" title="In short" description="What stands out, in the order the page tells it. Tap one to jump to it.">
          <Card className="divide-y divide-border overflow-hidden">
            {contents.map(({ id, p }) => (
              <a key={p.key} href={`#${id}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors duration-120 hover:bg-surface-2/60 sm:px-5">
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[p.tone]}`} />
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                  {p.title}
                  {p.tone !== "neutral" && <span className="sr-only"> ({FLAG[p.tone]})</span>}
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
              </a>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Who they are" description={`${qty(s.guests, 0)} different cards paid here over the last 12 months${loadedFrom ? `, with visits on file from ${dated(loadedFrom)}` : ""}.`}>
        <Chapter
          id="who"
          point={point("kinds")}
          title="Locals and visitors"
          detail="Going by timing alone: a card seen in three or more separate months is a local, one seen on a few days within ten days and never again is a visitor."
          numbers={
            <>
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
            </>
          }
        >
          <ShareBars
            parts={kindParts}
            rows={kindRows}
            ariaLabel="Cards and card sales by locals, visitors and everyone else"
            lead={`The blue slice widens on the way down: locals are ${p0(s.kinds.local.guestShare)} of the cards and ${p0(s.kinds.local.salesShare)} of the money. The pink one narrows: visitors are ${p0(s.kinds.visitor.guestShare)} and ${p0(s.kinds.visitor.salesShare)}.`}
          />
        </Chapter>
      </Section>

      {rhythm && (dayCols.length > 0 || monthCols.length > 0) && (
        <Section title="When they come" description="A typical open day over the last 12 months: card sales, split by who brought them.">
          <div className="grid gap-4 xl:grid-cols-2">
            {dayCols.length > 0 && (
              <Chapter id="weekdays" point={point("weekdays")} title="Who comes on which day" numbers={<RhythmTable first="Weekday" cells={rhythm.weekdays} name={(k) => DAYS[k]} />}>
                <Columns cols={dayCols} series={whoSeries} ariaLabel="Card sales on a typical open day, by weekday and by who brought them" caption="Weekday" />
                <p className="mt-2 text-xs text-muted">
                  The figure under each day is locals&apos; share of that day&apos;s card sales{mostLocal ? `; ${DAYS[mostLocal.key]} is the highest` : ""}. Days you&apos;re rarely open are shown but not compared.
                </p>
              </Chapter>
            )}
            {monthCols.length > 0 && (
              <Chapter
                id="season"
                point={point("season")}
                title="Who comes through the year"
                numbers={
                  <>
                    <RhythmTable first="Month" cells={rhythm.months} name={(k) => MONTHS[k - 1]} />
                    <p className="mt-2 text-xs text-muted">A card first seen in the last few weeks is counted by what it has done so far, so the most recent month leans a little towards visitors.</p>
                  </>
                }
              >
                <Columns cols={monthCols} series={whoSeries} ariaLabel="Card sales on a typical open day, by month and by who brought them" caption="Month" />
                <p className="mt-2 text-xs text-muted">Watch the blue: it&apos;s the part of the day that doesn&apos;t depend on who&apos;s in town.</p>
              </Chapter>
            )}
          </div>
        </Section>
      )}

      {orders && (
        <Section title="What they order" description="An order counts for the card that paid for it, so a round bought for the table is the buyer's.">
          <div className="grid gap-4">
            <Chapter
              id="orders"
              point={point("orders")}
              title="What locals and visitors order"
              detail={`Locals bring ${pct(orders.localShare, 0)} of card sales and visitors ${pct(orders.visitorShare, 0)}. An item is listed when one group buys noticeably more of it than that.`}
              numbers={
                <>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <FavouritesTable title="Locals buy more of" picks={orders.localFavourites} share={(p) => p.localShare} who="locals" />
                    <FavouritesTable title="Visitors buy more of" picks={orders.visitorFavourites} share={(p) => p.visitorShare} who="visitors" />
                  </div>
                  <p className="mt-2 text-xs text-muted">A beer is judged whole, whatever size it was poured in; add-ons and items without a Square category are left out. Brand-new cards are counted by what they&apos;ve done so far. Item detail is kept for two years.</p>
                </>
              }
            >
              {orders.localFavourites.length + orders.visitorFavourites.length > 0 ? (
                <LeanRows
                  baseLocal={orders.localShare}
                  baseVisitor={orders.visitorShare}
                  groups={[
                    {
                      title: "Locals buy more of",
                      valueLabel: "From locals",
                      rows: [
                        { key: "all", name: "Everything sold", local: orders.localShare, visitor: orders.visitorShare, value: pct(orders.localShare, 0), base: true },
                        ...orders.localFavourites.map((p) => ({ key: p.key, name: p.name, hint: p.category, local: p.localShare, visitor: p.visitorShare, value: pct(p.localShare, 0) })),
                      ],
                    },
                    {
                      title: "Visitors buy more of",
                      valueLabel: "From visitors",
                      rows: [
                        { key: "all", name: "Everything sold", local: orders.localShare, visitor: orders.visitorShare, value: pct(orders.visitorShare, 0), base: true },
                        ...orders.visitorFavourites.map((p) => ({ key: p.key, name: p.name, hint: p.category, local: p.localShare, visitor: p.visitorShare, value: pct(p.visitorShare, 0) })),
                      ],
                    },
                  ].filter((g) => g.rows.length > 1)}
                />
              ) : (
                <p className="text-sm text-muted">Nothing stands out yet: both groups buy much the same things.</p>
              )}
            </Chapter>

            <Chapter
              id="mix"
              point={mixGap}
              title={topGap && Math.abs(topGap.local - topGap.visitor) < 0.05 ? "Locals and visitors split their money almost the same way" : "How each splits their money"}
              detail={
                <>
                  {topCategory && `${topCategory.name} is ${pct(topCategory.local, 0)} of what locals spend and ${pct(topCategory.visitor, 0)} of what visitors spend.`}
                  {orders.perVisit.local != null && orders.perVisit.visitor != null && ` A local's card spends about ${whole(orders.perVisit.local)} on a visit and a visitor's about ${whole(orders.perVisit.visitor)}.`}
                </>
              }
              numbers={
                <>
                  <MixTable first="Category" rows={orders.categories} />
                  {orders.servings.length > 0 && (
                    <div className="mt-5">
                      <MixTable first="Size or option" rows={orders.servings} />
                    </div>
                  )}
                </>
              }
            >
              <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
                <div>
                  <h4 className="mb-3 text-sm font-medium text-ink">By category</h4>
                  <PairBars rows={orders.categories.slice(0, 7).map((c) => ({ name: c.name, hint: whole(c.sales), local: c.local, visitor: c.visitor }))} mark={mixGap && topGap ? topGap.name : null} />
                </div>
                {orders.servings.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-sm font-medium text-ink">By size or option</h4>
                    <PairBars rows={orders.servings.map((c) => ({ name: c.name, hint: whole(c.sales), local: c.local, visitor: c.visitor }))} />
                  </div>
                )}
              </div>
            </Chapter>
          </div>
        </Section>
      )}

      <Section title="Whether they come back" description="First visits, repeat business week by week, and the regulars who've stopped.">
        <div className="grid gap-4 xl:grid-cols-2">
          <Chapter
            id="returns"
            point={point("returns")}
            title="Do first-timers come back?"
            detail={waffle.length ? undefined : "Too few first-timers have had time to come back yet."}
            numbers={
              <>
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
              </>
            }
          >
            {waffle.length > 0 && (
              <>
                <h4 className="mb-3 text-sm font-medium text-ink">Of every 100 cards seen for the first time</h4>
                <Waffle parts={waffle} ariaLabel={`Of every 100 first-time cards: ${waffle.map((w) => `${w.count} ${w.label}`).join(", ")}`} />
              </>
            )}
          </Chapter>

          <Chapter
            id="quiet"
            point={point("quiet")}
            title={s.quiet.of > 0 ? `${qty(s.quiet.guests, 0)} of last year's ${qty(s.quiet.of, 0)} regulars have gone quiet` : "Regulars gone quiet"}
            detail={s.quiet.of > 0 ? "A regular counts as quiet after at least two months away, and two and a half times their own usual gap." : "There aren't regulars from the year before to follow yet."}
          >
            {s.quiet.of > 0 && (
              <>
                <h4 className="mb-3 text-sm font-medium text-ink">The regulars of the year before</h4>
                <ShareBars
                  parts={quietParts}
                  rows={[{ label: "Regulars of the year before", shares: { coming: (s.quiet.of - s.quiet.guests) / s.quiet.of, quiet: s.quiet.guests / s.quiet.of } }]}
                  ariaLabel="Last year's regulars: still coming, and gone quiet"
                  lead={`${qty(s.quiet.guests, 0)} of ${qty(s.quiet.of, 0)} have gone quiet. They spent about ${whole(s.quiet.sales)} between them the year before.`}
                />
              </>
            )}
          </Chapter>
        </div>

        {weekCols.length > 0 && (
          <Chapter
            id="weekly"
            className="mt-4"
            title={weekSales > 0 ? `${pct(weekReturning / weekSales, 0)} of card sales over the last six months came from cards that had been in before` : "New and returning, week by week"}
            detail={lastWeek ? `Each column is a week of card sales. Last week: ${qty(lastWeek.guests, 0)} cards, ${qty(lastWeek.newGuests, 0)} of them never seen before.` : "Each column is a week of card sales."}
            numbers={
              <>
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
                        <Td align="right" className="num hidden text-ink-2 sm:table-cell">{whole(w.sales)}</Td>
                        <Td align="right" className="num font-medium text-ink">{w.sales > 0 ? pct(w.returningSales / w.sales, 0) : "—"}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <p className="mt-2 text-xs text-muted">“New” means never seen before on the history that&apos;s loaded. “Returning” is the share of that week&apos;s card sales from cards that had been in before. Weeks run Monday to Sunday.</p>
              </>
            }
          >
            <Columns
              cols={weekCols}
              series={[
                { tone: "back-2", label: "From cards that had been in before" },
                { tone: "rest", label: "From cards never seen before" },
              ]}
              ariaLabel="Weekly card sales, split into returning and first-time cards"
              caption="Week of"
            />
          </Chapter>
        )}
      </Section>

      <Section help="sales.customers.numbers" title="How this is worked out" description="What Ops can see, and what it can't.">
        <Card id="worked-out" className="scroll-mt-24 p-4 sm:p-6">
          {s.coverage && (
            <div className="mb-5">
              <h3 className="mb-3 max-w-3xl text-base font-semibold tracking-tight text-balance text-ink sm:text-lg">
                {pct(s.coverage.amount, 0)} of what&apos;s paid carries a card Ops can recognise again
              </h3>
              <ShareBars
                parts={seenParts}
                rows={[{ label: "The money, last 12 months", shares: { seen: s.coverage.amount, unseen: 1 - s.coverage.amount } }]}
                ariaLabel="Share of the money paid with a card Ops can recognise again"
                lead={`${pct(s.coverage.payments, 0)} of payments, and ${pct(s.coverage.amount, 0)} of the money, carried a card mark.`}
              />
            </div>
          )}
          <div className="max-w-2xl space-y-2 text-sm leading-relaxed text-ink-2">
            <p>
              Cash leaves no mark. A phone wallet and the card behind it look like two people. So does a couple who take turns paying, or someone who got a new card. The true repeat figures are higher than the ones here; the direction they move in can be trusted. <Badge>Everything on this page is a floor</Badge>
            </p>
            <p>Ops keeps a scrambled copy of Square&apos;s mark for each card, the day, and the amount. No name, card number, email or phone is read or kept, and the copy can&apos;t be turned back into a card. That also means nobody here can be contacted: for that you&apos;d need people to give you their details, through a membership or an email list.</p>
          </div>
        </Card>
      </Section>
    </>
  );
}
