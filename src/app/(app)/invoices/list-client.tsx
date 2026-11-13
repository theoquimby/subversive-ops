"use client";

import { GridCell } from "@/components/grid";
import { Select } from "@/components/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { saveTolerance } from "./actions";

export function InvoiceFilters({ status, supplier, statuses, suppliers }: { status: string; supplier: string; statuses: { value: string; label: string }[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return (
    <div className="flex gap-2">
      <Select aria-label="Status" value={status} onChange={(e) => set("status", e.target.value)} options={[{ value: "", label: "Any status" }, ...statuses]} className="w-36 sm:w-40" />
      {suppliers.length > 1 && (
        <Select aria-label="Supplier" value={supplier} onChange={(e) => set("supplier", e.target.value)} options={[{ value: "", label: "All suppliers" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} className="w-36 sm:w-48" />
      )}
    </div>
  );
}

export function ToleranceCells({ price, qty }: { price: number; qty: number }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <label className="block">
        <span className="text-xs text-muted">Price</span>
        <GridCell grid="tolerance" col="price" type="number" align="left" prefix="$" decimals={2} value={price} ariaLabel="Price tolerance in dollars" onSave={(v) => saveTolerance("price", v)} className="-ml-2" />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Quantity</span>
        <GridCell grid="tolerance" col="qty" type="number" align="left" value={qty} ariaLabel="Quantity tolerance" onSave={(v) => saveTolerance("qty", v)} className="-ml-2" />
      </label>
    </div>
  );
}
