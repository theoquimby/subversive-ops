"use client";

import { Button, cx, Field, Input, Select } from "@/components/ui";
import { useActionState } from "react";
import { addUser } from "./actions";

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
