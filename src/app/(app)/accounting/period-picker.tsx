"use client";

import { cx, DatePicker, Select } from "@/components/ui";
import type { CloseKind } from "@/domain/monthEnd";
import { useRouter } from "next/navigation";

const KINDS: { kind: CloseKind; label: string }[] = [
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Tax quarter" },
  { kind: "custom", label: "Custom" },
];

/** Month / sales-tax quarter / custom range, kept in the URL so the page and the pack agree. */
export function PeriodPicker({ kind, from, to, months, quarters }: { kind: CloseKind; from: string; to: string; months: { value: string; label: string }[]; quarters: { value: string; label: string }[] }) {
  const router = useRouter();
  const go = (q: Record<string, string>) => router.push(`/accounting?${new URLSearchParams(q)}`);
  const pick = (k: CloseKind) => {
    if (k === "month") go({ period: "month", month: months.find((m) => m.value <= from.slice(0, 7))?.value ?? months[1]?.value ?? months[0].value });
    else if (k === "quarter") go({ period: "quarter", quarter: quarters.find((q) => q.value <= from)?.value ?? quarters[1]?.value ?? quarters[0].value });
    else go({ period: "custom", from, to });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-tour="accounting.period">
      <div role="tablist" aria-label="Period" className="grid w-full grid-cols-3 gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5 sm:inline-flex sm:w-auto">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            role="tab"
            type="button"
            aria-selected={kind === k.kind}
            onClick={() => pick(k.kind)}
            className={cx("h-10 shrink-0 rounded-md px-3 text-sm whitespace-nowrap transition-colors sm:h-8", kind === k.kind ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
          >
            {k.label}
          </button>
        ))}
      </div>
      {kind === "month" && (
        <div className="w-full sm:w-48">
          <Select aria-label="Month" value={from.slice(0, 7)} options={months} onChange={(e) => go({ period: "month", month: e.target.value })} />
        </div>
      )}
      {kind === "quarter" && (
        <div className="w-full sm:w-60">
          <Select aria-label="Quarter" value={from} options={quarters} onChange={(e) => go({ period: "quarter", quarter: e.target.value })} />
        </div>
      )}
      {kind === "custom" && (
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 sm:w-44 sm:flex-none"><DatePicker value={from} max={to} onChange={(e) => go({ period: "custom", from: e.target.value, to })} aria-label="From" /></div>
          <span className="text-muted">→</span>
          <div className="min-w-0 flex-1 sm:w-44 sm:flex-none"><DatePicker value={to} min={from} onChange={(e) => go({ period: "custom", from, to: e.target.value })} aria-label="To" /></div>
        </div>
      )}
    </div>
  );
}
