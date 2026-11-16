"use client";

import { Checkbox } from "@/components/data-table";
import { Button, Card } from "@/components/ui";
import type { CountEveryRow } from "@/server/services/countSuggest";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyCountEvery } from "./suggest-actions";

const LABEL = { changes: "Only when it changes", monthly: "Monthly" } as const;
const SHOW = 5;

/** "Count these less often": items whose count history says they needn't be on every count. */
export function CountEverySuggestions({ rows }: { rows: CountEveryRow[] }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!rows.length) return null;
  const ticked = rows.filter((r) => !off.has(r.key));
  const shown = all ? rows : rows.slice(0, SHOW);
  const toggle = (k: string) => setOff((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  });
  return (
    <Card className="mb-5 p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[0.95rem] font-semibold"><Sparkles aria-hidden className="size-4 text-ink-2" /> Shorter counts: {rows.length} {rows.length === 1 ? "item doesn't" : "items don't"} need counting every time</div>
      <p className="mt-0.5 text-sm text-muted">Worked out from past counts. Untick any you still want on every count.</p>
      <ul className="mt-3 divide-y divide-border">
        {shown.map((r) => (
          <li key={r.key} className="flex items-center gap-3 py-2">
            <Checkbox checked={!off.has(r.key)} onChange={() => toggle(r.key)} label={`Count ${r.name}: ${LABEL[r.every]}`} />
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate font-medium text-ink">{r.name}</div>
              <div className="truncate text-xs text-muted">{LABEL[r.every]} · {r.why}</div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > SHOW && <Button size="sm" variant="ghost" className="mt-1 px-0 hover:bg-transparent" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length}`}</Button>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={pending || !ticked.length}
          onClick={() => start(async () => {
            const r = await applyCountEvery(ticked.map((x) => ({ key: x.key, every: x.every })));
            setMsg(r);
            if (!r.error) router.refresh();
          })}
        >
          {pending ? "Saving…" : `Apply to ${ticked.length}`}
        </Button>
        {msg && <span role="status" className={msg.error ? "text-sm text-bad" : "text-sm text-good"}>{msg.error ?? msg.message}</span>}
      </div>
    </Card>
  );
}
