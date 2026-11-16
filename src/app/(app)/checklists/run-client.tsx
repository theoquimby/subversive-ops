"use client";

import { useConfirm } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Textarea } from "@/components/ui";
import { RUN_LABEL, runState, shiftLabel } from "@/domain/checklists";
import { dueText, everyText, type DueState } from "@/domain/upkeep";
import { businessTime, shortDate } from "@/lib/format";
import type { RunView } from "@/server/services/checklists";
import { ArrowUpRight, Check, Undo2, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { TickBox } from "../team/training/tick-box";
import { jobDone, signOff, tickItem, undoSignOff } from "./actions";

/** One list for today: tick steps (saved as you go, with your name), then sign it. */
export function RunCard({ run, today, canUndoAny, userName }: { run: RunView; today: string; canUndoAny: boolean; userName: string }) {
  const confirm = useConfirm();
  const [toast, show] = useToast();
  const [pending, start] = useTransition();
  // Ticks show at once; the server confirms (or the tick goes back with a message).
  const [local, setLocal] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState(run.note ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const doneBy = (id: string, server: string | null) => (id in local ? local[id] : server);
  const done = run.items.filter((i) => doneBy(i.id, i.doneBy)).length;
  const signed = !!run.signedOffAt;
  const state = runState(done, run.total, signed);
  const st = RUN_LABEL[state];
  const pctDone = run.total ? Math.round((done / run.total) * 100) : 0;
  const late = run.date !== today;

  const tick = (itemId: string, on: boolean) => {
    setLocal((l) => ({ ...l, [itemId]: on ? userName : null }));
    start(async () => {
      const r = await tickItem(run.templateId, run.date, itemId, on).catch(() => ({ error: "Couldn't save. Check the connection and try again." }));
      if (r?.error) {
        setLocal((l) => {
          const n = { ...l };
          delete n[itemId];
          return n;
        });
        show(r.error, "bad");
      }
    });
  };

  const sign = async () => {
    const left = run.total - done;
    if (left > 0 && !(await confirm({ title: `Sign off with ${left} step${left === 1 ? "" : "s"} not ticked?`, body: "Add a note saying why, so the next shift knows.", confirmLabel: "Sign off" }))) return;
    start(async () => {
      const r = await signOff(run.templateId, run.date, note);
      if (r?.error) show(r.error, "bad");
      else show(`${run.name} signed off`);
    });
  };

  return (
    <Card className={cx("overflow-hidden", pending && "opacity-90")} data-tour="checklists.run">
      {toast}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[0.95rem] font-semibold text-ink">{run.name}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {shiftLabel(run.shift)}{late && <> · for {shortDate(run.date)} (last night)</>}
              {run.crew.length > 0 && <> · <Users aria-hidden className="mb-px inline size-3" /> {run.crew.join(", ")}</>}
            </p>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span className={cx("block h-full rounded-full transition-[width] duration-260 ease-motion", done >= run.total ? "bg-good" : "bg-ink-2")} style={{ width: `${pctDone}%` }} />
          </span>
          <span className="num text-xs text-muted">{done}/{run.total}</span>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {run.items.map((i) => {
          const by = doneBy(i.id, i.doneBy);
          return (
            <li key={i.id} className="flex items-start gap-3 px-4 py-2">
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 py-1.5">
                <span className="pt-0.5"><TickBox checked={!!by} disabled={signed} onChange={(v) => tick(i.id, v)} label={i.title} /></span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-[0.95rem] leading-snug", by ? "text-muted line-through decoration-border-strong" : "text-ink")}>{i.title}</span>
                  {i.detail && <span className="mt-0.5 block text-xs text-muted">{i.detail}</span>}
                  {by && <span className="mt-0.5 block text-xs text-good">{by}{i.doneAt && !(i.id in local) ? ` · ${businessTime(i.doneAt)}` : ""}</span>}
                </span>
              </label>
              {i.href && (
                <Link href={i.href} className="mt-1 grid size-10 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8" aria-label={`Open the page for: ${i.title}`}>
                  <ArrowUpRight className="size-4" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border bg-surface-2/40 px-4 py-3">
        {signed ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="grid size-7 place-items-center rounded-full bg-good-bg text-good"><Check className="size-4" aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink">Signed off by {run.signedOffName}</span>
              <span className="text-muted"> · {businessTime(run.signedOffAt!)}</span>
              {run.note && <span className="mt-0.5 block text-xs text-ink-2">“{run.note}”</span>}
            </span>
            {(canUndoAny || run.signedOffName === userName) && (
              <Button size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => { const r = await undoSignOff(run.templateId, run.date); if (r?.error) show(r.error, "bad"); })}>
                <Undo2 className="size-3.5" />Undo
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {noteOpen ? (
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything the next shift should know (optional)" aria-label={`Note for ${run.name}`} />
            ) : (
              <button type="button" onClick={() => setNoteOpen(true)} className="min-h-10 text-xs text-muted underline-offset-2 hover:text-ink hover:underline sm:min-h-0">Add a note</button>
            )}
            <Button variant={state === "ready" ? "primary" : "secondary"} className="h-11 w-full sm:h-9" disabled={pending || done === 0} onClick={sign} data-tour="checklists.signoff">
              <Check className="size-4" />Sign off as {userName.split(" ")[0]}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

interface Job { id: string; title: string; everyDays: number; due: string | null; state: DueState; howTo: string | null; equipment: string | null }

/** Upkeep jobs staff can do that came due, with a Done button each. */
export function JobsDue({ jobs, today }: { jobs: Job[]; today: string }) {
  const [toast, show] = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card className="divide-y divide-border">
      {toast}
      {jobs.map((j) => (
        <div key={j.id} className={cx("flex items-start gap-3 px-4 py-3", busy === j.id && pending && "opacity-60")}>
          <span className={cx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", j.state === "overdue" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn")}><Wrench className="size-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink">{j.title}</div>
            <div className="text-xs text-muted">{[j.equipment, dueText(today, j.due), everyText(j.everyDays).toLowerCase()].filter(Boolean).join(" · ")}</div>
            {j.howTo && <p className="mt-1 text-xs text-ink-2">{j.howTo}</p>}
          </div>
          <Button size="sm" className="h-10 shrink-0 sm:h-8" disabled={pending} onClick={() => { setBusy(j.id); start(async () => { const r = await jobDone(j.id); if (r?.error) show(r.error, "bad"); else show(`${j.title} — logged`); }); }}>
            <Check className="size-3.5" />Done
          </Button>
        </div>
      ))}
    </Card>
  );
}
