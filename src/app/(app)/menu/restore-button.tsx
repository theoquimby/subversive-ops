"use client";

import { Button } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { restoreRecipe } from "./actions";

export function RestoreButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        className="h-10 sm:h-8"
        disabled={pending}
        aria-label={`Restore ${name}`}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await restoreRecipe(id);
            if (res.error) setError(res.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Restoring…" : "Restore"}
      </Button>
      {error && <span role="alert" className="max-w-56 text-right text-xs text-bad">{error}</span>}
    </div>
  );
}
