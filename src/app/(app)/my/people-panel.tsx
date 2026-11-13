"use client";

import { Badge, Button, Card, cx } from "@/components/ui";
import { acknowledgeDocument } from "@/server/actions/people";
import type { MyPeople } from "@/server/services/people";
import { shortDate } from "@/lib/format";
import { Check, FileText } from "lucide-react";
import { useState, useTransition } from "react";

const KIND: Record<string, { label: string; tone: "good" | "warn" | "neutral" }> = {
  PRAISE: { label: "Kudos", tone: "good" },
  COACHING: { label: "Coaching", tone: "warn" },
  NOTE: { label: "Note", tone: "neutral" },
};

export function MyFeedback({ items }: { items: MyPeople["feedback"] }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-10" data-tour="my.feedback">
      <h2 className="mb-3 text-[0.95rem] font-semibold">From your managers</h2>
      <Card className="divide-y divide-border">
        {items.map((f) => (
          <div key={f.id} className="px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Badge tone={KIND[f.kind]?.tone ?? "neutral"}>{KIND[f.kind]?.label ?? "Note"}</Badge>
              {shortDate(f.createdAt.slice(0, 10))}{f.author ? ` · ${f.author}` : ""}
            </div>
            <p className="mt-1.5 text-sm whitespace-pre-wrap">{f.body}</p>
          </div>
        ))}
      </Card>
    </section>
  );
}

export function MyDocuments({ docs }: { docs: MyPeople["docs"] }) {
  if (docs.length === 0) return null;
  const todo = docs.filter((d) => d.requiresAck && !d.ackedAt).length;
  return (
    <section className="mb-10" data-tour="my.documents">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-[0.95rem] font-semibold">Documents</h2>
        {todo > 0 && <Badge tone="warn">{todo} to sign</Badge>}
      </div>
      <Card className="divide-y divide-border">
        {docs.map((d) => <DocRow key={d.id} d={d} />)}
      </Card>
    </section>
  );
}

function DocRow({ d }: { d: MyPeople["docs"][number] }) {
  const [ackedAt, setAckedAt] = useState(d.ackedAt);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <a href={`/my/documents/${d.id}`} target="_blank" rel="noreferrer" onClick={() => setOpened(true)} className="flex min-h-10 min-w-0 flex-1 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><FileText className="size-4" /></span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium underline-offset-2 hover:underline">{d.title}</span>
          <span className="block text-xs text-muted">{d.size < 1024 ? "<1" : (d.size / 1024).toFixed(0)} KB · tap to read</span>
        </span>
      </a>
      {d.requiresAck && (ackedAt ? (
        <span className="inline-flex items-center gap-1 text-xs text-good"><Check className="size-3.5" /> Signed {shortDate(ackedAt.slice(0, 10))}</span>
      ) : (
        <Button
          size="sm"
          variant={opened ? "primary" : "secondary"}
          className={cx("h-10 w-full sm:h-8 sm:w-auto")}
          disabled={pending}
          onClick={() => start(async () => { const r = await acknowledgeDocument(d.id); if (r.error) setError(r.error); else setAckedAt(r.ackedAt ?? new Date().toISOString()); })}
        >
          {pending ? "Saving…" : "I've read this"}
        </Button>
      ))}
      {error && <p className="w-full text-xs text-bad" role="alert">{error}</p>}
    </div>
  );
}
