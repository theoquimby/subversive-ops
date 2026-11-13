"use client";

import { useConfirm } from "@/components/dialog";
import { Button } from "@/components/ui";
import { Archive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveIngredient, restoreIngredient } from "./actions";

/** Archive icon in an ingredients row. Refuses (with the recipe names) while a recipe still uses it. */
export function ArchiveIngredientButton({ id, name, usedIn }: { id: string; name: string; usedIn: number }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const click = async () => {
    setError(null);
    // Still in a recipe: skip the question and show which recipes (the server names them).
    if (usedIn === 0) {
      const ok = await confirm({ title: `Archive ${name}?`, body: "It drops out of counts, ordering and this list. Price history is kept, and you can restore it from Archived.", confirmLabel: "Archive" });
      if (!ok) return;
    }
    start(async () => {
      const r = await archiveIngredient(id);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  };
  return (
    <>
      <button
        type="button"
        onClick={click}
        disabled={pending}
        aria-label={`Archive ${name}`}
        title="Archive"
        className="relative rounded-md p-1.5 text-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <Archive className="size-4" />
      </button>
      {error && <span role="alert" className="w-full basis-full pl-2 text-xs text-bad">{error}</span>}
    </>
  );
}

export function RestoreIngredientButton({ id, name }: { id: string; name: string }) {
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
            const r = await restoreIngredient(id);
            if (r.error) setError(r.error);
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
