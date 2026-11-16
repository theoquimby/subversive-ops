"use client";

import { Select } from "@/components/select";
import { Button, Card, cx, Field, Input } from "@/components/ui";
import { displayCode, KEG_SIZE_LIST, kegSizeInfo, STATUS_META } from "@/domain/kegs";
import type { PanelContext } from "@/server/services/kegs";
import { Check, Keyboard, RotateCcw, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { scanMany, undoKegAction, type ScanManyForm, type ScanManyResult } from "./actions";
import { buzz, CameraFrame, useKegCamera } from "./camera";
import { BatchChips } from "./keg-panel";
import { newClientId } from "./queue";

/**
 * Scan a whole stack the same way: say once what's happening to these kegs,
 * then every scan is one keg done. Each scan carries an id made on the phone,
 * so one that didn't get through is sent again without being applied twice.
 */

type Mode = ScanManyForm["mode"];

const MODES: { id: Mode; label: string; hint: string; doing: string }[] = [
  { id: "DIRTY", label: "Empty, to clean", hint: "Kicked, came back, or just empty", doing: "Marking kegs empty, to clean" },
  { id: "CLEANED", label: "Cleaned", hint: "Washed and ready to fill", doing: "Marking kegs cleaned" },
  { id: "FILL", label: "Filled", hint: "All with the same beer", doing: "Filling kegs" },
  { id: "STORE", label: "Into cold storage", hint: "Full kegs going in", doing: "Putting kegs into" },
  { id: "OUT", label: "Out to an account", hint: "Full kegs leaving", doing: "Sending kegs out to" },
  { id: "ADD", label: "Add kegs to the app", hint: "Stickers the app doesn't know yet", doing: "Adding kegs" },
];

interface Row {
  id: string;
  text: string;
  state: "sending" | "waiting" | "done" | "failed" | "undone";
  result?: ScanManyResult;
}

export function ScanMany({ ctx, role, switcher, fill }: { ctx: PanelContext; role: "MANAGER" | "STAFF"; switcher: React.ReactNode; fill?: { beerId: string; batchCode: string } }) {
  const [mode, setMode] = useState<Mode | null>(fill ? "FILL" : null);
  const [running, setRunning] = useState(false);
  const [beerId, setBeerId] = useState(fill?.beerId ?? "");
  const [batchCode, setBatchCode] = useState(fill?.batchCode ?? "");
  // A picked chip is the batch itself (by id); a typed code is looked up for this beer.
  const [batchId, setBatchId] = useState<string | null>(null);
  const [area, setArea] = useState(ctx.coldArea);
  const [accountId, setAccountId] = useState("");
  const [sizeId, setSizeId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const done = useRef(new Set<string>());
  const form = useRef<Omit<ScanManyForm, "text" | "clientId"> | null>(null);

  const update = (id: string, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const send = useCallback(async (row: Pick<Row, "id" | "text">) => {
    if (!form.current) return;
    try {
      const result = await scanMany({ ...form.current, text: row.text, clientId: row.id });
      if ("ok" in result) done.current.add(row.text);
      update(row.id, { state: "ok" in result ? "done" : "failed", result });
    } catch {
      update(row.id, { state: "waiting" });
    }
  }, []);

  const onText = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    if (done.current.has(t)) { setNote("Already scanned. On to the next one."); return; }
    setNote(null);
    buzz();
    const row: Row = { id: newClientId(), text: t, state: "sending" };
    setRows((cur) => [row, ...cur]);
    void send(row);
  }, [send]);

  const cam = useKegCamera(onText, () => !running);
  // The viewfinder only exists while scanning: start the camera with it, stop it with it.
  useEffect(() => {
    if (running) void cam.start();
    else cam.off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Scans that didn't get through (no signal in the walk-in) go again every few seconds.
  useEffect(() => {
    const waiting = rows.filter((r) => r.state === "waiting");
    if (!waiting.length) return;
    const t = setTimeout(() => waiting.forEach((r) => void send(r)), 4000);
    return () => clearTimeout(t);
  }, [rows, send]);

  const m = MODES.find((x) => x.id === mode) ?? null;
  const ready = !!m && (m.id !== "FILL" || !!beerId) && (m.id !== "STORE" || !!area) && (m.id !== "OUT" || !!accountId) && (m.id !== "ADD" || !!sizeId);
  const detail = m?.id === "FILL" ? `${ctx.beers.find((b) => b.id === beerId)?.name ?? ""}${batchCode.trim() ? ` · batch ${batchCode.trim()}` : ""}` : m?.id === "STORE" ? area : m?.id === "OUT" ? (ctx.accounts.find((a) => a.id === accountId)?.name ?? "") : m?.id === "ADD" ? `as ${kegSizeInfo(sizeId).short}` : "";

  const begin = () => {
    if (!m || !ready) return;
    form.current = { mode: m.id, beerId: beerId || null, batchId: batchCode.trim() ? batchId : null, batchCode: batchCode.trim() || null, area: m.id === "STORE" ? area : null, accountId: accountId || null, sizeId: sizeId || null };
    done.current = new Set();
    setRows([]);
    setNote(null);
    cam.forget();
    setRunning(true);
  };

  const undo = async (row: Row) => {
    if (!row.result || !("ok" in row.result) || !row.result.eventId) return;
    const r = await undoKegAction({ eventId: row.result.eventId }).catch(() => ({ error: "No signal. Try again in a moment." }));
    if ("error" in r) { setNote(r.error); return; }
    done.current.delete(row.text);
    update(row.id, { state: "undone" });
  };

  if (!running) {
    return (
      <div className="space-y-4">
        {switcher}
        <Card className="p-4">
          <div className="font-semibold">What&apos;s happening to these kegs?</div>
          <p className="mt-0.5 text-sm text-muted">Pick once, then scan each keg. One scan, one keg done.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {MODES.filter((x) => x.id !== "ADD" || role === "MANAGER").map((x) => (
              <button key={x.id} type="button" aria-pressed={mode === x.id} onClick={() => setMode(x.id)} className={cx("flex min-h-[4.25rem] flex-col justify-center rounded-xl border px-3 py-2 text-left transition-colors duration-120", mode === x.id ? "border-ink bg-ink text-bg" : "border-border bg-surface active:bg-surface-2")}>
                <span className="text-sm font-medium">{x.label}</span>
                <span className={cx("text-xs", mode === x.id ? "opacity-75" : "text-muted")}>{x.hint}</span>
              </button>
            ))}
          </div>

          {m?.id === "FILL" && (
            <div className="mt-4 grid gap-3">
              <Field label="Beer"><Select aria-label="Beer" value={beerId} onChange={(e) => setBeerId(e.target.value)} placeholder="Pick the beer" options={ctx.beers.map((b) => ({ value: b.id, label: b.name }))} searchable /></Field>
              <BatchChips batches={ctx.batches.filter((b) => b.beerId === beerId)} value={batchCode} onPick={(code, id) => { setBatchCode(code); setBatchId(id); }} />
              <Field label="Batch" hint="Optional"><Input value={batchCode} onChange={(e) => { setBatchCode(e.target.value); setBatchId(null); }} placeholder="e.g. 2-2026" aria-label="Batch" autoComplete="off" maxLength={40} /></Field>
            </div>
          )}
          {m?.id === "STORE" && <div className="mt-4"><Field label="Where"><Select aria-label="Where" value={area} onChange={(e) => setArea(e.target.value)} options={ctx.areas.map((a) => ({ value: a, label: a }))} /></Field></div>}
          {m?.id === "OUT" && <div className="mt-4"><Field label="Account"><Select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Pick the account" options={ctx.accounts.map((a) => ({ value: a.id, label: a.name }))} searchable /></Field></div>}
          {m?.id === "ADD" && (
            <div className="mt-4">
              <div className="text-[0.8rem] font-medium text-ink-2">What size are they?</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {KEG_SIZE_LIST.map((s) => <button key={s.id} type="button" aria-pressed={sizeId === s.id} onClick={() => setSizeId(s.id)} className={cx("h-10 rounded-full border px-3 text-sm font-medium", sizeId === s.id ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2")}>{s.short}</button>)}
              </div>
              <p className="mt-2 text-xs text-muted">Each keg keeps the sticker it has and gets one of our codes too. Kegs already in the app are skipped.</p>
            </div>
          )}

          <Button variant="primary" size="lg" className="mt-4 h-12 w-full" disabled={!ready} onClick={begin}>Start scanning</Button>
        </Card>
      </div>
    );
  }

  const ok = rows.filter((r) => r.state === "done").length;
  const waiting = rows.filter((r) => r.state === "waiting" || r.state === "sending").length;
  const lastDone = rows.find((r) => r.state === "done");

  return (
    <div className="space-y-3">
      <Card className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{m!.doing}{detail && (m!.id === "DIRTY" || m!.id === "CLEANED" ? "" : m!.id === "FILL" ? `: ${detail}` : ` ${detail}`)}</div>
          <div className="num text-xs text-muted">{ok} done{waiting ? ` · ${waiting} sending` : ""}</div>
        </div>
        <Button size="sm" className="h-10 shrink-0" onClick={() => setRunning(false)} disabled={waiting > 0}>{ok ? "Finish" : "Change"}</Button>
      </Card>

      <CameraFrame cam={cam} compact status={cam.state === "on" ? "Scan the next keg" : undefined} />

      {note && <p role="status" className="rounded-xl bg-surface-2 px-4 py-2.5 text-sm text-ink-2">{note}</p>}
      {waiting > 0 && rows.some((r) => r.state === "waiting") && <p role="status" className="rounded-xl bg-warn-bg px-4 py-2.5 text-sm font-medium text-warn">No signal for {rows.filter((r) => r.state === "waiting").length}. Keep this page open; they send as soon as there&apos;s signal.</p>}

      {typing ? (
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) { onText(code); setCode(""); } }} className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code, e.g. 7Q3-MX" aria-label="Keg code" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} className="num h-12 text-lg tracking-wider sm:h-12" autoFocus />
          <Button type="submit" variant="primary" size="lg" className="h-12" disabled={!code.trim()}>Add</Button>
        </form>
      ) : (
        <Button variant="secondary" className="h-11 w-full" onClick={() => setTyping(true)}><Keyboard className="size-4" /> Type a code instead</Button>
      )}

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
                      <span className="block truncate text-xs text-muted">{res.added ? "Added to the app" : `${STATUS_META[res.status].short}${res.beer ? ` · ${res.beer}` : ""}`}</span>
                    </>
                  ) : r.state === "failed" && res && "error" in res ? (
                    <>
                      <span className="num font-medium">{res.code ? displayCode(res.code) : "Unknown sticker"}</span>
                      <span className="block text-xs text-bad">{res.error}{res.unknown && role === "MANAGER" ? " Finish, then use Add kegs to the app." : ""}</span>
                    </>
                  ) : r.state === "undone" ? (
                    <span className="text-muted">Undone</span>
                  ) : (
                    <span className="text-muted">{r.state === "waiting" ? "Waiting for signal…" : "Saving…"}</span>
                  )}
                </span>
                {good && r.id === lastDone?.id && res && "ok" in res && res.eventId && <Button size="sm" variant="ghost" className="h-10 shrink-0" onClick={() => void undo(r)}><Undo2 className="size-4" /> Undo</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
