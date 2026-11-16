"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, DatePicker, Field, Input, Textarea } from "@/components/ui";
import { DUE_TONE, dueText, everyText } from "@/domain/upkeep";
import { shortDate } from "@/lib/format";
import type { UpkeepTaskView } from "@/server/services/upkeep";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { AddRow } from "../team/team-client";
import { Sheet } from "../team/training/sheet";
import { addTask, deleteTask, setTaskField, taskDone } from "./actions";

type Opt = { value: string; label: string; group?: string };
const YESNO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

export function JobsTable({ tasks, inactive, equipment, today }: { tasks: UpkeepTaskView[]; inactive: { id: string; title: string; equipment: string | null }[]; equipment: Opt[]; today: string }) {
  const [showOff, setShowOff] = useState(false);
  const [toast, show] = useToast();
  return (
    <Card className="overflow-hidden">
      {toast}
      {tasks.length === 0 && <p className="px-4 pt-4 text-sm text-muted">No jobs yet. Add one below, e.g. “Clean draft lines”.</p>}
      <ul className="divide-y divide-border">
        {tasks.map((t) => <JobRow key={t.id} t={t} equipment={equipment} today={today} show={show} />)}
      </ul>
      <AddRow placeholder="Add a job, e.g. Descale the espresso machine" label="Add a job" onAdd={(title) => addTask(title)} />
      {inactive.length > 0 && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted">
          <button type="button" className="min-h-10 underline-offset-2 hover:text-ink hover:underline sm:min-h-0" onClick={() => setShowOff((v) => !v)} aria-expanded={showOff}>
            {showOff ? "Hide" : "Show"} {inactive.length} job{inactive.length === 1 ? "" : "s"} turned off
          </button>
          {showOff && (
            <ul className="mt-1 space-y-1">
              {inactive.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ink-2">{t.title}{t.equipment && <span className="text-muted"> · {t.equipment}</span>}</span>
                  <TurnOn id={t.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function TurnOn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" className="h-10 sm:h-7" disabled={pending} onClick={() => start(async () => { await setTaskField(id, "active", "yes"); })}>Turn on</Button>;
}

function JobRow({ t, equipment, today, show }: { t: UpkeepTaskView; equipment: Opt[]; today: string; show: (text: string, tone?: "good" | "bad") => void }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [pending, start] = useTransition();
  const tone = DUE_TONE[t.state];
  const quickDone = () =>
    start(async () => {
      const r = await taskDone(t.id);
      if (r?.error) show(r.error, "bad");
      else show(`${t.title} — done today`);
    });
  return (
    <li className={cx(pending && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform duration-180", open && "rotate-180")} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{t.title}</span>
            <span className="block truncate text-xs text-muted">
              {[t.equipment, everyText(t.everyDays), t.lastDoneOn ? `last ${shortDate(t.lastDoneOn)}` : null, t.staffCanDo ? "staff" : null].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
        <Badge tone={tone === "good" ? "neutral" : tone}>{dueText(today, t.due)}</Badge>
        {t.state === "unknown" ? (
          <div className="w-40"><DatePicker value="" max={today} today={today} aria-label={`When was ${t.title} last done?`} onChange={(e) => start(async () => { const r = await setTaskField(t.id, "lastDoneOn", e.target.value); if (r?.error) show(r.error, "bad"); })} /></div>
        ) : (
          <div className="flex items-center">
            <Button size="sm" variant={t.state === "overdue" || t.state === "today" ? "primary" : "secondary"} className="h-10 rounded-r-none sm:h-8" disabled={pending} onClick={quickDone} data-tour="upkeep.done">
              <Check className="size-3.5" />Done
            </Button>
            <Button size="sm" className="h-10 rounded-l-none border-l-0 px-2 sm:h-8" aria-label={`Log ${t.title} with a date, cost or note`} disabled={pending} onClick={() => setDetails(true)}>…</Button>
          </div>
        )}
      </div>
      {open && (
        <div className="animate-fade-in border-t border-border bg-surface-2/40 px-4 py-3">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <Field label="Job"><GridCell grid={`job-${t.id}`} col="title" value={t.title} onSave={setTaskField.bind(null, t.id, "title")} ariaLabel="Job name" /></Field>
            <Field label="Every" hint="“14”, “2 weeks”, “3 months”, “yearly”"><GridCell grid={`job-${t.id}`} col="every" value={everyText(t.everyDays)} onSave={setTaskField.bind(null, t.id, "everyDays")} ariaLabel="How often" /></Field>
            <Field label="Equipment"><GridSelect value={t.equipmentId ?? ""} options={[{ value: "", label: "None" }, ...equipment]} onSave={setTaskField.bind(null, t.id, "equipmentId")} ariaLabel="Equipment" /></Field>
            <Field label="Staff can do it" hint="Shows on Checklists when due"><GridSelect value={t.staffCanDo ? "yes" : "no"} options={YESNO} onSave={setTaskField.bind(null, t.id, "staffCanDo")} ariaLabel="Staff can do it" /></Field>
            <Field label="Who does it"><GridCell grid={`job-${t.id}`} col="vendor" value={t.vendor} placeholder="Us, or the company that comes" onSave={setTaskField.bind(null, t.id, "vendor")} ariaLabel="Who does it" /></Field>
            <Field label="Last done"><DatePicker value={t.lastDoneOn ?? ""} max={today} today={today} aria-label="Last done" onChange={(e) => start(async () => { const r = await setTaskField(t.id, "lastDoneOn", e.target.value); if (r?.error) show(r.error, "bad"); })} /></Field>
            <Field label="How to" className="sm:col-span-2"><GridCell grid={`job-${t.id}`} col="howTo" value={t.howTo} placeholder="Steps or what good looks like (shown to staff)" onSave={setTaskField.bind(null, t.id, "howTo")} ariaLabel="How to" /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            <Button size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => { await setTaskField(t.id, "active", "no"); })}>Turn off</Button>
            <Button size="sm" variant="danger" className="ml-auto h-10 sm:h-8" disabled={pending} onClick={async () => {
              if (!(await confirm({ title: `Delete “${t.title}”?`, body: "The log keeps what was done. Turn it off instead if it might come back.", confirmLabel: "Delete", danger: true }))) return;
              start(async () => { await deleteTask(t.id); });
            }}><Trash2 className="size-3.5" />Delete</Button>
          </div>
        </div>
      )}
      {details && <DoneSheet t={t} today={today} onClose={() => setDetails(false)} onDone={(m) => show(m)} />}
    </li>
  );
}

function DoneSheet({ t, today, onClose, onDone }: { t: UpkeepTaskView; today: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [date, setDate] = useState(today);
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState(t.vendor ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await taskDone(t.id, { date, cost, vendor, note });
      if (r?.error) setError(r.error);
      else {
        onDone(`${t.title} — logged`);
        onClose();
      }
    });
  return (
    <Sheet title={t.title} subtitle={t.equipment ?? undefined} onClose={onClose} label={`Log ${t.title}`}>
      <div className="space-y-3">
        <Field label="Done on"><DatePicker value={date} max={today} today={today} onChange={(e) => setDate(e.target.value)} aria-label="Done on" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost (optional)"><Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$0.00" /></Field>
          <Field label="Done by"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Us, or the company" /></Field>
        </div>
        <Field label="Note (optional)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything found, parts replaced…" /></Field>
        {error && <p className="text-sm text-bad" aria-live="polite">{error}</p>}
        <Button variant="primary" className="h-11 w-full sm:h-9" disabled={pending} onClick={save}><Check className="size-4" />{pending ? "Saving…" : "Log it"}</Button>
      </div>
    </Sheet>
  );
}
