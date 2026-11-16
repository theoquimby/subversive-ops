"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, DatePicker, Field, Input, Select, Textarea } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { UpkeepLogView } from "@/server/services/upkeep";
import { Check, Plus, Wrench, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Sheet } from "../team/training/sheet";
import { deleteLog, logRepair, markFixed, setLogCost } from "./actions";

const KIND: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  done: { label: "Done", tone: "good" },
  repair: { label: "Repair", tone: "warn" },
  service: { label: "Service", tone: "neutral" },
  note: { label: "Note", tone: "neutral" },
};

export function LogList({ logs }: { logs: UpkeepLogView[] }) {
  if (!logs.length) return <Card className="p-4 text-sm text-muted">Nothing logged yet. Jobs you mark Done and repairs you log show up here.</Card>;
  return (
    <Card className="divide-y divide-border">
      {logs.map((l) => <LogRow key={l.id} l={l} />)}
    </Card>
  );
}

function LogRow({ l }: { l: UpkeepLogView }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const k = KIND[l.kind] ?? KIND.note;
  const open = l.kind === "repair" && l.down && !l.fixedOn;
  return (
    <div className={cx("flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5", pending && "opacity-60")}>
      <span className="num w-14 shrink-0 pt-0.5 text-xs text-muted">{shortDate(l.date)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-ink">{l.title}</span>
          <Badge tone={k.tone}>{k.label}</Badge>
          {open && <Badge tone="bad">Down</Badge>}
          {l.fixedOn && <span className="text-xs text-good">Fixed {shortDate(l.fixedOn)}</span>}
        </div>
        <div className="text-xs text-muted">{[l.equipment, l.vendor, l.userName && `logged by ${l.userName}`].filter(Boolean).join(" · ")}</div>
        {l.note && <p className="mt-0.5 text-xs text-ink-2">{l.note}</p>}
      </div>
      <div className="w-24"><GridCell grid="log" col="cost" type="number" prefix="$" decimals={2} value={l.cost} placeholder="Cost" onSave={(v) => setLogCost(l.id, v)} ariaLabel={`Cost of ${l.title}`} /></div>
      {open && <Button size="sm" className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => { await markFixed(l.id); })}><Check className="size-3.5" />Fixed</Button>}
      <button type="button" aria-label={`Delete log entry ${l.title}`} disabled={pending} className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8" onClick={async () => {
        if (!(await confirm({ title: "Delete this entry?", body: l.kind === "done" ? "The job's last-done date goes back to the entry before it." : l.title, confirmLabel: "Delete", danger: true }))) return;
        start(async () => { await deleteLog(l.id); });
      }}><X className="size-3.5" /></button>
    </div>
  );
}

const KINDS = [{ value: "repair", label: "Repair — something broke" }, { value: "service", label: "Service visit" }, { value: "note", label: "Note" }];

/** "Log a repair": what broke, when, what it cost, and whether it's out of action. */
export function RepairButton({ equipment, today }: { equipment: { value: string; label: string; group?: string }[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [toast, show] = useToast();
  return (
    <>
      {toast}
      <Button size="sm" variant="primary" className="h-10 sm:h-8" onClick={() => setOpen(true)} data-tour="upkeep.repair"><Plus className="size-4" />Log a repair</Button>
      {open && <RepairSheet equipment={equipment} today={today} onClose={() => setOpen(false)} onSaved={(m) => show(m)} />}
    </>
  );
}

function RepairSheet({ equipment, today, onClose, onSaved }: { equipment: { value: string; label: string; group?: string }[]; today: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [kind, setKind] = useState("repair");
  const [equipmentId, setEquipmentId] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [down, setDown] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await logRepair({ kind: kind as "repair", equipmentId, title, date, cost, vendor, down, note });
      if (r?.error) setError(r.error);
      else {
        onSaved(down ? "Logged — it shows as down until marked fixed" : "Logged");
        onClose();
      }
    });
  return (
    <Sheet title="Log a repair or visit" onClose={onClose} label="Log a repair">
      <div className="space-y-3">
        <Field label="What"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={KINDS} aria-label="What kind" /></Field>
        <Field label="Equipment"><Select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} options={[{ value: "", label: "Not a specific one" }, ...equipment]} searchable aria-label="Equipment" /></Field>
        <Field label={kind === "repair" ? "What happened" : "What was done"}><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "repair" ? "e.g. Walk-in compressor not cycling" : "e.g. Quarterly hood cleaning"} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><DatePicker value={date} max={today} today={today} onChange={(e) => setDate(e.target.value)} aria-label="Date" /></Field>
          <Field label="Cost (optional)"><Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$0.00" /></Field>
        </div>
        <Field label="Company (optional)"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Who came out" /></Field>
        {kind === "repair" && (
          <button type="button" role="switch" aria-checked={down} onClick={() => setDown((d) => !d)} className={cx("flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-120", down ? "border-bad/40 bg-bad-bg/60" : "border-border hover:bg-surface-2")}>
            <Wrench className={cx("size-4", down ? "text-bad" : "text-muted")} aria-hidden />
            <span className="flex-1"><span className="font-medium text-ink">Out of action until fixed</span><span className="block text-xs text-muted">Shows on the Overview and in the brief until you mark it fixed.</span></span>
            <span className={cx("relative h-6 w-10 shrink-0 rounded-full transition-colors duration-120", down ? "bg-bad" : "bg-border-strong")}><span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] duration-120", down ? "left-[1.1rem]" : "left-0.5")} /></span>
          </button>
        )}
        <Field label="Note (optional)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Part numbers, what the tech said…" /></Field>
        {error && <p className="text-sm text-bad" aria-live="polite">{error}</p>}
        <Button variant="primary" className="h-11 w-full sm:h-9" disabled={pending || !title.trim()} onClick={save}><Check className="size-4" />{pending ? "Saving…" : "Save"}</Button>
      </div>
    </Sheet>
  );
}
