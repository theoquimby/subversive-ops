"use client";

import { Button, cx, Field, Input, Select } from "@/components/ui";
import { WEEKDAYS } from "@/domain/dates";
import { useActionState } from "react";
import { addUser, saveSupplier } from "./actions";

export function AddUserForm() {
  const [state, action, pending] = useActionState(addUser, undefined);
  return (
    <form action={action} key={state?.ok} className="grid gap-3 p-4 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-end">
      <Field label="Name"><Input name="name" required /></Field>
      <Field label="PIN"><Input name="pin" inputMode="numeric" pattern="\d{4,8}" placeholder="4–8 digits" required /></Field>
      <Field label="Access">
        <Select name="role" defaultValue="STAFF"><option value="STAFF">Staff (counts)</option><option value="MANAGER">Manager</option></Select>
      </Field>
      <Button variant="primary" disabled={pending}>Add person</Button>
      {(state?.error || state?.ok) && <p className={cx("text-sm sm:col-span-4", state.error ? "text-bad" : "text-good")}>{state.error ?? state.ok}</p>}
    </form>
  );
}

export interface SupplierValues { id: string | null; name: string; kind: "DISTRIBUTOR" | "LOCAL"; email: string; leadTimeDays: number; minOrder: string; deliveryDays: number[] }

export function SupplierForm({ v }: { v: SupplierValues }) {
  const [state, action, pending] = useActionState(saveSupplier.bind(null, v.id), undefined);
  return (
    <form action={action} className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input name="name" defaultValue={v.name} required /></Field>
        <Field label="Type">
          <Select name="kind" defaultValue={v.kind}><option value="DISTRIBUTOR">Distributor (price sheet)</option><option value="LOCAL">Local (prices by hand)</option></Select>
        </Field>
        <Field label="Order email"><Input name="email" type="email" defaultValue={v.email} placeholder="optional" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
        <div>
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Delivers on</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="cursor-pointer">
                <input type="checkbox" name="deliveryDays" value={i} defaultChecked={v.deliveryDays.includes(i)} className="peer sr-only" />
                <span className="inline-grid h-9 w-11 place-items-center rounded-lg border border-border-strong text-sm text-ink-2 peer-checked:border-ink peer-checked:bg-primary peer-checked:text-primary-ink peer-focus-visible:outline-2 peer-focus-visible:outline-focus">{d}</span>
              </label>
            ))}
          </div>
        </div>
        <Field label="Order lead (days)"><Input name="leadTimeDays" type="number" min={0} max={14} defaultValue={v.leadTimeDays} className="num" /></Field>
        <Field label="Minimum ($)"><Input name="minOrder" type="number" min={0} step="1" defaultValue={v.minOrder} className="num" placeholder="none" /></Field>
      </div>
      <div className="flex items-center gap-3">
        <Button disabled={pending}>{v.id ? "Save" : "Add supplier"}</Button>
        {(state?.error || state?.ok) && <span className={cx("text-sm", state.error ? "text-bad" : "text-good")}>{state.error ?? state.ok}</span>}
      </div>
    </form>
  );
}
