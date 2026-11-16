"use client";

import { Button, Card, cx, Input, LinkButton } from "@/components/ui";
import { progressLabel } from "@/domain/kegOrders";
import { displayCode, kegSizeInfo } from "@/domain/kegs";
import type { OrderScanResult, OrderScanState } from "@/server/services/kegOrders";
import { Check, Keyboard, RotateCcw, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { BeerDot } from "../bits";
import { buzz, CameraFrame, useKegCamera } from "../camera";
import { newClientId } from "../queue";
import { fulfilKegOrder, scanOrderKeg, undoOrderKeg } from "./actions";

/**
 * Fill an order by scanning, the same way as scanning many kegs: every scan
 * is one keg checked against the order, sent out to its account and counted
 * on its line. Each scan carries an id made on the phone, so one that didn't
 * get through is sent again without being applied twice.
 */

interface Row {
  id: string;
  text: string;
  state: "sending" | "waiting" | "done" | "failed" | "undone";
  result?: OrderScanResult;
}

/** The viewfinder and the typed-code fallback. Only on screen while the order still needs kegs, so the camera is off otherwise. */
function ScanInput({ onText }: { onText: (text: string) => void }) {
  const cam = useKegCamera(onText, () => false);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  return (
    <>
      <CameraFrame cam={cam} compact status={cam.state === "on" ? "Scan the next keg" : undefined} />
      {typing ? (
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) { onText(code); setCode(""); } }} className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code, e.g. 7Q3-MX" aria-label="Keg code" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} className="num h-12 text-lg tracking-wider sm:h-12" autoFocus />
          <Button type="submit" variant="primary" size="lg" className="h-12" disabled={!code.trim()}>Add</Button>
        </form>
      ) : (
        <Button variant="secondary" className="h-11 w-full" onClick={() => setTyping(true)}><Keyboard className="size-4" /> Type a code instead</Button>
      )}
    </>
  );
}

export function OrderScanner({ orderId, initial, done: back }: { orderId: string; initial: OrderScanState; done: { href: string; label: string } }) {
  const [state, setState] = useState<OrderScanState>(initial);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  /** Stickers that went onto the order here, and ones on their way, so neither is sent twice. */
  const sent = useRef(new Set<string>());
  const busy = useRef(new Set<string>());
  /** Answers can come back out of order; only a newer one replaces what's shown. */
  const seq = useRef(0);
  const shown = useRef(0);

  const update = (id: string, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const show = (n: number, s: OrderScanState | undefined) => {
    if (!s || n < shown.current) return;
    shown.current = n;
    setState(s);
  };

  const send = useCallback(async (row: Pick<Row, "id" | "text">) => {
    const n = ++seq.current;
    try {
      const result = await scanOrderKeg({ orderId, text: row.text, clientId: row.id });
      busy.current.delete(row.text);
      if ("ok" in result) sent.current.add(row.text);
      show(n, result.state);
      update(row.id, { state: "ok" in result ? "done" : "failed", result });
    } catch {
      update(row.id, { state: "waiting" });
    }
  }, [orderId]);

  const onText = useCallback((text: string) => {
    const t = text.trim();
    if (!t || busy.current.has(t)) return;
    if (sent.current.has(t)) { setNote("Already scanned. On to the next one."); return; }
    setNote(null);
    buzz();
    busy.current.add(t);
    const row: Row = { id: newClientId(), text: t, state: "sending" };
    // A sticker that was refused before and is scanned again replaces its old line in the list.
    setRows((cur) => [row, ...cur.filter((r) => !(r.state === "failed" && r.text === t))]);
    void send(row);
  }, [send]);

  // Scans that didn't get through (no signal in the walk-in) go again every few seconds.
  useEffect(() => {
    const waiting = rows.filter((r) => r.state === "waiting");
    if (!waiting.length) return;
    const t = setTimeout(() => waiting.forEach((r) => void send(r)), 4000);
    return () => clearTimeout(t);
  }, [rows, send]);

  const undo = async (row: Row) => {
    if (!row.result || !("ok" in row.result)) return;
    const n = ++seq.current;
    const r = await undoOrderKeg({ orderId, kegId: row.result.kegId }).catch(() => ({ error: "No signal. Try again in a moment." }));
    if ("error" in r) { setNote(r.error); return; }
    sent.current.delete(row.text);
    setNote(null);
    show(n, r.state);
    update(row.id, { state: "undone" });
  };

  const fulfil = () =>
    start(async () => {
      const r = await fulfilKegOrder(orderId).catch(() => ({ error: "No signal. Try again in a moment." }));
      if ("error" in r) setNote(r.error);
      else { setNote(null); setState((s) => ({ ...s, status: "FULFILLED" })); }
    });

  const open = state.status === "OPEN";
  const p = state.progress;
  const waiting = rows.filter((r) => r.state === "waiting" || r.state === "sending").length;
  const noSignal = rows.filter((r) => r.state === "waiting").length;
  const lastDone = rows.find((r) => r.state === "done");

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <span className="text-sm font-semibold">{open ? (p.complete ? "Every keg is on the order" : "Still to scan") : state.status === "FULFILLED" ? "Order fulfilled" : "Order cancelled"}</span>
          <span className="num text-xs text-muted">{progressLabel(p)}{waiting ? ` · ${waiting} sending` : ""}</span>
        </div>
        <ul className="mt-2 divide-y divide-border" aria-label="Kegs on this order">
          {state.lines.map((l) => (
            <li key={l.id} className={cx("flex items-center gap-2 px-1 py-2 text-sm", l.remaining === 0 && "text-muted")}>
              <BeerDot color={l.color} />
              <span className="min-w-0 flex-1 truncate">{l.beer} <span className="text-xs text-muted">{kegSizeInfo(l.sizeId).short}</span></span>
              <span className="num shrink-0 font-medium">{l.sent} of {l.quantity}</span>
              <span className={cx("grid size-5 shrink-0 place-items-center rounded-full", l.remaining === 0 ? "bg-good-bg text-good" : "bg-surface-2 text-transparent")} aria-hidden><Check className="size-3.5" /></span>
            </li>
          ))}
        </ul>
      </Card>

      {open && !p.complete && <ScanInput onText={onText} />}

      {open && p.complete && (
        <Card className="p-4">
          <p className="text-sm text-ink-2">Nothing left to scan. Mark the order fulfilled to close it{lastDone ? ", or undo the last keg if it was a mistake" : ""}.</p>
          <Button variant="primary" size="lg" className="mt-3 h-12 w-full" disabled={pending || waiting > 0} onClick={fulfil}>{pending ? "Saving…" : "Mark fulfilled"}</Button>
        </Card>
      )}

      {!open && (
        <Card className="p-4">
          <p className="text-sm text-ink-2">{state.status === "FULFILLED" ? "This order is fulfilled. Nothing more can be scanned for it." : "This order was cancelled. Nothing more can be scanned for it; kegs already sent out stay out."}</p>
          <LinkButton href={back.href} size="lg" className="mt-3 h-12 w-full">Back to {back.label}</LinkButton>
        </Card>
      )}

      {note && <p role="status" className="rounded-xl bg-surface-2 px-4 py-2.5 text-sm text-ink-2">{note}</p>}
      {noSignal > 0 && <p role="status" className="rounded-xl bg-warn-bg px-4 py-2.5 text-sm font-medium text-warn">No signal for {noSignal}. Keep this page open; they send as soon as there&apos;s signal.</p>}

      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface" aria-label="Scanned kegs">
          {rows.slice(0, 60).map((r) => {
            const res = r.result;
            const good = r.state === "done" && res && "ok" in res;
            return (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className={cx("grid size-7 shrink-0 place-items-center rounded-full", good ? "bg-good-bg text-good" : r.state === "failed" ? "bg-bad-bg text-bad" : "bg-surface-2 text-muted")}>
                  {good ? <Check className="size-4" /> : r.state === "failed" ? <TriangleAlert className="size-4" /> : r.state === "undone" ? <Undo2 className="size-3.5" /> : <RotateCcw className="size-3.5 animate-spin" />}
                </span>
                <span className="min-w-0 flex-1">
                  {good && res && "ok" in res ? (
                    <>
                      <span className="num font-medium">{displayCode(res.code)}</span> <span className="text-muted">{kegSizeInfo(res.sizeId).short}</span>
                      <span className="block truncate text-xs text-muted">Sent out · {res.beer}</span>
                    </>
                  ) : r.state === "failed" && res && "error" in res ? (
                    <>
                      <span className="num font-medium">{res.code ? displayCode(res.code) : "Unknown sticker"}</span>
                      <span className="block text-xs text-bad">{res.error}{res.unknown ? " Add it from Scan a keg, then scan it here." : ""}</span>
                    </>
                  ) : r.state === "undone" ? (
                    <span className="text-muted">Undone{res && "ok" in res ? ` · ${displayCode(res.code)}` : ""}</span>
                  ) : (
                    <span className="text-muted">{r.state === "waiting" ? "Waiting for signal…" : "Checking…"}</span>
                  )}
                </span>
                {good && open && r.id === lastDone?.id && <Button size="sm" variant="ghost" className="h-10 shrink-0" onClick={() => void undo(r)}><Undo2 className="size-4" /> Undo</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
