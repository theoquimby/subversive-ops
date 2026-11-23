import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Card, cx, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { Verdict } from "@/components/chapter";
import { rangeWords } from "@/domain/pnlVerdict";
import { checklistProgress, closeOrder, closePeriod, closeVerdict, monthLabel, previousPeriod, recentMonths, recentQuarters, usualDueDate, type CheckStatus } from "@/domain/monthEnd";
import { money, pct, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { closeReport, salesTaxSettings } from "@/server/services/monthEnd";
import { journalOverview } from "@/server/services/monthEndJournal";
import { businessToday } from "@/server/services/sales";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Circle, Download, MinusCircle } from "lucide-react";
import Link from "next/link";
import { JournalPanel } from "./journal-panel";
import { PeriodPicker } from "./period-picker";
import { TaxSettings } from "./tax-settings";

export const metadata = { title: "Month-end" };

const whole = (n: number | null | undefined) => (n == null ? "—" : money(n, { whole: true }));
const ICON: Record<CheckStatus, { icon: typeof Circle; className: string; label: string }> = {
  done: { icon: CheckCircle2, className: "text-good", label: "Done" },
  todo: { icon: Circle, className: "text-bad", label: "To do" },
  warn: { icon: AlertTriangle, className: "text-warn", label: "Worth a look" },
  na: { icon: MinusCircle, className: "text-muted", label: "Not needed" },
};

export default async function MonthEndPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const today = businessToday();
  const taxSettings = await salesTaxSettings();
  const qs = taxSettings.quarterStartMonth;
  const p = closePeriod(sp.period, today, sp, qs);
  const prev = previousPeriod(p, qs);
  const journalP = journalOverview(p);
  const [r, journal] = await Promise.all([closeReport(p, prev, journalP), journalP.catch(() => null)]);

  const query = new URLSearchParams(p.kind === "month" ? { period: "month", month: p.from.slice(0, 7) } : p.kind === "quarter" ? { period: "quarter", quarter: p.from } : { period: "custom", from: p.from, to: p.to });
  const progress = checklistProgress(r.checklist);
  const checklist = closeOrder(r.checklist);
  const verdict = closeVerdict(r.checklist, p.label, p.to < today);
  const taxMissing = r.tax.missingTax.length;
  const t = r.tax.totals;
  const inv = r.inventory;
  const partial = p.to >= today;
  const hasEnd = inv.end.items.length > 0;
  const hasStart = inv.start.items.length > 0;
  const k = r.kpis;
  const months = recentMonths(today, 18).map((m) => ({ value: m, label: `${monthLabel(m)}${m === today.slice(0, 7) ? " (so far)" : ""}` }));
  const quarters = recentQuarters(today, 8, qs).map((q) => ({ value: q.from, label: `${q.label}${q.to >= today ? " (so far)" : ""}` }));

  return (
    <div>
      <PageHeader
        title="Month-end"
        description="Close the books: what's left to do, sales tax, stock value and cost of goods, tips owed, and one file for your accountant."
        help="accounting.page"
        actions={
          <a
            href={`/accounting/export?${query}`}
            download
            data-tour="accounting.pack"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium whitespace-nowrap text-primary-ink transition-opacity duration-120 hover:opacity-90 active:scale-[0.98]"
          >
            <Download className="size-4" strokeWidth={1.75} /> Accountant pack
          </a>
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker kind={p.kind} from={p.from} to={p.to} months={months} quarters={quarters} />
        <p className="text-sm text-muted">
          {rangeWords(p.from, p.to)}
          {partial && " · not over yet"}
        </p>
      </div>

      {/* The verdict: can it close, the first thing to do, the checklist in the order to work it. */}
      <HelpZone id="accounting.stats" tour="accounting.stats">
        <Verdict
          badge={{ tone: verdict.tone, label: progress.open ? `${progress.open} to do` : undefined }}
          title={verdict.title}
          line={`${verdict.line} Net sales were ${whole(k.total.sales)} over ${k.counted.length} day${k.counted.length === 1 ? "" : "s"}${r.money?.discounts ? `, after ${whole(r.money.discounts)} of comps and discounts` : ""}.`}
          stats={[
            taxMissing
              ? { label: "Sales tax collected", value: "—", tone: "unknown", hint: `Tax isn't in for ${taxMissing} day${taxMissing === 1 ? "" : "s"} yet` }
              : { label: "Sales tax collected", value: whole(t.tax), hint: t.effectiveRate != null ? `${pct(t.effectiveRate, 2)} of all sales` : "No tax stored yet" },
            { label: "Actual cost of goods", value: whole(r.cogs), tone: r.cogs == null ? "unknown" : "neutral", hint: r.cogs != null && k.total.sales > 0 ? `${pct(r.cogs / k.total.sales)} of sales · theoretical ${pct(k.total.cogs / k.total.sales)}` : "Needs a count at both ends" },
            { label: "Card tips owed", value: whole(r.tips.owed), tone: r.tips.owed > 0.5 && !partial ? "warn" : "neutral", hint: `${whole(r.tips.collected)} collected · ${whole(r.tips.paid)} paid` },
          ]}
        >
          {verdict.first && (
            <Link href={verdict.first.href} className="mb-5 flex min-h-11 items-center gap-2.5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm font-medium text-ink transition-colors duration-120 hover:bg-border/60">
              <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">Start with {verdict.first.title.toLowerCase()}: <span className="font-normal text-ink-2">{verdict.first.detail}</span></span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
            </Link>
          )}
          <div className="mb-2 flex items-center gap-1 text-[0.8rem] font-medium text-muted">
            The checklist, in the order to work it <HelpTip id="accounting.checklist" />
          </div>
          <ol className="divide-y divide-border rounded-lg border border-border" data-tour="accounting.checklist">
            {checklist.map((c) => {
              const I = ICON[c.status];
              return (
                <li key={c.id}>
                  <Link href={c.href} className="flex min-h-14 items-start gap-3 px-4 py-3 transition-colors duration-120 hover:bg-surface-2/60">
                    <I.icon className={cx("mt-0.5 size-[18px] shrink-0", I.className)} strokeWidth={2} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-ink">
                        {c.title}
                        <span className={cx("text-xs font-normal", I.className)}>{I.label}</span>
                      </span>
                      <span className="block text-sm text-muted">{c.detail}</span>
                    </span>
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.75} />
                  </Link>
                </li>
              );
            })}
          </ol>
        </Verdict>
      </HelpZone>

      <div className="mb-10 mt-10">

        <Section title={<span className="inline-flex items-center gap-1">Inventory and cost of goods <HelpTip id="accounting.inventory" /></span>} description={hasEnd ? `From each item's latest count on or before ${shortDate(inv.end.asOf)}, at that day's prices.` : "No counts yet."} fill className="mb-0">
          <Card className="flex flex-col" data-tour="accounting.inventory">
            <dl className="divide-y divide-border text-sm">
              <Row label={`Inventory at ${shortDate(inv.start.asOf)}`} value={hasStart ? money(inv.start.total) : "—"} />
              <Row label={<>+ Purchases <span className="text-muted">({r.purchases.bills.length} approved invoice{r.purchases.bills.length === 1 ? "" : "s"})</span></>} value={money(r.purchases.total)} />
              <Row label={`− Inventory at ${shortDate(inv.end.asOf)}`} value={hasEnd ? money(inv.end.total) : "—"} />
              <Row label="= Actual cost of goods" value={r.cogs != null ? money(r.cogs) : "—"} strong />
              <Row label="Theoretical (recipes × items sold)" value={money(k.total.cogs)} muted />
            </dl>
            {hasEnd && (
              <div className="border-t border-border px-4 py-3 text-sm text-muted">
                Stock {inv.change >= 0 ? "up" : "down"} {money(Math.abs(inv.change))} on the period before. Food {money(inv.end.food)} · beverage {money(inv.end.beverage)}.
                {inv.end.unpriced.length > 0 && <span className="text-warn"> {inv.end.unpriced.length} counted item{inv.end.unpriced.length === 1 ? " has" : "s have"} no price ({inv.end.unpriced.slice(0, 3).join(", ")}{inv.end.unpriced.length > 3 ? "…" : ""}).</span>}
                {inv.end.stale > 0 && <span> {inv.end.stale} item{inv.end.stale === 1 ? " was" : "s were"} last counted over 45 days before.</span>}
              </div>
            )}
          </Card>
        </Section>
      </div>

      <Section
        title={<span className="inline-flex items-center gap-1">Sales tax <HelpTip id="accounting.salesTax" /></span>}
        description={`${taxSettings.jurisdiction} at ${pct(taxSettings.rate, 3).replace(/\.?0+%$/, "%")} combined, filed ${taxSettings.filing}.${p.kind === "quarter" ? ` Returns for ${p.label} are usually due by ${shortDate(usualDueDate(p.to))}.` : ""}`}
      >
        <div data-tour="accounting.tax">
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th align="right">All sales</Th>
                <Th align="right" className="hidden sm:table-cell">Taxable</Th>
                <Th align="right" className="hidden sm:table-cell">Non-taxable</Th>
                <Th align="right">Tax collected</Th>
              </tr>
            </thead>
            <tbody>
              {r.taxByMonth.map((m) => (
                <Tr key={m.month}>
                  <Td className="whitespace-nowrap">
                    {monthLabel(m.month)}
                    {m.missing > 0 && <Badge tone="warn" className="ml-2">{m.missing} day{m.missing === 1 ? "" : "s"} no tax</Badge>}
                  </Td>
                  <Td align="right">{money(m.sales)}</Td>
                  <Td align="right" className="hidden sm:table-cell">{money(m.taxable)}</Td>
                  <Td align="right" className="hidden sm:table-cell">{money(m.nonTaxable)}</Td>
                  <Td align="right">{money(m.tax)}</Td>
                </Tr>
              ))}
              {r.taxByMonth.length > 1 && (
                <Tr className="font-semibold">
                  <Td>Total</Td>
                  <Td align="right">{money(t.sales)}</Td>
                  <Td align="right" className="hidden sm:table-cell">{money(t.taxable)}</Td>
                  <Td align="right" className="hidden sm:table-cell">{money(t.nonTaxable)}</Td>
                  <Td align="right">{money(t.tax)}</Td>
                </Tr>
              )}
            </tbody>
          </Table>
          <div className="mt-3 space-y-1.5 text-sm text-muted">
            <p>Square sends the tax collected each day, not which items were taxed, so taxable sales are worked out as tax ÷ rate. The pack has every day.</p>
            {r.tax.missingTax.length > 0 && <p className="text-warn">{r.tax.missingTax.length} day{r.tax.missingTax.length === 1 ? " has" : "s have"} sales but no tax stored. Import those days again in <Link href="/settings/square#import" className="underline underline-offset-2">Settings → Square</Link>.</p>}
            {r.tax.overRate.length > 0 && <p className="text-warn">On {r.tax.overRate.length} day{r.tax.overRate.length === 1 ? "" : "s"} the tax was more than {pct(taxSettings.rate, 2)} of sales. Check the rate below.</p>}
            <p>The rate, filing and quarters are settings, not legal advice. Check them with your accountant or the NY Department of Taxation and Finance.</p>
          </div>
          <div className="mt-4">
            <TaxSettings settings={taxSettings} />
          </div>
        </div>
      </Section>

      <Section title={<span className="inline-flex items-center gap-1">Tips payable <HelpTip id="accounting.tips" /></span>} description="Card tips Square collected, against what's gone out through payroll.">
        <Card data-tour="accounting.tips">
          <dl className="divide-y divide-border text-sm">
            <Row label="Card tips collected" value={money(r.tips.collected)} />
            <Row label="In finalized tip pools" value={money(r.tips.allocated)} />
            <Row label="Paid through payroll (approved pay periods)" value={money(r.tips.paid)} />
            <Row label="Still owed to the team" value={money(r.tips.owed)} strong />
          </dl>
          {(r.tips.unpooled.length > 0 || r.tips.unpaid.length > 0) && (
            <p className="border-t border-border px-4 py-3 text-sm text-muted">
              {r.tips.unpooled.length > 0 && <>{r.tips.unpooled.length} day{r.tips.unpooled.length === 1 ? "" : "s"} with tips aren&apos;t in a finalized pool (<Link href="/tips" className="underline underline-offset-2">Tips</Link>). </>}
              {r.tips.unpaid.length > 0 && <>{r.tips.unpaid.length} pooled day{r.tips.unpaid.length === 1 ? " isn't" : "s aren't"} in an approved pay period yet (<Link href="/labor/payroll" className="underline underline-offset-2">Payroll</Link>).</>}
            </p>
          )}
        </Card>
      </Section>

      <div id="journal" className="scroll-mt-20">
        <Section title={<span className="inline-flex items-center gap-1">Sales to QuickBooks <HelpTip id="accounting.journal" /></span>} description="Each day's (or month's) Square sales as one journal entry: sales by food, beverage and other, tax and tips owed, card fees, discounts, and card vs cash.">
          {journal ? <JournalPanel o={journal} from={p.from} to={p.to} /> : <Card className="p-4 text-sm text-muted">Couldn&apos;t load the QuickBooks entries. Try again in a minute.</Card>}
        </Section>
      </div>
    </div>
  );
}

function Row({ label, value, strong, muted }: { label: React.ReactNode; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 px-4 py-3", strong && "font-semibold", muted && "text-muted")}>
      <dt className="min-w-0">{label}</dt>
      <dd className="num shrink-0">{value}</dd>
    </div>
  );
}
