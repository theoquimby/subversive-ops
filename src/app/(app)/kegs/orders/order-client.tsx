"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Select } from "@/components/select";
import { Badge, Button, DatePicker, Input, Textarea } from "@/components/ui";
import { lineProgress, progressLabel, TRANSITS, type OrderProgress } from "@/domain/kegOrders";
import { KEG_SIZE_LIST, kegSizeInfo } from "@/domain/kegs";
import { businessDateTime } from "@/lib/format";
import type { OrderDetail, OrderFormContext } from "@/server/services/kegOrders";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BeerDot } from "../bits";
import { addKegOrderLine, addKegOrderNote, cancelKegOrder, fulfilKegOrder, removeKegOrderLine, saveLineUnscanned, saveOrderField, saveOrderLineField } from "./actions";

const SIZES = KEG_SIZE_LIST.map((s) => ({ value: s.id, label: s.short }));
const OFFLINE = { error: "Couldn't save. Check the connection and try again." };

const row = (label: string, el: React.ReactNode) => (
  <div className="grid grid-cols-[7rem_1fr] items-center gap-2 border-b border-border px-4 py-1.5 last:border-b-0">
    <span className="text-sm text-muted">{label}</span>
    <div className="min-w-0">{el}</div>
  </div>
);

/** An open order's account, delivery or pickup and date, changed in place. Each saves as it changes. */
export function OrderDetails({ order: o, accounts }: { order: OrderDetail; accounts: OrderFormContext["accounts"] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sent = o.progress.sent > 0;
  const setDate = (value: string) =>
    start(async () => {
      const r = await saveOrderField(o.id, "dueOn", value).catch(() => OFFLINE);
      setError(r.error ?? null);
    });
  return (
    <div className="rounded-xl border border-border bg-surface">
      {row(
        "Account",
        sent ? (
          <Link href={`/kegs/accounts/${o.account.id}`} className="block px-2 py-2 text-sm hover:underline sm:py-1.5">{o.account.name}</Link>
        ) : (
          <GridSelect ariaLabel="Account" value={o.account.id} options={accounts.map((a) => ({ value: a.id, label: a.name }))} onSave={(v) => saveOrderField(o.id, "accountId", v)} />
        ),
      )}
      {row("Delivery or pickup", <GridSelect ariaLabel="Delivery or pickup" value={o.transit} options={TRANSITS} onSave={(v) => saveOrderField(o.id, "transit", v)} />)}
      {row(
        "Date",
        <div className="flex items-center gap-1 py-0.5">
          <DatePicker value={o.dueOn ?? ""} today={o.today} onChange={(e) => setDate(e.target.value)} aria-label={o.transit === "PICKUP" ? "Pickup date" : "Delivery date"} className={`h-10 border-transparent bg-transparent px-2 hover:border-border sm:h-8 ${pending ? "opacity-60" : ""}`} />
          {o.dueOn && <Button variant="ghost" size="sm" className="h-10 shrink-0 sm:h-8" disabled={pending} onClick={() => setDate("")}>No date</Button>}
        </div>,
      )}
      {row("Made", <span className="block px-2 py-2 text-sm text-ink-2 sm:py-1.5">{businessDateTime(o.createdAt)}{o.createdByName ? ` by ${o.createdByName}` : ""}</span>)}
      {error && <p role="alert" className="border-t border-border px-4 py-2 text-xs text-bad">{error}</p>}
    </div>
  );
}

/** What a line still needs against the full kegs there are for it. */
function LineStatus({ line: l, open }: { line: OrderDetail["lines"][number]; open: boolean }) {
  const p = lineProgress(l);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="num text-ink-2">{p.sent} of {l.quantity} sent</span>
      {l.unscanned > 0 && <span className="text-xs text-muted">{l.unscanned} without scanning</span>}
      {p.complete ? <Badge tone="good">Complete</Badge> : open ? (
        l.short > 0 ? <span className="text-xs font-medium text-warn">{l.full} full now, {l.short} to fill</span> : <span className="text-xs text-muted">{l.full} full now</span>
      ) : null}
    </div>
  );
}

/**
 * An order's lines. On an open order a manager changes how many, marks kegs
 * delivered without scanning, and adds or removes lines; a line that has kegs
 * out keeps its beer and size.
 */
export function OrderLines({ order: o, beers }: { order: OrderDetail; beers: OrderFormContext["beers"] }) {
  const open = o.status === "OPEN";
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [beerId, setBeerId] = useState("");
  const [sizeId, setSizeId] = useState(o.lines[o.lines.length - 1]?.sizeId ?? "half");
  const [quantity, setQuantity] = useState("1");
  const beerOptions = beers.map((b) => ({ value: b.id, label: b.name }));

  const remove = (lineId: string) =>
    start(async () => {
      const r = await removeKegOrderLine(lineId).catch(() => OFFLINE);
      setError(r.error ?? null);
    });
  const add = () => {
    if (!beerId) { setError("Pick the beer."); return; }
    start(async () => {
      const r = await addKegOrderLine(o.id, { beerId, sizeId, quantity: /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : Number.NaN }).catch(() => OFFLINE);
      setError(r.error ?? null);
      if (!r.error) { setBeerId(""); setQuantity("1"); }
    });
  };

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {o.lines.map((l) => {
          const sent = lineProgress(l).sent;
          const what = `${l.beer} ${kegSizeInfo(l.sizeId).short}`;
          return (
            <li key={l.id} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {open && sent === 0 ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-1">
                      <div className="min-w-0"><GridSelect ariaLabel="Beer" value={l.beerId} options={beerOptions} onSave={(v) => saveOrderLineField(l.id, "beerId", v)} /></div>
                      <div className="min-w-0"><GridSelect ariaLabel={`Keg size for ${l.beer}`} value={l.sizeId} options={SIZES} onSave={(v) => saveOrderLineField(l.id, "sizeId", v)} /></div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 font-medium"><BeerDot color={l.color} /><span className="min-w-0">{l.beer}</span><span className="shrink-0 text-xs font-normal text-muted">{kegSizeInfo(l.sizeId).short}</span></div>
                  )}
                  <LineStatus line={l} open={open} />
                </div>
                {open && sent === 0 && o.lines.length > 1 && (
                  <Button variant="ghost" aria-label={`Remove ${what}`} className="h-10 w-10 shrink-0 px-0 sm:h-8 sm:w-8" disabled={pending} onClick={() => remove(l.id)}><X className="size-4" /></Button>
                )}
              </div>
              {open && (
                <div className="mt-2 grid max-w-sm grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-2 text-sm text-muted">
                  <span>Wanted</span>
                  <GridCell grid={`order-${o.id}`} col="quantity" type="number" ariaLabel={`How many ${what}`} value={l.quantity} onSave={(v) => saveOrderLineField(l.id, "quantity", v)} />
                  <span>Delivered without scanning</span>
                  <GridCell grid={`order-${o.id}`} col="unscanned" type="number" ariaLabel={`${what} delivered without scanning`} value={l.unscanned} onSave={(v) => saveLineUnscanned(l.id, v)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {open && (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mt-3 grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_4.5rem_auto]">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <Select aria-label="Beer for a new line" value={beerId} onChange={(e) => { setError(null); setBeerId(e.target.value); }} placeholder="Add a beer" options={beerOptions} searchable className="h-10 sm:h-9" />
          </div>
          <Select aria-label="Keg size for a new line" value={sizeId} onChange={(e) => setSizeId(e.target.value)} options={SIZES} className="h-10 sm:h-9" />
          <Input aria-label="How many for a new line" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={3} className="num text-right" />
          <Button type="submit" className="col-span-2 h-10 sm:col-span-1 sm:h-9" disabled={pending || !beerId}><Plus className="size-4" /> Add line</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    </>
  );
}

/** Mark fulfilled (one tap when complete), fulfil short, or cancel. Short and cancel ask first. */
export function OrderFinish({ orderId, progress: p }: { orderId: string; progress: OrderProgress }) {
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      const r = await fn().catch(() => OFFLINE);
      setError("error" in r ? r.error : null);
    });

  const fulfilShort = async () => {
    const ok = await confirm({
      title: `Fulfil with ${progressLabel(p)}?`,
      body: `The order closes with ${p.remaining} keg${p.remaining === 1 ? "" : "s"} not sent. It can't be reopened; make a new order for the rest.`,
      confirmLabel: `Fulfil with ${p.sent} of ${p.quantity}`,
    });
    if (ok) run(() => fulfilKegOrder(orderId, true));
  };
  const cancel = async () => {
    const ok = await confirm({
      title: "Cancel this order?",
      body: p.sent > 0 ? `${p.sent} keg${p.sent === 1 ? " has" : "s have"} already gone out on it. ${p.sent === 1 ? "It stays" : "They stay"} out at the account; cancelling doesn't bring ${p.sent === 1 ? "it" : "them"} back. A cancelled order can't be reopened.` : "No kegs have gone out on it. A cancelled order can't be reopened.",
      confirmLabel: "Cancel order",
      danger: true,
    });
    if (ok) run(() => cancelKegOrder(orderId));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {p.complete && <Button variant="primary" size="lg" className="h-12 w-full sm:w-auto sm:px-8" disabled={pending} onClick={() => run(() => fulfilKegOrder(orderId))}>Mark fulfilled</Button>}
        {!p.complete && p.sent > 0 && <Button className="h-10 sm:h-9" disabled={pending} onClick={() => void fulfilShort()}>Fulfil with {p.sent} of {p.quantity}</Button>}
        <Button variant="danger" className="h-10 sm:h-9" disabled={pending} onClick={() => void cancel()}>Cancel order</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}

/** Notes on an order, newest first, and a box to add one. Anyone can; they stay with the order after it closes. */
export function OrderNotes({ orderId, notes }: { orderId: string; notes: { id: string; at: Date; userName: string | null; text: string }[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const add = () => {
    if (!text.trim()) return;
    start(async () => {
      const r = await addKegOrderNote(orderId, text).catch(() => OFFLINE);
      setError(r.error ?? null);
      if (!r.error) { setText(""); router.refresh(); }
    });
  };
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="space-y-2">
        <Textarea value={text} onChange={(e) => { setText(e.target.value); setError(null); }} maxLength={1000} placeholder="Add a note for whoever picks this order up next" aria-label="New note" className="min-h-16" />
        <div className="flex items-center gap-3">
          <Button type="submit" className="h-10 sm:h-9" disabled={pending || !text.trim()}>{pending ? "Adding…" : "Add note"}</Button>
          {error && <span role="alert" className="text-sm text-bad">{error}</span>}
        </div>
      </form>
      {notes.length > 0 && (
        <ul className="mt-4 space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl border border-border bg-surface px-4 py-3">
              <p className="text-sm whitespace-pre-wrap text-ink">{n.text}</p>
              <p className="mt-1 text-xs text-muted">{n.userName ?? "Someone"} · {businessDateTime(n.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
