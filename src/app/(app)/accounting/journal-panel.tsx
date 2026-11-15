"use client";

import { useConfirm } from "@/components/dialog";
import { RelativeTime } from "@/components/relative-time";
import { Badge, Button, Card, cx, DatePicker, Field, LinkButton, Select, Table, Td, Th, Tr, type Tone } from "@/components/ui";
import { JOURNAL_ACCOUNT_KEYS, JOURNAL_ACCOUNT_LABELS, journalAccountChoices, journalTotals, type JournalAccountKey } from "@/domain/salesJournal";
import { money, shortDate } from "@/lib/format";
import type { EntryState, JournalOverview } from "@/server/services/monthEndJournal";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { saveJournalSetting, sendJournal, sendJournalPeriod } from "./actions";

const STATE: Record<EntryState, { label: string; tone: Tone }> = {
  "not-sent": { label: "Not sent", tone: "neutral" },
  sent: { label: "In QuickBooks", tone: "good" },
  changed: { label: "Changed since sent", tone: "warn" },
  "not-ready": { label: "Waiting on Square", tone: "neutral" },
  error: { label: "Didn't go", tone: "bad" },
  blocked: { label: "Blocked", tone: "warn" },
  "before-start": { label: "Before start date", tone: "neutral" },
  sending: { label: "Sending…", tone: "neutral" },
};

const monthName = (ym: string) => new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));

/** QuickBooks sales journal: settings, account mapping, and every entry in the period with a preview. */
export function JournalPanel({ o, from, to }: { o: JournalOverview; from: string; to: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const s = o.settings;

  const save = (input: Record<string, unknown>) =>
    start(async () => {
      const r = await saveJournalSetting(input);
      setMsg(r.error ? { ok: false, text: r.error } : null);
      router.refresh();
    });

  const missing = JOURNAL_ACCOUNT_KEYS.filter((k) => !s.accounts[k]);
  const canSuggest = missing.some((k) => o.suggestions[k]);
  const sendable = o.entries.filter((e) => (e.state === "not-sent" || e.state === "changed" || e.state === "error") && !e.reason?.startsWith("Choose"));
  const live = o.connected && s.enabled;

  const sendAll = async () => {
    // Ask first, outside the transition, then send.
    const ok = await confirm({
      title: `Send ${sendable.length} ${sendable.length === 1 ? "entry" : "entries"} to QuickBooks?`,
      body: `They go to ${o.companyName ?? "your QuickBooks company"} as journal entries. Entries already sent are only updated if their figures changed.`,
      confirmLabel: "Send",
    });
    if (!ok) return;
    start(async () => {
      const r = await sendJournalPeriod(from, to);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Sent." });
      router.refresh();
    });
  };
  const sendOne = (key: string) =>
    start(async () => {
      const r = await sendJournal(key);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Sent." });
      router.refresh();
    });

  return (
    <div className="space-y-4" aria-busy={pending}>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{live ? `On · ${s.mode === "daily" ? "one entry per day" : "one entry per month"}` : "Off"}</div>
            <p className="mt-0.5 text-sm text-muted">
              {!o.connected
                ? "QuickBooks isn't connected, so this is a preview only. Connect it to send the entries."
                : s.enabled
                  ? <>Sales go to {o.companyName ?? "QuickBooks"} as journal entries when you press Send. Sending again only updates an entry whose figures changed.</>
                  : "Nothing is sent until you turn this on and pick the accounts. The preview below shows what each entry would be."}
            </p>
          </div>
          {o.connected ? (
            <Button variant={s.enabled ? "ghost" : "primary"} disabled={pending} onClick={() => save({ field: "enabled", value: !s.enabled })} data-tour="accounting.journal.toggle">
              {s.enabled ? "Turn off" : "Turn on"}
            </Button>
          ) : (
            <LinkButton href="/settings/quickbooks" size="md">Connect QuickBooks</LinkButton>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Entries">
            <Select value={s.mode} options={[{ value: "daily", label: "One per day" }, { value: "monthly", label: "One per month" }]} onChange={(e) => save({ field: "mode", value: e.target.value })} />
          </Field>
          <Field label="Send days from" hint="Earlier days are already in your books.">
            <DatePicker value={s.sendFrom ?? ""} onChange={(e) => save({ field: "sendFrom", value: e.target.value || null })} aria-label="Send days from" />
          </Field>
        </div>
      </Card>

      {o.connected && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">QuickBooks accounts</div>
              <p className="mt-0.5 text-sm text-muted">{missing.length ? `${missing.length} still to choose.` : "All chosen."} Ask your accountant if you&apos;re unsure which to use.</p>
            </div>
            {canSuggest && <Button size="sm" disabled={pending} onClick={() => save({ field: "useSuggestions" })}>Use suggestions</Button>}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {JOURNAL_ACCOUNT_KEYS.map((k: JournalAccountKey) => {
              const choices = journalAccountChoices(k, o.accounts);
              const suggested = o.suggestions[k];
              return (
                <Field key={k} label={JOURNAL_ACCOUNT_LABELS[k].label} hint={!s.accounts[k] && suggested ? `Suggested: ${o.accounts.find((a) => a.id === suggested)?.fullName}` : JOURNAL_ACCOUNT_LABELS[k].hint}>
                  <Select
                    value={s.accounts[k] ?? ""}
                    placeholder={choices.length ? "Choose…" : "No account of this kind"}
                    searchable={choices.length > 8}
                    options={[...(s.accounts[k] ? [{ value: "", label: "None" }] : []), ...choices.map((a) => ({ value: a.id, label: a.fullName, hint: a.id === suggested ? "Suggested" : a.type }))]}
                    onChange={(e) => save({ field: "account", key: k, value: e.target.value || null })}
                  />
                </Field>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">If QuickBooks won&apos;t take an entry on its own sales tax account, make an &quot;Other current liability&quot; account such as Sales tax collected (Square) and pick that.</p>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {o.entries.length ? `${o.entries.length} ${o.entries.length === 1 ? "entry" : "entries"} for this period.` : "No Square sales in this period yet."}
          {o.counts.sent ? ` ${o.counts.sent} in QuickBooks.` : ""}
        </p>
        {live && sendable.length > 0 && (
          <Button variant="primary" disabled={pending} onClick={sendAll} data-tour="accounting.journal.send">
            {pending ? "Sending…" : `Send ${sendable.length === 1 ? "1 entry" : `${sendable.length} entries`}`}
          </Button>
        )}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cx("text-sm", msg.ok ? "text-good" : "text-bad")}>{msg.text}</p>}

      {o.entries.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Entry</Th>
              <Th align="right">Net sales</Th>
              <Th align="right" className="hidden sm:table-cell">Tax</Th>
              <Th align="right" className="hidden sm:table-cell">Tips</Th>
              <Th>Status</Th>
              <Th className="w-10"><span className="sr-only">Preview</span></Th>
            </tr>
          </thead>
          <tbody>
            {o.entries.map((e) => {
              const t = journalTotals(e.summary);
              const isOpen = open === e.key;
              const st = STATE[e.state];
              return (
                <Fragment key={e.key}>
                  <Tr className="cursor-pointer" onClick={() => setOpen(isOpen ? null : e.key)}>
                    <Td className="whitespace-nowrap">{e.summary.mode === "daily" ? shortDate(e.label) : monthName(e.label)}</Td>
                    <Td align="right">{money(t.net)}</Td>
                    <Td align="right" className="hidden sm:table-cell">{money(e.summary.tax)}</Td>
                    <Td align="right" className="hidden sm:table-cell">{money(e.summary.tips)}</Td>
                    <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                    <Td className="w-10 px-2">
                      <button type="button" aria-expanded={isOpen} aria-label={`Preview ${e.label}`} className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink">
                        <ChevronDown className={cx("size-4 transition-transform", isOpen && "rotate-180")} />
                      </button>
                    </Td>
                  </Tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="border-b border-border bg-surface-2/50 px-3 py-3 sm:px-4">
                        <EntryPreview e={e} />
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="min-w-0 flex-1 text-xs text-muted">
                            {e.qboId ? <>QuickBooks entry #{e.qboId}{e.sentAt && <> · sent <RelativeTime at={e.sentAt} /></>}{e.sentBy && <> by {e.sentBy}</>}</> : "Not in QuickBooks yet."}
                          </p>
                          {live && (e.state === "not-sent" || e.state === "changed" || e.state === "error") && (
                            <Button size="sm" variant={e.state === "changed" ? "primary" : "secondary"} disabled={pending || !!e.reason?.startsWith("Choose")} onClick={() => sendOne(e.key)}>
                              {e.state === "changed" ? "Update in QuickBooks" : e.state === "error" ? "Try again" : "Send this one"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function EntryPreview({ e }: { e: JournalOverview["entries"][number] }) {
  return (
    <div className="min-w-0">
      {e.reason && <p className={cx("mb-2 text-sm", e.state === "error" ? "text-bad" : e.state === "blocked" ? "text-warn" : "text-muted")}>{e.reason}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-3 font-medium">Account</th>
              <th className="py-1.5 pl-3 text-right font-medium">Debit</th>
              <th className="py-1.5 pl-3 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {e.lines.map((l) => (
              <tr key={l.key + l.posting} className="border-t border-border">
                <td className="py-1.5 pr-3">
                  <div className="font-medium">{l.label}</div>
                  <div className="text-xs text-muted">{l.account ?? "Account not chosen"}</div>
                </td>
                <td className="num py-1.5 pl-3 text-right align-top">{l.posting === "Debit" ? money(l.amount) : ""}</td>
                <td className="num py-1.5 pl-3 text-right align-top">{l.posting === "Credit" ? money(l.amount) : ""}</td>
              </tr>
            ))}
            <tr className="border-t border-border-strong font-semibold">
              <td className="py-1.5 pr-3">{e.balanced ? "Balanced" : "Doesn't balance"}</td>
              <td className="num py-1.5 pl-3 text-right">{money(e.debits)}</td>
              <td className="num py-1.5 pl-3 text-right">{money(e.credits)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {e.notes.map((n) => <p key={n} className="mt-2 text-xs text-warn">{n}</p>)}
    </div>
  );
}
