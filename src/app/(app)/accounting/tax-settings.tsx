"use client";

import { Field, Input, Select } from "@/components/ui";
import type { SalesTaxSettings } from "@/domain/monthEnd";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveTaxSetting } from "./actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const quarterName = (m: number) => [0, 3, 6, 9].map((o) => MONTHS[(m - 1 + o) % 12].slice(0, 3)).join(", ");

/** Rate, filing frequency and quarter months: settings with defaults, saved as you go. */
export function TaxSettings({ settings }: { settings: SalesTaxSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(String(Math.round(settings.rate * 100_000) / 1000));
  const [place, setPlace] = useState(settings.jurisdiction);
  const save = (input: { field: string; value: unknown }) =>
    start(async () => {
      const r = await saveTaxSetting(input);
      setError(r.error ?? null);
      if (!r.error) router.refresh();
    });
  const saveRate = () => {
    const n = Number(rate.replace(/%/g, "").trim());
    if (!Number.isFinite(n) || Math.abs(n / 100 - settings.rate) < 1e-9) return;
    save({ field: "rate", value: n / 100 });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy={pending}>
      <Field label="Combined rate (%)">
        <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={saveRate} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} aria-label="Combined sales tax rate in percent" />
      </Field>
      <Field label="Where it applies">
        <Input value={place} onChange={(e) => setPlace(e.target.value)} onBlur={() => place.trim() !== settings.jurisdiction && save({ field: "jurisdiction", value: place })} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      </Field>
      <Field label="You file">
        <Select
          value={settings.filing}
          options={[
            { value: "quarterly", label: "Quarterly" },
            { value: "monthly", label: "Monthly" },
            { value: "annual", label: "Annually" },
          ]}
          onChange={(e) => save({ field: "filing", value: e.target.value })}
        />
      </Field>
      <Field label="Quarters start in">
        <Select value={String(settings.quarterStartMonth)} options={[3, 1, 2].map((m) => ({ value: String(m), label: MONTHS[m - 1], hint: quarterName(m) }))} onChange={(e) => save({ field: "quarterStartMonth", value: Number(e.target.value) })} />
      </Field>
      {error && <p role="alert" className="text-sm text-bad sm:col-span-2 lg:col-span-4">{error}</p>}
    </div>
  );
}
