"use client";

import { HelpTip, HelpZone } from "@/components/help";
import { readDraft, useDraftStorage, useSaveShortcut, useUnsavedGuard } from "@/components/form-hooks";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Select } from "@/components/ui";
import { receiptLine } from "@/domain/purchasing";
import { money, qty as fmtQty } from "@/lib/format";
import { RotateCcw, Truck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addOrderLine, receiveOrder, removeOrderLine, reopenOrder, updateOrderLine } from "../../actions";
import { QtyStepper } from "../../qty-stepper";

export interface PoLine {
  id: string;
  supplierProductId: string;
  name: string;
  detail: string;
  unit: string;
  qty: number;
  suggestedQty: number;
  received: number | null;
  /** The line's price, or the current price list's when the line has none. */
  price: number | null;
  estimated: boolean;
}

export interface AddOption { value: string; label: string; hint?: string }

interface Invoiced { total: number | null; links: { id: string; label: string }[] }

type Mode = "edit" | "receive" | "done";

/**
 * The lines of an order. A draft is edited in place (quantities save as you
 * go, remove has Undo, add any of the supplier's items). A sent order, or a
 * draft that was phoned in, is checked in line by line; a checked-in order
 * can be reopened to fix it.
 */
export function OrderLines({ orderId, status, lines, addOptions, invoiced }: { orderId: string; status: "DRAFT" | "SENT" | "RECEIVED"; lines: PoLine[]; addOptions: AddOption[]; invoiced: Invoiced | null }) {
  const [toast, show] = useToast();
  const [mode, setMode] = useState<Mode>(status === "RECEIVED" ? "done" : status === "SENT" ? "receive" : "edit");
  useEffect(() => setMode(status === "RECEIVED" ? "done" : status === "SENT" ? "receive" : "edit"), [status]);

  // ---- Draft: quantities saved line by line ----
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, start] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Once the page has the saved value, the local edit isn't needed.
  useEffect(() => setEdits((e) => {
    const next = Object.fromEntries(Object.entries(e).filter(([id, q]) => lines.find((l) => l.id === id)?.qty !== q));
    return Object.keys(next).length === Object.keys(e).length ? e : next;
  }), [lines]);
  const qtyOf = (l: PoLine) => edits[l.id] ?? l.qty;
  const shown = lines.filter((l) => !gone.has(l.id));

  const saveQty = (l: PoLine, n: number, delay = 0) => {
    clearTimeout(timers.current[l.id]);
    if (n === 0) { remove(l); return; }
    timers.current[l.id] = setTimeout(async () => {
      if (n === l.qty) return;
      const r = await updateOrderLine(l.id, n).catch(() => ({ error: "No connection. That quantity isn't saved yet; try again." }));
      if (r.error) show(`${l.name}: ${r.error}`, "bad");
    }, delay);
  };
  const remove = (l: PoLine) => {
    clearTimeout(timers.current[l.id]);
    setGone((g) => new Set(g).add(l.id));
    start(async () => {
      const r = await removeOrderLine(l.id).catch(() => ({ error: "No connection. The line wasn't removed.", removed: undefined }));
      if (r.error || !r.removed) {
        setGone((g) => { const n = new Set(g); n.delete(l.id); return n; });
        show(r.error ?? "Couldn't remove that line.", "bad");
        return;
      }
      const removed = r.removed;
      show(`Removed ${l.name}`, "good", {
        label: "Undo",
        onClick: () => start(async () => {
          const u = await addOrderLine({ orderId, supplierProductId: removed.supplierProductId, qty: removed.qty, suggestedQty: removed.suggestedQty, unitPrice: removed.unitPrice }).catch(() => ({ error: "No connection. Add it again from the list." }));
          if (u.error) show(u.error, "bad");
          else show(`Put ${l.name} back`, "good");
        }),
      });
    });
  };
  const add = (supplierProductId: string) => {
    const o = addOptions.find((x) => x.value === supplierProductId);
    if (!o) return;
    start(async () => {
      const r = await addOrderLine({ orderId, supplierProductId, qty: 1 }).catch(() => ({ error: "No connection. The item wasn't added." }));
      if (r.error) show(r.error, "bad");
      else show(`Added 1 ${o.label}. Set the quantity in the list.`, "good");
    });
  };
  const onOrder = new Set(shown.map((l) => l.supplierProductId));
  const canAdd = addOptions.filter((o) => !onOrder.has(o.value));

  // ---- Receiving ----
  const draftKey = `receive:${orderId}`;
  const startReceived = () => Object.fromEntries(lines.map((l) => [l.id, l.received ?? l.qty]));
  const [received, setReceived] = useState<Record<string, number>>(startReceived);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || mode !== "receive") return;
    restored.current = true;
    const kept = readDraft<Record<string, number>>(draftKey);
    if (kept) setReceived((r) => ({ ...r, ...Object.fromEntries(Object.entries(kept).filter(([id, n]) => id in r && typeof n === "number")) }));
  }, [mode, draftKey]);
  const got = (l: PoLine) => received[l.id] ?? l.received ?? l.qty;
  const receiving = mode === "receive";
  const rows = useMemo(() => shown.map((l) => ({ l, r: receiptLine(qtyOf(l), got(l)) })), [shown, received, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const shorts = rows.filter((x) => x.r.short > 0).length;
  const overs = rows.filter((x) => x.r.over > 0).length;
  const dirtyReceive = receiving && rows.some((x) => x.r.changed);
  const { allowLeave } = useUnsavedGuard(dirtyReceive, { body: "The received amounts you've typed aren't checked in yet." });
  useDraftStorage(draftKey, received, dirtyReceive);
  const [checking, startCheck] = useTransition();
  const checkIn = () => startCheck(async () => {
    // A draft quantity changed a moment ago goes first, so "ordered" is right.
    for (const l of shown) {
      const e = edits[l.id];
      if (status !== "DRAFT" || e == null || e === l.qty || e <= 0) continue;
      clearTimeout(timers.current[l.id]);
      await updateOrderLine(l.id, e).catch(() => null);
    }
    const r = await receiveOrder({ id: orderId, lines: shown.map((l) => ({ lineId: l.id, received: got(l) })) }).catch(() => ({ error: "No connection. Nothing was checked in; your amounts are kept on this device. Try again when you have signal." }));
    if (r.error) { show(r.error, "bad"); return; }
    allowLeave();
    try { localStorage.removeItem(`draft:${draftKey}`); } catch { /* nothing kept */ }
    show(shorts ? `Checked in. ${shorts} line${shorts === 1 ? "" : "s"} short.` : "Checked in. Added to estimated stock.", "good");
  });
  useSaveShortcut(checkIn, receiving && !checking);
  const reopen = () => startCheck(async () => {
    const r = await reopenOrder(orderId).catch(() => ({ error: "No connection. Try again." }));
    if (r.error) show(r.error, "bad");
    else { setReceived(startReceived()); show("Reopened. Fix the amounts and check it in again.", "good"); }
  });

  // ---- Totals ----
  const total = shown.reduce((s, l) => s + (l.price == null ? 0 : qtyOf(l) * l.price), 0);
  const estimated = shown.some((l) => l.estimated);
  const unpriced = shown.filter((l) => l.price == null).length;

  return (
    <>
      {toast}
      <HelpZone id={receiving ? "ordering.po.receive" : "ordering.po.lines"}>
        {receiving && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted">Change anything that came in short or extra. Everything else is checked in as ordered.</p>
            {rows.some((x) => x.r.changed) && <Button size="sm" variant="ghost" onClick={() => setReceived(Object.fromEntries(shown.map((l) => [l.id, qtyOf(l)])))}><RotateCcw className="size-3.5" />All as ordered</Button>}
          </div>
        )}
        <Card className="divide-y divide-border">
          {rows.map(({ l, r }) => (
            <div key={l.id} className={cx("flex items-center gap-2 px-3 py-2.5 transition-colors duration-120 sm:gap-3 sm:px-4", receiving && r.changed && "bg-warn-bg/50")}>
              <div className="min-w-0 flex-1">
                <div className="font-medium break-words">{l.name}</div>
                <div className="text-xs break-words text-muted">{l.detail}</div>
                <div className="num mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                  {mode === "edit" ? (
                    <>
                      <span>{l.price == null ? "No price" : `${money(l.price)}/${l.unit}`}{l.estimated && <span className="text-muted"> current price</span>}</span>
                      {l.price != null && <span className="font-medium">{money(qtyOf(l) * l.price)}</span>}
                      {l.suggestedQty > 0 && l.suggestedQty !== qtyOf(l) && <span className="text-muted">suggested {fmtQty(l.suggestedQty)}</span>}
                    </>
                  ) : (
                    <>
                      <span>Ordered {fmtQty(qtyOf(l))} {l.unit}</span>
                      {mode === "done" && <span>· received {fmtQty(got(l))}</span>}
                      {r.short > 0 && <Badge tone="warn">short {fmtQty(r.short)}</Badge>}
                      {r.over > 0 && <Badge>{fmtQty(r.over)} extra</Badge>}
                    </>
                  )}
                </div>
              </div>
              {mode === "edit" && (
                <>
                  <QtyStepper value={qtyOf(l)} label={`${l.name} quantity`} changed={l.suggestedQty > 0 && qtyOf(l) !== l.suggestedQty}
                    onChange={(n) => setEdits((e) => ({ ...e, [l.id]: n }))}
                    onCommit={(n) => saveQty(l, n, 500)} />
                  <button type="button" onClick={() => remove(l)} aria-label={`Remove ${l.name}`} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-bad sm:size-9"><X className="size-4" /></button>
                </>
              )}
              {mode === "receive" && (
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <QtyStepper value={got(l)} label={`${l.name} received`} changed={r.changed} onChange={(n) => setReceived((x) => ({ ...x, [l.id]: n }))} />
                  <span className="text-xs text-muted">{l.unit}</span>
                </div>
              )}
            </div>
          ))}
          {rows.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">No items on this order yet. Add one below.</div>}
        </Card>
        {mode === "edit" && canAdd.length > 0 && (
          <div className="mt-3 max-w-md">
            <Select value="" onChange={(e) => add(e.target.value)} options={canAdd} placeholder="Add an item…" searchable aria-label="Add an item to this order" disabled={busy} className="h-11 sm:h-9" />
          </div>
        )}
      </HelpZone>

      <HelpZone id={receiving ? "ordering.po.receive" : "ordering.po.total"} className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          {invoiced ? (
            <>
              <span className="text-muted">Invoiced total</span> <span className="num font-semibold">{money(invoiced.total)}</span>
              <span className="text-muted"> · ordered est. <span className="num">{money(total)}</span> · </span>
              {invoiced.links.map((i, k) => (
                <span key={i.id}>{k > 0 && ", "}<Link href={`/invoices/${i.id}`} className="text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-ink">{i.label}</Link></span>
              ))}
            </>
          ) : (
            <>
              <span className="text-muted">Estimated total</span> <span className="num font-semibold">{shown.length - unpriced > 0 ? money(total) : "—"}</span>
              {estimated && <span className="text-muted"> · est. from current prices</span>}
              {unpriced > 0 && <span className="text-warn"> · {unpriced} line{unpriced === 1 ? "" : "s"} without a price</span>}
            </>
          )}
          {receiving && (shorts > 0 || overs > 0) && <div className="mt-0.5 text-warn">{[shorts && `${shorts} short`, overs && `${overs} with extra`].filter(Boolean).join(" · ")}</div>}
        </div>
        <span className="flex flex-wrap items-center gap-2">
          {mode === "edit" && rows.length > 0 && (
            <Button onClick={() => { setReceived(Object.fromEntries(shown.map((l) => [l.id, l.received ?? qtyOf(l)]))); setMode("receive"); }}><Truck className="size-4" />It&apos;s here: check it in</Button>
          )}
          {receiving && status === "DRAFT" && <Button variant="ghost" onClick={() => setMode("edit")} disabled={checking}>Back to the order</Button>}
          {receiving && (
            <>
              <HelpTip id="ordering.po.receive" />
              <Button variant="primary" size="lg" pending={checking} onClick={checkIn} disabled={rows.length === 0}>{checking ? "Checking in…" : "Check in delivery"}</Button>
            </>
          )}
          {mode === "done" && <Button variant="ghost" pending={checking} onClick={reopen}><RotateCcw className="size-4" />Reopen to fix</Button>}
        </span>
      </HelpZone>
      {receiving && status === "DRAFT" && <p className="mt-2 text-right text-xs text-muted">This order was never sent from here. Checking it in marks it sent too.</p>}
    </>
  );
}
