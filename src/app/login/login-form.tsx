"use client";

import { Button, Card, Field, Input } from "@/components/ui";
import { useActionState } from "react";
import { login, setup } from "./actions";

export function LoginForm({ firstRun = false }: { firstRun?: boolean }) {
  const [state, action, pending] = useActionState(firstRun ? setup : login, undefined);
  return (
    <Card className="p-6">
      <form action={action} className="space-y-4">
        <Field label="Name">
          <Input name="name" autoComplete="username" autoCapitalize="words" required autoFocus />
        </Field>
        <Field label={firstRun ? "Choose a PIN (4–8 digits)" : "PIN"}>
          <Input name="pin" type="password" inputMode="numeric" autoComplete={firstRun ? "new-password" : "current-password"} pattern="\d*" maxLength={8} required />
        </Field>
        {firstRun && (
          <Field label="Confirm PIN">
            <Input name="confirm" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d*" maxLength={8} required />
          </Field>
        )}
        {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        <Button variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "One sec…" : firstRun ? "Create manager account" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
