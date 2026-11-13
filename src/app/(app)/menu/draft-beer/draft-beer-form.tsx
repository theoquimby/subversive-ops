"use client";

import { Button, Card, Field, Input, Select } from "@/components/ui";
import { DEFAULT_POURS, KEG_SIZES, planDraftBeer } from "@/domain/draftBeer";
import { money, pct } from "@/lib/format";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createDraftBeer } from "./actions";

interface PourRow {
  label: string;
  oz: string;
  price: string;
  squareId: string;
}

const NONE = "__none";
const HOUSE = "__house";
const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/[$,%\s]/g, "")));

export function DraftBeerFormView({ suppliers, squareItems }: { suppliers: { id: string; name: string }[]; squareItems: { value: string; label: string; hint?: string }[] }) {
  const [beer, setBeer] = useState("");
  const [size, setSize] = useState("half");
  const [cost, setCost] = useState("");
  const [yieldPct, setYieldPct] = useState("95");
  const [supplier, setSupplier] = useState(suppliers.find((s) => s.name === "House brewery")?.id ?? HOUSE);
  const [pours, setPours] = useState<PourRow[]>(DEFAULT_POURS.map((p) => ({ label: p.label, oz: String(p.oz), price: p.price == null ? "" : String(p.price), squareId: NONE })));
  const [result, setResult] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const input = {
    beer,
    kegSizeId: size,
    kegCost: toNum(cost),
    yieldPct: toNum(yieldPct) / 100,
    pours: pours.filter((p) => p.label.trim()).map((p) => ({ label: p.label, oz: toNum(p.oz), price: p.price.trim() === "" ? null : toNum(p.price), squareId: p.squareId === NONE ? null : p.squareId })),
  };
  const plan = useMemo(() => planDraftBeer(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = "error" in plan ? null : plan;
  const setPour = (i: number, patch: Partial<PourRow>) => setPours((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = () =>
    start(async () => {
      setResult(null);
      const res = await createDraftBeer({ ...input, supplierId: supplier === HOUSE ? null : supplier });
      if ("error" in res) setResult({ error: res.error });
      else {
        setResult({ ok: `${beer.trim()} is set up: keg plus ${res.recipes} pour${res.recipes === 1 ? "" : "s"}.` });
        setBeer("");
        setCost("");
      }
    });

  return (
    <Card className="p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Beer">
          <Input value={beer} onChange={(e) => setBeer(e.target.value)} placeholder="e.g. Subversive IPA" aria-label="Beer name" />
        </Field>
        <Field label="Keg">
          <Select value={size} onChange={(e) => setSize(e.target.value)} options={KEG_SIZES.map((k) => ({ value: k.id, label: k.label }))} aria-label="Keg size" />
        </Field>
        <Field label="Cost per keg" hint="What it costs you to brew or buy">
          <Input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="$140" aria-label="Cost per keg" />
        </Field>
        <Field label="Usable %" hint="After foam and line loss">
          <Input value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} inputMode="decimal" aria-label="Usable percent" />
        </Field>
        <Field label="From" className="sm:col-span-2 lg:col-span-1">
          <Select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            options={[...(suppliers.some((s) => s.name === "House brewery") ? [] : [{ value: HOUSE, label: "House brewery (new)" }]), ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
            aria-label="Supplier"
          />
        </Field>
      </div>

      <div className="mt-6 text-sm font-medium">Pours</div>
      <div className="mt-2 space-y-2">
        <div className="hidden grid-cols-[1.4fr_0.6fr_0.7fr_1.6fr_0.9fr_auto] gap-2 px-1 text-xs text-muted md:grid">
          <span>Name</span><span>Oz</span><span>Price</span><span>Square item</span><span className="text-right">Cost · pour %</span><span className="w-10" />
        </div>
        {pours.map((p, i) => {
          const pv = preview?.pours.find((x) => x.label === p.label.trim());
          return (
            <div key={i} className="grid grid-cols-[1fr_5rem_5.5rem] gap-2 rounded-lg border border-border p-2 md:grid-cols-[1.4fr_0.6fr_0.7fr_1.6fr_0.9fr_auto] md:items-center md:border-0 md:p-0">
              <Input value={p.label} onChange={(e) => setPour(i, { label: e.target.value })} aria-label="Pour name" placeholder="16 oz" />
              <Input value={p.oz} onChange={(e) => setPour(i, { oz: e.target.value })} inputMode="decimal" aria-label="Ounces" />
              <Input value={p.price} onChange={(e) => setPour(i, { price: e.target.value })} inputMode="decimal" aria-label="Menu price" placeholder="$" />
              <div className="col-span-3 md:col-span-1">
                <Select value={p.squareId} onChange={(e) => setPour(i, { squareId: e.target.value })} options={[{ value: NONE, label: "Not linked" }, ...squareItems]} aria-label="Square item" />
              </div>
              <div className="num col-span-2 self-center text-sm md:col-span-1 md:text-right">
                {pv ? <>{money(pv.cost)} <span className="text-muted">· {pct(pv.pourCostPct, 0)}</span></> : <span className="text-muted">—</span>}
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-10 w-10 justify-self-end p-0" aria-label="Remove pour" onClick={() => setPours((ps) => ps.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="ghost" size="sm" onClick={() => setPours((ps) => [...ps, { label: "", oz: "", price: "", squareId: NONE }])}>
          <Plus className="h-4 w-4" /> Add a pour
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="num text-sm text-ink-2">
          {preview ? (
            <>
              {Math.round(preview.usableOz)} oz to sell per keg · <span className="font-medium text-ink">${preview.costPerOz.toFixed(3)} per oz</span>
            </>
          ) : (
            <span className="text-muted">{"error" in plan ? plan.error : ""}</span>
          )}
        </div>
        <Button type="button" variant="primary" disabled={!preview || pending} onClick={submit}>
          {pending ? "Saving…" : "Create keg and pours"}
        </Button>
      </div>
      {result?.error && <p className="mt-3 text-sm text-bad">{result.error}</p>}
      {result?.ok && (
        <p className="mt-3 text-sm text-good">
          {result.ok} <Link href="/menu?kind=MENU" className="underline">See menu costs</Link>
        </p>
      )}
    </Card>
  );
}
