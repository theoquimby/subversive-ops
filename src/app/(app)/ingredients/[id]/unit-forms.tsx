"use client";

import { useConfirm } from "@/components/dialog";
import { HelpTip } from "@/components/help";
import { Badge, Button, Input, Select } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { addConversion, removeConversion, setPackSize, setPreferredProduct, unlinkProduct } from "../actions";

/** "1 case = 50 lb" for one supplier product, with Use for cost and Unlink. Says what's wrong instead of doing nothing. */
export function PackForm({ ingredientId, productId, purchaseUnit, amount, defaultUnit, units, hasPack, isPreferred }: { ingredientId: string; productId: string; purchaseUnit: string; amount: number | null; defaultUnit: string; units: string[]; hasPack: boolean; isPreferred: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const run = (fn: () => Promise<{ error?: string } | void>) => start(async () => {
    setSaved(false);
    const r = await fn();
    if (r && r.error) return setError(r.error);
    setError(null);
    router.refresh();
  });
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => { const r = await setPackSize(productId, fd); if (!r.error) setSaved(true); return r; }); }}
      noValidate
    >
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <span className="text-muted">1</span>
        <Input name="purchaseUnit" defaultValue={purchaseUnit} className="h-10 min-w-0 flex-1 sm:h-8 sm:w-20 sm:flex-none" aria-label="Purchase unit" />
        <span className="text-muted">=</span>
        <Input name="amount" inputMode="decimal" defaultValue={amount ?? ""} placeholder="?" onChange={() => setSaved(false)} className="num h-10 min-w-0 flex-1 text-right sm:h-8 sm:w-24 sm:flex-none" aria-label="Pack amount" aria-invalid={!!error || undefined} autoComplete="off" />
        <Select name="unit" defaultValue={defaultUnit} className="h-10 w-24 shrink-0 sm:h-8" aria-label="Pack unit">
          {units.map((u) => <option key={u}>{u}</option>)}
        </Select>
      </div>
      <Button size="sm" className="h-10 sm:h-8" pending={pending}>Save pack</Button>
      {saved && !error && <span className="text-xs text-good">Saved</span>}
      {!hasPack && !error && <span className="inline-flex items-center gap-1.5"><Badge tone="warn">Pack size needed for costing</Badge><HelpTip id="ingredients.packSize" /></span>}
      <span className="ml-auto flex gap-1">
        {!isPreferred && <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={() => run(() => setPreferredProduct(ingredientId, productId))}>Use for cost</Button>}
        <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={() => run(() => unlinkProduct(ingredientId, productId))}>Unlink</Button>
      </span>
      {error && <p role="alert" className="w-full text-xs font-medium text-bad">{error}</p>}
    </form>
  );
}

/** "1 slice = 21 g": add a unit for recipes and counts. */
export function AddUnitForm({ ingredientId, base, units }: { ingredientId: string; base: string; units: string[] }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      ref={ref}
      className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await addConversion(ingredientId, fd);
          if (r.error) return setError(r.error);
          setError(null);
          ref.current?.reset();
          router.refresh();
        });
      }}
      noValidate
    >
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <span className="text-muted">1</span>
        <Input name="unit" placeholder="slice" className="h-10 min-w-0 flex-1 sm:h-8 sm:w-28 sm:flex-none" aria-label="Unit name" autoComplete="off" />
        <span className="text-muted">=</span>
        <Input name="amount" inputMode="decimal" placeholder="21" className="num h-10 min-w-0 flex-1 text-right sm:h-8 sm:w-24 sm:flex-none" aria-label="Amount" autoComplete="off" />
        <Select name="amountUnit" defaultValue={base} className="h-10 w-24 shrink-0 sm:h-8" aria-label="Amount unit">
          {units.map((u) => <option key={u}>{u}</option>)}
        </Select>
      </div>
      <Button size="sm" className="h-10 w-full sm:h-8 sm:w-auto" pending={pending}>Add unit</Button>
      {error && <p role="alert" className="w-full text-xs font-medium text-bad">{error}</p>}
    </form>
  );
}

/** Remove a custom unit, after saying which recipe lines use it. */
export function RemoveUnitButton({ ingredientId, conversionId, unit, usedBy }: { ingredientId: string; conversionId: string; unit: string; usedBy: number }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${unit}?`,
      body: usedBy
        ? `${usedBy} recipe line${usedBy === 1 ? " uses" : "s use"} ${unit}. ${usedBy === 1 ? "It" : "They"} will stop costing until you change ${usedBy === 1 ? "its" : "their"} unit.`
        : `No recipe uses ${unit}, so nothing else changes.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await removeConversion(ingredientId, conversionId);
      if (r.error) return setError(r.error);
      router.refresh();
    });
  };
  return (
    <span className="flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-bad">{error}</span>}
      <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-8" pending={pending} onClick={remove}>Remove</Button>
    </span>
  );
}
