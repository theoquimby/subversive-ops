"use client";

import { cx, DatePicker } from "@/components/ui";
import { PERIODS, PeriodKind } from "@/domain/pnl";
import { useRouter } from "next/navigation";

export function PeriodSwitch({ period, from, to }: { period: PeriodKind; from: string; to: string }) {
  const router = useRouter();
  const go = (p: PeriodKind, f?: string, t?: string) => router.push(p === "custom" ? `/pnl?period=custom&from=${f ?? from}&to=${t ?? to}` : `/pnl?period=${p}`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Period" className="grid w-full grid-cols-3 gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5 sm:inline-flex sm:w-auto">
        {PERIODS.map((p) => (
          <button
            key={p.kind}
            role="tab"
            type="button"
            aria-selected={period === p.kind}
            onClick={() => go(p.kind)}
            className={cx(
              "h-10 shrink-0 rounded-md px-3 text-sm whitespace-nowrap transition-colors sm:h-8",
              period === p.kind ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 sm:w-44 sm:flex-none"><DatePicker value={from} max={to} onChange={(e) => go("custom", e.target.value, to)} aria-label="From" /></div>
          <span className="text-muted">→</span>
          <div className="min-w-0 flex-1 sm:w-44 sm:flex-none"><DatePicker value={to} min={from} onChange={(e) => go("custom", from, e.target.value)} aria-label="To" /></div>
        </div>
      )}
    </div>
  );
}
