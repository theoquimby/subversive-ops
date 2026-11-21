"use client";

import { useConfirm } from "@/components/dialog";
import type { ToastAction } from "@/components/toast";
import { Badge, Button, cx, Input, Select } from "@/components/ui";
import { weekday } from "@/domain/dates";
import { availabilityLabel, formatMinutes, shiftPaidHours, timeOptions } from "@/domain/schedule";
import { parseShiftTime } from "@/domain/shiftEntry";
import { dayDate } from "@/lib/format";
import type { EmployeeView, PositionView, ShiftView, WeekIssue } from "@/server/services/scheduling";
import { autoUpdate, flip, offset, shift as shiftMw, useFloating } from "@floating-ui/react";
import { Copy, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { copyShiftTo, createShift, deleteShift, removeNewShifts, restoreShift, updateShift } from "./actions";

const TIMES = timeOptions(5 * 60, 27 * 60, 15);
const BREAKS = [0, 15, 30, 45, 60].map((m) => ({ value: String(m), label: m ? `${m} min unpaid` : "No break" }));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  shift: ShiftView;
  anchor: HTMLElement | null;
  employees: EmployeeView[];
  positions: PositionView[];
  issues: WeekIssue[];
  hoursByEmployee: Map<string, number>;
  timeOff: Record<string, string[]>;
  /** Opening hours by weekday ([open hour, close hour]), so "open" and "close" can be typed. */
  opening: Record<number, [number, number]>;
  /** The week's seven dates, for Copy to. */
  weekDates: string[];
  weekShifts: ShiftView[];
  onClose: () => void;
  onToast: (msg: string, action?: ToastAction) => void;
  /** New shift: edits stay local and nothing is created until Save. */
  isNew?: boolean;
}

export function ShiftEditor({ shift, anchor, employees, positions, issues, hoursByEmployee, timeOff, opening, weekDates, weekShifts, onClose, onToast, isNew = false }: Props) {
  const [draft, setDraft] = useState(shift);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const confirm = useConfirm();
  const [phone, setPhone] = useState(false);
  // Typed but not yet saved: the start, end and notes boxes.
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState(shift.notes ?? "");
  // While "Discard?" is open, leaving a box must not save what's in it.
  const holding = useRef(false);
  useEffect(() => setPhone(window.matchMedia("(max-width: 639px)").matches), []);
  useEffect(() => setDraft(shift), [shift]);

  const { refs, floatingStyles } = useFloating({
    placement: "right-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 12, fallbackPlacements: ["left-start", "bottom", "top"] }), shiftMw({ padding: 12 })],
    elements: { reference: anchor },
  });

  const changedNew = isNew && (draft.employeeId !== shift.employeeId || draft.positionId !== shift.positionId || draft.startMin !== shift.startMin || draft.endMin !== shift.endMin || draft.breakMinutes !== shift.breakMinutes || notes.trim() !== "");
  const dirty = Object.values(typing).some(Boolean) || (!isNew && notes !== (draft.notes ?? "")) || changedNew;

  const requestClose = async () => {
    if (!dirty) return onClose();
    holding.current = true;
    const ok = await confirm({
      title: isNew ? "Discard this shift?" : "Discard what you typed?",
      body: isNew ? "It hasn't been added yet." : "The changes you typed haven't been saved.",
      confirmLabel: "Discard",
      danger: true,
    });
    holding.current = false;
    if (ok) onClose();
  };
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="listbox"], [role="alertdialog"]') && void closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    if (Object.values(typing).some(Boolean)) return setError("Check the start and end: type a time like 4p, or pick one from the list.");
    start(async () => {
      const r = await createShift({ employeeId: draft.employeeId, positionId: draft.positionId, date: draft.date, startMin: draft.startMin, endMin: draft.endMin, breakMinutes: draft.breakMinutes, notes: notes.trim() || null });
      if (r.error) setError(r.error);
      else {
        onToast("Shift added as a draft");
        onClose();
      }
    });
  };

  const remove = async () => {
    if (shift.published && !(await confirm({ title: "Delete a published shift?", body: "The team can already see it. They won't be notified automatically.", confirmLabel: "Delete", danger: true }))) return;
    const gone = { ...draft, notes: draft.notes };
    start(async () => {
      const r = await deleteShift(shift.id);
      if (r.error) return setError(r.error);
      onToast("Shift deleted", {
        label: "Undo",
        onClick: () => {
          void restoreShift({ employeeId: gone.employeeId, positionId: gone.positionId, date: gone.date, startMin: gone.startMin, endMin: gone.endMin, breakMinutes: gone.breakMinutes, notes: gone.notes, published: gone.published }).then((b) =>
            onToast(b.error ?? "Shift put back"),
          );
        },
      });
      onClose();
    });
  };

  const emp = employees.find((e) => e.id === draft.employeeId);
  const wd = weekday(draft.date);
  const hoursToday = opening[wd];
  const parseOpts = { openMin: hoursToday ? hoursToday[0] * 60 : null, closeMin: hoursToday ? hoursToday[1] * 60 : null };
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
  const typed = (k: string) => (v: boolean) => setTyping((t) => (t[k] === v ? t : { ...t, [k]: v }));

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
        <button onClick={() => void requestClose()} className="-m-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink max-sm:p-2.5" aria-label="Close">
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
      <div>
        <div className="grid grid-cols-2 gap-2.5">
          <Labeled label="Start">
            <TimeBox
              label="Start time"
              value={draft.startMin}
              options={TIMES}
              parse={(raw) => parseShiftTime(raw, parseOpts)}
              holding={holding}
              onTyping={typed("start")}
              onCommit={(s) => {
                const len = draft.endMin - draft.startMin;
                save({ ...draft, startMin: s, endMin: s + len }); // keep the length, like moving the shift
              }}
            />
          </Labeled>
          <Labeled label="End">
            <TimeBox
              label="End time"
              value={draft.endMin}
              options={TIMES.filter((t) => Number(t.value) > draft.startMin)}
              parse={(raw) => parseShiftTime(raw, { ...parseOpts, after: draft.startMin })}
              holding={holding}
              onTyping={typed("end")}
              onCommit={(e) => {
                if (e <= draft.startMin) return setError("The shift has to end after it starts.");
                save({ ...draft, endMin: e });
              }}
            />
          </Labeled>
        </div>
        <p className="mt-1 text-xs text-muted">Type 4p, 10:30p{hoursToday ? " or close" : ""}, or pick from the list.</p>
      </div>
      <Labeled label="Break">
        <Select aria-label="Break" value={String(draft.breakMinutes)} options={BREAKS} onChange={(e) => save({ ...draft, breakMinutes: Number(e.target.value) })} />
      </Labeled>
      <Labeled label="Notes">
        <Input
          aria-label="Notes"
          placeholder="e.g. cover patio, close bar"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (isNew || holding.current) return;
            if (notes !== (draft.notes ?? "")) save({ ...draft, notes: notes || null });
          }}
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

      {!isNew && <CopyTo shift={draft} weekDates={weekDates} weekShifts={weekShifts} />}

      {isNew ? (
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" className="max-sm:h-10" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" className="max-sm:h-10" onClick={create} pending={saving}>
            {saving ? "Adding…" : "Add shift"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="danger" size="sm" className="max-sm:h-10" disabled={saving} onClick={() => void remove()}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>
      )}
    </div>
  );

  return createPortal(
    <>
      <div className={cx("fixed inset-0 z-40", phone && "bg-black/30")} onMouseDown={(e) => { e.preventDefault(); void requestClose(); }} />
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

/**
 * A time typed as it's said ("4p", "10:30p", "close"), saved on Enter or on
 * leaving the box. The arrow opens the 15-minute list for anyone who'd
 * rather pick.
 */
function TimeBox({ label, value, options, parse, onCommit, onTyping, holding }: { label: string; value: number; options: { value: string; label: string }[]; parse: (raw: string) => number | null; onCommit: (min: number) => void; onTyping: (typing: boolean) => void; holding: { current: boolean } }) {
  const shown = formatMinutes(value);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  useEffect(() => onTyping(text.trim() !== shown), [text, shown, onTyping]);

  const commit = () => {
    if (text.trim() === shown) return setBad(false);
    const m = parse(text);
    if (m == null) return setBad(true);
    setBad(false);
    setText(formatMinutes(m));
    if (m !== value) onCommit(m);
  };

  return (
    <div className="flex items-stretch gap-1">
      <Input
        aria-label={label}
        aria-invalid={bad || undefined}
        value={text}
        autoComplete="off"
        enterKeyHint="done"
        className={cx("min-w-0 flex-1 px-2.5 num", bad && "border-bad")}
        onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        onBlur={() => {
          focused.current = false;
          if (!holding.current) commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
        }}
      />
      <Select
        aria-label={`${label}: pick from the list`}
        value={String(value)}
        options={options}
        className="w-9 shrink-0 justify-center px-0 sm:w-8 [&>span]:hidden"
        onChange={(e) => {
          const m = Number(e.target.value);
          setText(formatMinutes(m));
          setBad(false);
          if (m !== value) onCommit(m);
        }}
      />
      {bad && <span className="sr-only" role="alert">Type a time like 4p or 10:30p</span>}
    </div>
  );
}

/** Copy this shift onto other days of the week, with Undo right there. */
function CopyTo({ shift, weekDates, weekShifts }: { shift: ShiftView; weekDates: string[]; weekShifts: ShiftView[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [done, setDone] = useState<{ ids: string[]; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const days = weekDates.filter((d) => d !== shift.date);
  const busyDay = (d: string) => !!shift.employeeId && weekShifts.some((s) => s.employeeId === shift.employeeId && s.date === d && s.startMin < shift.endMin && s.endMin > shift.startMin);
  const label = (ds: string[]) => ds.map((d) => DOW[weekday(d)]).join(", ");

  const copy = () =>
    start(async () => {
      setError(null);
      const r = await copyShiftTo(shift.id, picked);
      if (r.error) return setError(r.error);
      const ids = r.ids ?? [];
      const skipped = r.skipped ?? [];
      setPicked([]);
      setDone({ ids, text: `${ids.length ? `Copied to ${label(picked.filter((d) => !skipped.includes(d)))}.` : "Nothing copied."}${skipped.length ? ` Skipped ${label(skipped)}: already working then.` : ""}` });
    });
  const undo = () =>
    start(async () => {
      if (!done) return;
      const r = await removeNewShifts(done.ids);
      setDone(r.error ? { ids: [], text: r.error } : { ids: [], text: "Copies removed." });
    });

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[0.75rem] font-medium text-ink-2"><Copy className="size-3" /> Copy to</div>
      <div className="flex flex-wrap gap-1">
        {days.map((d) => {
          const on = picked.includes(d);
          const taken = busyDay(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              disabled={taken || busy}
              title={taken ? "Already working then" : undefined}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== d) : [...p, d].sort()))}
              className={cx(
                "h-10 min-w-11 rounded-full border px-2.5 text-xs font-medium sm:h-8 sm:min-w-10",
                on ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2 hover:bg-surface-2",
                taken && "border-dashed text-muted/60 line-through",
              )}
            >
              {DOW[weekday(d)]}
            </button>
          );
        })}
        {picked.length > 0 && (
          <Button size="sm" variant="secondary" className="max-sm:h-10" pending={busy} onClick={copy}>
            Copy to {picked.length} day{picked.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-bad">{error}</p>}
      {done && (
        <p className="mt-1.5 text-xs text-ink-2" role="status">
          {done.text}{" "}
          {done.ids.length > 0 && <button type="button" className="font-semibold underline underline-offset-2" disabled={busy} onClick={undo}>Undo</button>}
        </p>
      )}
    </div>
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
