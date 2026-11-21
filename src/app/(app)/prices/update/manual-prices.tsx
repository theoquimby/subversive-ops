"use client";

import { readDraft, useDraftStorage, useSaveShortcut, useUnsavedGuard } from "@/components/form-hooks";
import { HelpZone } from "@/components/help";
import { useToast } from "@/components/toast";
import { Button, Card, cx, DatePicker, EmptyState, Input } from "@/components/ui";
import { typedPrice } from "@/domain/manualPrice";
import { money, shortDate, signedPct } from "@/lib/format";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveManualPrices } from "../actions";

interface Row { id: string; description: string; ingredient: string | null; unit: string; price: number | null; since: string | null }

/** A price typed in a box, kept by product so switching supplier (or reloading) doesn't lose it. */
interface Typed { v: string; supplierId: string; was: number | null }

const DRAFT_KEY = "prices-update";

export function ManualPrices({ suppliers, supplierId, rows, today }: { suppliers: { id: string; name: string }[]; supplierId: string | undefined; rows: Row[]; today: string }) {
  const router = useRouter();
  const [toast, show] = useToast();
  const [typed, setTyped] = useState<Record<string, Typed>>({});
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [switching, startSwitch] = useTransition();

  // Prices typed earlier on this device come back (read before the draft below is first written).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const kept = readDraft<Record<string, Typed>>(DRAFT_KEY);
    if (kept && Object.keys(kept).length) {
      setTyped(kept);
      show(`Brought back ${Object.keys(kept).length} price${Object.keys(kept).length === 1 ? "" : "s"} you typed earlier`);
    }
  }, [show]);

  // Every typed box, across suppliers: a change, the same price, blank, or not a price.
  const entries = useMemo(() => Object.entries(typed).map(([id, t]) => ({ id, ...t, read: typedPrice(t.v, t.was) })), [typed]);
  const changes = entries.flatMap((e) => (e.read.kind === "change" ? [{ productId: e.id, price: e.read.price, supplierId: e.supplierId }] : []));
  const bad = entries.filter((e) => e.read.kind === "bad");
  const otherChanges = changes.filter((c) => c.supplierId !== supplierId).length;
  const pendingBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) if (e.read.kind === "change" || e.read.kind === "bad") m.set(e.supplierId, (m.get(e.supplierId) ?? 0) + 1);
    return m;
  }, [entries]);
  const unsaved = changes.length > 0 || bad.length > 0;
  useUnsavedGuard(unsaved, { title: "Leave without saving?", body: "Your typed prices aren't saved yet. They're kept on this device for a week, so you can come back to them." });
  useDraftStorage(DRAFT_KEY, typed, Object.keys(typed).length > 0);

  const setValue = (r: Row, v: string) => {
    setError(null);
    setTyped((cur) => {
      const next = { ...cur };
      if (v.trim() === "") delete next[r.id];
      else next[r.id] = { v, supplierId: supplierId ?? "", was: r.price };
      return next;
    });
  };

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.description} ${r.ingredient ?? ""}`.toLowerCase().includes(q)) : rows;

  const save = () => {
    if (bad.length) return setError(`${bad.length === 1 ? "One box isn't" : `${bad.length} boxes aren't`} a price. Fix ${bad.length === 1 ? "it" : "them"} or clear ${bad.length === 1 ? "it" : "them"}, then save.`);
    if (!changes.length) return;
    start(async () => {
      setError(null);
      const res = await saveManualPrices(changes.map(({ productId, price }) => ({ productId, price })), date);
      if (res.error) return setError(res.error);
      const done = new Set(changes.map((c) => c.productId));
      setTyped((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => !done.has(id))));
      show(`Saved ${res.saved} price${res.saved === 1 ? "" : "s"}${date !== today ? `, effective ${shortDate(date)}` : ""}`);
      router.refresh();
    });
  };
  useSaveShortcut(save, changes.length > 0 && !pending);

  return (
    <div className="pb-24">
      <HelpZone id="prices.manual.suppliers" className="mb-4 flex flex-wrap gap-2">
        {suppliers.map((s) => {
          const n = pendingBy.get(s.id) ?? 0;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === supplierId}
              disabled={switching}
              onClick={() => startSwitch(() => router.push(`/prices/update?supplier=${s.id}`, { scroll: false }))}
              className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm sm:min-h-8", s.id === supplierId ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}
            >
              {s.name}
              {n > 0 && <span className={cx("num rounded-full px-1.5 text-xs", s.id === supplierId ? "bg-primary-ink/20" : "bg-surface-2 text-ink")} aria-label={`${n} typed, not saved`}>{n}</span>}
            </button>
          );
        })}
      </HelpZone>

      {rows.length === 0 ? (
        <EmptyState title="No products for this supplier">Products appear here once they&apos;re imported or added. Any ingredient with no price yet can get one on its own page.</EmptyState>
      ) : (
        <>
          <div className="relative mb-3 max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${rows.length} product${rows.length === 1 ? "" : "s"}`} aria-label="Search products" className="pl-9" />
          </div>
          <HelpZone id="prices.manual.list"><Card className={cx("divide-y divide-border", switching && "opacity-60")}>
            {shown.map((r) => {
              const v = typed[r.id]?.v ?? "";
              const read = typedPrice(v, r.price);
              const delta = read.kind === "change" ? read.delta : null;
              return (
                <label key={r.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.ingredient ?? r.description}</div>
                    <div className="truncate text-xs text-muted">{r.ingredient ? r.description : "Not linked"} · now {money(r.price)}/{r.unit}{r.since && ` since ${shortDate(r.since)}`}</div>
                    {read.kind === "bad" && <div role="alert" className="text-xs font-medium text-bad">{read.error}. Type it like 12.50</div>}
                  </div>
                  {delta != null && Math.abs(delta) >= 0.0005 && <span className={cx("num text-xs", delta > 0 ? "text-bad" : "text-good")}>{signedPct(delta)}</span>}
                  <div className="relative w-28 shrink-0">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                    <Input inputMode="decimal" autoComplete="off" placeholder={r.price?.toFixed(2) ?? "0.00"} value={v} aria-invalid={read.kind === "bad" || undefined} onChange={(e) => setValue(r, e.target.value)} className={cx("num h-10 pl-6 text-right text-base", read.kind === "bad" && "border-bad")} aria-label={`New price for ${r.ingredient ?? r.description}, per ${r.unit}`} />
                  </div>
                </label>
              );
            })}
            {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">Nothing matches “{query}”.</p>}
          </Card></HelpZone>
        </>
      )}

      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <HelpZone id="prices.manual.save" className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
          <span role={error ? "alert" : undefined} className={cx("mr-auto min-w-0 text-sm", error ? "text-bad" : "text-muted")}>
            {error ?? (otherChanges ? `Includes ${otherChanges} for other suppliers` : unsaved ? "Not saved yet" : "")}
          </span>
          <label className="flex items-center gap-2 text-sm text-muted">Effective <DatePicker value={date} onChange={(e) => setDate(e.target.value)} className="w-48" aria-label="Effective date" /></label>
          <Button variant="primary" pending={pending} disabled={changes.length === 0} onClick={save}>
            {pending ? "Saving…" : changes.length ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}` : "No changes"}
          </Button>
        </HelpZone>
      </div>
      {toast}
    </div>
  );
}
