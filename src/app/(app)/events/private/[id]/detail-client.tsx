"use client";

import { RelativeTime } from "@/components/relative-time";
import { useConfirm } from "@/components/dialog";
import { GridCell } from "@/components/grid";
import { HelpTip } from "@/components/help";
import { Badge, Button, Card, cx, DatePicker, Input, Select, Textarea } from "@/components/ui";
import { displayTime } from "@/domain/events";
import { BAR_KINDS, BAR_LABEL, canMove, EVENT_TYPE_LABEL, EVENT_TYPES, nextStage, PATH, STAGE_LABEL, type BarKind, type SpaceOption, type Stage } from "@/domain/privateEvents";
import { businessDateOf, money, pct, shortDate } from "@/lib/format";
import type { PrivateEventDetail, PrivateEventRow, quoteCatalog } from "@/server/services/privateEvents";
import { Check, Copy, ExternalLink, Mail, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ClashWarning, type Clash } from "../pipeline-client";
import {
  addPayment,
  addQuoteLine,
  emailQuote,
  removePayment,
  removePrivateEvent,
  removeQuoteLine,
  sendReminder,
  setLineField,
  setPrivateEventField,
  setStage,
  shareLink,
  squarePaymentLink,
  type PrivateEventField,
} from "../actions";

type Catalog = Awaited<ReturnType<typeof quoteCatalog>>;
type Msg = { error?: string; message?: string } | null;

function Note({ msg }: { msg: Msg }) {
  if (!msg || (!msg.error && !msg.message)) return null;
  return <div role={msg.error ? "alert" : "status"} className={cx("mt-2 text-sm", msg.error ? "text-bad" : "text-good")}>{msg.error ?? msg.message}</div>;
}

function Panel({ title, help, actions, children, className }: { title: ReactNode; help?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <h2 className="inline-flex items-center gap-1 text-[0.95rem] font-semibold text-ink">{title}{help && <HelpTip id={help} />}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Copy text; returns false when the browser won't (http, old Safari). */
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const save = (id: string, field: PrivateEventField) => (v: string) => setPrivateEventField(id, field, v);

// ---- Stage stepper --------------------------------------------------------------------

const SHORT: Record<Stage, string> = { INQUIRY: "Inquiry", QUOTED: "Quoted", DEPOSIT: "Deposit", CONFIRMED: "Confirmed", DONE: "Done", LOST: "Lost" };

export function StageStepper({ id, stage }: { id: string; stage: Stage }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const at = PATH.indexOf(stage);
  const next = nextStage(stage);
  const go = (to: Stage) =>
    start(async () => {
      setMsg(null);
      const r = await setStage(id, to);
      setMsg(r.error ? r : null);
      if (!r.error) router.refresh();
    });
  return (
    <div>
      <ol className="grid grid-cols-5 gap-1" aria-label="Stage">
        {PATH.map((s, i) => {
          const done = stage !== "LOST" && i < at;
          const current = s === stage;
          return (
            <li key={s} className="min-w-0">
              <button
                type="button"
                disabled={pending || current}
                onClick={() => go(s)}
                aria-current={current ? "step" : undefined}
                className={cx(
                  "flex h-11 w-full min-w-0 flex-col items-start justify-center rounded-lg border px-1.5 text-left text-[11px] transition-colors duration-120 sm:h-12 sm:px-3 sm:text-sm",
                  current ? "border-ink bg-primary text-primary-ink" : done ? "border-border bg-surface-2 text-ink-2 hover:border-border-strong" : "border-dashed border-border-strong bg-surface text-muted hover:text-ink",
                )}
              >
                <span className="flex w-full min-w-0 items-center gap-1">
                  {done && <Check className="hidden size-3.5 shrink-0 sm:block" />}
                  <span className="truncate sm:hidden">{SHORT[s]}</span>
                  <span className="hidden truncate sm:inline">{STAGE_LABEL[s]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {stage === "LOST" ? (
          <>
            <Badge tone="bad">Lost</Badge>
            <Button size="sm" disabled={pending} onClick={() => go("INQUIRY")} className="h-10 sm:h-8">Reopen as inquiry</Button>
          </>
        ) : (
          next && <Button size="sm" variant="primary" disabled={pending} onClick={() => go(next)} className="h-10 sm:h-8">Move to {STAGE_LABEL[next].toLowerCase()}</Button>
        )}
        <Note msg={msg} />
      </div>
    </div>
  );
}

// ---- Details --------------------------------------------------------------------------

function Row({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2 border-b border-border px-3 py-1 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <span className="inline-flex items-center gap-1 text-[0.8rem] text-muted">{label}{help && <HelpTip id={help} />}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function DateField({ value, onSave, label, min }: { value: string | null; onSave: (v: string) => Promise<{ error?: string } | void>; label: string; min?: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <div className="py-1">
      <DatePicker
        value={value ?? ""}
        min={min}
        aria-label={label}
        onChange={(e) =>
          start(async () => {
            const r = await onSave(e.target.value);
            setErr(r?.error ?? null);
            router.refresh();
          })
        }
      />
      {err && <div className="text-xs text-bad">{err}</div>}
    </div>
  );
}

function SelectField({ value, options, onSave, label }: { value: string; options: { value: string; label: string }[]; onSave: (v: string) => Promise<{ error?: string } | void>; label: string }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <div className="py-1">
      <Select
        value={v}
        options={options}
        aria-label={label}
        onChange={(e) => {
          const nv = e.target.value;
          setV(nv);
          start(async () => {
            const r = await onSave(nv);
            setErr(r?.error ?? null);
            router.refresh();
          });
        }}
      />
      {err && <div className="text-xs text-bad">{err}</div>}
    </div>
  );
}

/** A GridCell that refreshes the page after saving (totals depend on it). */
function Cell(props: Omit<React.ComponentProps<typeof GridCell>, "onSave"> & { onSave: (v: string) => Promise<{ error?: string } | void> }) {
  const router = useRouter();
  return (
    <GridCell
      {...props}
      onSave={async (v) => {
        const r = await props.onSave(v);
        if (!r?.error) router.refresh();
        return r;
      }}
    />
  );
}

export function DetailsCard({ row: r, spaces, owners, today, clashes = [] }: { row: PrivateEventRow; spaces: SpaceOption[]; owners: { id: string; name: string }[]; today: string; clashes?: Clash[] }) {
  const space = spaces.find((s) => s.name === r.space);
  const over = space?.capacity != null && r.headcount > space.capacity;
  return (
    <Panel title="Details" help="events.private.details">
      <Card className="py-1">
        <Row label="Client"><Cell grid="pe-d" col="clientName" value={r.clientName} ariaLabel="Client name" onSave={save(r.id, "clientName")} /></Row>
        <Row label="Company / occasion"><Cell grid="pe-d" col="company" value={r.company ?? ""} placeholder="Optional" ariaLabel="Company or occasion" onSave={save(r.id, "company")} /></Row>
        <Row label="Email"><Cell grid="pe-d" col="email" value={r.clientEmail ?? ""} placeholder="name@example.com" ariaLabel="Client email" onSave={save(r.id, "clientEmail")} /></Row>
        <Row label="Phone"><Cell grid="pe-d" col="phone" value={r.clientPhone ?? ""} placeholder="(518) 555-0100" ariaLabel="Client phone" onSave={save(r.id, "clientPhone")} /></Row>
        <Row label="Type"><SelectField value={r.type} label="Type" options={EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] }))} onSave={save(r.id, "type")} /></Row>
        <Row label="Date"><DateField value={r.date} label="Event date" onSave={save(r.id, "date")} /></Row>
        <Row label="Time">
          <div className="flex items-center gap-1">
            <Cell grid="pe-d" col="start" value={displayTime(r.startTime)} placeholder="6pm" ariaLabel="Start time" onSave={save(r.id, "startTime")} className="w-24" />
            <span className="text-muted">–</span>
            <Cell grid="pe-d" col="end" value={displayTime(r.endTime)} placeholder="10pm" ariaLabel="End time" onSave={save(r.id, "endTime")} className="w-24" />
          </div>
        </Row>
        <Row label="Guests">
          <div className="flex items-center gap-2">
            <Cell grid="pe-d" col="guests" type="number" value={r.headcount || ""} placeholder="0" ariaLabel="Guests" onSave={save(r.id, "headcount")} className="w-24" />
            {over && <span className="text-xs text-warn">Over the {space!.name.toLowerCase()}&rsquo;s {space!.capacity}</span>}
          </div>
        </Row>
        <Row label="Space"><SelectField value={r.space ?? ""} label="Space" options={[{ value: "", label: "Not set" }, ...spaces.map((s) => ({ value: s.name, label: `${s.name}${s.capacity ? ` · up to ${s.capacity}` : ""}` }))]} onSave={save(r.id, "space")} /></Row>
        {clashes.length > 0 && <div className="border-b border-border px-3 py-2"><ClashWarning clashes={clashes} /></div>}
        <Row label="Owner"><SelectField value={r.ownerId ?? ""} label="Owner" options={[{ value: "", label: "Nobody" }, ...owners.map((o) => ({ value: o.id, label: o.name }))]} onSave={save(r.id, "ownerId")} /></Row>
        <Row label="Follow up on" help="events.private.followup"><DateField value={r.followUpOn} label="Follow up on" min={today} onSave={save(r.id, "followUpOn")} /></Row>
        <Row label="Notes"><NotesField id={r.id} field="notes" value={r.notes ?? ""} placeholder="Allergies, cake, music, who to call on the day…" /></Row>
      </Card>
    </Panel>
  );
}

function NotesField({ id, field, value, placeholder }: { id: string; field: "notes" | "quoteNote"; value: string; placeholder: string }) {
  const [v, setV] = useState(value);
  const [state, setState] = useState<"idle" | "saved" | string>("idle");
  const [, start] = useTransition();
  return (
    <div className="py-1.5">
      <Textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v === value) return;
          start(async () => {
            const r = await setPrivateEventField(id, field, v);
            setState(r?.error ?? "saved");
          });
        }}
        placeholder={placeholder}
        aria-label={field === "notes" ? "Notes" : "Note to the client"}
        className="min-h-16"
      />
      {state !== "idle" && <div className={cx("mt-0.5 text-xs", state === "saved" ? "text-muted" : "text-bad")}>{state === "saved" ? "Saved" : state}</div>}
    </div>
  );
}

// ---- Quote builder --------------------------------------------------------------------

export function QuoteBuilder({ ev, catalog }: { ev: PrivateEventDetail; catalog: Catalog }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const id = ev.row.id;
  const s = ev.settings;

  const options = useMemo(
    () => [
      ...catalog.packages.map((p) => ({ value: `PACKAGE:${p.id}`, label: p.name, group: "Packages (per guest)", hint: `${money(p.pricePerPerson)} pp` })),
      ...catalog.items.map((i) => ({ value: `ITEM:${i.id}`, label: i.name, group: i.category || "Menu", hint: money(i.price) })),
    ],
    [catalog],
  );

  const run = (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.error ? r : null);
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });

  const add = (value: string) => {
    const [kind, refId] = value.split(":");
    run(() => addQuoteLine(id, { kind: kind as "ITEM" | "PACKAGE", refId }), () => setPick(""));
  };

  return (
    <Panel title="Quote" help="events.private.quote">
      <Card className="overflow-hidden">
        {ev.lines.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">Add a package or menu items below. Prices come from the menu; change any of them for this quote.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[0.75rem] text-muted">
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-1 py-2 text-right font-medium">Qty</th>
                <th className="hidden px-1 py-2 text-right font-medium sm:table-cell">Price</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Cost</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {ev.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-1.5">
                    {l.kind === "CUSTOM" ? (
                      <Cell grid="pe-q" col="label" value={l.label} ariaLabel="Line" onSave={(v) => setLineField(l.id, "label", v)} />
                    ) : (
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{l.label}</div>
                        <div className="text-xs text-muted">{l.kind === "PACKAGE" ? "Package" : "Menu item"}</div>
                      </div>
                    )}
                    <div className="sm:hidden">
                      <span className="text-xs text-muted">at </span>
                      <Cell grid="pe-q-m" col="price" type="number" decimals={2} prefix="$" value={l.unitPrice} ariaLabel={`Price for ${l.label}`} onSave={(v) => setLineField(l.id, "unitPrice", v)} className="inline-block w-24" />
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-right align-top sm:align-middle">
                    <div className="flex flex-col items-end gap-0.5">
                      <Cell grid="pe-q" col="qty" type="number" value={l.qty} ariaLabel={`Quantity for ${l.label}`} onSave={(v) => setLineField(l.id, "qty", v)} className="w-16" />
                      <button
                        type="button"
                        onClick={() => run(async () => (await setLineField(l.id, "perPerson", l.perPerson ? "0" : "1")) ?? {})}
                        className="relative rounded px-1 text-[11px] text-muted underline decoration-dotted underline-offset-2 after:absolute after:-inset-2 after:content-[''] hover:text-ink"
                        aria-label={l.perPerson ? "Per guest: switch to a fixed count" : "Fixed count: switch to per guest"}
                      >
                        {l.perPerson ? `per guest = ${l.units}` : "total"}
                      </button>
                    </div>
                  </td>
                  <td className="hidden px-1 py-1.5 text-right sm:table-cell">
                    <Cell grid="pe-q" col="price" type="number" decimals={2} prefix="$" value={l.unitPrice} ariaLabel={`Price for ${l.label}`} onSave={(v) => setLineField(l.id, "unitPrice", v)} className="w-24" />
                  </td>
                  <td className="num px-3 py-1.5 text-right">{money(l.amount)}</td>
                  <td className="num hidden px-3 py-1.5 text-right text-muted md:table-cell">
                    {l.kind === "CUSTOM" ? (
                      <Cell grid="pe-q" col="cost" type="number" decimals={2} prefix="$" placeholder="cost" value={l.unitCost ?? ""} ariaLabel={`Cost per unit for ${l.label}`} onSave={(v) => setLineField(l.id, "unitCost", v)} className="w-20" />
                    ) : l.cost != null ? (
                      money(l.cost)
                    ) : (
                      <span title="Some ingredients have no price yet">—</span>
                    )}
                  </td>
                  <td className="pr-1 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-10 p-0 sm:size-8"
                      aria-label={`Remove ${l.label}`}
                      disabled={pending}
                      onClick={async () => {
                        const ok = await confirm({ title: `Remove ${l.label}?`, confirmLabel: "Remove", danger: true });
                        if (ok) run(() => removeQuoteLine(l.id));
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="grid gap-2 border-t border-border bg-surface-2/40 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-tour="private.add-line">
          <Select value={pick} options={options} searchable placeholder={options.length ? "Add a package or menu item…" : "No menu prices yet"} disabled={pending || options.length === 0} aria-label="Add a package or menu item" onChange={(e) => e.target.value && add(e.target.value)} />
          <div className="flex gap-2">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or a custom line (cake, platter…)" aria-label="Custom line" onKeyDown={(e) => e.key === "Enter" && custom.trim() && run(() => addQuoteLine(id, { kind: "CUSTOM", label: custom }), () => setCustom(""))} />
            <Button disabled={pending || !custom.trim()} onClick={() => run(() => addQuoteLine(id, { kind: "CUSTOM", label: custom }), () => setCustom(""))} aria-label="Add custom line" className="h-10 shrink-0 sm:h-9"><Plus className="size-4" /></Button>
          </div>
        </div>
      </Card>
      <Note msg={msg} />

      <h3 className="mt-6 mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink">Bar, fees and deposit <HelpTip id="events.private.bar" /></h3>
      <Card className="py-1">
        <Row label="Bar">
          <SelectField value={s.barKind} label="Bar" options={BAR_KINDS.map((k) => ({ value: k, label: BAR_LABEL[k] }))} onSave={save(id, "barKind")} />
        </Row>
        {s.barKind === "TICKETS" && (
          <Row label="Tickets">
            <div className="flex items-center gap-1">
              <Cell grid="pe-f" col="tickets" type="number" value={s.drinkTickets || ""} placeholder="0" ariaLabel="Drink tickets" onSave={save(id, "drinkTickets")} className="w-20" />
              <span className="text-muted">×</span>
              <Cell grid="pe-f" col="ticketPrice" type="number" decimals={2} prefix="$" value={s.ticketPrice} ariaLabel="Price per ticket" onSave={save(id, "ticketPrice")} className="w-24" />
              {ev.row.headcount > 0 && <span className="text-xs text-muted">{(s.drinkTickets / ev.row.headcount).toFixed(1)} per guest</span>}
            </div>
          </Row>
        )}
        {(s.barKind === "OPEN_TAB" || s.barKind === "MINIMUM") && (
          <Row label={s.barKind === "MINIMUM" ? "Bar minimum" : "Tab estimate"}>
            <Cell grid="pe-f" col="barAmount" type="number" decimals={2} prefix="$" value={s.barAmount} ariaLabel={s.barKind === "MINIMUM" ? "Bar minimum" : "Open tab estimate"} onSave={save(id, "barAmount")} className="w-32" />
          </Row>
        )}
        <Row label="Room fee"><Cell grid="pe-f" col="roomFee" type="number" decimals={2} prefix="$" value={s.roomFee} ariaLabel="Room fee" onSave={save(id, "roomFee")} className="w-32" /></Row>
        <Row label="Service charge" help="events.private.service"><Cell grid="pe-f" col="sc" type="number" suffix="%" value={+(s.serviceChargePct * 100).toFixed(2)} ariaLabel="Service charge percent" onSave={save(id, "serviceChargePct")} className="w-24" /></Row>
        <Row label="Sales tax"><Cell grid="pe-f" col="tax" type="number" suffix="%" value={+(s.taxPct * 100).toFixed(3)} ariaLabel="Sales tax percent" onSave={save(id, "taxPct")} className="w-24" /></Row>
        <Row label="Deposit" help="events.private.deposit">
          <div className="flex flex-wrap items-center gap-1">
            <Cell grid="pe-f" col="depPct" type="number" suffix="%" value={+(s.depositPct * 100).toFixed(2)} ariaLabel="Deposit percent" onSave={save(id, "depositPct")} className="w-20" />
            <span className="text-xs text-muted">or fixed</span>
            <Cell grid="pe-f" col="depAmt" type="number" decimals={2} prefix="$" placeholder="—" value={s.depositAmount ?? ""} ariaLabel="Fixed deposit amount" onSave={save(id, "depositAmount")} className="w-28" />
          </div>
        </Row>
        <Row label="Deposit due"><DateField value={ev.row.depositDueOn} label="Deposit due" onSave={save(id, "depositDueOn")} /></Row>
        <Row label="Balance due"><DateField value={ev.row.balanceDueOn} label="Balance due" onSave={save(id, "balanceDueOn")} /></Row>
        <Row label="Note to client"><NotesField id={id} field="quoteNote" value={s.quoteNote ?? ""} placeholder="Shown on the quote: what's included, timings, the fine print." /></Row>
      </Card>
    </Panel>
  );
}

// ---- Totals ---------------------------------------------------------------------------

function Line({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 py-1", strong && "font-semibold text-ink", muted && "text-muted")}>
      <span className="min-w-0">{label}</span>
      <span className="num shrink-0">{value}</span>
    </div>
  );
}

export function TotalsCard({ ev }: { ev: PrivateEventDetail }) {
  const q = ev.quote;
  const s = ev.settings;
  const tone = q.marginPct == null ? "" : q.marginPct >= 0.6 ? "text-good" : q.marginPct >= 0.45 ? "text-ink" : "text-warn";
  return (
    <Panel title="Totals" help="events.private.totals">
      <Card className="p-4 text-sm">
        {q.food > 0 && <Line label="Food" value={money(q.food)} />}
        {q.bar > 0 && <Line label={BAR_LABEL[s.barKind as BarKind]} value={money(q.bar)} />}
        {q.roomFee > 0 && <Line label="Room fee" value={money(q.roomFee)} />}
        <Line label="Subtotal" value={money(q.subtotal)} />
        {q.serviceCharge > 0 && <Line label={`Service charge ${pct(s.serviceChargePct, 0)}`} value={money(q.serviceCharge)} />}
        <Line label={`Sales tax ${pct(s.taxPct, s.taxPct * 1000 % 10 ? 3 : 0)}`} value={money(q.tax)} />
        <div className="my-1 border-t border-border" />
        <Line label="Total" value={money(q.total)} strong />
        {q.perGuest != null && <Line label="Per guest" value={money(q.perGuest)} muted />}
        <div className="my-2 border-t border-border" />
        <Line label="Deposit" value={money(q.deposit)} />
        <Line label="Paid" value={money(q.paid)} />
        <Line label="Balance" value={money(q.balance)} strong />

        <div className="mt-4 rounded-lg bg-surface-2 p-3" data-tour="private.margin">
          <div className="mb-1 text-xs font-medium text-muted">Just for you, not on the quote</div>
          <Line label={<>Food cost{q.foodCostPct != null && <span className="text-muted"> · {pct(q.foodCostPct, 0)}</span>}</>} value={<>{money(q.foodCost)}{q.costIncomplete && <span className="text-warn">*</span>}</>} />
          {q.barCost > 0 && <Line label="Bar cost (est.)" value={money(q.barCost)} />}
          <Line label={<>Margin before labor{q.marginPct != null && <span className={cx(" font-medium", tone)}> · {pct(q.marginPct, 0)}</span>}</>} value={money(q.margin)} strong />
          {q.costIncomplete && <div className="mt-1 text-xs text-warn">* Some lines have no cost yet, so real cost is higher.</div>}
        </div>
      </Card>
    </Panel>
  );
}

// ---- Share ----------------------------------------------------------------------------

export function ShareCard({ ev, canEmail }: { ev: PrivateEventDetail; canEmail: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const sh = ev.share;
  const id = ev.row.id;
  const hasEmail = !!ev.row.clientEmail;

  const getLink = (fresh = false) =>
    start(async () => {
      setMsg(null);
      const r = await shareLink(id, { fresh });
      if (r.error || !r.url) return setMsg(r);
      setUrl(r.url);
      const ok = await copy(r.url);
      setMsg({ message: r.message ?? (ok ? "Link copied. Paste it in a text or email." : "Here's the link. Copy it from the box.") });
      router.refresh();
    });

  return (
    <Panel title="Send the quote" help="events.private.share">
      <Card className="p-4 text-sm">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {sh.acceptedAt ? <Badge tone="good">Accepted by {sh.acceptedName} · {shortDate(businessDateOf(sh.acceptedAt))}</Badge> : sh.viewedAt ? <Badge>Opened <RelativeTime at={sh.viewedAt} /></Badge> : sh.sentAt ? <Badge>Sent <RelativeTime at={sh.sentAt} /></Badge> : <Badge>Not sent yet</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending || ev.quote.total <= 0} onClick={() => getLink()} className="h-10 sm:h-9" data-tour="private.copy-link"><Copy className="size-4" /> Copy link</Button>
          {canEmail && hasEmail && (
            <Button disabled={pending || ev.quote.total <= 0} className="h-10 sm:h-9" onClick={() => start(async () => { setMsg(await emailQuote(id)); router.refresh(); })}><Mail className="size-4" /> Email it</Button>
          )}
          {sh.token && <a href={`/quote/${sh.token}`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-9"><ExternalLink className="size-4" /> Preview</a>}
        </div>
        {url && <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Quote link" className="mt-3 text-xs" />}
        {!canEmail && <p className="mt-3 text-xs text-muted">Email isn&rsquo;t set up, so copy the link and text or email it yourself. (Settings → Connections → Email.)</p>}
        {canEmail && !hasEmail && <p className="mt-3 text-xs text-muted">Add the client&rsquo;s email above to send it from here.</p>}
        {ev.quote.total <= 0 && <p className="mt-3 text-xs text-muted">Add something to the quote first.</p>}
        {sh.token && (
          <button
            type="button"
            disabled={pending}
            className="relative mt-3 text-xs text-muted underline decoration-dotted underline-offset-2 after:absolute after:-inset-2 after:content-[''] hover:text-ink"
            onClick={async () => {
              const ok = await confirm({ title: "Make a new link?", body: "The old link stops working. Use this if a link went to the wrong person.", confirmLabel: "New link" });
              if (ok) getLink(true);
            }}
          >
            Make a new link
          </button>
        )}
        <Note msg={msg} />
      </Card>
    </Panel>
  );
}

// ---- Payments -------------------------------------------------------------------------

const KIND_OPTIONS = [{ value: "DEPOSIT", label: "Deposit" }, { value: "BALANCE", label: "Balance" }, { value: "OTHER", label: "Other" }];
const METHOD_OPTIONS = [{ value: "CARD", label: "Card" }, { value: "CASH", label: "Cash" }, { value: "CHECK", label: "Check" }, { value: "SQUARE_LINK", label: "Square link" }, { value: "OTHER", label: "Other" }];
const METHOD_LABEL = Object.fromEntries(METHOD_OPTIONS.map((o) => [o.value, o.label]));

export function PaymentsCard({ ev, today, square, canEmail }: { ev: PrivateEventDetail; today: string; square: boolean; canEmail: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const q = ev.quote;
  const depositLeft = Math.max(0, q.deposit - q.paid);
  const which: "deposit" | "balance" = depositLeft > 0.005 ? "deposit" : "balance";
  const owed = which === "deposit" ? depositLeft : q.balance;
  const [amount, setAmount] = useState(owed > 0 ? owed.toFixed(2) : "");
  const [kind, setKind] = useState(which === "deposit" ? "DEPOSIT" : "BALANCE");
  const [method, setMethod] = useState("CARD");
  const [paidOn, setPaidOn] = useState(today);
  const [msg, setMsg] = useState<Msg>(null);
  const [reminder, setReminder] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(ev.share.paymentLinkUrl);
  const [pending, start] = useTransition();
  const id = ev.row.id;
  // After a payment, the form moves on to what's owed next (the balance after the deposit), amount filled in.
  const justPaid = useRef(false);
  useEffect(() => {
    if (!justPaid.current) return;
    justPaid.current = false;
    setKind(which === "deposit" ? "DEPOSIT" : "BALANCE");
    setAmount(owed > 0.005 ? owed.toFixed(2) : "");
  }, [which, owed, ev.payments.length]);

  return (
    <Panel title="Payments" help="events.private.payments">
      <Card className="p-4 text-sm">
        {ev.payments.length === 0 ? (
          <p className="text-muted">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {ev.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <div className="num">{money(p.amount)} <span className="text-muted">· {KIND_OPTIONS.find((k) => k.value === p.kind)?.label ?? p.kind}</span></div>
                  <div className="truncate text-xs text-muted">{shortDate(p.paidOn)} · {METHOD_LABEL[p.method] ?? p.method}{p.note ? ` · ${p.note}` : ""}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-10 shrink-0 p-0 sm:size-8"
                  aria-label={`Remove ${money(p.amount)} payment`}
                  disabled={pending}
                  onClick={async () => {
                    const ok = await confirm({ title: `Remove the ${money(p.amount)} payment?`, body: "Only if it was entered by mistake. The stage doesn't move back on its own.", confirmLabel: "Remove", danger: true });
                    if (ok) start(async () => { setMsg(await removePayment(p.id)); router.refresh(); });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2" data-tour="private.record-payment">
          <div className="relative col-span-2 sm:col-span-1 lg:col-span-2">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">$</span>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount paid" placeholder="0.00" className="num pl-6" />
          </div>
          <div className="col-span-2 sm:col-span-1 lg:col-span-2"><DatePicker value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} aria-label="Paid on" /></div>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={KIND_OPTIONS} aria-label="What for" />
          <Select value={method} onChange={(e) => setMethod(e.target.value)} options={METHOD_OPTIONS} aria-label="How" />
          <Button
            variant="primary"
            className="col-span-2 h-10 sm:h-9"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(null);
                const r = await addPayment(id, { amount, kind: kind as "DEPOSIT", method: method as "CARD", paidOn });
                setMsg(r);
                if (!r.error) {
                  justPaid.current = true;
                  setAmount("");
                  router.refresh();
                }
              })
            }
          >
            Record payment
          </Button>
        </div>
        <Note msg={msg} />

        {owed > 0.005 && ev.row.stage !== "LOST" && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 text-xs text-muted">
              {which === "deposit" ? "Deposit" : "Balance"} owed {money(owed)}
              {(which === "deposit" ? ev.row.depositDueOn : ev.row.balanceDueOn) && <> · due {shortDate((which === "deposit" ? ev.row.depositDueOn : ev.row.balanceDueOn)!)}</>}
              {ev.share.remindedAt && <> · reminded <RelativeTime at={ev.share.remindedAt} /></>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-10 sm:h-8"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await sendReminder(id, which);
                    setReminder(r.text ?? null);
                    setMsg(r.error || r.message ? { error: r.error, message: r.message } : null);
                    router.refresh();
                  })
                }
              >
                {canEmail && ev.row.clientEmail ? "Email a reminder" : "Write a reminder"}
              </Button>
              {square && (
                <Button
                  size="sm"
                  className="h-10 sm:h-8"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await squarePaymentLink(id, which);
                      if (r.error) return setMsg({ error: r.error });
                      setLink(r.url ?? null);
                      const ok = r.url ? await copy(r.url) : false;
                      setMsg({ message: ok ? "Square payment link copied." : "Square payment link made." });
                      router.refresh();
                    })
                  }
                >
                  Square payment link
                </Button>
              )}
            </div>
            {link && <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Square payment link" className="mt-2 text-xs" />}
            {reminder && (
              <div className="mt-2">
                <Textarea readOnly value={reminder} aria-label="Reminder text" className="min-h-36 text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="ghost" className="mt-1 h-10 sm:h-8" onClick={async () => setMsg((await copy(reminder)) ? { message: "Copied." } : { error: "Select the text and copy it." })}><Copy className="size-3.5" /> Copy</Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </Panel>
  );
}

// ---- Lost / delete --------------------------------------------------------------------

export function DangerZone({ id, stage, title }: { id: string; stage: Stage; title: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const canLose = canMove(stage, "LOST", { date: null, headcount: 0, total: 0, deposit: 0, paid: 0, today: "" }).ok;
  return (
    <div className="flex flex-wrap gap-2">
      {canLose && (
        <Button
          variant="ghost"
          disabled={pending}
          className="h-10 sm:h-9"
          onClick={async () => {
            const ok = await confirm({ title: `Mark ${title} as lost?`, body: "It comes off the calendar and the forecast. You can reopen it later.", confirmLabel: "Mark lost" });
            if (ok) start(async () => { const r = await setStage(id, "LOST"); setMsg(r.error ? r : null); router.refresh(); });
          }}
        >
          Mark lost
        </Button>
      )}
      <Button
        variant="danger"
        disabled={pending}
        className="h-10 sm:h-9"
        onClick={async () => {
          const ok = await confirm({ title: `Delete ${title}?`, body: "The booking, its quote and payments are deleted for good, and it comes off the calendar.", confirmLabel: "Delete", danger: true });
          if (ok) start(async () => { await removePrivateEvent(id); router.push("/events/private"); });
        }}
      >
        Delete
      </Button>
      <Note msg={msg} />
    </div>
  );
}
