"use client";

import { cx, Select } from "@/components/ui";
import { useRouter } from "next/navigation";

const GROUPS = [
  { value: "all", label: "All" },
  { value: "food", label: "Food" },
  { value: "beverage", label: "Beverage" },
] as const;

export function PeriodPicker({ points, start, end, group }: { points: { id: string; label: string; hint?: string }[]; start: string; end: string; group: string }) {
  const router = useRouter();
  const go = (s: string, e: string, g = group) => router.push(`/variance?start=${s}&end=${e}${g !== "all" ? `&group=${g}` : ""}`);
  const options = points.map((p) => ({ value: p.id, label: p.label, hint: p.hint }));
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-muted">From count</span>
          <Select value={start} onChange={(e) => go(e.target.value, end)} options={options} className="w-full sm:w-52" aria-label="From count" />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-muted">To count</span>
          <Select value={end} onChange={(e) => go(start, e.target.value)} options={options} className="w-full sm:w-52" aria-label="To count" />
        </label>
      </div>
      <div role="tablist" aria-label="Food or beverage" className="grid w-full grid-cols-3 gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5 sm:ml-2 sm:inline-flex sm:w-auto">
        {GROUPS.map((g) => (
          <button
            key={g.value}
            role="tab"
            type="button"
            aria-selected={group === g.value}
            onClick={() => go(start, end, g.value)}
            className={cx("h-10 rounded-md px-3 text-sm whitespace-nowrap transition-colors sm:h-8", group === g.value ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}
