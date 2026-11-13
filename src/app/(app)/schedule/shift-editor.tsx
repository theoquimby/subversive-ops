"use client";

import { useConfirm } from "@/components/dialog";
import { Badge, Button, cx, Input, Select } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { availabilityLabel, shiftPaidHours, timeOptions } from "@/domain/schedule";
import { dayDate } from "@/lib/format";
import type { EmployeeView, PositionView, ShiftView, WeekIssue } from "@/server/services/scheduling";
import { autoUpdate, flip, offset, shift as shiftMw, useFloating } from "@floating-ui/react";
import { Copy, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { createShift, deleteShift, duplicateShift, updateShift } from "./actions";

const TIMES = timeOptions(5 * 60, 27 * 60, 15);
const BREAKS = [0, 15, 30, 45, 60].map((m) => ({ value: String(m), label: m ? `${m} min unpaid` : "No break" }));

interface Props {
  shift: ShiftView;
  anchor: HTMLElement | null;
  employees: EmployeeView[];
  positions: PositionView[];
  issues: WeekIssue[];
  hoursByEmployee: Map<string, number>;
  timeOff: Record<string, string[]>;
  onClose: () => void;
  onToast: (msg: string) => void;
  /** New shift: edits stay local and nothing is created until Save. */
  isNew?: boolean;
}

export function ShiftEditor({ shift, anchor, employees, positions, issues, hoursByEmployee, timeOff, onClose, onToast, isNew = false }: Props) {
  const [draft, setDraft] = useState(shift);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const confirm = useConfirm();
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(window.matchMedia("(max-width: 639px)").matches), []);
  useEffect(() => setDraft(shift), [shift]);

  const { refs, floatingStyles } = useFloating({
    placement: "right-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 12, fallbackPlacements: ["left-start", "bottom", "top"] }), shiftMw({ padding: 12 })],
    elements: { reference: anchor },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="listbox"]') && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = (next: ShiftView) => {
    setDraft(next);
    setError(null);
    if (isNew) return;
    start(async () => {
      const r = await updateShift(shift.id, { employeeId: next.employeeId, positionId: next.positionId, date: next.date, startMin: next.startMin, endMin: next.endMin, breakMinutes: next.breakMinutes, notes: next.notes });
      if (r.error) setError(r.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      }
    });
  };

  const create = () => {
    setError(null);
    start(async () => {
      const r = await createShift({ employeeId: draft.employeeId, positionId: draft.positionId, date: draft.date, startMin: draft.startMin, endMin: draft.endMin, breakMinutes: draft.breakMinutes, notes: draft.notes });
      if (r.error) setError(r.error);
      else {
        onToast("Shift added as a draft");
        onClose();
      }
    });
  };

  const emp = employees.find((e) => e.id === draft.employeeId);
  const wd = new Date(`${draft.date}T00:00:00Z`).getUTCDay();
  const employeeOptions = useMemo(
    () => [
      { value: "", label: "Open shift (anyone can pick up)" },
      ...employees
        .map((e) => {
          const off = timeOff[e.id]?.includes(draft.date);
          const hrs = hoursByEmployee.get(e.id) ?? 0;
          const fits = e.positionIds.includes(draft.positionId);
          return {
            value: e.id,
            label: e.name,
            group: fits ? "Can work this position" : "Other people",
            hint: off ? "Time off" : `${hrs.toFixed(hrs % 1 ? 1 : 0)}h${e.maxHoursWeek ? ` / ${e.maxHoursWeek}` : ""} · ${availabilityLabel(e.availability, wd)}`,
            fits,
          };
        })
        .sort((a, b) => Number(b.fits) - Number(a.fits) || a.label.localeCompare(b.label)),
    ],
    [employees, timeOff, hoursByEmployee, draft.date, draft.positionId, wd],
  );
  const positionOptions = positions.map((p) => ({ value: p.id, label: p.name, hint: emp && !emp.positionIds.includes(p.id) ? "not trained" : undefined }));
  const hours = shiftPaidHours(draft);
  const mine = issues.filter((i) => i.shiftId === shift.id);

  const body = (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{dayDate(draft.date)}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <span className="num">{hours.toFixed(hours % 1 ? 2 : 0)} paid hours</span>
            <span>·</span>
            {isNew ? <span>New shift</span> : draft.published ? <span>Published</span> : <span>Draft</span>}
            {saving ? <span>· Saving…</span> : saved ? <span className="text-good">· Saved</span> : null}
          </div>
        </div>
        <button onClick={onClose} className="-m-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <Labeled label="Who">
        <Select
          aria-label="Employee"
          value={draft.employeeId ?? ""}
          options={employeeOptions}
          searchable
          onChange={(e) => {
            const id = e.target.value || null;
            const person = employees.find((x) => x.id === id);
            const positionId = person && !person.positionIds.includes(draft.positionId) && person.positionIds[0] ? person.positionIds[0] : draft.positionId;
            save({ ...draft, employeeId: id, positionId });
          }}
        />
      </Labeled>
      <Labeled label="Position">
        <Select aria-label="Position" value={draft.positionId} options={positionOptions} onChange={(e) => save({ ...draft, positionId: e.target.value })} />
      </Labeled>
      <div className="grid grid-cols-2 gap-2.5">
        <Labeled label="Start">
          <Select
            aria-label="Start time"
            value={String(draft.startMin)}
            options={TIMES}
            onChange={(e) => {
              const s = Number(e.target.value);
              const len = draft.endMin - draft.startMin;
              save({ ...draft, startMin: s, endMin: s + len }); // keep the length, like moving the shift
            }}
          />
        </Labeled>
        <Labeled label="End">
          <Select aria-label="End time" value={String(draft.endMin)} options={TIMES.filter((t) => Number(t.value) > draft.startMin)} onChange={(e) => save({ ...draft, endMin: Number(e.target.value) })} />
        </Labeled>
      </div>
      <Labeled label="Break">
        <Select aria-label="Break" value={String(draft.breakMinutes)} options={BREAKS} onChange={(e) => save({ ...draft, breakMinutes: Number(e.target.value) })} />
      </Labeled>
      <Labeled label="Notes">
        <Input
          aria-label="Notes"
          placeholder="e.g. cover patio, close bar"
          defaultValue={draft.notes ?? ""}
          key={shift.id}
          onBlur={(e) => e.target.value !== (draft.notes ?? "") && save({ ...draft, notes: e.target.value || null })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </Labeled>

      {error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}
      {mine.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {mine.map((i, n) => (
            <li key={n} className="flex items-start gap-2 text-sm">
              <Badge tone={i.level === "block" ? "bad" : "warn"} className="mt-px">{i.level === "block" ? "Must fix" : "Check"}</Badge>
              <span className="text-ink-2">{i.message}</span>
            </li>
          ))}
        </ul>
      )}

      {isNew ? (
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" className="max-sm:h-10" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" className="max-sm:h-10" onClick={create} disabled={saving}>
            {saving ? "Adding…" : "Add shift"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="max-sm:h-10"
            onClick={() =>
              start(async () => {
                const next = addDays(draft.date, 1);
                const r = await duplicateShift(shift.id, next);
                if (r.error) setError(r.error);
                else onToast(`Copied to ${dayDate(next)}`);
              })
            }
          >
            <Copy className="size-3.5" /> Copy to next day
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="max-sm:h-10"
            onClick={async () => {
              if (shift.published && !(await confirm({ title: "Delete a published shift?", body: "The team can already see it. They won't be notified automatically.", confirmLabel: "Delete", danger: true }))) return;
              start(async () => {
                await deleteShift(shift.id);
                onToast("Shift deleted");
                onClose();
              });
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>
      )}
    </div>
  );

  return createPortal(
    <>
      <div className={cx("fixed inset-0 z-40", phone && "bg-black/30")} onMouseDown={onClose} />
      {phone ? (
        <div role="dialog" aria-label={isNew ? "New shift" : "Edit shift"} className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
          <div className="mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-border-strong" />
          {body}
        </div>
      ) : (
        <div ref={refs.setFloating} style={floatingStyles} role="dialog" aria-label={isNew ? "New shift" : "Edit shift"} className="z-50 w-80 rounded-xl border border-border bg-surface p-4 shadow-2xl">
          {body}
        </div>
      )}
    </>,
    document.body,
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[0.75rem] font-medium text-ink-2">{label}</div>
      {children}
    </div>
  );
}
