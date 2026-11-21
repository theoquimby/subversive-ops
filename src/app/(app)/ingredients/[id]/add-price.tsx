"use client";

import { Button, Combobox, Field, Input, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addHandPrice } from "../actions";

type FieldName = "supplier" | "what" | "size" | "sizeUnit" | "price" | "per";

/**
 * For an ingredient with nothing linked yet: say where you buy it, what you
 * buy and what it costs, and it's costed straight away. No price sheet needed.
 */
export function AddPrice({ ingredientId, name, units, defaultUnit, suppliers }: { ingredientId: string; name: string; units: string[]; defaultUnit: string; suppliers: string[] }) {
  const router = useRouter();
  const [toast, show] = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ text: string; field?: FieldName } | null>(null);
  const [unit, setUnit] = useState(defaultUnit);
  const err = (f: FieldName) => (error?.field === f ? error.text : undefined);

  const submit = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const get = (k: FieldName) => String(fd.get(k) ?? "");
    start(async () => {
      const r = await addHandPrice(ingredientId, { supplier: get("supplier"), what: get("what"), size: get("size"), sizeUnit: unit, price: get("price"), per: get("per") });
      if (r.error) return setError({ text: r.error, field: r.field as FieldName | undefined });
      setError(null);
      show(r.message ?? "Price added");
      router.refresh();
    });
  };

  return (
    <form id="add-price" className="scroll-mt-24 space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }} noValidate>
      <div>
        <h3 className="text-sm font-semibold">Add a price</h3>
        <p className="mt-0.5 text-sm text-muted">Where you buy {name}, what you buy and what it costs. Recipes cost from it straight away. Or link a product from a price sheet on <Link href="/prices?filter=unlinked" className="text-ink underline underline-offset-2">Prices</Link>.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier" hint="Pick one, or type a new name" error={err("supplier")}>
          <Combobox name="supplier" suggestions={suppliers} placeholder="e.g. Price Chopper" aria-label="Supplier" />
        </Field>
        <Field label="What you buy" hint="As it says on the label. Optional." error={err("what")}>
          <Input name="what" placeholder="e.g. 50 lb bag" autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How much is in one" error={err("size") ?? err("sizeUnit")}>
          <div className="flex gap-2">
            <Input name="size" inputMode="decimal" placeholder="50" className="num min-w-0 flex-1 text-right" aria-label="Amount in one" autoComplete="off" />
            <Select value={unit} onChange={(e) => setUnit(e.target.value)} options={units.map((u) => ({ value: u, label: u }))} className="w-28 shrink-0" aria-label="Unit" />
          </div>
        </Field>
        <Field label="Price" error={err("price") ?? err("per")}>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
              <Input name="price" inputMode="decimal" placeholder="42.50" className="num pl-6 text-right" aria-label="Price" autoComplete="off" />
            </div>
            <span className="shrink-0 text-sm text-muted">per</span>
            <Input name="per" defaultValue="case" className="w-24 shrink-0" aria-label="Price per (case, bag…)" autoComplete="off" />
          </div>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" pending={pending}>{pending ? "Adding…" : "Add price"}</Button>
        {error && !error.field && <span role="alert" className="text-sm text-bad">{error.text}</span>}
      </div>
      {toast}
    </form>
  );
}
