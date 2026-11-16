"use client";

import { HelpZone } from "@/components/help";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Textarea } from "@/components/ui";
import { Reply } from "lucide-react";
import { useState, useTransition } from "react";
import { markMessageRead, replyToMessage } from "../workforce-actions";

const KIND: Record<string, string> = { QUESTION: "Question", IDEA: "Idea", CONCERN: "Concern", OTHER: "Note" };

export function MessagesInbox({ items }: { items: { id: string; kind: string; body: string; from: string | null; read: boolean; reply: string | null; repliedBy: string | null; at: string }[] }) {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const run = (fn: () => Promise<{ error?: string; ok?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) show(r.error, "bad");
      else {
        show(r.ok ?? "Done");
        after?.();
      }
    });
  if (items.length === 0) return <Card className="px-4 py-6 text-center text-sm text-muted">No messages yet. Staff send them from Today → Message a manager.</Card>;
  return (
    <HelpZone id="team.messages.list">
      {toast}
      <Card className="divide-y divide-border">
        {items.map((m) => (
          <article key={m.id} className={cx("px-4 py-3.5", !m.read && "bg-warn-bg/25")}>
            <div className="flex items-start justify-between gap-3">
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <Badge tone={m.kind === "CONCERN" ? "warn" : "neutral"}>{KIND[m.kind] ?? "Note"}</Badge>
                <span className="font-medium text-ink-2">{m.from ?? "Name hidden"}</span> · {new Date(m.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {!m.read && <span className="font-medium text-warn">· new</span>}
              </p>
              {!m.reply && <Button size="sm" variant="ghost" className="shrink-0 max-sm:h-10" disabled={pending} onClick={() => run(() => markMessageRead(m.id, !m.read))}>{m.read ? "Mark unread" : "Mark read"}</Button>}
            </div>
            <p className="mt-1.5 text-[0.95rem] leading-snug whitespace-pre-line">{m.body}</p>
            {m.reply ? (
              <div className="mt-2.5 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
                <p className="whitespace-pre-line">{m.reply}</p>
                <p className="mt-1 text-xs text-muted">{m.repliedBy}</p>
              </div>
            ) : open === m.id ? (
              <div className="mt-2.5 flex flex-col gap-2">
                <Textarea aria-label="Reply" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={m.from ? `Reply to ${m.from.split(" ")[0]}` : "Reply (they'll see it on their phone)"} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" className="max-sm:h-11" onClick={() => setOpen(null)}>Cancel</Button>
                  <Button variant="primary" className="max-sm:h-11" disabled={pending || text.trim().length < 2} onClick={() => run(() => replyToMessage(m.id, text), () => { setOpen(null); setText(""); })}>Send reply</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" className="mt-2 max-sm:h-10" onClick={() => { setOpen(m.id); setText(""); }}><Reply className="size-3.5" aria-hidden /> Reply</Button>
            )}
          </article>
        ))}
      </Card>
    </HelpZone>
  );
}
