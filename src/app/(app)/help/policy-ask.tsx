"use client";

import { Button, Card, Input } from "@/components/ui";
import { askPolicy } from "@/server/actions/people";
import type { PolicyAnswer } from "@/server/services/documents";
import { FileText, Search } from "lucide-react";
import { useState, useTransition } from "react";

/**
 * "Ask about policies": answers only from uploaded documents. With the Claude
 * key it writes a short answer with sources; without it, it shows matching
 * passages. Either way it never makes a policy up.
 */
export function PolicyAsk({ examples = [], hasDocs }: { examples?: string[]; hasDocs: boolean }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<PolicyAnswer | { error: string } | null>(null);
  const [asked, setAsked] = useState("");
  const [pending, start] = useTransition();
  const ask = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setAsked(t);
    start(async () => setRes(await askPolicy(t)));
  };
  if (!hasDocs) return <Card className="p-4 text-sm text-muted">No policies have been uploaded yet. Ask a manager.</Card>;
  return (
    <Card className="p-4" data-tour="policy.ask">
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How long is my meal break?" aria-label="Question about policies" maxLength={500} enterKeyHint="search" />
        <Button variant="primary" disabled={pending || q.trim().length < 3} aria-label="Ask"><Search className="size-4" /><span className="hidden sm:inline">Ask</span></Button>
      </form>
      {!res && examples.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((e) => (
            <button key={e} type="button" onClick={() => { setQ(e); ask(e); }} className="h-9 rounded-full border border-border-strong px-3 text-xs text-ink-2 hover:bg-surface-2">{e}</button>
          ))}
        </div>
      )}
      <div aria-live="polite">
        {pending && <p className="mt-3 text-sm text-muted">Looking through the documents…</p>}
        {!pending && res && <Answer res={res} asked={asked} />}
      </div>
    </Card>
  );
}

function Answer({ res, asked }: { res: PolicyAnswer | { error: string }; asked: string }) {
  if ("error" in res && !("mode" in res)) return <p className="mt-3 text-sm text-bad">{res.error}</p>;
  const r = res as PolicyAnswer;
  const docLink = (id: string, title: string) => (
    <a href={`/my/documents/${id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline decoration-border-strong underline-offset-2 hover:decoration-ink">
      <FileText className="size-3.5" />{title}
    </a>
  );
  return (
    <div className="mt-4 space-y-3 text-sm">
      <div className="text-xs text-muted">“{asked}”</div>
      {r.answer ? (
        <>
          <p className="leading-relaxed">{r.answer}</p>
          <ul className="space-y-2">
            {r.citations.map((c, i) => (
              <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="text-xs">{docLink(c.docId, c.title)}</div>
                <div className="mt-1 text-xs text-ink-2">“{c.quote}”</div>
              </li>
            ))}
          </ul>
        </>
      ) : r.passages.length > 0 ? (
        <>
          <p className="text-muted">{r.mode === "claude" ? "The documents don't answer that directly. These parts mention it:" : "Here's what the documents say about that:"}</p>
          <ul className="space-y-2">
            {r.passages.map((p, i) => (
              <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="text-xs">{docLink(p.docId, p.title)}</div>
                <div className="mt-1 text-xs leading-relaxed text-ink-2">{p.snippet}</div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-muted">{r.searched === 0 ? "None of the uploaded documents have readable text yet." : "The uploaded documents don't cover that."} Ask a manager.</p>
      )}
      {r.error && <p className="text-xs text-muted">{r.error}</p>}
      <p className="text-xs text-muted">Answers come only from documents your managers uploaded. If something looks wrong, check with a manager.</p>
    </div>
  );
}
