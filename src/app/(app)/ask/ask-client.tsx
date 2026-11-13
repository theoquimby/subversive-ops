"use client";

import { Button, Card, cx, Input, LinkButton } from "@/components/ui";
import type { AskResponse, ToolResult } from "@/server/services/ask";
import { ArrowRight, Send } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { askQuestion, runSuggested } from "./actions";

interface Turn {
  id: number;
  question: string;
  res: AskResponse | null;
}

export function AskChat({ suggestions, claude }: { suggestions: string[]; claude: boolean }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, start] = useTransition();
  const nextId = useRef(1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns]);

  const run = (question: string, fn: () => Promise<AskResponse>) => {
    const id = nextId.current++;
    setTurns((t) => [...t, { id, question, res: null }]);
    start(async () => {
      const res = await fn();
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, res } : x)));
    });
  };
  const submit = () => {
    const text = q.trim();
    if (text.length < 3 || pending) return;
    setQ("");
    run(text, () => askQuestion(text));
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap gap-2" data-tour="ask.suggestions">
        {suggestions.map((s, i) => (
          <button key={s} type="button" disabled={pending} onClick={() => run(s, () => runSuggested(i))} className="min-h-10 rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-left text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50 sm:min-h-9">
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {turns.map((t) => (
          <div key={t.id}>
            <div className="mb-2 flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm text-primary-ink">{t.question}</div>
            </div>
            {t.res ? <Answer res={t.res} /> : <p className="text-sm text-muted">Looking it up…</p>}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className={cx("sticky bottom-[calc(var(--tabbar,0px)+0.75rem)] mt-6 flex gap-2 rounded-xl border border-border bg-surface/95 p-2 shadow-sm backdrop-blur lg:bottom-4")}
        data-tour="ask.input"
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={claude ? "Ask about sales, costs, labor, orders…" : "Ask, or tap a suggestion above"} aria-label="Your question" maxLength={500} enterKeyHint="send" className="border-0 focus:border-0" />
        <Button variant="primary" disabled={pending || q.trim().length < 3} aria-label="Ask"><Send className="size-4" /></Button>
      </form>
    </div>
  );
}

function Answer({ res }: { res: AskResponse }) {
  return (
    <div className="space-y-3">
      {res.answer && <p className="text-[0.95rem] leading-relaxed whitespace-pre-wrap">{res.answer}</p>}
      {res.error && <p className="text-sm text-muted">{res.error}</p>}
      {res.results.map((r, i) => <ResultCard key={i} r={r} />)}
    </div>
  );
}

function ResultCard({ r }: { r: ToolResult }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="text-sm font-semibold">{r.title}</div>
        <ul className="mt-1.5 space-y-1 text-sm text-ink-2">
          {r.facts.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      </div>
      {r.table && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {r.table.columns.map((c, i) => (
                  <th key={i} className={cx("border-b border-border px-4 py-2 text-[0.75rem] font-medium whitespace-nowrap text-muted", r.table!.align?.[i] === "right" ? "text-right" : "text-left", i > 2 && "hidden sm:table-cell")}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={cx("border-b border-border px-4 py-2 [tr:last-child_&]:border-b-0", r.table!.align?.[ci] === "right" ? "num text-right" : "text-left", ci > 2 && "hidden sm:table-cell")}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
          {r.links.map((l) => (
            <LinkButton key={l.href} href={l.href} size="sm" variant="ghost" className="max-sm:h-10">
              {l.label} <ArrowRight className="size-3.5" />
            </LinkButton>
          ))}
        </div>
      )}
    </Card>
  );
}
