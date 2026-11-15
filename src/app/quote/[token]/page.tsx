import { displayTime } from "@/domain/events";
import { BAR_LABEL, isQuoteToken } from "@/domain/privateEvents";
import { businessTimeZone, money } from "@/lib/format";
import { getSession } from "@/server/auth";
import { markQuoteViewed, publicQuote } from "@/server/services/privateEvents";
import { getBusinessContact } from "@/server/services/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AcceptQuote, PrintQuote } from "./quote-client";

/**
 * The client's quote: public, no sign-in. The 43-character random token in the
 * URL is the only key; a bad or revoked token is a plain 404. Shows prices,
 * never costs, margins or internal notes.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Your quote · Subversive" }, description: "Your private event quote from Subversive, Catskill NY.", robots: { index: false, follow: false }, referrer: "no-referrer" };

const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const pctLabel = (n: number) => `${+(n * 100).toFixed(3)}%`;

function Row({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "text-base font-semibold text-ink" : muted ? "text-muted" : "text-ink-2"}`}>
      <span className="min-w-0">{label}</span>
      <span className="num shrink-0">{value}</span>
    </div>
  );
}

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isQuoteToken(token)) notFound();
  const [q, biz, session] = await Promise.all([publicQuote(token), getBusinessContact(), getSession()]);
  if (!q) notFound();
  // A manager previewing doesn't count as the client opening it.
  if (!session && !q.viewed) await markQuoteViewed(token).catch(() => {});
  const t = q.totals;
  const when = [q.date ? longDate(q.date) : "Date to be set", q.startTime ? `${displayTime(q.startTime)}${q.endTime ? `–${displayTime(q.endTime)}` : ""}` : null].filter(Boolean).join(" · ");

  return (
    <div className="min-h-dvh bg-bg px-4 py-8 print:bg-white print:p-0 sm:py-12">
      <style>{`@media print { @page { margin: 0.6in; } :root { --bg: #fff; --surface: #fff; --surface-2: #f1f1ee; --border: #e6e5e1; --ink: #1b1a18; --ink-2: #4a4843; --muted: #85837c; --good: #1f7a4d; } .no-print { display: none !important; } .quote-sheet { border: 0 !important; box-shadow: none !important; padding: 0 !important; } }`}</style>
      <main className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-[15px] font-bold text-primary-ink">S</span>
            <div>
              <div className="font-semibold tracking-tight text-ink">{biz.name}</div>
              <div className="text-xs text-muted">{biz.address || "Brewery & kitchen · Catskill, NY"}</div>
            </div>
          </div>
          <div className="no-print"><PrintQuote /></div>
        </header>

        <article className="quote-sheet rounded-2xl border border-border bg-surface p-5 sm:p-8">
          <p className="text-sm text-muted">Quote for {q.company ? `${q.company} · ${q.clientName}` : q.clientName}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{q.type}{q.headcount ? ` for ${q.headcount}` : ""}</h1>
          <p className="mt-1 text-ink-2">{when}{q.space ? ` · ${q.space}` : ""}</p>

          {!q.available && <p className="mt-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">This quote is no longer available. Please get in touch with us.</p>}

          <section className="mt-6">
            <h2 className="mb-1 text-sm font-semibold text-ink">Food</h2>
            {q.lines.length === 0 ? (
              <p className="text-sm text-muted">To be decided together.</p>
            ) : (
              <div className="divide-y divide-border text-sm">
                {q.lines.map((l, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <div className="text-ink">{l.label}</div>
                      <div className="num text-xs text-muted">{l.perPerson ? `${money(l.unitPrice)} per guest${l.qty !== 1 ? ` × ${l.qty}` : ""} · ${l.units}` : `${l.units} × ${money(l.unitPrice)}`}</div>
                    </div>
                    <span className="num shrink-0">{money(l.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {(t.bar > 0 || t.roomFee > 0) && (
            <section className="mt-5">
              <h2 className="mb-1 text-sm font-semibold text-ink">Bar & room</h2>
              <div className="divide-y divide-border text-sm">
                {t.bar > 0 && (
                  <div className="flex items-baseline justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <div className="text-ink">{BAR_LABEL[q.bar.kind]}</div>
                      <div className="num text-xs text-muted">
                        {q.bar.kind === "TICKETS" ? `${q.bar.tickets} tickets × ${money(q.bar.ticketPrice)}` : q.bar.kind === "OPEN_TAB" ? "Estimate — billed on what's poured" : "Minimum bar spend for the event"}
                      </div>
                    </div>
                    <span className="num shrink-0">{money(t.bar)}</span>
                  </div>
                )}
                {t.roomFee > 0 && (
                  <div className="flex items-baseline justify-between gap-4 py-2">
                    <span className="text-ink">Room fee</span>
                    <span className="num shrink-0">{money(t.roomFee)}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="mt-6 rounded-xl bg-surface-2 p-4 text-sm print:bg-transparent print:p-0">
            <Row label="Subtotal" value={money(t.subtotal)} />
            {t.serviceCharge > 0 && <Row label={`Service charge (${pctLabel(q.serviceChargePct)} of food and bar)`} value={money(t.serviceCharge)} />}
            <Row label={`NY sales tax (${pctLabel(q.taxPct)})`} value={money(t.tax)} />
            <div className="my-1 border-t border-border" />
            <Row label="Total" value={money(t.total)} strong />
            {t.perGuest != null && <Row label="Per guest" value={money(t.perGuest)} muted />}
            {(t.deposit > 0 || t.paid > 0) && <div className="my-1 border-t border-border" />}
            {t.deposit > 0 && <Row label={`Deposit to hold the date${q.depositDueOn ? `, due ${longDate(q.depositDueOn)}` : ""}`} value={money(t.deposit)} />}
            {t.paid > 0 && <Row label="Paid so far" value={money(t.paid)} />}
            {t.paid > 0 && <Row label={`Balance${q.balanceDueOn ? `, due ${longDate(q.balanceDueOn)}` : ""}`} value={money(t.balance)} strong />}
            {t.paid === 0 && q.balanceDueOn && <Row label={`Balance due ${longDate(q.balanceDueOn)}`} value="" muted />}
          </section>

          {q.note && <section className="mt-5 text-sm whitespace-pre-line text-ink-2">{q.note}</section>}

          <section className="mt-6 border-t border-border pt-5">
            {q.acceptedAt ? (
              <p className="text-sm text-good">Accepted by {q.acceptedName} on {new Date(q.acceptedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: businessTimeZone() })}. Thank you!</p>
            ) : q.available ? (
              <div className="no-print"><AcceptQuote token={token} deposit={t.deposit > 0 ? money(t.deposit) : null} /></div>
            ) : null}
            {q.paymentLinkUrl && q.available && t.balance > 0 && (
              <a href={q.paymentLinkUrl} target="_blank" rel="noopener noreferrer" className="no-print mt-4 inline-flex h-11 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2">Pay online with Square</a>
            )}
          </section>
        </article>

        <footer className="mt-6 text-center text-xs text-muted">
          {[biz.name, biz.phone, biz.email].filter(Boolean).join(" · ")}
        </footer>
      </main>
    </div>
  );
}
