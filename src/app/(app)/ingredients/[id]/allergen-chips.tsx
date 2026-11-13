"use client";

import { cx } from "@/components/ui";
import { ALLERGENS, toggleAllergen, type AllergenId } from "@/domain/allergens";
import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { setIngredientAllergens } from "./actions";

/** Tap to toggle; saves straight away (rolls back and says so if it fails). */
export function AllergenChips({ ingredientId, initial }: { ingredientId: string; initial: string[] }) {
  const [list, setList] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, start] = useTransition();
  const toggle = (id: AllergenId) => {
    const before = list;
    const next = toggleAllergen(list, id, !list.includes(id));
    setList(next);
    setSaved(false);
    start(async () => {
      const r = await setIngredientAllergens(ingredientId, next);
      if (r.error) { setList(before); setError(r.error); }
      else { setError(null); setSaved(true); }
    });
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Allergens">
        {ALLERGENS.map((a) => {
          const on = list.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(a.id)}
              className={cx("inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm sm:h-8 sm:px-3", on ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2 hover:bg-surface-2")}
            >
              {on && <Check className="size-3.5" strokeWidth={2.25} />}
              {a.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {error ? <span className="text-bad">{error}</span> : list.length === 0 ? "None tagged. Tap any it contains — check the supplier's label." : saved ? "Saved. Recipes using this update automatically." : `Contains ${list.length}. Recipes using this show it too.`}
      </p>
    </div>
  );
}
