"use client";

import { useConfirm } from "@/components/dialog";
import { Switch } from "@/components/push-toggle";
import { Badge, Button, Card, cx, LinkButton, Textarea } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { Eye, EyeOff, MessageSquareText, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { addFeedback, deleteFeedback, setFeedbackVisible } from "./feedback-actions";

export type FeedbackKind = "PRAISE" | "COACHING" | "NOTE";
export const FEEDBACK_LABEL: Record<FeedbackKind, string> = { PRAISE: "Kudos", COACHING: "Coaching", NOTE: "Note" };
const KIND_TONE: Record<FeedbackKind, "good" | "warn" | "neutral"> = { PRAISE: "good", COACHING: "warn", NOTE: "neutral" };

export interface PersonRow {
  id: string;
  name: string;
  hasLogin: boolean;
  feedback: { id: string; kind: FeedbackKind; body: string; visible: boolean; author: string | null; createdAt: string }[];
  acks: { docId: string; title: string; ackedAt: string | null }[];
}

/** One row per person: latest note and sign-off progress. Tap opens their sheet. */
export function PeopleNotes({ people }: { people: PersonRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = people.find((p) => p.id === openId) ?? null;
  return (
    <>
      <Card className="divide-y divide-border" data-tour="team.people-notes">
        {people.map((p) => {
          const signed = p.acks.filter((a) => a.ackedAt).length;
          const last = p.feedback[0];
          return (
            <button key={p.id} type="button" onClick={() => setOpenId(p.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-2/60">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted">{last ? `${FEEDBACK_LABEL[last.kind]} · ${shortDate(last.createdAt.slice(0, 10))} · ${last.body}` : "No notes yet"}</span>
              </span>
              {p.acks.length > 0 && <Badge tone={signed === p.acks.length ? "good" : "warn"}>{signed}/{p.acks.length} signed</Badge>}
              <span className="num hidden w-16 text-right text-xs text-muted sm:block">{p.feedback.length} note{p.feedback.length === 1 ? "" : "s"}</span>
              <MessageSquareText className="size-4 shrink-0 text-muted" />
            </button>
          );
        })}
      </Card>
      {open && <PersonSheet person={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

function PersonSheet({ person: p, onClose }: { person: PersonRow; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const first = p.name.split(" ")[0];
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${p.name}: notes and documents`}>
      <div className="absolute inset-0 bg-black/20" onMouseDown={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={cx(
          "absolute flex flex-col overflow-hidden border-border bg-surface shadow-2xl outline-none",
          "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]",
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[28rem] sm:rounded-none sm:border-t-0 sm:border-l",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{p.name}</div>
            <div className="text-xs text-muted">Notes, kudos and documents</div>
          </div>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <FeedbackComposer employeeId={p.id} first={first} hasLogin={p.hasLogin} />
          <section>
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            {p.feedback.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
              <ul className="space-y-2">{p.feedback.map((f) => <FeedbackItem key={f.id} f={f} first={first} />)}</ul>
            )}
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Documents to sign</h3>
              <LinkButton href="/team/documents" size="sm" variant="ghost">Manage</LinkButton>
            </div>
            {p.acks.length === 0 ? <p className="text-sm text-muted">No documents need signing.</p> : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {p.acks.map((a) => (
                  <li key={a.docId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate">{a.title}</span>
                    {a.ackedAt ? <span className="shrink-0 text-xs text-good">Signed {shortDate(a.ackedAt.slice(0, 10))}</span> : <Badge tone="warn">Not yet</Badge>}
                  </li>
                ))}
              </ul>
            )}
            {!p.hasLogin && p.acks.length > 0 && <p className="mt-2 text-xs text-muted">{first} has no login yet, so they can&apos;t sign. Invite them from People above.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function FeedbackComposer({ employeeId, first, hasLogin }: { employeeId: string; first: string; hasLogin: boolean }) {
  const [kind, setKind] = useState<FeedbackKind>("PRAISE");
  const [body, setBody] = useState("");
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await addFeedback({ employeeId, kind, body, visible: hasLogin && visible });
      if (r.error) setError(r.error);
      else { setBody(""); setError(null); }
    });
  return (
    <section>
      <div className="mb-2 flex gap-1.5" role="radiogroup" aria-label="Kind of note">
        {(Object.keys(FEEDBACK_LABEL) as FeedbackKind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setVisible(k !== "NOTE"); }} className={cx("h-10 rounded-full border px-4 text-sm sm:h-8 sm:px-3", kind === k ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2")}>
            {FEEDBACK_LABEL[k]}
          </button>
        ))}
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) save(); }}
        rows={3}
        maxLength={2000}
        aria-label={`Note about ${first}`}
        placeholder={kind === "PRAISE" ? `What did ${first} do well?` : kind === "COACHING" ? "What to work on, and how" : "Private note for managers"}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className={cx("inline-flex items-center gap-1 text-sm", !hasLogin && "opacity-50")}>
          <Switch on={hasLogin && visible} onChange={setVisible} disabled={!hasLogin} label={`Share with ${first}`} />
          {hasLogin ? `Show ${first} on My shifts` : `${first} has no login`}
        </label>
        <Button variant="primary" disabled={pending || !body.trim()} onClick={save}>{pending ? "Saving…" : "Save note"}</Button>
      </div>
      {error && <p className="mt-1 text-sm text-bad" role="alert">{error}</p>}
    </section>
  );
}

function FeedbackItem({ f, first }: { f: PersonRow["feedback"][number]; first: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  return (
    <li className={cx("rounded-lg border border-border px-3 py-2.5", pending && "opacity-60")}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <Badge tone={KIND_TONE[f.kind]}>{FEEDBACK_LABEL[f.kind]}</Badge>
        <span>{shortDate(f.createdAt.slice(0, 10))}{f.author ? ` · ${f.author}` : ""}</span>
        <span className="ml-auto flex items-center">
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await setFeedbackVisible(f.id, !f.visible); })}
            aria-label={f.visible ? `Hide from ${first}` : `Share with ${first}`}
            title={f.visible ? `${first} can see this` : "Managers only"}
            className={cx("grid size-10 place-items-center rounded-md hover:bg-surface-2 sm:size-8", f.visible ? "text-ink" : "text-muted")}
          >
            {f.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
          <button
            type="button"
            disabled={pending}
            aria-label="Delete note"
            onClick={async () => {
              if (!(await confirm({ title: "Delete this note?", body: f.body.slice(0, 120), confirmLabel: "Delete", danger: true }))) return;
              start(async () => { await deleteFeedback(f.id); });
            }}
            className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </div>
      <p className="mt-1.5 text-sm whitespace-pre-wrap">{f.body}</p>
      <p className="mt-1 text-xs text-muted">{f.visible ? `Shared with ${first}` : "Managers only"}</p>
    </li>
  );
}
