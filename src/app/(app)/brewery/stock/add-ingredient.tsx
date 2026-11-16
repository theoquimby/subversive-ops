"use client";

import { useToast } from "@/components/toast";
import { Button, Field, Input, Select } from "@/components/ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addIngredientAction, moveToBreweryAction } from "./actions";

const CATEGORIES = ["Malt", "Hops", "Yeast", "Brewing"].map((c) => ({ value: c, label: c === "Brewing" ? "Other brewing" : c }));
const UNITS = [
  { value: "lb", label: "Weighed (lb, oz, kg, g)" },
  { value: "pkg", label: "Counted (packs, each)" },
  { value: "gal", label: "Measured (gal, l, ml)" },
];

/** A new brewing ingredient (on the brewery side from the start), or one moved over from the kitchen. */
export function AddIngredient({ strays }: { strays: { id: string; name: string; category: string }[] }) {
  const router = useRouter();
  const [toast, show] = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Malt");
  const [unit, setUnit] = useState("lb");
  const [stray, setStray] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {toast}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await addIngredientAction({ name, category, unit: category === "Yeast" && unit === "lb" ? "g" : unit });
            if (r.error) setError(r.error);
            else { setName(""); show(`${name.trim()} added.`, "good"); router.refresh(); }
          });
        }}
      >
        <h3 className="text-sm font-semibold text-ink">A new one</h3>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pilsner malt" maxLength={120} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind"><Select value={category} onChange={(e) => { setCategory(e.target.value); if (e.target.value === "Yeast") setUnit("pkg"); }} options={CATEGORIES} /></Field>
          <Field label="Measured"><Select value={unit} onChange={(e) => setUnit(e.target.value)} options={UNITS} /></Field>
        </div>
        {error && <p role="alert" className="text-xs text-bad">{error}</p>}
        <Button type="submit" variant="primary" disabled={pending || !name.trim()}><Plus className="size-4" /> Add ingredient</Button>
      </form>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Bring one over from the kitchen</h3>
        <p className="text-sm text-muted">
          {strays.length
            ? "These are on brewing recipes or in a brewing category but still on the kitchen side, so they show in kitchen counts and not here."
            : "Every ingredient on a brewing recipe is already on the brewery side."}
        </p>
        {strays.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Select value={stray} onChange={(e) => setStray(e.target.value)} options={strays.map((s) => ({ value: s.id, label: s.name, hint: s.category }))} placeholder="Pick an ingredient" searchable aria-label="Kitchen ingredient to move" className="min-w-0 flex-1 sm:max-w-xs" />
            <Button disabled={pending || !stray} onClick={() => start(async () => {
              const r = await moveToBreweryAction(stray);
              if (r.error) show(r.error, "bad");
              else { show("Moved to the brewery side.", "good"); setStray(""); router.refresh(); }
            })}>Move here</Button>
          </div>
        )}
      </div>
    </div>
  );
}
