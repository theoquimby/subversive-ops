"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, Card, cx, DatePicker, Select } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { AssignmentView, ModuleView } from "@/server/services/training";
import { ArrowDown, ArrowUp, Check, ChevronDown, FileText, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { AddRow } from "../team-client";
import {
  addModule, addStep, assignModule, deleteModule, deleteStep, moveStep, removeAssignment, setAssignmentDue, setAssignmentStep, setModuleField, setModulePosition, setStepField, signOffAssignment,
} from "./actions";
import type { PositionOpt } from "./matrix-client";
import { ASSIGNMENT_LABEL } from "./status";
import { TickBox } from "./tick-box";

interface Person { id: string; name: string; positionIds: string[] }
const ACTIVE = [{ value: "yes", label: "In use" }, { value: "no", label: "Archived" }];

/** Onboarding checklists: build steps inline, assign by person or position, follow progress, sign off. */
export function TrainingModules({ modules, people, positions, docs, today }: { modules: ModuleView[]; people: Person[]; positions: PositionOpt[]; docs: { id: string; title: string }[]; today: string }) {
  return (
    <div className="space-y-4">
      {modules.map((m) => <ModuleCard key={m.id} m={m} people={people} positions={positions} docs={docs} today={today} />)}
      <Card data-tour="training.new-module">
        {modules.length === 0 && <p className="px-4 pt-4 text-sm text-muted">No checklists yet. Start one for new hires, e.g. “New bartender”: the steps they need to learn, with links to the handbook or recipes.</p>}
        <AddRow placeholder="New checklist, e.g. New bartender" label="New checklist" onAdd={addModule} />
      </Card>
    </div>
  );
}

function ModuleCard({ m, people, positions, docs, today }: { m: ModuleView; people: Person[]; positions: PositionOpt[]; docs: { id: string; title: string }[]; today: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const docOptions = [{ value: "", label: "No document" }, ...docs.map((d) => ({ value: d.id, label: d.title }))];
  const done = m.assignments.filter((a) => a.state === "signed-off").length;
  return (
    <Card className={cx("overflow-hidden", !m.active && "opacity-60", pending && "opacity-60")} data-tour="training.module">
      <div className="flex flex-col gap-1 border-b border-border px-2 py-2 sm:flex-row sm:items-start sm:gap-2">
        <div className="min-w-0 sm:flex-1">
          <GridCell grid="mod" col="title" value={m.title} onSave={setModuleField.bind(null, m.id, "title")} ariaLabel="Checklist name" className="font-semibold" />
          <GridCell grid="mod" col="desc" value={m.description} placeholder="What it's for (optional)" onSave={setModuleField.bind(null, m.id, "description")} ariaLabel={`${m.title} description`} className="text-muted [&_input]:h-8 [&_input]:text-sm" />
          <div className="px-2 pt-1"><PositionToggles moduleId={m.id} assigned={m.positionIds} positions={positions} /></div>
        </div>
        <div className="flex items-center gap-1 px-2 sm:px-0">
          <Badge tone={done === m.assignments.length && done > 0 ? "good" : "neutral"}>{m.assignments.length ? `${done}/${m.assignments.length} signed off` : "Not assigned"}</Badge>
          <div className="w-28"><GridSelect value={m.active ? "yes" : "no"} options={ACTIVE} onSave={setModuleField.bind(null, m.id, "active")} ariaLabel={`${m.title} in use`} /></div>
          <button
            type="button"
            aria-label={`Delete ${m.title}`}
            onClick={async () => {
              if (!(await confirm({ title: `Delete “${m.title}”?`, body: m.assignments.length ? `${m.assignments.length} people's progress goes with it. Archive it instead to keep the record.` : "Its steps go with it.", confirmLabel: "Delete", danger: true }))) return;
              start(async () => { await deleteModule(m.id); });
            }}
            className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-border">
        <section aria-label="Steps" className="min-w-0">
          <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-muted">Steps</h3>
          {m.steps.length === 0 ? <p className="px-4 pb-2 text-sm text-muted">Add the first step below.</p> : (
            <ol className="divide-y divide-border">
              {m.steps.map((s, i) => (
                <li key={s.id} className="flex items-start gap-1 px-2 py-1.5">
                  <span className="num mt-2.5 w-6 shrink-0 text-right text-xs text-muted">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <GridCell grid={`step-${m.id}`} col="title" value={s.title} onSave={setStepField.bind(null, s.id, "title")} ariaLabel={`Step ${i + 1}`} />
                    <GridCell grid={`step-${m.id}`} col="detail" value={s.detail} placeholder="How, or what good looks like (optional)" onSave={setStepField.bind(null, s.id, "detail")} ariaLabel={`Step ${i + 1} details`} className="text-muted [&_input]:h-8 [&_input]:text-xs" />
                    <div className="flex items-center gap-1 px-1">
                      <FileText className="size-3.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1"><GridSelect value={s.documentId ?? ""} options={docOptions} onSave={setStepField.bind(null, s.id, "documentId")} ariaLabel={`Step ${i + 1} linked document`} className="text-xs" /></div>
                    </div>
                  </div>
                  <StepButtons id={s.id} first={i === 0} last={i === m.steps.length - 1} title={s.title} />
                </li>
              ))}
            </ol>
          )}
          <AddRow placeholder="Add a step, e.g. Pour a pint with the right head" label={`Add a step to ${m.title}`} onAdd={(t) => addStep(m.id, t)} />
        </section>

        <section aria-label="People" className="min-w-0 border-t border-border lg:border-t-0">
          <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-muted">People</h3>
          <AssignBar m={m} people={people} positions={positions} today={today} />
          {m.assignments.length > 0 && (
            <ul className="divide-y divide-border border-t border-border">
              {m.assignments.map((a) => <AssignmentRow key={a.id} a={a} steps={m.steps} today={today} />)}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

function PositionToggles({ moduleId, assigned, positions }: { moduleId: string; assigned: string[]; positions: PositionOpt[] }) {
  const [pending, start] = useTransition();
  return (
    <div className={cx("flex flex-wrap items-center gap-1", pending && "opacity-60")} role="group" aria-label="Meant for positions">
      <span className="mr-1 text-xs text-muted">For</span>
      {positions.map((p) => {
        const on = assigned.includes(p.id);
        return (
          <button key={p.id} type="button" aria-pressed={on} disabled={pending} onClick={() => start(async () => { await setModulePosition(moduleId, p.id, !on); })}
            className={cx("inline-flex h-9 items-center gap-1 rounded-md border px-2 text-xs transition-colors duration-120 sm:h-7", on ? "border-ink/80 bg-primary text-primary-ink" : "border-border text-muted hover:bg-surface-2 hover:text-ink-2")}>
            {on && <Check className="size-3" />}{p.name}
          </button>
        );
      })}
    </div>
  );
}

function StepButtons({ id, first, last, title }: { id: string; first: boolean; last: boolean; title: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const btn = "grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30 sm:size-7";
  return (
    <div className={cx("flex shrink-0 items-center", pending && "opacity-50")}>
      <button type="button" className={cx(btn, "hidden sm:grid")} aria-label={`Move ${title} up`} disabled={first || pending} onClick={() => start(async () => { await moveStep(id, -1); })}><ArrowUp className="size-3.5" /></button>
      <button type="button" className={cx(btn, "hidden sm:grid")} aria-label={`Move ${title} down`} disabled={last || pending} onClick={() => start(async () => { await moveStep(id, 1); })}><ArrowDown className="size-3.5" /></button>
      <button type="button" className={cx(btn, "hover:bg-bad-bg hover:text-bad")} aria-label={`Delete step ${title}`} disabled={pending} onClick={async () => {
        if (!(await confirm({ title: "Delete this step?", body: title, confirmLabel: "Delete", danger: true }))) return;
        start(async () => { await deleteStep(id); });
      }}><X className="size-3.5" /></button>
    </div>
  );
}

function AssignBar({ m, people, positions, today }: { m: ModuleView; people: Person[]; positions: PositionOpt[]; today: string }) {
  const [who, setWho] = useState("");
  const [due, setDue] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const have = new Set(m.assignments.map((a) => a.employeeId));
  const preferred = positions.filter((p) => m.positionIds.includes(p.id));
  const posOptions = [...preferred, ...positions.filter((p) => !m.positionIds.includes(p.id))].map((p) => {
    const n = people.filter((x) => x.positionIds.includes(p.id) && !have.has(x.id)).length;
    return { value: `pos:${p.id}`, label: `Every ${p.name.toLowerCase()} (${n} new)`, group: "By position", disabled: n === 0 };
  });
  const personOptions = people.filter((p) => !have.has(p.id)).map((p) => ({ value: `emp:${p.id}`, label: p.name, group: "One person" }));
  const assign = () =>
    start(async () => {
      const [kind, id] = who.split(":");
      const r = await assignModule({ moduleId: m.id, dueOn: due, ...(kind === "pos" ? { positionId: id } : { employeeIds: [id] }) });
      setMsg(r);
      if (r.ok) { setWho(""); }
    });
  return (
    <div className="px-4 pb-3" data-tour="training.assign">
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
        <Select aria-label={`Assign ${m.title} to`} value={who} onChange={(e) => { setWho(e.target.value); setMsg(null); }} placeholder="Assign to…" options={[...posOptions, ...personOptions]} searchable />
        <DatePicker value={due} onChange={(e) => setDue(e.target.value)} min={today} today={today} aria-label="Due date (optional)" />
        <Button variant="primary" disabled={!who || pending} onClick={assign} className="h-10 sm:h-9">{pending ? "Assigning…" : "Assign"}</Button>
      </div>
      {msg && <p className={cx("mt-1.5 text-xs", msg.error ? "text-bad" : "text-good")} aria-live="polite">{msg.error ?? msg.ok}</p>}
      {!due && <p className="mt-1 text-xs text-muted">Due date is optional — overdue checklists show in the weekly brief.</p>}
    </div>
  );
}

function AssignmentRow({ a, steps, today }: { a: AssignmentView; steps: ModuleView["steps"]; today: string }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const st = ASSIGNMENT_LABEL[a.state];
  const pctDone = a.total ? Math.round((a.done / a.total) * 100) : 100;
  return (
    <li className={cx(pending && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform duration-180", open && "rotate-180")} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{a.employeeName}</span>
            <span className="mt-1 flex items-center gap-2">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span className={cx("block h-full rounded-full transition-[width] duration-260 ease-motion", a.done >= a.total ? "bg-good" : "bg-ink-2")} style={{ width: `${pctDone}%` }} />
              </span>
              <span className="num text-xs text-muted">{a.done}/{a.total}</span>
            </span>
          </span>
        </button>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="num text-xs text-muted">{a.dueOn ? `Due ${shortDate(a.dueOn)}` : "No due date"}</span>
        {a.state === "signed-off" ? (
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => start(async () => { await signOffAssignment(a.id, false); })}>Undo sign-off</Button>
        ) : (
          <Button size="sm" variant={a.state === "ready" ? "primary" : "secondary"} className="h-10 sm:h-8" data-tour="training.signoff" onClick={async () => {
            if (a.state !== "ready" && !(await confirm({ title: `Sign off ${a.employeeName.split(" ")[0]} anyway?`, body: `${a.total - a.done} step${a.total - a.done === 1 ? " isn't" : "s aren't"} ticked yet.`, confirmLabel: "Sign off" }))) return;
            start(async () => { await signOffAssignment(a.id, true); });
          }}><Check className="size-4" />Sign off</Button>
        )}
      </div>
      {open && (
        <div className="animate-fade-in border-t border-border bg-surface-2/40 px-4 py-2">
          <ul className="space-y-0.5">
            {steps.map((s) => {
              const done = a.doneStepIds.includes(s.id);
              return (
                <li key={s.id}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
                    <TickBox checked={done} disabled={pending || a.state === "signed-off"} onChange={(v) => start(async () => { await setAssignmentStep(a.id, s.id, v); })} label={s.title} />
                    <span className={cx(done && "text-muted line-through decoration-border-strong")}>{s.title}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <span className="text-xs text-muted">Due</span>
            <div className="w-44"><DatePicker value={a.dueOn ?? ""} onChange={(e) => start(async () => { await setAssignmentDue(a.id, e.target.value); })} today={today} aria-label={`Due date for ${a.employeeName}`} /></div>
            {a.signedOffBy && <span className="text-xs text-muted">Signed off by {a.signedOffBy}</span>}
            <Button size="sm" variant="danger" className="ml-auto h-10 sm:h-8" onClick={async () => {
              if (!(await confirm({ title: `Remove ${a.employeeName} from this checklist?`, body: "Their ticks are deleted.", confirmLabel: "Remove", danger: true }))) return;
              start(async () => { await removeAssignment(a.id); });
            }}>Remove</Button>
          </div>
        </div>
      )}
    </li>
  );
}
