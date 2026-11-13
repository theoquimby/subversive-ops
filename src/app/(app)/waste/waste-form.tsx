"use client";

import { Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { useActionState, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/dialog";
import { deleteWaste, logWaste } from "./actions";
import { HelpTip } from "@/components/help";

const REASONS = ["Spoiled", "Expired", "Dropped", "Overcooked", "Returned", "Other"];

type Errors = { item?: string; qty?: string };

export function WasteForm({ items }: { items: { id: string; name: string; units: string[] }[] }) {
  const [state, action, pending] = useActionState(logWaste, undefined);
  const [itemId, setItemId] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [errors, setErrors] = useState<Errors>({});
  const units = items.find((i) => i.id === itemId)?.units ?? [];
  return (
    <Card className="p-5" data-tour="waste.form">
      <form
        action={action}
        noValidate
        className="space-y-4"
        key={state?.ok}
        onSubmit={(e) => {
          // App-styled validation instead of the browser's "Please fill out this field" bubbles.
          const qty = Number(new FormData(e.currentTarget).get("qty"));
          const next: Errors = {};
          if (!itemId) next.item = "Pick what was thrown out.";
          if (!(qty > 0)) next.qty = "Enter how much.";
          setErrors(next);
          if (next.item || next.qty) {
            e.preventDefault();
            (e.currentTarget.querySelector<HTMLElement>(next.item ? "#waste-item" : "#waste-qty"))?.focus();
          }
        }}
      >
        <Field label="Item" hint={errors.item && <span className="text-bad" role="alert">{errors.item}</span>}>
          <Select id="waste-item" name="ingredientId" value={itemId} onChange={(e) => { setItemId(e.target.value); setErrors((x) => ({ ...x, item: undefined })); }} className={cx("h-11 text-base", errors.item && "border-bad")}>
            <option value="" disabled>Choose…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How much" hint={errors.qty && <span className="text-bad" role="alert">{errors.qty}</span>}>
            <Input id="waste-qty" name="qty" type="number" inputMode="decimal" step="any" min={0} aria-invalid={errors.qty ? true : undefined} onChange={() => errors.qty && setErrors((x) => ({ ...x, qty: undefined }))} className={cx("num h-11 text-base", errors.qty && "border-bad")} />
          </Field>
          <Field label="Unit">
            {/* Defaults to the item's count unit, so it's never blank. */}
            <Select name="unit" className="h-11 text-base" key={itemId} defaultValue={units[0] ?? ""} disabled={!units.length} placeholder={itemId ? "Choose…" : "Pick an item"}>
              {units.map((u) => <option key={u}>{u}</option>)}
            </Select>
          </Field>
        </div>
        <div data-tour="waste.reasons">
          <span className="mb-1.5 flex items-center gap-1.5 text-[0.8rem] font-medium text-ink-2">Why <HelpTip id="waste.reasons" /></span>
          <input type="hidden" name="reason" value={reason} />
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={r === reason} onClick={() => setReason(r)} className={cx("h-10 rounded-full border px-4 text-sm", r === reason ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2")}>{r}</button>
            ))}
          </div>
        </div>
        <div aria-live="polite">
          {state?.error && <p className="text-sm text-bad">{state.error}</p>}
          {state?.ok && <p className="text-sm text-good">{state.ok}</p>}
        </div>
        <Button variant="primary" size="lg" className="w-full" disabled={pending}>{pending ? "Saving…" : "Log waste"}</Button>
      </form>
    </Card>
  );
}

/** Remove a waste entry (own entries for 15 minutes; managers any time). */
export function DeleteWasteButton({ id, label }: { id: string; label: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        aria-label={`Remove ${label}`}
        onClick={async () => {
          if (!(await confirm({ title: "Remove this entry?", body: label, confirmLabel: "Remove", danger: true }))) return;
          start(async () => { const res = await deleteWaste(id); setError(res.error ?? null); });
        }}
        className="relative grid size-8 place-items-center rounded-md text-muted after:absolute after:-inset-1 after:content-[''] hover:bg-surface-2 hover:text-bad disabled:opacity-50"
      >
        <Trash2 className="size-4" strokeWidth={1.75} />
      </button>
      {error && <span role="alert" className="mt-1 max-w-48 text-right text-xs text-bad">{error}</span>}
    </span>
  );
}
