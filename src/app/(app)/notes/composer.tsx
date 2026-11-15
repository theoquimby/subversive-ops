"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button, cx, DatePicker, Input, Textarea } from "@/components/ui";
import { CHIPS, SHIFTS, parseItems, type ShiftKind } from "@/domain/shiftNotes";
import type { ShiftNoteView } from "@/server/services/shiftNotes";
import { saveNote, type NoteForm } from "./actions";

type Drawer = "" | "even" | "over" | "short";

interface State {
  date: string;
  shift: ShiftKind;
  tags: string[];
  items: string[];
  itemDraft: string;
  compsAmount: string;
  comps: string;
  drawer: Drawer;
  drawerAmount: string;
  cash: string;
  issues: string;
  maintenance: string;
  notes: string;
}

const DRAFT_KEY = "notes.draft";

function fromNote(n: ShiftNoteView): State {
  const os = n.cashOverShort;
  return {
    date: n.date,
    shift: (SHIFTS.some((s) => s.value === n.shift) ? n.shift : "close") as ShiftKind,
    tags: n.tags,
    items: n.eightySixed,
    itemDraft: "",
    compsAmount: n.compsAmount != null ? String(n.compsAmount) : "",
    comps: n.comps ?? "",
    drawer: os == null ? "" : Math.abs(os) < 0.005 ? "even" : os > 0 ? "over" : "short",
    drawerAmount: os != null && Math.abs(os) >= 0.005 ? String(Math.abs(os)) : "",
    cash: n.cash ?? "",
    issues: n.issues ?? "",
    maintenance: n.maintenance ?? "",
    notes: n.notes ?? "",
  };
}

const blank = (date: string, shift: ShiftKind): State => ({ date, shift, tags: [], items: [], itemDraft: "", compsAmount: "", comps: "", drawer: "", drawerAmount: "", cash: "", issues: "", maintenance: "", notes: "" });

function toForm(s: State): NoteForm {
  const amount = s.drawerAmount.replace(/[$\s]/g, "");
  return {
    date: s.date,
    shift: s.shift,
    eightySixed: parseItems([...s.items, s.itemDraft]),
    issues: s.issues,
    comps: s.comps,
    compsAmount: s.compsAmount,
    cash: s.cash,
    cashOverShort: s.drawer === "even" ? "0" : s.drawer && amount ? `${s.drawer === "short" ? "-" : ""}${amount}` : "",
    maintenance: s.maintenance,
    notes: s.notes,
    tags: s.tags,
  };
}

const isBlank = (s: State) => !s.tags.length && !s.items.length && !s.itemDraft.trim() && !s.compsAmount && !s.comps && !s.drawer && !s.cash && !s.issues && !s.maintenance && !s.notes;

/**
 * The end-of-shift note: tap chips, add what was 86'd, comps, the drawer and
 * a few words. New notes keep an unsent draft on this device.
 */
export function NoteComposer({ today, defaultDate, defaultShift, usual, note, onDone, showDrawer = true }: { today: string; defaultDate: string; defaultShift: ShiftKind; usual: string[]; note?: ShiftNoteView; onDone?: () => void; showDrawer?: boolean }) {
  const [s, setS] = useState<State>(() => (note ? fromNote(note) : blank(defaultDate, defaultShift)));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const loaded = useRef(false);
  const set = (patch: Partial<State>) => {
    setSaved(false);
    setS((x) => ({ ...x, ...patch }));
  };

  // Unsent drafts survive a closed tab (new notes only; this device only).
  useEffect(() => {
    if (note || loaded.current) return;
    loaded.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as State;
        if (d && d.date === defaultDate && !isBlank(d)) setS({ ...blank(defaultDate, defaultShift), ...d });
      }
    } catch {
      /* storage blocked: start empty */
    }
  }, [note, defaultDate, defaultShift]);
  useEffect(() => {
    if (note || !loaded.current) return;
    try {
      if (isBlank(s)) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s, note]);

  const toggleTag = (t: string) => set({ tags: s.tags.includes(t) ? s.tags.filter((x) => x !== t) : [...s.tags, t] });
  const addItems = (raw: string) => {
    const next = parseItems([...s.items, ...raw.split(/[,;\n]+/)]);
    set({ items: next, itemDraft: "" });
  };
  const onItemKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && s.itemDraft.trim()) {
      e.preventDefault();
      addItems(s.itemDraft);
    } else if (e.key === "Backspace" && !s.itemDraft && s.items.length) set({ items: s.items.slice(0, -1) });
  };

  const submit = () => {
    setError(null);
    start(async () => {
      // No signal (walk-in): keep the draft on this phone rather than lose it.
      const r = await saveNote(note?.id ?? null, toForm(s)).catch(() => ({ error: note ? "No signal — that didn't save. Try again when you're back in range." : "No signal. Your note is kept on this phone — tap Save again when you're back in range." }));
      if (r.error) {
        setError(r.error);
        return;
      }
      setSaved(true);
      if (!note) {
        setS(blank(s.date, s.shift));
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
      }
      onDone?.();
    });
  };

  const usualLeft = usual.filter((u) => !s.items.some((i) => i.toLowerCase() === u.toLowerCase())).slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Shift" className="grid grid-cols-3 gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5">
          {SHIFTS.map((x) => (
            <button
              key={x.value}
              type="button"
              role="radio"
              aria-checked={s.shift === x.value}
              onClick={() => set({ shift: x.value })}
              className={cx("h-10 rounded-md px-3.5 text-sm font-medium transition-colors sm:h-8", s.shift === x.value ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="w-44">
          <DatePicker value={s.date} max={today} onChange={(e) => set({ date: e.target.value })} aria-label="Shift date" today={today} />
        </div>
      </div>

      <Group label="How it went">
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => {
            const on = s.tags.includes(c.label);
            return (
              <button
                key={c.label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTag(c.label)}
                className={cx(
                  "inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-[background-color,border-color,color,transform] duration-120 active:scale-[0.97] sm:h-8",
                  on ? (c.kind === "maintenance" ? "border-warn/40 bg-warn-bg text-warn" : "border-ink bg-ink text-bg") : "border-border-strong bg-surface text-ink-2 hover:border-ink-2/40 hover:text-ink",
                )}
              >
                {on && <Check className="size-3.5" strokeWidth={2.25} aria-hidden />}
                {c.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">Amber ones are fixes: they show up as a follow-up for a manager.</p>
      </Group>

      <Group label="86'd">
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2 py-1.5 focus-within:border-ink-2">
          {s.items.map((i) => (
            <span key={i} className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 pr-1 pl-3 text-sm text-ink">
              {i}
              <button type="button" onClick={() => set({ items: s.items.filter((x) => x !== i) })} className="grid size-7 place-items-center rounded-full text-muted hover:bg-border hover:text-ink" aria-label={`Remove ${i}`}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <input
            value={s.itemDraft}
            onChange={(e) => set({ itemDraft: e.target.value })}
            onKeyDown={onItemKey}
            onBlur={() => s.itemDraft.trim() && addItems(s.itemDraft)}
            placeholder={s.items.length ? "Add another" : "Type an item, then Enter"}
            aria-label="Item that ran out"
            className="h-8 min-w-36 flex-1 bg-transparent px-1 text-base text-ink placeholder:text-muted/70 focus:outline-none sm:text-sm"
          />
        </div>
        {usualLeft.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">Usual:</span>
            {usualLeft.map((u) => (
              <button key={u} type="button" onClick={() => addItems(u)} className="inline-flex h-9 items-center gap-1 rounded-full border border-dashed border-border-strong px-3 text-sm text-ink-2 hover:border-ink-2/50 hover:text-ink sm:h-7 sm:text-xs">
                <Plus className="size-3" aria-hidden />
                {u}
              </button>
            ))}
          </div>
        )}
      </Group>

      <div className={cx("grid gap-5", showDrawer && "sm:grid-cols-2")}>
        <Group label="Comps">
          <div className="flex gap-2">
            <div className="relative w-28 shrink-0">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
              <Input inputMode="decimal" value={s.compsAmount} onChange={(e) => set({ compsAmount: e.target.value })} placeholder="0" className="num pl-6" aria-label="Comps total" />
            </div>
            <Input value={s.comps} onChange={(e) => set({ comps: e.target.value })} placeholder="What and why" aria-label="What was comped and why" />
          </div>
        </Group>
        {showDrawer && (
          <Group label="Drawer">
            <div className="flex gap-2">
              <div role="radiogroup" aria-label="Drawer" className="grid shrink-0 grid-cols-3 gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5">
                {(["even", "over", "short"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={s.drawer === d}
                    onClick={() => set({ drawer: s.drawer === d ? "" : d })}
                    className={cx("h-9 rounded-md px-2.5 text-sm capitalize transition-colors sm:h-7", s.drawer === d ? (d === "short" ? "bg-bad-bg font-medium text-bad" : "bg-primary font-medium text-primary-ink") : "text-ink-2 hover:bg-surface-2")}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {(s.drawer === "over" || s.drawer === "short") && (
                <div className="relative w-24 shrink-0">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                  <Input inputMode="decimal" value={s.drawerAmount} onChange={(e) => set({ drawerAmount: e.target.value })} placeholder="0" className="num pl-6" aria-label={`Amount ${s.drawer}`} autoFocus />
                </div>
              )}
            </div>
            <Input value={s.cash} onChange={(e) => set({ cash: e.target.value })} placeholder="Drawer note (float, safe drop…)" aria-label="Drawer note" className="mt-2" />
          </Group>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Group label="Issues">
          <Textarea rows={2} value={s.issues} onChange={(e) => set({ issues: e.target.value })} placeholder="Guest complaints, staff, deliveries…" className="min-h-16" />
        </Group>
        <Group label="Maintenance">
          <Textarea rows={2} value={s.maintenance} onChange={(e) => set({ maintenance: e.target.value })} placeholder="What's broken or needs a look" className="min-h-16" />
        </Group>
      </div>
      <Group label="Anything else">
        <Textarea rows={2} value={s.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="For the next shift or the morning" className="min-h-16" />
      </Group>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" size="lg" onClick={submit} disabled={pending} className={cx("w-full sm:w-auto", !note && "h-13 rounded-xl text-base sm:h-11")}>
          {pending ? "Saving…" : note ? "Save changes" : "Save note"}
        </Button>
        {onDone && note && (
          <Button type="button" variant="ghost" size="lg" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        )}
        <span aria-live="polite" className="text-sm">
          {error ? <span className="text-bad">{error}</span> : saved ? <span className="inline-flex items-center gap-1 text-good motion-safe:animate-fade-in"><Check className="size-4" /> {note ? "Saved." : "Saved. It'll be in tomorrow's brief."}</span> : null}
        </span>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">{label}</div>
      {children}
    </div>
  );
}
