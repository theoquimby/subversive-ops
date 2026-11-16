"use client";

import { GridCell, GridSelect } from "@/components/grid";
import { cx } from "@/components/ui";
import { ALERT_OPTIONS, CADENCE_OPTIONS, type OrderCadence } from "@/domain/orderNeed";
import { FIRST_OPTIONS, LAST_CALL_OPTIONS, RECIPIENT_OPTIONS, SEND_BY_OPTIONS, type SupplierPrefs } from "@/domain/supplierPrefs";
import { useState, useTransition } from "react";
import { saveSupplierPref, setCadence } from "./actions";

/**
 * How often a supplier is ordered from, when and whom to remind, and how it takes
 * orders. Used in the Ordering side panel and in Settings → Suppliers.
 */

export function CadenceToggle({ id, name, value, compact }: { id: string; name: string; value: OrderCadence; compact?: boolean }) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (c: OrderCadence) => {
    if (c === v) return;
    const prev = v;
    setV(c);
    start(async () => {
      const r = await setCadence([id], c);
      if (r.error) { setV(prev); setError(r.error); } else setError(null);
    });
  };
  return (
    <div>
      <div role="radiogroup" aria-label={`How often you order from ${name}`} className="inline-flex rounded-lg border border-border-strong p-0.5">
        {CADENCE_OPTIONS.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={v === o.value} disabled={pending} title={o.hint} onClick={() => pick(o.value)}
            className={cx("rounded-md px-2.5 text-xs whitespace-nowrap transition-colors", compact ? "h-9 sm:h-7" : "h-10 sm:h-8", v === o.value ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>
            {compact ? (o.value === "regular" ? "Every delivery" : "When low") : o.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

function PeoplePicker({ id, value, people }: { id: string; value: string[]; people: { id: string; name: string }[] }) {
  const [v, setV] = useState(value);
  const [, start] = useTransition();
  const toggle = (uid: string) => {
    const next = v.includes(uid) ? v.filter((x) => x !== uid) : [...v, uid];
    setV(next);
    start(async () => { await saveSupplierPref(id, "people", next.join(",")); });
  };
  if (people.length === 0) return <p className="text-xs text-muted">No logins yet.</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who to remind">
      {people.map((p) => (
        <button key={p.id} type="button" aria-pressed={v.includes(p.id)} onClick={() => toggle(p.id)} className={cx("h-10 rounded-full border px-3 text-sm sm:h-8 sm:text-xs", v.includes(p.id) ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2 hover:bg-surface-2")}>{p.name}</button>
      ))}
    </div>
  );
}

export function SupplierOrderSettings({ id, name, cadence, prefs, people }: { id: string; name: string; cadence: OrderCadence; prefs: SupplierPrefs; people: { id: string; name: string }[] }) {
  const [recipients, setRecipients] = useState(prefs.recipients);
  const [sendBy, setSendBy] = useState(prefs.sendBy);
  const [alert, setAlert] = useState<string>(prefs.alert ?? "auto");
  const save = (field: string) => (value: string) => saveSupplierPref(id, field, value);
  const row = (label: string, hint: string, el: React.ReactNode) => (
    <div className="grid gap-1.5 py-2.5 sm:grid-cols-[1fr_13rem] sm:items-center sm:gap-3">
      <div><div className="text-sm font-medium text-ink">{label}</div><div className="text-xs text-muted">{hint}</div></div>
      <div className="min-w-0">{el}</div>
    </div>
  );
  const auto = cadence === "as_needed" ? "Only when stock runs low" : "Every delivery";
  return (
    <div className="divide-y divide-border">
      <div className="py-2.5">
        <div className="text-sm font-medium text-ink">How often you order</div>
        <div className="mb-2 text-xs text-muted">Every delivery: Ops expects an order for each truck. When stock runs low: it only speaks up when counts and sales say something runs short before the delivery after next.</div>
        <CadenceToggle id={id} name={name} value={cadence} />
      </div>
      {row("Remind me", "Whether a missing order sends reminders and shows in Needs you and the morning brief.",
        <GridSelect value={alert} ariaLabel={`Reminders for ${name}`} options={[{ value: "auto", label: `Follow how often (${auto.toLowerCase()})` }, ...ALERT_OPTIONS]} onSave={async (v) => { setAlert(v); return save("alert")(v); }} />)}
      {alert !== "off" && row("First reminder", "A heads-up before the order cutoff.", <GridSelect value={prefs.first} ariaLabel="First reminder" options={FIRST_OPTIONS} onSave={save("first")} />)}
      {alert !== "off" && row("Last call", "\"You haven't placed it\", if nothing is placed by then.", <GridSelect value={prefs.lastCallMins == null ? "off" : String(prefs.lastCallMins)} ariaLabel="Last call" options={LAST_CALL_OPTIONS} onSave={save("lastCallMins")} />)}
      {alert !== "off" && row("Who gets them", recipients === "shift" ? "Whoever is on today's schedule and can place orders; managers if nobody is." : "By push, and email for anyone who turned it on.",
        <GridSelect value={recipients} ariaLabel="Who gets reminders" options={RECIPIENT_OPTIONS} onSave={async (v) => { setRecipients(v as SupplierPrefs["recipients"]); return save("recipients")(v); }} />)}
      {alert !== "off" && recipients === "people" && <div className="py-2.5"><PeoplePicker id={id} value={prefs.people} people={people} /></div>}
      {row("Send orders by", SEND_BY_OPTIONS.find((o) => o.value === sendBy)?.hint ?? "", <GridSelect value={sendBy} ariaLabel="Send orders by" options={SEND_BY_OPTIONS} onSave={async (v) => { setSendBy(v as SupplierPrefs["sendBy"]); return save("sendBy")(v); }} />)}
      {(sendBy === "text" || sendBy === "phone") && row("Their number", sendBy === "text" ? "The mobile number orders are texted to." : "The number to call orders in to.", <GridCell grid={`sop-${id}`} col="phone" value={prefs.phone} placeholder="(518) 555-0142" ariaLabel="Supplier phone" onSave={save("phone")} className="rounded-md border border-border" />)}
      {sendBy === "portal" && row("Their site or app", "What it's called, so buttons say \"Copy order for Cut+Dry\".", <GridCell grid={`sop-${id}`} col="portal" value={prefs.portal} placeholder="e.g. Driscoll's app" ariaLabel="Portal name" onSave={save("portal")} className="rounded-md border border-border" />)}
      {sendBy === "portal" && row("Its web address", "Optional: a button opens it. Ops never logs in for you.", <GridCell grid={`sop-${id}`} col="portalUrl" value={prefs.portalUrl} placeholder="https://" ariaLabel="Portal web address" onSave={save("portalUrl")} className="rounded-md border border-border" />)}
    </div>
  );
}
