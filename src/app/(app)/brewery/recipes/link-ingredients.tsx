"use client";

import { Button, Card, cx } from "@/components/ui";
import type { LinkSummary } from "@/domain/brewIngredientLink";
import { useState, useTransition } from "react";
import { LinkSummaryView } from "../link-summary";
import { linkBrewIngredientsAction } from "./actions";

/**
 * "N recipe lines aren't linked to an ingredient — Link them". Recipes shows it
 * as a banner while lines are unlinked; Brewing stock when the list is empty but
 * recipes exist. After linking it stays to say what happened.
 */
export function LinkIngredients({ unlinked, show, variant = "banner", pricesHref }: { unlinked: number; show: boolean; variant?: "banner" | "empty"; pricesHref?: string }) {
  const [summary, setSummary] = useState<LinkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!summary && !show) return null;

  const run = () =>
    start(async () => {
      setError(null);
      const res = await linkBrewIngredientsAction();
      if ("error" in res) return setError(res.error);
      setSummary(res.summary);
    });

  if (summary) {
    return (
      <Card className="mb-6 px-4 py-3">
        <LinkSummaryView s={summary} pricesHref={pricesHref} />
      </Card>
    );
  }

  const lines = unlinked === 1 ? "1 recipe line isn't" : `${unlinked} recipe lines aren't`;
  return (
    <Card className={cx("mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm", variant === "banner" && "border-warn/30 bg-warn-bg/40")}>
      <span className="min-w-0 flex-1">
        {variant === "empty"
          ? unlinked > 0
            ? `No brewing ingredients yet: ${lines} linked to an ingredient. Linking them adds the malt, hops and yeast your recipes use.`
            : "No brewing ingredients yet. Linking checks your recipes' lines for malt, hops and yeast to add."
          : `${lines} linked to an ingredient, so ${unlinked === 1 ? "it doesn't" : "they don't"} count toward stock, ordering or costs.`}
      </span>
      <Button variant={variant === "empty" ? "primary" : "secondary"} onClick={run} disabled={pending}>
        {pending ? "Linking…" : variant === "empty" ? "Link ingredients" : "Link them"}
      </Button>
      {error && <p role="alert" className="w-full text-bad">{error}</p>}
    </Card>
  );
}
