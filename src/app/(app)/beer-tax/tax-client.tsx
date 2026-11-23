"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, DatePicker, Field, Input, Select } from "@/components/ui";
import { FREQS, type DueReturn, type Form, type TaxSettings } from "@/domain/beerTax";
import { daysBetween } from "@/domain/dates";
import { money, qty, shortDate } from "@/lib/format";
import { Check, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Sheet } from "../team/training/sheet";
import { addAdjustment, deleteAdjustment, markFiled, setTaxSetting, unmarkFiled } from "./actions";

interface FilingView { id: string; form: Form; periodStart: string; periodEnd: string; filedOn: string; amount: number | null; note: string | null; userName: string | null }

interface DueRow { form: Form; name: string; who: string; periodLabel: string; periodKey: string; due: string; state: DueReturn["state"]; filing: FilingView | null }

const STATE: Record<DueReturn["state"], { tone: "good" | "warn" | "bad" | "neutral"; label: (d: number) => string }> = {
  filed: { tone: "good", label: () => "Filed" },
  overdue: { tone: "bad", label: (d) => `${-d} day${d === -1 ? "" : "s"} late` },
  "due-soon": { tone: "warn", label: (d) => (d === 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}`) },
  upcoming: { tone: "neutral", label: (d) => `Due in ${d} days` },
  open: { tone: "neutral", label: () => "Open" },
};

export function ReturnsDue({ rows, today, current, amounts }: { rows: DueRow[]; today: string; current: string; amounts: Record<Form, number | null> }) {
  const [filing, setFiling] = useState<DueRow | null>(null);
  const [toast, show] = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  if (!rows.length) return <Card className="p-4 text-sm text-muted">Nothing due yet. A return shows here once a period with keg history ends.</Card>;
  return (
    <Card className="divide-y divide-border">
      {toast}
      {rows.map((r) => {
        const st = STATE[r.state];
        const d = daysBetween(today, r.due);
        return (
          <div key={`${r.form}-${r.periodKey}`} className={cx("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3", pending && "opacity-70")}>
            <div className="min-w-0 flex-[1_1_14rem]">
              <div className="text-sm font-medium text-ink">{r.name} · {r.periodLabel}</div>
              <div className="text-xs text-muted">
                {r.filing ? `Filed ${shortDate(r.filing.filedOn)}${r.filing.amount != null ? ` · paid ${money(r.filing.amount)}` : ""}${r.filing.userName ? ` · ${r.filing.userName}` : ""}` : `Due ${shortDate(r.due)} · ${r.who}`}
              </div>
            </div>
            <Badge tone={st.tone}>{st.label(d)}</Badge>
            {r.periodKey !== current && <Link href={`/beer-tax?p=${r.periodKey}`} className="inline-flex h-10 items-center rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-8">See numbers</Link>}
            {r.filing ? (
              <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={async () => {
                if (!(await confirm({ title: `Mark ${r.name} for ${r.periodLabel} not filed?`, body: "It goes back on the Overview until it's filed again.", confirmLabel: "Mark not filed" }))) return;
                start(async () => { await unmarkFiled(r.filing!.id); });
              }}>Undo</Button>
            ) : (
              <Button size="sm" variant={r.state === "overdue" || r.state === "due-soon" ? "primary" : "secondary"} className="h-10 sm:h-8" onClick={() => setFiling(r)} data-tour="beertax.markFiled">
                <Check className="size-3.5" />Mark filed
              </Button>
            )}
          </div>
        );
      })}
      {filing && <FileSheet row={filing} today={today} suggested={filing.periodKey === current ? amounts[filing.form] : null} onClose={() => setFiling(null)} onDone={(m) => show(m)} />}
    </Card>
  );
}

function FileSheet({ row, today, suggested, onClose, onDone }: { row: DueRow; today: string; suggested: number | null; onClose: () => void; onDone: (m: string) => void }) {
  const [filedOn, setFiledOn] = useState(today);
  const [amount, setAmount] = useState(suggested != null ? suggested.toFixed(2) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet title={`${row.name} · ${row.periodLabel}`} subtitle={row.who} onClose={onClose} label="Mark a return filed">
      <div className="space-y-3">
        <Field label="Filed on"><DatePicker value={filedOn} max={today} today={today} onChange={(e) => setFiledOn(e.target.value)} aria-label="Filed on" /></Field>
        {row.form !== "brop" && (
          <Field label="Paid" hint={suggested != null ? "From this period's worksheet. Change it to what you actually paid." : "Leave blank if nothing was due."}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0.00" />
          </Field>
        )}
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Confirmation number" /></Field>
        {error && <p className="text-sm text-bad" aria-live="polite">{error}</p>}
        <Button variant="primary" className="h-11 w-full sm:h-9" disabled={pending} onClick={() => start(async () => {
          const r = await markFiled({ form: row.form, period: row.periodKey, filedOn, amount: row.form === "brop" ? "" : amount, note });
          if (r?.error) setError(r.error);
          else { onDone(`${row.name} for ${row.periodLabel} marked filed`); onClose(); }
        })}><Check className="size-4" />{pending ? "Saving…" : "Mark filed"}</Button>
      </div>
    </Sheet>
  );
}

const ADJ_KINDS = [
  { value: "removed", label: "Removed: cans, bottles, crowlers out the door" },
  { value: "packaged", label: "Packaged: cans or bottles filled" },
  { value: "returned", label: "Returned to the brewery" },
  { value: "loss", label: "Dumped or lost" },
];
const UNITS = [{ value: "gal", label: "gallons" }, { value: "bbl", label: "barrels" }];

export function AdjustmentForm({ beers, defaultDate, today }: { beers: { id: string; name: string }[]; defaultDate: string; today: string }) {
  const [date, setDate] = useState(defaultDate);
  const [kind, setKind] = useState("removed");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"gal" | "bbl">("gal");
  const [beerId, setBeerId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const r = await addAdjustment({ date, kind: kind as "removed", gallons: amount, unit, beerId, note });
      if (r?.error) setError(r.error);
      else { setAmount(""); setNote(""); setError(null); }
    });
  return (
    <Card className="mb-3 p-4" data-tour="beertax.adjust">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] lg:grid-cols-[10rem_minmax(0,1.4fr)_minmax(0,1fr)_9rem_8rem]">
        {/* One column on a phone: without it the grid sizes to the longest option and runs off the screen. */}
        <Field label="Date"><DatePicker value={date} max={today} today={today} onChange={(e) => setDate(e.target.value)} aria-label="Date" /></Field>
        <Field label="What"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={ADJ_KINDS} aria-label="What" /></Field>
        <Field label="Beer"><Select value={beerId} onChange={(e) => setBeerId(e.target.value)} options={[{ value: "", label: "Not one beer" }, ...beers.map((b) => ({ value: b.id, label: b.name }))]} searchable aria-label="Beer" /></Field>
        <Field label="How much"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></Field>
        <Field label="In"><Select value={unit} onChange={(e) => setUnit(e.target.value as "gal" | "bbl")} options={UNITS} aria-label="Unit" /></Field>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. 4 cases of 16 oz cans" aria-label="Note" className="sm:flex-1" />
        <Button variant="primary" className="h-11 sm:h-10" disabled={pending || !amount.trim()} onClick={add}><Plus className="size-4" />Add</Button>
      </div>
      {error && <p className="mt-2 text-sm text-bad" aria-live="polite">{error}</p>}
    </Card>
  );
}

const KIND_LABEL: Record<string, string> = { removed: "Removed", packaged: "Packaged", returned: "Returned", loss: "Dumped" };

export function AdjustmentList({ rows }: { rows: { id: string; date: string; kind: string; gallons: number; beer: string; note: string | null }[] }) {
  const [pending, start] = useTransition();
  if (!rows.length) return <p className="px-1 text-sm text-muted">Nothing typed in for this period.</p>;
  return (
    <Card className={cx("divide-y divide-border", pending && "opacity-70")}>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 px-4 py-2">
          <span className="num w-14 shrink-0 text-xs text-muted">{shortDate(r.date)}</span>
          <span className="min-w-0 flex-1 text-sm"><span className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span> · {r.beer}{r.note && <span className="block truncate text-xs text-muted">{r.note}</span>}</span>
          <span className="num text-sm">{qty(r.gallons, 1)} gal</span>
          <button type="button" aria-label="Delete this line" className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8" onClick={() => start(async () => { await deleteAdjustment(r.id); })}><X className="size-3.5" /></button>
        </div>
      ))}
    </Card>
  );
}

export function FiledList({ rows }: { rows: (FilingView & { name: string; label: string })[] }) {
  if (!rows.length) return <Card className="p-4 text-sm text-muted">Nothing marked filed yet. Use Mark filed above once a return is in.</Card>;
  return (
    <Card className="divide-y divide-border">
      {rows.slice(0, 16).map((f) => (
        <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1"><span className="font-medium">{f.name}</span> · {f.label}<span className="block text-xs text-muted">Filed {shortDate(f.filedOn)}{f.note ? ` · ${f.note}` : ""}</span></span>
          <span className="num">{f.amount != null ? money(f.amount) : "—"}</span>
        </div>
      ))}
    </Card>
  );
}

const YESNO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

export function TaxSettingsGrid({ s, forms }: { s: TaxSettings; forms: { form: Form; name: string }[] }) {
  return (
    <Card className="divide-y divide-border">
      <Row label="Federal excise, $ per barrel" hint="Reduced rate on the first 60,000 bbl a year">
        <GridCell grid="tax" col="v" type="number" prefix="$" decimals={2} value={s.federalRate} onSave={(v) => setTaxSetting("federalRate", v)} ariaLabel="Federal rate per barrel" />
      </Row>
      <Row label="New York beer tax, $ per gallon">
        <GridCell grid="tax" col="v" type="number" prefix="$" decimals={2} value={s.nyRate} onSave={(v) => setTaxSetting("nyRate", v)} ariaLabel="New York rate per gallon" />
      </Row>
      <Row label="NY small brewer credit" hint="On the first 500,000 gallons a year">
        <GridSelect value={s.nyCredit ? "yes" : "no"} options={YESNO} onSave={(v) => setTaxSetting("nyCredit", v)} ariaLabel="New York small brewer credit" />
      </Row>
      {forms.map((f) => (
        <Row key={f.form} label={f.name} hint="How often · days after the period it's due">
          <div className="grid grid-cols-[1fr_5rem] gap-1">
            <GridSelect value={s.freq[f.form]} options={FREQS} onSave={(v) => setTaxSetting(`freq.${f.form}`, v)} ariaLabel={`${f.name} how often`} />
            <GridCell grid="tax" col="d" type="number" value={s.dueDays[f.form]} suffix="d" onSave={(v) => setTaxSetting(`due.${f.form}`, v)} ariaLabel={`${f.name} due days after the period`} />
          </div>
        </Row>
      ))}
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_13rem]">
      <div className="min-w-0"><div className="text-sm text-ink">{label}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>
      <div>{children}</div>
    </div>
  );
}
