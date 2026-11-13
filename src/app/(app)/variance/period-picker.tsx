"use client";

import { cx, Select } from "@/components/ui";
import { useRouter } from "next/navigation";

const GROUPS = [
  { value: "all", label: "All" },
  { value: "food", label: "Food" },
  { value: "beverage", label: "Beverage" },
] as const;

export function PeriodPicker({ points, start, end, group }: { points: { id: string; label: string }[]; start: string; end: string; group: string }) {
  const router = useRouter();
  const go = (s: string, e: string, g = group) => router.push(`/variance?start=${s}&end=${e}${g !== "all" ? `&group=${g}` : ""}`);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Select value={start} onChange={(e) => go(e.target.value, end)} className="min-w-0 flex-1 sm:w-60 sm:flex-none" aria-label="From count">
          {points.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
        <span className="text-muted">→</span>
        <Select value={end} onChange={(e) => go(start, e.target.value)} className="min-w-0 flex-1 sm:w-60 sm:flex-none" aria-label="To count">
          {points.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
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
