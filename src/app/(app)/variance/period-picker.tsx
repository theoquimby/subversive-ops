"use client";

import { Select } from "@/components/ui";
import { useRouter } from "next/navigation";

export function PeriodPicker({ points, start, end }: { points: { id: string; label: string }[]; start: string; end: string }) {
  const router = useRouter();
  const go = (s: string, e: string) => router.push(`/variance?start=${s}&end=${e}`);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Select value={start} onChange={(e) => go(e.target.value, end)} className="w-60" aria-label="From count">
        {points.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </Select>
      <span className="text-muted">→</span>
      <Select value={end} onChange={(e) => go(start, e.target.value)} className="w-60" aria-label="To count">
        {points.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </Select>
    </div>
  );
}
