"use client";

import { Button, Card, Field, Input } from "@/components/ui";
import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <Card className="p-6">
      <form action={action} className="space-y-4">
        <Field label="Name">
          <Input name="name" autoComplete="username" autoCapitalize="words" required autoFocus />
        </Field>
        <Field label="PIN">
          <Input name="pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="\d*" maxLength={8} required />
        </Field>
        {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        <Button variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
