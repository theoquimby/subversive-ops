"use client";

import { Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { useActionState, useState } from "react";
import { logWaste } from "./actions";
import { HelpTip } from "@/components/help";

const REASONS = ["Spoiled", "Expired", "Dropped", "Overcooked", "Returned", "Other"];

export function WasteForm({ items }: { items: { id: string; name: string; units: string[] }[] }) {
  const [state, action, pending] = useActionState(logWaste, undefined);
  const [itemId, setItemId] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const units = items.find((i) => i.id === itemId)?.units ?? [];
  return (
    <Card className="p-5" data-tour="waste.form">
      <form action={action} className="space-y-4" key={state?.ok}>
        <Field label="Item">
          <Select name="ingredientId" value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-11 text-base" required>
            <option value="" disabled>Choose…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How much"><Input name="qty" type="number" inputMode="decimal" step="any" min={0} className="num h-11 text-base" required /></Field>
          <Field label="Unit">
            <Select name="unit" className="h-11 text-base" key={itemId}>{units.map((u) => <option key={u}>{u}</option>)}</Select>
          </Field>
        </div>
        <div data-tour="waste.reasons">
          <span className="mb-1.5 flex items-center gap-1.5 text-[0.8rem] font-medium text-ink-2">Why <HelpTip id="waste.reasons" /></span>
          <input type="hidden" name="reason" value={reason} />
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cx("h-10 rounded-full border px-4 text-sm", r === reason ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2")}>{r}</button>
            ))}
          </div>
        </div>
        {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        {state?.ok && <p className="text-sm text-good">{state.ok}</p>}
        <Button variant="primary" size="lg" className="w-full" disabled={pending}>{pending ? "Saving…" : "Log waste"}</Button>
      </form>
    </Card>
  );
}
