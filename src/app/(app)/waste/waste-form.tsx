"use client";

import { Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { useActionState, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/dialog";
import { deleteWaste, logRecipeWaste, logWaste } from "./actions";
import { HelpTip } from "@/components/help";

const REASONS = ["Spoiled", "Expired", "Dropped", "Overcooked", "Returned", "Other"];

type Errors = { item?: string; qty?: string };

export interface RecipeItem {
  id: string;
  name: string;
  /** PREP | MENU | MODIFIER */
  kind: string;
  units: string[];
}

type Mode = "ingredient" | "recipe";

export function WasteForm({ items, recipes = [] }: { items: { id: string; name: string; units: string[] }[]; recipes?: RecipeItem[] }) {
  const [mode, setMode] = useState<Mode>("ingredient");
  const [ingState, ingAction, ingPending] = useActionState(logWaste, undefined);
  const [recState, recAction, recPending] = useActionState(logRecipeWaste, undefined);
  const state = mode === "ingredient" ? ingState : recState;
  const pending = mode === "ingredient" ? ingPending : recPending;
  const [itemId, setItemId] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [errors, setErrors] = useState<Errors>({});
  const list = mode === "ingredient" ? items : recipes;
  const units = list.find((i) => i.id === itemId)?.units ?? [];
  const switchMode = (m: Mode) => { setMode(m); setItemId(""); setErrors({}); };
  return (
    <Card className="p-5" data-tour="waste.form">
      {recipes.length > 0 && (
        <div role="tablist" aria-label="What was thrown out" className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" data-tour="waste.mode">
          {([["ingredient", "Ingredient"], ["recipe", "Prep or menu item"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={cx("h-10 rounded-md text-sm", mode === m ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2")}>{label}</button>
          ))}
        </div>
      )}
      <form
        action={mode === "ingredient" ? ingAction : recAction}
        noValidate
        className="space-y-4"
        key={`${mode}-${state?.ok ?? ""}`}
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
        <Field
          label={mode === "ingredient" ? "Item" : <span className="inline-flex items-center gap-1.5">Prep or menu item <HelpTip id="waste.prepItems" /></span>}
          hint={errors.item ? <span className="text-bad" role="alert">{errors.item}</span> : mode === "recipe" ? "Logged as the ingredients it's made from, so food cost counts it." : undefined}
        >
          <Select
            id="waste-item"
            name={mode === "ingredient" ? "ingredientId" : "recipeId"}
            value={itemId}
            onChange={(e) => { setItemId(e.target.value); setErrors((x) => ({ ...x, item: undefined })); }}
            className={cx("h-11 text-base", errors.item && "border-bad")}
            options={mode === "ingredient" ? items.map((i) => ({ value: i.id, label: i.name })) : recipes.map((r) => ({ value: r.id, label: r.name, group: r.kind === "PREP" ? "Prep" : "Menu" }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={mode === "recipe" && recipes.find((r) => r.id === itemId)?.kind !== "PREP" && itemId ? "How many" : "How much"} hint={errors.qty && <span className="text-bad" role="alert">{errors.qty}</span>}>
            <Input id="waste-qty" name="qty" type="number" inputMode="decimal" step="any" min={0} aria-invalid={errors.qty ? true : undefined} onChange={() => errors.qty && setErrors((x) => ({ ...x, qty: undefined }))} className={cx("num h-11 text-base", errors.qty && "border-bad")} />
          </Field>
          <Field label="Unit">
            {/* Defaults to the item's count unit (or a prep's batch unit), so it's never blank. */}
            <Select name="unit" className="h-11 text-base" key={`${mode}-${itemId}`} defaultValue={units[0] ?? ""} disabled={!units.length} placeholder={itemId ? "Choose…" : "Pick an item"}>
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
