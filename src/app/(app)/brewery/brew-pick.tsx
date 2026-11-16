"use client";

import { Select } from "@/components/ui";
import type { BeerOption, RecipeOption } from "@/server/services/brewery";

/**
 * One picker for "what are we brewing": a recipe, or a beer that has no
 * recipe yet. Value is "r:<recipe id>" or "b:<beer id>".
 */
export function BrewPick({ value, onChange, recipes, beers, label = "Recipe or beer" }: { value: string; onChange: (v: string) => void; recipes: RecipeOption[]; beers: BeerOption[]; label?: string }) {
  const withRecipe = new Set(recipes.map((r) => r.beerId).filter(Boolean));
  const options = [
    ...recipes.map((r) => ({ value: `r:${r.id}`, label: r.name, group: "Recipes", hint: `${r.batchBbl} bbl · ${r.fermentDays}+${r.conditionDays} days` })),
    ...beers.filter((b) => !withRecipe.has(b.id)).map((b) => ({ value: `b:${b.id}`, label: b.name, group: recipes.length ? "Beers with no recipe yet" : "Beers" })),
  ];
  return <Select value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder="Pick what you're brewing" aria-label={label} searchable />;
}

/** Split a BrewPick value into the ids the actions take. */
export function pickIds(v: string): { recipeId: string | null; beerId: string | null } {
  if (v.startsWith("r:")) return { recipeId: v.slice(2), beerId: null };
  if (v.startsWith("b:")) return { recipeId: null, beerId: v.slice(2) };
  return { recipeId: null, beerId: null };
}

/** The pick for a brew that already has a recipe or beer. */
export const pickOf = (b: { recipeId: string | null; beerId: string | null }) => (b.recipeId ? `r:${b.recipeId}` : b.beerId ? `b:${b.beerId}` : "");

/** Usual size for a pick: the recipe's batch, else `fallback`. */
export const pickBbl = (v: string, recipes: RecipeOption[], fallback: number) => recipes.find((r) => `r:${r.id}` === v)?.batchBbl ?? fallback;
