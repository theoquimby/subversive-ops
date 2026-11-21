"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Pencil, Trash2, Undo2, Wrench } from "lucide-react";
import { useConfirm } from "@/components/dialog";
import { Button, Card, cx, LinkButton } from "@/components/ui";
import { chipKind, needsFollowUp, noteHighlights, repairFromNote, shiftLabel, type ShiftKind } from "@/domain/shiftNotes";
import { businessDateTime, dayDate } from "@/lib/format";
import type { ShiftNoteView } from "@/server/services/shiftNotes";
import { markHandled, removeNote } from "./actions";
import { NoteComposer } from "./composer";

const DOT = { bad: "bg-bad", warn: "bg-warn", neutral: "bg-border-strong" } as const;

/** One shift note: chips, what stood out, and (for managers) mark handled / edit / delete. */
export function NoteCard({ note, viewer, today, usual, compact = false, showDate = true }: { note: ShiftNoteView; viewer: { userId: string; role: "MANAGER" | "STAFF" }; today: string; usual: string[]; compact?: boolean; showDate?: boolean }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const manager = viewer.role === "MANAGER";
  const mine = note.authorId === viewer.userId;
  const canEdit = manager || mine;
  // Staff don't see drawer amounts on other people's notes.
  const view = manager || mine ? note : { ...note, cash: null, cashOverShort: null };
  const lines = noteHighlights(view);
  const follow = needsFollowUp(view);
  const pace = note.tags.filter((t) => chipKind(t) !== "maintenance");
  // Upkeep is for managers; the repair form opens filled in from the note.
  const repair = manager ? repairFromNote(note) : null;
  const repairHref = repair ? `/upkeep?${new URLSearchParams({ repair: "1", title: repair.title, date: repair.date, note: repair.note })}` : null;

  const del = async () => {
    // Ask first, outside any transition; then delete.
    const ok = await confirm({ title: "Delete this note?", body: "It comes out of the history and the morning brief.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    start(async () => {
      const r = await removeNote(note.id);
      if (r.error) setError(r.error);
    });
  };
  const handle = (on: boolean) =>
    start(async () => {
      const r = await markHandled(note.id, on);
      if (r.error) setError(r.error);
    });

  if (editing) {
    return (
      <Card className="p-4 sm:p-5">
        <NoteComposer today={today} defaultDate={note.date} defaultShift={note.shift as ShiftKind} usual={usual} note={note} onDone={() => setEditing(false)} showDrawer={manager || mine} />
      </Card>
    );
  }

  return (
    <Card className={cx("p-4 transition-opacity duration-180 sm:p-5", pending && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-ink">{shiftLabel(note.shift)}{showDate && <span className="font-normal text-muted"> · {dayDate(note.date)}</span>}</span>
            {follow && manager && <span className="rounded-md bg-warn-bg px-1.5 py-0.5 text-xs font-medium text-warn">Follow up</span>}
            {note.handledAt && <span className="inline-flex items-center gap-1 rounded-md bg-good-bg px-1.5 py-0.5 text-xs font-medium text-good"><CheckCircle2 className="size-3" aria-hidden />Handled{note.handledBy ? ` by ${note.handledBy}` : ""}</span>}
          </div>
          <div className="mt-0.5 text-xs text-muted">{note.authorName} · {businessDateTime(note.createdAt)}</div>
        </div>
        {canEdit && !compact && (
          <div className="-mt-1 -mr-2 flex shrink-0">
            <Button variant="ghost" size="sm" className="size-10 px-0 sm:size-8" onClick={() => setEditing(true)} aria-label="Edit note" title="Edit"><Pencil className="size-4" /></Button>
            <Button variant="ghost" size="sm" className="size-10 px-0 text-muted hover:text-bad sm:size-8" onClick={del} aria-label="Delete note" title="Delete"><Trash2 className="size-4" /></Button>
          </div>
        )}
      </div>

      {pace.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pace.map((t) => <span key={t} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2">{t}</span>)}
        </div>
      )}
      {lines.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {lines.map((l) => (
            <li key={l.key} className="flex gap-2.5 text-sm leading-snug text-ink">
              <span aria-hidden className={cx("mt-[0.45rem] size-1.5 shrink-0 rounded-full", DOT[l.tone])} />
              <span className="min-w-0 break-words whitespace-pre-line">{l.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        pace.length === 0 && <p className="mt-3 text-sm text-muted">No problems.</p>
      )}

      {manager && (follow || note.handledAt) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {note.handledAt ? (
            <Button variant="ghost" size="sm" className="-ml-2 h-10 sm:h-8" onClick={() => handle(false)} disabled={pending}><Undo2 className="size-3.5" />Not handled yet</Button>
          ) : (
            <Button variant="secondary" size="sm" className="h-10 sm:h-8" onClick={() => handle(true)} disabled={pending}><CheckCircle2 className="size-3.5" />Mark handled</Button>
          )}
          {repairHref && !compact && <LinkButton href={repairHref} variant="ghost" size="sm" className="h-10 sm:h-8"><Wrench className="size-3.5" />Log as repair</LinkButton>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </Card>
  );
}
