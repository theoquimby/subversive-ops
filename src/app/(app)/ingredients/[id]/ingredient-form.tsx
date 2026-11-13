"use client";

import { Button, Combobox, Field, Input, Select } from "@/components/ui";
import { useActionState } from "react";
import { saveIngredient } from "../actions";
import { HelpTip } from "@/components/help";

export interface IngredientFormValues {
  id: string | null;
  name: string;
  category: string;
  storageArea: string;
  baseUnit: "g" | "ml" | "each";
  yieldPct: number;
  safetyPct: number;
  countUnit: string;
  notes: string;
}

export function IngredientForm({ v, units, categories, areas }: { v: IngredientFormValues; units: string[]; categories: string[]; areas: string[] }) {
  const [state, action, pending] = useActionState(saveIngredient.bind(null, v.id), undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Name"><Input name="name" defaultValue={v.name} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category"><Combobox name="category" defaultValue={v.category} suggestions={categories} /></Field>
        <Field label="Storage area"><Combobox name="storageArea" defaultValue={v.storageArea} suggestions={areas} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={<span className="inline-flex items-center gap-1.5">Measured by <HelpTip id="ingredients.baseUnit" /></span>} hint="Every quantity is stored in this unit">
          <Select name="baseUnit" defaultValue={v.baseUnit}>
            <option value="g">Weight (g)</option>
            <option value="ml">Volume (ml)</option>
            <option value="each">Count (each)</option>
          </Select>
        </Field>
        <Field label="Count in" hint="What staff count it in">
          <Select name="countUnit" defaultValue={v.countUnit}>
            <option value="">Default</option>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={<span className="inline-flex items-center gap-1.5">Yield % <HelpTip id="ingredients.yield" /></span>} hint="Usable after trim / cook loss"><Input name="yieldPct" type="number" min={1} max={100} step="0.1" defaultValue={v.yieldPct} className="num" /></Field>
        <Field label={<span className="inline-flex items-center gap-1.5">Order buffer % <HelpTip id="ingredients.buffer" /></span>} hint="Extra on top of forecast"><Input name="safetyPct" type="number" min={0} max={200} step="1" defaultValue={v.safetyPct} className="num" /></Field>
      </div>
      <Field label="Notes"><Input name="notes" defaultValue={v.notes} /></Field>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={pending}>{pending ? "Saving…" : v.id ? "Save changes" : "Create ingredient"}</Button>
        {state?.error && <span className="text-sm text-bad">{state.error}</span>}
        {state?.ok && <span className="text-sm text-good">Saved</span>}
      </div>
    </form>
  );
}
