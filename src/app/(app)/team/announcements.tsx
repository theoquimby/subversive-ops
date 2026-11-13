"use client";

/**
 * Announcements: managers post short notes from Team or Schedule; staff see
 * them at the top of My shifts. Pinned notes stay; others drop off after 30 days.
 */

import { useConfirm } from "@/components/dialog";
import { Button, Card, cx, Textarea } from "@/components/ui";
import { Megaphone, Pin, PinOff, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteAnnouncement, pinAnnouncement, postAnnouncement } from "./actions";

export interface AnnouncementView {
  id: string;
  body: string;
  author: string | null;
  pinned: boolean;
  createdAt: string; // ISO
}

// Business timezone so the server render and the browser agree.
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

export function AnnouncementsManager({ items }: { items: AnnouncementView[] }) {
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const post = () =>
    start(async () => {
      const r = await postAnnouncement(text);
      if (r.error) setError(r.error);
      else {
        setText("");
        setError(null);
      }
    });
  return (
    <Card>
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
        <Textarea
          aria-label="New announcement"
          placeholder="Post a note to the team: menu changes, a private event, who to call if you're running late…"
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } }}
          className="min-h-11 flex-1"
        />
        <Button variant="primary" className="shrink-0 max-sm:h-11" disabled={pending || !text.trim()} onClick={post}>
          <Megaphone className="size-3.5" /> {pending ? "Posting…" : "Post"}
        </Button>
      </div>
      {error && <p className="px-3 pb-2 text-sm text-bad">{error}</p>}
      {items.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {items.map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line text-ink">{a.body}</p>
                <p className="mt-0.5 text-xs text-muted">{a.pinned ? "Pinned · " : ""}{a.author ?? "Manager"} · {when(a.createdAt)}</p>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <button
                  type="button"
                  aria-label={a.pinned ? "Unpin" : "Pin"}
                  title={a.pinned ? "Unpin" : "Pin to the top"}
                  disabled={pending}
                  onClick={() => start(async () => { await pinAnnouncement(a.id, !a.pinned); })}
                  className={cx("grid size-10 place-items-center rounded-md hover:bg-surface-2 sm:size-8", a.pinned ? "text-ink" : "text-muted")}
                >
                  {a.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </button>
                <button
                  type="button"
                  aria-label="Delete announcement"
                  disabled={pending}
                  onClick={async () => {
                    if (await confirm({ title: "Delete this announcement?", confirmLabel: "Delete", danger: true })) start(async () => { await deleteAnnouncement(a.id); });
                  }}
                  className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
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
            <p className="mt-0.5 text-xs text-muted">{a.pinned ? "Pinned · " : ""}{a.author ?? "Manager"} · {when(a.createdAt)}</p>
          </div>
        ))}
      </Card>
    </section>
  );
}
