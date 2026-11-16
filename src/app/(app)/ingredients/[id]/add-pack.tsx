"use client";

import { Select } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPackToIngredient } from "../actions";

/** "Also bought as…": link another supplier product (another pack size) to this ingredient. */
export function AddPack({ ingredientId, products }: { ingredientId: string; products: { id: string; label: string; hint: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="px-4 py-3">
      <Select
        value=""
        placeholder={pending ? "Linking…" : "Also bought as… (add another pack)"}
        searchable
        disabled={pending}
        options={products.map((p) => ({ value: p.id, label: p.label, hint: p.hint }))}
        onChange={(e) => start(async () => { const r = await addPackToIngredient(ingredientId, e.target.value); if (r.error) setError(r.error); else { setError(null); router.refresh(); } })}
        className="!h-10 w-full"
        aria-label="Add another pack this is bought in"
      />
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
