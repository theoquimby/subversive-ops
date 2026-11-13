"use client";

import { Button } from "@/components/ui";
import { useState, useTransition } from "react";
import { createOrder } from "../ordering/actions";

/** One tap: save the suggested order as a draft PO (then opens it). */
export function CreateOrderButton({ input, label = "Create order" }: { input: Parameters<typeof createOrder>[0]; label?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        size="sm"
        className="h-10 sm:h-8"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await createOrder(input);
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? "Creating…" : label}
      </Button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
