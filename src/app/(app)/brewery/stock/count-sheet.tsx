"use client";

import { useToast } from "@/components/toast";
import { Button, Card, cx, EmptyState, Field, Input, LinkButton, Select } from "@/components/ui";
import { BREWING_CATEGORIES } from "@/domain/brewRecipes";
import { fuzzyFilter } from "@/domain/search";
import { qty } from "@/lib/format";
import type { BrewStockRow } from "@/server/services/brewStock";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { readDraft, useDraftStorage, useUnsavedGuard } from "@/components/form-hooks";
import { parseAmount } from "@/lib/amount";
import { saveCountsAction, saveReceivedAction } from "./actions";

type Draft = Record<string, { amount: string; unit: string }>;
/** Blank is "not typed"; anything else is a number ("2", "1.5", "1,5", "1 1/2", "1,200") or NaN. */
const parse = (s: string) => (s.trim() === "" ? null : parseAmount(s.trim().replace(/^(\d+),(\d{1,2})$/, "$1.$2")) ?? NaN);
const hasAmounts = (d: Draft) => Object.values(d).some((x) => x.amount.trim() !== "");

/**
 * The whole brewing shelf on one list, for a phone: type what's there (a count)
 * or what came in (a delivery) in any unit that fits, then save once. Blank
 * rows are left alone. What's typed is kept on this device (a reload, a closed
 * tab or lost signal doesn't lose it) until it's saved.
 */
export function CountSheet({ rows, mode, suppliers = [] }: { rows: BrewStockRow[]; mode: "count" | "received"; suppliers?: string[] }) {
  const router = useRouter();
  const [toast, show] = useToast();
  const key = `brewery.stock.${mode}`;
  const [draft, setDraft] = useState<Draft>({});
  const [q, setQ] = useState("");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const kept = readDraft<{ draft: Draft; note?: string }>(key);
    if (kept?.draft && typeof kept.draft === "object") {
      setDraft(kept.draft);
      if (kept.note) setNote(kept.note);
      if (hasAmounts(kept.draft)) show("Your typed amounts from before are back.", "good");
    }
    setReady(true);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const kept = useMemo(() => ({ draft, note }), [draft, note]);
  // Not until the kept draft is read back, so the first render can't wipe it.
  useDraftStorage(ready ? key : `${key}:loading`, kept, hasAmounts(draft));
  useUnsavedGuard(hasAmounts(draft) && !pending, { body: "What you've typed isn't saved yet. It stays on this device, so you can come back to it." });
  const update = (next: Draft) => setDraft(next);

  const shown = useMemo(() => {
    const bySupplier = supplier ? rows.filter((r) => (r.supplier ?? "") === supplier) : rows;
    return q.trim() ? fuzzyFilter(bySupplier, q, (r) => `${r.name} ${r.category}`, 1000) : bySupplier;
  }, [rows, q, supplier]);
  const entries = Object.entries(draft)
    .map(([ingredientId, d]) => ({ ingredientId, qty: parse(d.amount), unit: d.unit }))
    .filter((e): e is { ingredientId: string; qty: number; unit: string } => e.qty != null && rows.some((r) => r.id === e.ingredientId));
  const bad = entries.some((e) => !Number.isFinite(e.qty) || e.qty < 0);

  const save = () => start(async () => {
    setErrors({});
    const r = await (mode === "count" ? saveCountsAction(entries) : saveReceivedAction(entries, note.trim() || null)).catch(() => null);
    if (!r) {
      show(mode === "count"
        ? "No connection, so the count isn't saved. Your numbers are kept on this device. Save again when you have signal."
        : "No connection, so nothing was added. Your numbers are kept on this device. Check the stock page before saving again, in case it went through.", "bad");
      return;
    }
    if (r.errors?.length) {
      setErrors(Object.fromEntries(r.errors.map((e) => [e.ingredientId, e.error])));
      const keep = Object.fromEntries(Object.entries(draft).filter(([id]) => r.errors!.some((e) => e.ingredientId === id)));
      update(keep);
      show(r.error ?? "Some amounts need a look.", "bad");
      router.refresh();
      return;
    }
    if (r.error) { show(r.error, "bad"); return; }
    update({});
    try { localStorage.removeItem(`draft:${key}`); } catch { /* not kept */ }
    show(r.ok ?? "Saved.", "good");
    router.push("/brewery/stock");
    router.refresh();
  });

  if (!rows.length) {
    return (
      <EmptyState title="No brewing ingredients yet" action={<LinkButton href="/brewery/stock">Add one</LinkButton>}>
        Add malt, hops and yeast on the stock page first, or move them over from the kitchen side.
      </EmptyState>
    );
  }

  const cats = [...BREWING_CATEGORIES, ...new Set(rows.map((r) => r.category).filter((c) => !BREWING_CATEGORIES.includes(c)))];
  return (
    <div>
      {toast}
      <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an ingredient" aria-label="Find an ingredient" className="pl-9" />
        </div>
        {mode === "received" && suppliers.length > 0 && (
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value)} options={[{ value: "", label: "Every supplier" }, ...suppliers.map((s) => ({ value: s, label: s }))]} aria-label="Only this supplier's ingredients" className="sm:w-56" />
        )}
      </div>
      {mode === "received" && (
        <Field label="Note (optional)" className="mb-5 max-w-md">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hudson Valley Malt, invoice 1234" maxLength={200} />
        </Field>
      )}
      <div className="space-y-6">
        {cats.map((cat) => {
          const list = shown.filter((r) => r.category === cat);
          if (!list.length) return null;
          return (
            <section key={cat} aria-label={cat}>
              <h2 className="mb-2 text-[0.95rem] font-semibold text-ink">{cat}</h2>
              <Card className="divide-y divide-border">
                {list.map((r) => {
                  const d = draft[r.id] ?? { amount: "", unit: r.unit };
                  const n = parse(d.amount);
                  const wrong = n != null && (!Number.isFinite(n) || n < 0);
                  return (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{r.name}</div>
                        <div className={cx("truncate text-xs", errors[r.id] || wrong ? "text-bad" : "text-muted")}>
                          {errors[r.id] ?? (wrong ? "Type a number" : mode === "count" ? (r.counted || r.onHandBase !== 0 ? `Expect about ${qty(r.onHand, 1)} ${r.unit}` : "Never counted") : r.supplier ?? "")}
                        </div>
                      </div>
                      <Input
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        data-stock-input
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-stock-input]"));
                          const next = all[all.indexOf(e.currentTarget) + 1];
                          if (next) { next.focus(); next.scrollIntoView({ block: "center", behavior: "smooth" }); } else e.currentTarget.blur();
                        }}
                        value={d.amount}
                        onChange={(e) => update({ ...draft, [r.id]: { ...d, amount: e.target.value } })}
                        aria-label={`${r.name}, ${mode === "count" ? "amount on the shelf" : "amount received"}`}
                        placeholder="—"
                        className={cx("w-20 text-right sm:w-24", wrong && "border-bad")}
                      />
                      <Select value={d.unit} onChange={(e) => update({ ...draft, [r.id]: { ...d, unit: e.target.value } })} options={r.units.map((u) => ({ value: u, label: u }))} aria-label={`${r.name} unit`} className="w-[4.75rem] sm:w-24" />
                    </div>
                  );
                })}
              </Card>
            </section>
          );
        })}
        {!shown.length && <p className="text-sm text-muted">Nothing matches.</p>}
      </div>
      <div className="sticky bottom-[calc(var(--tabbar,0px)+0.75rem)] z-20 mt-6 rounded-xl border border-border bg-surface/95 p-2 pl-4 shadow-sm backdrop-blur lg:bottom-4">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-sm text-muted">{entries.length ? `${entries.length} typed in` : mode === "count" ? "Type what's on the shelf. Blank rows stay as they are." : "Type what came in."}</span>
          <Button variant="primary" size="lg" disabled={pending || !entries.length || bad} onClick={save}>
            {pending ? "Saving…" : mode === "count" ? "Save count" : "Add to stock"}
          </Button>
        </div>
      </div>
    </div>
  );
}
