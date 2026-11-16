"use client";

/**
 * Announcements: managers post short notes from Team or Schedule; staff see
 * them at the top of My shifts. Pinned notes stay; others drop off after 30 days.
 * A note can be written ahead with "Show from": staff don't see it until then,
 * and managers see it under Scheduled, where it can be changed or shown now.
 */

import { useConfirm } from "@/components/dialog";
import { Button, Card, cx, DatePicker, Select, Textarea } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { formatMinutes, localParts, timeOptions } from "@/domain/schedule";
import type { AnnouncementView } from "@/server/services/scheduling";
import { CalendarClock, Megaphone, Pencil, Pin, PinOff, Send, Trash2 } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { deleteAnnouncement, editAnnouncement, pinAnnouncement, postAnnouncement, publishAnnouncementNow } from "./actions";

export type { AnnouncementView };

type Start = { date: string; minutes: number };

// Business timezone so the server render and the browser agree.
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

const TIMES = timeOptions(0, 23 * 60 + 45, 15);
const DEFAULT_MINUTES = 9 * 60;

/** Is this start still ahead, in the business timezone (published by the root layout)? */
function isLater(s: Start | null, today: string): boolean {
  if (!s) return false;
  if (s.date !== today) return s.date > today;
  const tz = document.querySelector<HTMLMetaElement>('meta[name="business-tz"]')?.content || "America/New_York";
  try {
    return s.minutes > localParts(new Date(), tz).minutes;
  } catch {
    return true;
  }
}

/** Day and time a note starts showing. */
function StartPicker({ value, onChange, today }: { value: Start; onChange: (s: Start) => void; today: string }) {
  const options = TIMES.some((t) => t.value === String(value.minutes)) ? TIMES : [...TIMES, { value: String(value.minutes), label: formatMinutes(value.minutes) }];
  return (
    <div className="grid grid-cols-[1fr_8.5rem] gap-2 sm:w-[22rem]">
      <DatePicker value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} min={today} today={today} aria-label="Day it shows from" />
      <Select value={String(value.minutes)} onChange={(e) => onChange({ ...value, minutes: Number(e.target.value) })} options={options} aria-label="Time it shows from" />
    </div>
  );
}

export function AnnouncementsManager({ items, scheduled = [], today }: { items: AnnouncementView[]; scheduled?: AnnouncementView[]; today: string }) {
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const [start, setStart] = useState<Start | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, begin] = useTransition();
  const post = () =>
    begin(async () => {
      const later = isLater(start, today);
      const r = await postAnnouncement(text, later ? start : null);
      if (r.error) setError(r.error);
      else {
        setText("");
        setStart(null);
        setError(null);
        setNotice(later ? "Scheduled. Staff see it from the day and time you picked." : null);
      }
    });
  const remove = async (id: string) => {
    if (await confirm({ title: "Delete this announcement?", confirmLabel: "Delete", danger: true })) begin(async () => { await deleteAnnouncement(id); });
  };
  const later = start ? isLater(start, today) : false;
  return (
    <Card>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Textarea
            aria-label="New announcement"
            placeholder="Post a note to the team: menu changes, a private event, who to call if you're running late…"
            value={text}
            rows={2}
            onChange={(e) => { setText(e.target.value); setNotice(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } }}
            className="min-h-11 flex-1"
          />
          <Button variant="primary" className="shrink-0 max-sm:h-11" disabled={pending || !text.trim()} onClick={post}>
            {later ? <CalendarClock className="size-3.5" /> : <Megaphone className="size-3.5" />} {pending ? "Saving…" : later ? "Schedule" : "Post"}
          </Button>
        </div>
        {start ? (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-[0.8rem] font-medium text-ink-2">Show from</span>
            <StartPicker value={start} onChange={(s) => { setStart(s); setNotice(null); }} today={today} />
            <button type="button" className="min-h-10 self-start text-xs text-muted underline underline-offset-2 sm:min-h-0 sm:self-center" onClick={() => setStart(null)}>Post it now instead</button>
          </div>
        ) : (
          <button type="button" className="inline-flex min-h-10 items-center gap-1.5 self-start text-xs text-muted hover:text-ink sm:min-h-0" onClick={() => { setStart({ date: addDays(today, 1), minutes: DEFAULT_MINUTES }); setNotice(null); }}>
            <CalendarClock className="size-3.5" /> Schedule it for later
          </button>
        )}
      </div>
      {error && <p className="px-3 pb-2 text-sm text-bad">{error}</p>}
      {notice && <p className="px-3 pb-2 text-sm text-good">{notice}</p>}

      {scheduled.length > 0 && (
        <div className="border-t border-border">
          <h3 className="px-4 pt-3 text-xs font-semibold tracking-wide text-muted uppercase">Scheduled</h3>
          <div className="divide-y divide-border">
            {scheduled.map((a) =>
              editing === a.id ? (
                <ScheduledEditor key={a.id} item={a} today={today} onDone={() => setEditing(null)} />
              ) : (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-line text-ink-2">{a.body}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-medium text-ink-2">Shows {a.starts?.label ?? "soon"}</span> · {a.pinned ? "Pinned · " : ""}{a.author ?? "Manager"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <IconButton label="Show it now" disabled={pending} onClick={() => begin(async () => { await publishAnnouncementNow(a.id); })}><Send className="size-3.5" /></IconButton>
                    <IconButton label="Edit" disabled={pending} onClick={() => setEditing(a.id)}><Pencil className="size-3.5" /></IconButton>
                    <IconButton label="Delete announcement" danger disabled={pending} onClick={() => remove(a.id)}><Trash2 className="size-3.5" /></IconButton>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="border-t border-border">
          {scheduled.length > 0 && <h3 className="px-4 pt-3 text-xs font-semibold tracking-wide text-muted uppercase">Showing now</h3>}
          <div className="divide-y divide-border">
          {items.map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line text-ink">{a.body}</p>
                <p className="mt-0.5 text-xs text-muted">{a.pinned ? "Pinned · " : ""}{a.author ?? "Manager"} · {when(a.shownAt)}</p>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <IconButton label={a.pinned ? "Unpin" : "Pin to the top"} className={a.pinned ? "text-ink" : undefined} disabled={pending} onClick={() => begin(async () => { await pinAnnouncement(a.id, !a.pinned); })}>
                  {a.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </IconButton>
                <IconButton label="Delete announcement" danger disabled={pending} onClick={() => remove(a.id)}><Trash2 className="size-3.5" /></IconButton>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function IconButton({ label, danger, className, children, ...rest }: { label: string; danger?: boolean; className?: string; children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={cx("grid size-10 place-items-center rounded-md text-muted sm:size-8", danger ? "hover:bg-bad-bg hover:text-bad" : "hover:bg-surface-2 hover:text-ink", className)}>
      {children}
    </button>
  );
}

/** Change a scheduled note's words or when it shows. */
function ScheduledEditor({ item, today, onDone }: { item: AnnouncementView; today: string; onDone: () => void }) {
  const [text, setText] = useState(item.body);
  const [start, setStart] = useState<Start>(item.starts ? { date: item.starts.date, minutes: item.starts.minutes } : { date: addDays(today, 1), minutes: DEFAULT_MINUTES });
  const [error, setError] = useState<string | null>(null);
  const [pending, begin] = useTransition();
  const save = () =>
    begin(async () => {
      const r = await editAnnouncement(item.id, text, start);
      if (r.error) setError(r.error);
      else onDone();
    });
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <Textarea aria-label="Announcement" value={text} rows={2} onChange={(e) => setText(e.target.value)} className="min-h-11" />
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-[0.8rem] font-medium text-ink-2">Show from</span>
        <StartPicker value={start} onChange={setStart} today={today} />
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className="max-sm:h-11" disabled={pending || !text.trim()} onClick={save}>{pending ? "Saving…" : isLater(start, today) ? "Save" : "Save and show now"}</Button>
        <Button variant="ghost" className="max-sm:h-11" disabled={pending} onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

/** Read-only feed for staff. */
export function AnnouncementsFeed({ items }: { items: AnnouncementView[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-[0.95rem] font-semibold"><Megaphone className="size-4" strokeWidth={1.75} /> From the team</h2>
      <Card className="divide-y divide-border">
        {items.map((a) => (
          <div key={a.id} className="px-4 py-3 text-sm">
            <p className="whitespace-pre-line text-ink">{a.body}</p>
            <p className="mt-0.5 text-xs text-muted">{a.pinned ? "Pinned · " : ""}{a.author ?? "Manager"} · {when(a.shownAt)}</p>
          </div>
        ))}
      </Card>
    </section>
  );
}
