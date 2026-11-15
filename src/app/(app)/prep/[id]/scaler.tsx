"use client";

import { Button, Card, LinkButton } from "@/components/ui";
import { amountText, formatPrepQty, friendlyAmount, type PrepUnit } from "@/domain/prep";
import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function RecipeScaler({ yieldQty, yieldUnit, batchBase, unit, step, initial, lines, notes, editHref }: {
  yieldQty: number;
  yieldUnit: string;
  batchBase: number;
  unit: PrepUnit;
  step: number;
  initial: number;
  lines: { qty: number; unit: string; name: string; subRecipeId: string | null }[];
  notes: string | null;
  editHref: string | null;
}) {
  const [make, setMake] = useState(initial);
  const factor = batchBase > 0 ? make / batchBase : 1;
  const sync = (v: number) => {
    setMake(v);
    // Keep the amount in the address so a reload (or a share) shows the same thing.
    const u = new URL(window.location.href);
    u.searchParams.set("make", String(Math.round(v * 100) / 100));
    window.history.replaceState(window.history.state, "", u.pathname + u.search);
  };
  return (
    <div className="space-y-6">
      <Card className="p-4" data-tour="prep.scale">
        <div className="text-xs font-medium text-ink-2">Making</div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="lg" className="w-12 px-0" aria-label="Less" disabled={make - step < step / 2} onClick={() => sync(Math.max(step, make - step))}><Minus className="size-4" /></Button>
          <div className="num min-w-0 flex-1 text-center text-lg font-semibold" aria-live="polite">{amountText(make, batchBase, unit)}</div>
          <Button size="lg" className="w-12 px-0" aria-label="More" onClick={() => sync(make + step)}><Plus className="size-4" /></Button>
        </div>
        <p className="mt-2 text-center text-xs text-muted">One batch is {batchBase > 0 ? formatPrepQty(batchBase, unit) : `${fmt(yieldQty)} ${yieldUnit}`}{batchBase > 0 && Math.abs(factor - 1) > 0.01 ? ` · everything × ${fmt(factor)}` : ""}</p>
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        {lines.length === 0 && <p className="p-4 text-sm text-muted">No ingredients on this recipe yet.</p>}
        {lines.map((l, i) => {
          const a = friendlyAmount(l.qty * factor, l.unit);
          const name = l.subRecipeId ? <Link className="underline decoration-border-strong underline-offset-2" href={`/prep/${l.subRecipeId}`}>{l.name}</Link> : l.name;
          return (
            <div key={i} className="flex items-baseline gap-3 px-4 py-3">
              <span className="num w-24 shrink-0 text-right text-[1.05rem] font-semibold text-ink sm:w-28">{fmt(a.qty)} <span className="text-sm font-normal text-ink-2">{a.unit}</span></span>
              <span className="min-w-0 flex-1 text-[0.95rem]">{name}</span>
            </div>
          );
        })}
      </Card>

      {notes?.trim() && (
        <Card className="p-4">
          <div className="mb-1 text-xs font-medium text-ink-2">Method</div>
          <p className="text-sm whitespace-pre-line text-ink">{notes}</p>
        </Card>
      )}
      {editHref && <LinkButton href={editHref} variant="ghost" className="h-10">Edit recipe on Menu costs</LinkButton>}
    </div>
  );
}
