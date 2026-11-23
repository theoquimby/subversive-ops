"use client";

import { useConfirm } from "@/components/dialog";
import { Button, Card, cx, LinkButton } from "@/components/ui";
import { orderWarnings } from "@/domain/orderGuards";
import { money } from "@/lib/format";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveOrderForSending } from "../actions";

export interface GuidedLine {
  ingredientId: string;
  supplierProductId: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: number | null;
  suggested: number;
  runsOut: boolean;
  needsCount: boolean;
  usual: number | null;
  /** "On hand 3 case, need 9 by Fri". */
  why: string;
}

function Steps({ at }: { at: 1 | 2 | 3 }) {
  const steps = ["Check", "Send", "Done"];
  return (
    <ol className="mb-4 flex items-center gap-2 text-xs" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} aria-current={i + 1 === at ? "step" : undefined} className={cx("flex items-center gap-1.5", i + 1 === at ? "font-medium text-ink" : "text-muted")}>
          <span className={cx("flex size-5 items-center justify-center rounded-full border text-[0.7rem]", i + 1 <= at ? "border-ink bg-primary text-primary-ink" : "border-border-strong")}>{i + 1}</span>
          {s}
          {i < steps.length - 1 && <ChevronRight aria-hidden className="size-3.5 text-muted" />}
        </li>
      ))}
    </ol>
  );
}

/** A big − qty + for thumbs. */
function Qty({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-border-strong">
      <button type="button" className="h-12 w-12 text-lg text-ink-2 hover:bg-surface-2" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Less ${label}`}>−</button>
      <input inputMode="numeric" value={value} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} onFocus={(e) => e.target.select()} className="num h-12 w-14 border-x border-border bg-transparent text-center text-lg focus:outline-none" aria-label={`${label} quantity`} />
      <button type="button" className="h-12 w-12 text-lg text-ink-2 hover:bg-surface-2" onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>+</button>
    </div>
  );
}

function LineCard({ l, q, set }: { l: GuidedLine; q: number; set: (n: number) => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium text-ink">{l.name}</div>
        <div className={cx("text-sm", l.runsOut ? "text-bad" : "text-ink-2")}>{l.runsOut ? `Runs out before the truck. ${l.why}` : l.why}</div>
        <div className="text-xs text-muted">{l.description}{l.suggested > 0 && q !== l.suggested ? ` · suggested ${l.suggested}` : ""}</div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <Qty value={q} onChange={set} label={l.name} />
        <span className="text-xs text-muted">{l.unit}</span>
      </div>
    </li>
  );
}

export function GuidedOrder(p: { supplierId: string; supplierName: string; deliveryDate: string; coverUntil: string; minOrder: number | null; minsToCutoff: number | null; hasDraft: string | null; lines: GuidedLine[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [qtys, setQtys] = useState<Record<string, number>>(() => Object.fromEntries(p.lines.map((l) => [l.ingredientId, l.suggested])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const suggested = p.lines.filter((l) => l.suggested > 0 || l.runsOut);
  const others = p.lines.filter((l) => !(l.suggested > 0 || l.runsOut));
  const uncounted = others.filter((l) => l.needsCount).length;
  const set = (id: string) => (n: number) => setQtys((s) => ({ ...s, [id]: Math.max(0, n) }));
  const total = p.lines.reduce((s, l) => s + (qtys[l.ingredientId] ?? 0) * (l.unitPrice ?? 0), 0);
  const count = p.lines.filter((l) => (qtys[l.ingredientId] ?? 0) > 0).length;
  const warnings = useMemo(() => orderWarnings({ lines: p.lines.map((l) => ({ name: l.name, qty: qtys[l.ingredientId] ?? 0, usual: l.usual, unit: l.unit })), minsToCutoff: p.minsToCutoff }), [p.lines, p.minsToCutoff, qtys]);

  const next = async () => {
    const serious = warnings.filter((w) => w.kind !== "empty");
    if (count === 0) {
      setError("Nothing is on this order. Add at least one item, or go back if nothing is needed.");
      return;
    }
    if (serious.length && !(await confirm({ title: "Check before you send", body: <ul className="list-disc space-y-1 pl-4">{serious.map((w) => <li key={w.text}>{w.text}</li>)}</ul>, confirmLabel: "It's right, continue" }))) return;
    start(async () => {
      setError(null);
      const r = await saveOrderForSending({
        supplierId: p.supplierId,
        deliveryDate: p.deliveryDate,
        coverUntil: p.coverUntil,
        lines: p.lines.map((l) => ({ supplierProductId: l.supplierProductId, suggestedQty: l.suggested, qty: qtys[l.ingredientId] ?? 0, unitPrice: l.unitPrice })),
      });
      if (r.error || !r.id) setError(r.error ?? "Couldn't save it. Try again.");
      else router.push(`/my/ordering/order/${r.id}`);
    });
  };

  return (
    <div className="pb-32">
      <Steps at={1} />
      {p.hasDraft && (
        <Card className="mb-4 p-4 text-sm">
          A saved order for this delivery is waiting to be sent. <LinkButton href={`/my/ordering/order/${p.hasDraft}`} size="sm" className="ml-1 h-10 sm:h-8">Send the saved one</LinkButton>
          <span className="mt-1 block text-xs text-muted">Or check the numbers below: continuing replaces it.</span>
        </Card>
      )}
      {p.minsToCutoff != null && p.minsToCutoff <= 0 && <Card role="alert" className="mb-4 border-warn/30 bg-warn-bg p-4 text-sm text-warn">The cutoff for this delivery has passed. Call or text {p.supplierName} to check they can still take it.</Card>}

      <div className="mb-1 text-[0.8rem] font-medium text-ink-2">Suggested order</div>
      {suggested.length === 0 ? (
        <Card className="p-4 text-sm text-muted">Stock covers this delivery: nothing is suggested.{uncounted ? ` ${uncounted} item${uncounted === 1 ? " hasn't" : "s haven't"} been counted, so it can't tell for those.` : ""} Add items below if you know you need them.</Card>
      ) : (
        <Card className="overflow-hidden"><ul className="divide-y divide-border">{suggested.map((l) => <LineCard key={l.ingredientId} l={l} q={qtys[l.ingredientId] ?? 0} set={set(l.ingredientId)} />)}</ul></Card>
      )}

      {others.length > 0 && (
        <details className="group mt-4 rounded-xl border border-border bg-surface">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
            <span><span className="font-medium text-ink">Add something else</span><span className="text-muted"> · {others.length} more from {p.supplierName}</span></span>
            <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">{others.map((l) => <LineCard key={l.ingredientId} l={l} q={qtys[l.ingredientId] ?? 0} set={set(l.ingredientId)} />)}</ul>
        </details>
      )}

      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm">
            <span className="num font-semibold">{money(total)}</span>
            <span className="text-muted"> · {count} item{count === 1 ? "" : "s"}</span>
            {p.minOrder != null && total > 0 && total < p.minOrder && <span className="block text-xs text-warn">Under the {money(p.minOrder, { whole: true })} minimum</span>}
            {warnings.some((w) => w.kind === "far-above") && <span className="block text-xs text-warn">A quantity is far above usual</span>}
            {error && <span role="alert" className="block text-xs text-bad">{error}</span>}
          </div>
          <Button variant="primary" className="h-12 px-5 text-base" disabled={pending} onClick={() => void next()}>{pending ? "Saving…" : "Next: send it"}</Button>
        </div>
      </div>
    </div>
  );
}
