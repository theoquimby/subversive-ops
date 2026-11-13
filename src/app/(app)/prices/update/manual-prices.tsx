"use client";

import { HelpZone } from "@/components/help";
import { Button, Card, cx, DatePicker, EmptyState, Input } from "@/components/ui";
import { money, shortDate, signedPct } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveManualPrices } from "../actions";

interface Row { id: string; description: string; ingredient: string | null; unit: string; price: number | null; since: string | null }

export function ManualPrices({ rows, today }: { rows: Row[]; today: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const changed = rows
    .map((r) => ({ r, v: Number(values[r.id]) }))
    .filter(({ r, v }) => values[r.id] !== undefined && values[r.id] !== "" && Number.isFinite(v) && v >= 0 && (r.price == null || Math.abs(v - r.price) >= 0.005));

  if (rows.length === 0) return <EmptyState title="No products for this supplier">Products appear here once they're imported or added.</EmptyState>;

  return (
    <div className="pb-20">
      <HelpZone id="prices.manual.list"><Card className="divide-y divide-border">
        {rows.map((r) => {
          const v = values[r.id];
          const n = Number(v);
          const delta = v && r.price && Number.isFinite(n) ? (n - r.price) / r.price : null;
          return (
            <label key={r.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.ingredient ?? r.description}</div>
                <div className="truncate text-xs text-muted">{r.ingredient ? r.description : "Not linked"} · now {money(r.price)}/{r.unit}{r.since && ` since ${shortDate(r.since)}`}</div>
              </div>
              {delta != null && Math.abs(delta) >= 0.0005 && <span className={cx("num text-xs", delta > 0 ? "text-bad" : "text-good")}>{signedPct(delta)}</span>}
              <div className="relative w-28">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                <Input type="number" inputMode="decimal" step="0.01" min={0} placeholder={r.price?.toFixed(2) ?? "0.00"} value={v ?? ""} onChange={(e) => setValues((s) => ({ ...s, [r.id]: e.target.value }))} className="num h-10 pl-6 text-right text-base" />
              </div>
            </label>
          );
        })}
      </Card></HelpZone>
      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <HelpZone id="prices.manual.save" className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
          {msg && <span className="mr-auto text-sm text-good">{msg}</span>}
          <label className="flex items-center gap-2 text-sm text-muted">Effective <DatePicker value={date} onChange={(e) => setDate(e.target.value)} className="w-48" aria-label="Effective date" /></label>
          <Button
            variant="primary"
            disabled={pending || changed.length === 0}
            onClick={() => start(async () => {
              const res = await saveManualPrices(changed.map(({ r, v }) => ({ productId: r.id, price: v })), date);
              setValues({});
              setMsg(`Saved ${res.saved} price${res.saved === 1 ? "" : "s"}`);
              router.refresh();
            })}
          >
            {pending ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
          </Button>
        </HelpZone>
      </div>
    </div>
  );
}
