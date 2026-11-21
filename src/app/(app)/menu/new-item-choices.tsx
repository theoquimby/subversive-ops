"use client";

import { Button } from "@/components/ui";
import type { BaseUnit } from "@/domain/units";
import { Plus } from "lucide-react";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What to do with a name that isn't on the list: add it as a new ingredient
 * (measured the way the unit was typed, or by weight, volume or count when no
 * unit was typed) or, where it fits, as a new prep recipe made here.
 */
export function NewItemChoices({ name, measure, busy, onIngredient, onPrep, primary }: {
  name: string;
  /** How the typed unit measures it ("2 oz pepper jack" is weighed); null when no unit was typed, so it asks. */
  measure: BaseUnit | null;
  busy?: boolean;
  onIngredient: (base?: BaseUnit) => void;
  onPrep?: () => void;
  /** Show the ingredient choice as the main button (nothing close was found). */
  primary?: boolean;
}) {
  const label = `“${cap(name)}”`;
  return (
    <>
      {measure ? (
        <Button size="sm" variant={primary ? "secondary" : "ghost"} pending={busy} onClick={() => onIngredient()}>
          {!busy && <Plus className="size-3.5" />}New ingredient {label}
        </Button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label={`New ingredient ${cap(name)}, measured by`}>
          <span className="text-xs text-ink-2">New ingredient {label}, by</span>
          <Button size="sm" variant={primary ? "secondary" : "ghost"} disabled={busy} onClick={() => onIngredient("g")}>weight</Button>
          <Button size="sm" variant={primary ? "secondary" : "ghost"} disabled={busy} onClick={() => onIngredient("ml")}>volume</Button>
          <Button size="sm" variant={primary ? "secondary" : "ghost"} disabled={busy} onClick={() => onIngredient("each")}>count</Button>
        </span>
      )}
      {onPrep && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onPrep}>
          <Plus className="size-3.5" />New prep recipe {label}
        </Button>
      )}
    </>
  );
}
