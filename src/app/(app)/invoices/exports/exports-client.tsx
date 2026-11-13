"use client";

import { GridCell } from "@/components/grid";
import { DatePicker } from "@/components/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { saveAccountField, saveSalesTaxRate } from "../actions";

export function RangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const go = (k: "from" | "to", v: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set(k, v);
    router.push(`?${q.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-nowrap items-center gap-2 text-sm">
      <DatePicker value={from} onChange={(e) => go("from", e.target.value)} aria-label="From" className="w-36 sm:w-44" />
      <span className="text-muted">to</span>
      <DatePicker value={to} onChange={(e) => go("to", e.target.value)} aria-label="To" className="w-36 sm:w-44" />
    </div>
  );
}

type Field = Parameters<typeof saveAccountField>[0];

export function AccountCell({ field, value, placeholder, label }: { field: Field; value: string; placeholder?: string; label: string }) {
  return <GridCell grid="accounts" col="account" value={value} placeholder={placeholder} onSave={(v) => saveAccountField(field, v)} ariaLabel={label} />;
}

export function TermsCell({ value }: { value: number }) {
  return <GridCell grid="accounts-misc" col="v" type="number" align="left" value={value} onSave={(v) => saveAccountField("termsDays", v)} ariaLabel="Payment terms in days" />;
}

export function TaxRateCell({ value }: { value: number | null }) {
  return <GridCell grid="accounts-misc" col="v" type="number" align="left" decimals={3} value={value == null ? null : Math.round(value * 100000) / 1000} placeholder="Not set" onSave={saveSalesTaxRate} ariaLabel="Sales tax rate" />;
}
