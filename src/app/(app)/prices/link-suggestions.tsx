"use client";

import { Checkbox } from "@/components/data-table";
import { Button, Card } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyLinkSuggestions } from "./actions";

export interface LinkSuggestionRow {
  productId: string;
  description: string;
  supplier: string;
  ingredientId: string;
  ingredient: string;
}

const SHOW = 6;

/**
 * Products with no ingredient yet whose name clearly matches one (e.g. "Chkn
 * Wing Jumbo" → Chicken wings). Every one is ticked; untick the wrong ones and
 * link the rest in one go.
 */
export function LinkSuggestions({ rows }: { rows: LinkSuggestionRow[] }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOW);
  const ticked = rows.filter((r) => !off.has(r.productId));
  const toggle = (id: string) => setOff((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <Card className="mb-6 p-4 sm:p-5">
      <div className="text-[0.95rem] font-semibold">We can link {rows.length} {rows.length === 1 ? "product" : "products"} to your ingredients</div>
      <p className="mt-0.5 text-sm text-muted">Matched by name. Untick any that are wrong, then link the rest — their prices then count toward plate costs.</p>
      <ul className="mt-3 divide-y divide-border">
        {shown.map((r) => (
          <li key={r.productId} className="flex items-center gap-3 py-2">
            <Checkbox checked={!off.has(r.productId)} onChange={() => toggle(r.productId)} label={`Link ${r.description} to ${r.ingredient}`} />
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate text-ink">{r.description} <span className="hidden text-xs text-muted sm:inline">· {r.supplier}</span></div>
              <div className="truncate text-ink-2"><span className="text-muted">→</span> <span className="font-medium">{r.ingredient}</span></div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > SHOW && (
        <Button size="sm" variant="ghost" className="mt-1 px-0 hover:bg-transparent" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length}`}</Button>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={pending || !ticked.length}
          onClick={() => start(async () => {
            const r = await applyLinkSuggestions(ticked.map((x) => ({ productId: x.productId, ingredientId: x.ingredientId })));
            setMsg(r);
            if (!r.error) router.refresh();
          })}
        >
          {pending ? "Linking…" : `Link ${ticked.length}`}
        </Button>
        {msg && <span role="status" className={msg.error ? "text-sm text-bad" : "text-sm text-good"}>{msg.error ?? msg.message}</span>}
      </div>
    </Card>
  );
}
