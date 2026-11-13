"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, cx, DatePicker, Input, Select } from "@/components/ui";
import { displayTime, EVENT_KIND_LABEL, EVENT_KINDS } from "@/domain/events";
import { dayDate, shortDate } from "@/lib/format";
import { Plus, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { addEvents, addHolidaysFor, applyLearned, deleteEvent, setEventField } from "./actions";

const KIND_OPTIONS = EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABEL[k] }));

export interface EventRowView {
  id: string;
  date: string;
  title: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  impact: number;
  notes: string | null;
  lift?: { lift: number | null; actual: number; baseline: number } | null;
}

/** "Add more dates for …" hint, in words that fit the kind of event. */
const MORE_DATES: Record<string, string> = {
  GAME: "every home game",
  FESTIVAL: "each festival day",
  MUSIC: "each show",
  PRIVATE: "each booking",
  CLOSURE: "each day you're closed",
  HOLIDAY: "each holiday",
  OTHER: "each date it happens",
};

const pctText = (m: number) => {
  const p = Math.round((m - 1) * 100);
  return p > 0 ? `+${p}` : String(p);
};

function Msg({ msg }: { msg: { error?: string; message?: string } | null }) {
  if (!msg || (!msg.error && !msg.message)) return null;
  return <span className={cx("text-sm", msg.error ? "text-bad" : "text-good")}>{msg.error ?? msg.message}</span>;
}

// ---- Holidays -------------------------------------------------------------------------

export function HolidayButtons({ years }: { years: number[] }) {
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Msg msg={msg} />
      {years.map((y) => (
        <Button key={y} disabled={pending} onClick={() => start(async () => setMsg(await addHolidaysFor(y)))}>
          Add NY holidays {y}
        </Button>
      ))}
    </div>
  );
}

// ---- Quick add ------------------------------------------------------------------------

export function QuickAdd({ today }: { today: string }) {
  const [dates, setDates] = useState<string[]>([]);
  const [repeat, setRepeat] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("GAME");
  const [startTime, setStart] = useState("");
  const [endTime, setEnd] = useState("");
  const [impactPct, setImpact] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const [pickerKey, setPickerKey] = useState(0);

  const submit = () =>
    start(async () => {
      const r = await addEvents({ dates, repeatUntil: repeat || null, title, kind, startTime, endTime, impactPct, notes });
      setMsg(r);
      if (!r.error) {
        setDates([]);
        setRepeat("");
        setTitle("");
        setNotes("");
      }
    });

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem_6rem_6rem]">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Knicks vs Celtics" aria-label="Event name" onKeyDown={(e) => e.key === "Enter" && submit()} />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} options={KIND_OPTIONS} aria-label="Kind" />
        <Input value={startTime} onChange={(e) => setStart(e.target.value)} placeholder="Starts" aria-label="Start time" />
        <Input value={endTime} onChange={(e) => setEnd(e.target.value)} placeholder="Ends" aria-label="End time" />
        <div className="relative">
          <Input value={kind === "CLOSURE" ? "" : impactPct} disabled={kind === "CLOSURE"} onChange={(e) => setImpact(e.target.value)} placeholder={kind === "CLOSURE" ? "Closed" : "±0"} aria-label="Impact percent" className="num pr-7 text-right" />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">%</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dates.map((d) => (
          <span key={d} className="inline-flex h-8 items-center gap-1 rounded-lg bg-surface-2 pr-1 pl-2.5 text-sm">
            {dayDate(d)}
            <button type="button" onClick={() => setDates(dates.filter((x) => x !== d))} className="rounded p-1 text-muted hover:text-ink" aria-label={`Remove ${dayDate(d)}`}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <div className="w-44">
          <DatePicker
            key={pickerKey}
            aria-label="Add a date"
            onChange={(e) => {
              if (e.target.value && !dates.includes(e.target.value)) setDates([...dates, e.target.value].sort());
              setPickerKey((k) => k + 1);
            }}
          />
        </div>
        <span className="text-xs text-muted">{dates.length === 0 ? "Pick one or more dates" : `Add more dates for ${MORE_DATES[kind] ?? "each date it happens"}`}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-center">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the website (optional)" aria-label="Notes" />
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted">Weekly until</span>
          <DatePicker value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label="Repeat weekly until" min={dates[0] ?? today} />
          {repeat && (
            <button type="button" onClick={() => setRepeat("")} className="rounded p-1 text-muted hover:text-ink" aria-label="Don't repeat">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button variant="primary" disabled={pending} onClick={submit} className="h-10 sm:h-9">
          <Plus className="size-4" /> {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      <div className="mt-2 min-h-5"><Msg msg={msg} /></div>
    </div>
  );
}

// ---- Grid -----------------------------------------------------------------------------

export function EventsGrid({ rows, grid, past = false }: { rows: EventRowView[]; grid: string; past?: boolean }) {
  const confirm = useConfirm();
  const [, start] = useTransition();
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[0.75rem] text-muted">
            <th className="hidden border-b border-border px-3 py-2.5 font-medium sm:table-cell">Date</th>
            <th className="border-b border-border px-3 py-2.5 font-medium">Event</th>
            <th className="hidden border-b border-border px-3 py-2.5 font-medium sm:table-cell">Kind</th>
            <th className="hidden border-b border-border px-3 py-2.5 font-medium md:table-cell">Starts</th>
            <th className="hidden border-b border-border px-3 py-2.5 font-medium lg:table-cell">Ends</th>
            <th className="border-b border-border px-3 py-2.5 text-right font-medium">Impact</th>
            {past && <th className="hidden border-b border-border px-3 py-2.5 text-right font-medium whitespace-nowrap sm:table-cell">vs usual</th>}
            <th className={cx("hidden border-b border-border px-3 py-2.5 font-medium", past ? "2xl:table-cell" : "xl:table-cell")}>Notes</th>
            <th className="w-10 border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const save = (field: Parameters<typeof setEventField>[1]) => setEventField.bind(null, r.id, field);
            const closed = r.kind === "CLOSURE";
            return (
              <tr key={r.id} className="transition-colors hover:bg-surface-2/60 [&:last-child>td]:border-b-0">
                <td className="hidden w-40 border-b border-border px-2 py-1.5 sm:table-cell">
                  <DatePicker value={r.date} onChange={(e) => start(async () => void (await setEventField(r.id, "date", e.target.value)))} aria-label={`Date of ${r.title}`} className="h-10 border-transparent bg-transparent px-2 hover:border-border sm:h-8" />
                </td>
                <td className="border-b border-border px-1 py-1.5 sm:min-w-44 lg:min-w-60">
                  <GridCell grid={grid} col="title" value={r.title} onSave={save("title")} ariaLabel={`Title of ${r.title}`} />
                  <div className="px-2 text-xs text-muted sm:hidden">{shortDate(r.date)} · {EVENT_KIND_LABEL[r.kind as keyof typeof EVENT_KIND_LABEL] ?? r.kind}{r.startTime ? ` · ${displayTime(r.startTime)}` : ""}</div>
                </td>
                <td className="hidden w-40 border-b border-border px-1 py-1.5 sm:table-cell">
                  <GridSelect value={r.kind} options={KIND_OPTIONS} onSave={save("kind")} ariaLabel={`Kind of ${r.title}`} />
                </td>
                <td className="hidden w-28 min-w-[6.5rem] border-b border-border px-1 py-1.5 md:table-cell">
                  <GridCell grid={grid} col="start" value={displayTime(r.startTime)} placeholder="—" onSave={save("startTime")} ariaLabel={`Start of ${r.title}`} />
                </td>
                <td className="hidden w-28 min-w-[6.5rem] border-b border-border px-1 py-1.5 lg:table-cell">
                  <GridCell grid={grid} col="end" value={displayTime(r.endTime)} placeholder="—" onSave={save("endTime")} ariaLabel={`End of ${r.title}`} />
                </td>
                <td className="w-24 border-b border-border px-1 py-1.5 text-right">
                  {closed ? (
                    <span className="px-2 text-sm text-muted">Closed</span>
                  ) : (
                    <GridCell grid={grid} col="impact" value={pctText(r.impact)} suffix="%" align="right" onSave={save("impact")} ariaLabel={`Impact of ${r.title}`} className="num" />
                  )}
                </td>
                {past && (
                  <td className="num hidden border-b border-border px-3 py-1.5 text-right whitespace-nowrap sm:table-cell">
                    {r.lift?.lift != null ? (
                      <span title={`Sold ${Math.round(r.lift.actual)} vs usual ${Math.round(r.lift.baseline)}`}>
                        <Badge tone={r.lift.lift >= 1.05 ? "good" : r.lift.lift <= 0.95 ? "warn" : "neutral"}>{pctText(r.lift.lift)}%</Badge>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">{closed ? "—" : "not enough history"}</span>
                    )}
                  </td>
                )}
                <td className={cx("hidden min-w-48 border-b border-border px-1 py-1.5", past ? "2xl:table-cell" : "xl:table-cell")}>
                  <GridCell grid={grid} col="notes" value={r.notes ?? ""} placeholder="Add a note" onSave={save("notes")} ariaLabel={`Notes for ${r.title}`} />
                </td>
                <td className="border-b border-border pr-2 text-right">
                  <button
                    type="button"
                    className="inline-grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
                    aria-label={`Delete ${r.title}`}
                    onClick={async () => {
                      if (await confirm({ title: `Delete “${r.title}”?`, body: `${shortDate(r.date)} · it will disappear from the forecast and the website.`, confirmLabel: "Delete", danger: true })) start(async () => void (await deleteEvent(r.id)));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Learned impact ------------------------------------------------------------------

export function ApplyLearned({ series, label, disabled }: { series: string; label: string; disabled?: boolean }) {
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  if (msg?.message) return <span className="text-sm text-good">{msg.message}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Msg msg={msg} />
      <Button size="sm" disabled={pending || disabled} onClick={() => start(async () => setMsg(await applyLearned(series)))}>{label}</Button>
    </span>
  );
}
