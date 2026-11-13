"use client";

import { Button, Card, Field, Input } from "@/components/ui";
import { useActionState, useState } from "react";
import { login, setup } from "./actions";

export function LoginForm({ firstRun = false }: { firstRun?: boolean }) {
  const [state, action, pending] = useActionState(firstRun ? setup : login, undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const msg = (k: string) => errors[k] && <span id={`login-${k}-error`} role="alert" className="text-bad">{errors[k]}</span>;
  const clear = (k: string) => () => errors[k] && setErrors((x) => ({ ...x, [k]: "" }));
  return (
    <Card className="p-6">
      <form
        action={action}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          // App-styled validation instead of the browser's "Please fill out this field" bubbles.
          const f = new FormData(e.currentTarget);
          const name = String(f.get("name") ?? "").trim();
          const pin = String(f.get("pin") ?? "");
          const next: Record<string, string> = {};
          if (!name) next.name = "Enter your name.";
          if (!pin) next.pin = "Enter your PIN.";
          else if (!/^\d+$/.test(pin)) next.pin = "PINs are numbers only.";
          else if (firstRun && !/^\d{4,8}$/.test(pin)) next.pin = "Use 4–8 digits.";
          if (firstRun && !next.pin && f.get("confirm") !== pin) next.confirm = "The PINs don't match.";
          setErrors(next);
          const first = Object.keys(next)[0];
          if (first) {
            e.preventDefault();
            e.currentTarget.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
          }
        }}
      >
        <Field label="Name" hint={msg("name")}>
          <Input name="name" autoComplete="username" autoCapitalize="words" autoFocus aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "login-name-error" : undefined} onChange={clear("name")} className={errors.name ? "border-bad" : undefined} />
        </Field>
        <Field label={firstRun ? "Choose a PIN (4–8 digits)" : "PIN"} hint={msg("pin")}>
          <Input name="pin" type="password" inputMode="numeric" autoComplete={firstRun ? "new-password" : "current-password"} maxLength={8} aria-invalid={errors.pin ? true : undefined} aria-describedby={errors.pin ? "login-pin-error" : undefined} onChange={clear("pin")} className={errors.pin ? "border-bad" : undefined} />
        </Field>
        {firstRun && (
          <Field label="Confirm PIN" hint={msg("confirm")}>
            <Input name="confirm" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} aria-invalid={errors.confirm ? true : undefined} aria-describedby={errors.confirm ? "login-confirm-error" : undefined} onChange={clear("confirm")} className={errors.confirm ? "border-bad" : undefined} />
          </Field>
        )}
        {state?.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
        <Button variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "One sec…" : firstRun ? "Create manager account" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
