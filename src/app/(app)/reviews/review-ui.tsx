"use client";

import { Button, Select, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/dialog";
import clsx from "clsx";
import { Check, ClipboardPaste, Copy, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteReview, importGoogle, importPasted, redraft, saveReplyDraft, setReplied } from "./actions";

const SOURCES = [
  { value: "GOOGLE", label: "Google" },
  { value: "YELP", label: "Yelp" },
  { value: "TRIPADVISOR", label: "TripAdvisor" },
  { value: "MANUAL", label: "Other / not sure" },
];

const EXAMPLE = `Dana K.
★★★★★ 2 weeks ago
Best hazy IPA in the Catskills, and the dog got a treat too.

Mark R.
2 stars · Oct 18, 2026
Waited 50 minutes for a burger on Saturday night.`;

/** Header actions: paste reviews (opens a sheet) and import from Google. */
export function ImportActions({ googleReady, googleHint }: { googleReady: boolean; googleHint: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  return (
    <>
      {msg && <span className={clsx("text-sm", msg.tone === "good" ? "text-good" : "text-bad")}>{msg.text}</span>}
      <Button
        variant="secondary"
        disabled={!googleReady || pending}
        title={googleReady ? "Fetch the latest Google reviews" : googleHint}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await importGoogle();
            if ("error" in r && r.error) setMsg({ tone: "bad", text: r.error });
            else if ("added" in r) setMsg({ tone: "good", text: r.added ? `${r.added} new from Google` : "No new Google reviews" });
          })
        }
      >
        <RefreshCw className={clsx("size-4", pending && "animate-spin")} strokeWidth={1.75} />
        {pending ? "Checking Google…" : "Import from Google"}
      </Button>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <ClipboardPaste className="size-4" strokeWidth={1.75} />
        Paste reviews
      </Button>
      {open && <PasteSheet onClose={(text) => { setOpen(false); if (text) setMsg({ tone: "good", text }); }} />}
    </>
  );
}

function PasteSheet({ onClose }: { onClose: (msg?: string) => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState("GOOGLE");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await importPasted({ text, source: source as "GOOGLE" });
      if ("error" in r && r.error) setError(r.error);
      else if ("added" in r) onClose(`${r.added} review${r.added === 1 ? "" : "s"} added${r.skipped ? ` · ${r.skipped} already here` : ""}`);
    });
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={() => onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Paste reviews" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="text-base font-semibold">Paste reviews</div>
            <p className="mt-0.5 text-sm text-muted">Copy reviews from Google, Yelp or TripAdvisor and paste them here. Leave a blank line between reviews — names, stars and dates are picked up where they appear.</p>
          </div>
          <button onClick={() => onClose()} className="-mr-2 rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} className="min-h-64 font-mono text-[13px] leading-relaxed sm:text-[13px]" aria-label="Reviews text" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-2">Mostly from</span>
            <Select value={source} onChange={(e) => setSource(e.target.value)} options={SOURCES} className="w-44" aria-label="Source" />
          </div>
          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
          <Button variant="primary" disabled={pending || !text.trim()} onClick={submit}>
            {pending ? "Reading reviews…" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Reply draft (autosaves), copy, mark replied, redraft. */
export function ReplyBox({ id, draft, replied, compact }: { id: string; draft: string | null; replied: boolean; compact?: boolean }) {
  const [text, setText] = useState(draft ?? "");
  const saved = useRef(draft ?? "");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [redrafting, startRedraft] = useTransition();
  const confirm = useConfirm();
  useEffect(() => {
    setText(draft ?? "");
    saved.current = draft ?? "";
  }, [draft]);

  const save = () => {
    if (text === saved.current) return;
    saved.current = text;
    start(async () => { await saveReplyDraft(id, text); });
  };

  return (
    <div className={clsx(compact ? "mt-3" : "mt-4")}>
      {!replied && (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          rows={compact ? 3 : 4}
          aria-label="Reply draft"
          placeholder="Write a reply…"
          className="bg-surface-2/40 leading-relaxed"
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!replied && (
          <Button
            size="sm"
            variant="secondary"
            className="h-10 sm:h-8"
            disabled={!text.trim()}
            onClick={async () => {
              save();
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked: the text is still selectable */
              }
            }}
          >
            {copied ? <Check className="size-3.5 text-good" strokeWidth={2.5} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
            {copied ? "Copied" : "Copy reply"}
          </Button>
        )}
        <Button size="sm" variant={replied ? "ghost" : "primary"} className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => { save(); await setReplied(id, !replied); })}>
          {replied ? "Mark not replied" : "Mark replied"}
        </Button>
        {!replied && (
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" disabled={redrafting} onClick={() => startRedraft(async () => { await redraft(id); })}>
            <RefreshCw className={clsx("size-3.5", redrafting && "animate-spin")} strokeWidth={1.75} />
            {redrafting ? "Drafting…" : "Redraft"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-10 text-muted sm:h-8"
          aria-label="Delete review"
          onClick={async () => {
            if (await confirm({ title: "Delete this review?", body: "It's removed from Subversive Ops only, not from the review site.", confirmLabel: "Delete", danger: true })) start(async () => { await deleteReview(id); });
          }}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}
