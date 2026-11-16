"use client";

import { downloadText } from "@/components/data-table";
import { Select } from "@/components/select";
import { Button } from "@/components/ui";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setKegField } from "../actions";

/** Narrow the fill charts to one beer; the choice lives in the address so it survives a refresh. */
export function BeerPicker({ beers, value, range }: { beers: { id: string; name: string }[]; value: string | null; range: string }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Beer"
      className="w-56"
      value={value ?? ""}
      onChange={(e) => router.push(`/kegs/fleet?range=${range}${e.target.value ? `&beer=${e.target.value}` : ""}`, { scroll: false })}
      options={[{ value: "", label: "Every beer" }, ...beers.map((b) => ({ value: b.id, label: b.name }))]}
    />
  );
}

const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** The status by size grid as a CSV file. */
export function ExportGrid({ header, rows }: { header: string[]; rows: (string | number)[][] }) {
  return (
    <Button size="sm" className="h-10 sm:h-8" onClick={() => downloadText(`keg-fleet-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"))}>
      <Download className="size-4" /> Export
    </Button>
  );
}

/** Take a keg nobody can find off the boards. Its history stays; scanning it later brings it back from All kegs. */
export function RetireKeg({ id, code }: { id: string; code: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-bad">{error}</span>}
      <Button
        size="sm"
        variant="ghost"
        className="h-10 sm:h-8"
        disabled={pending}
        aria-label={`Retire keg ${code}`}
        onClick={() =>
          start(async () => {
            const r = await setKegField(id, "active", "false");
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Retiring…" : "Retire"}
      </Button>
    </span>
  );
}
