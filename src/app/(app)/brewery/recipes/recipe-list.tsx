"use client";

import { Card, cx, EmptyState, Input, LinkButton } from "@/components/ui";
import { RECIPE_STATUSES, type BrewRecipeStatus } from "@/domain/brewRecipes";
import { fuzzyFilter } from "@/domain/search";
import { money, qty } from "@/lib/format";
import type { BrewRecipeRow } from "@/server/services/brewRecipes";
import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export const sg = (n: number) => n.toFixed(3);

/** Recipes grouped Live / In development / Archived, with a search box. A table on a wide screen, a stacked list on a phone. */
export function RecipeList({ rows }: { rows: BrewRecipeRow[] }) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const shown = useMemo(() => (q.trim() ? fuzzyFilter(rows, q, (r) => `${r.name} ${r.style ?? ""} ${r.beer ?? ""}`, 1000) : rows), [rows, q]);

  if (!rows.length) {
    return (
      <EmptyState
        title="No brewing recipes yet"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <LinkButton href="/brewery/recipes/new" variant="primary">New recipe</LinkButton>
            <LinkButton href="/brewery/import">Import from Brew Manager</LinkButton>
          </div>
        }
      >
        Write one here, or bring in every recipe from Brew Manager in one go.
      </EmptyState>
    );
  }

  const archivedCount = shown.filter((r) => r.status === "archived").length;
  return (
    <div className="space-y-6">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes, styles, beers" aria-label="Search recipes" className="pl-9" />
      </div>
      {RECIPE_STATUSES.map(({ value, label }) => {
        const group = shown.filter((r) => r.status === value);
        if (value === "archived" && !showArchived && !q.trim()) {
          return archivedCount > 0 ? (
            <button key={value} type="button" onClick={() => setShowArchived(true)} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
              Show {archivedCount} archived recipe{archivedCount === 1 ? "" : "s"}
            </button>
          ) : null;
        }
        if (!group.length) return null;
        return <Group key={value} status={value} label={label} rows={group} />;
      })}
      {q.trim() && !shown.length && <p className="text-sm text-muted">No recipe matches “{q}”.</p>}
    </div>
  );
}

function Group({ label, rows, status }: { label: string; rows: BrewRecipeRow[]; status: BrewRecipeStatus }) {
  return (
    <section aria-label={label}>
      <h2 className="mb-2 text-[0.95rem] font-semibold text-ink">
        {label} <span className="num font-normal text-muted">{rows.length}</span>
      </h2>
      <Card className={cx("divide-y divide-border overflow-hidden", status === "archived" && "opacity-80")}>
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_4.5rem_7.5rem_3.5rem_3rem_6rem] gap-3 px-4 py-2.5 text-[0.75rem] font-medium text-muted md:grid">
          <span>Recipe</span>
          <span>Beer</span>
          <span className="text-right">Batch</span>
          <span className="text-right">OG → FG</span>
          <span className="text-right">ABV</span>
          <span className="text-right">IBU</span>
          <span className="text-right">Per pint</span>
        </div>
        {rows.map((r) => (
          <Link key={r.id} href={`/brewery/recipes/${r.id}`} className="block px-4 py-3 transition-colors duration-120 hover:bg-surface-2/60">
            {/* Phone: stacked */}
            <div className="flex items-start gap-3 md:hidden">
              <Swatch hex={r.colorHex} srm={r.srm} hasGrain={r.og > 1} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-ink">{r.name}</span>
                  <PerPint r={r} />
                </div>
                <div className="truncate text-xs text-muted">{[r.style, r.beer && `pours as ${r.beer}`].filter(Boolean).join(" · ") || "No style yet"}</div>
                <div className="num mt-1 text-xs text-ink-2">
                  {qty(r.batchBbl, 1)} bbl · {sg(r.og)} → {sg(r.fg)} · {r.abv.toFixed(1)}% · {Math.round(r.ibu)} IBU
                </div>
              </div>
            </div>
            {/* Wide: one row */}
            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_4.5rem_7.5rem_3.5rem_3rem_6rem] items-center gap-3 text-sm md:grid">
              <span className="flex min-w-0 items-center gap-2.5">
                <Swatch hex={r.colorHex} srm={r.srm} hasGrain={r.og > 1} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{r.name}</span>
                  <span className="block truncate text-xs text-muted">{r.style ?? "No style yet"}</span>
                </span>
              </span>
              <span className={cx("truncate", r.beer ? "text-ink-2" : "text-muted")}>{r.beer ?? "Not linked"}</span>
              <span className="num text-right text-ink-2">{qty(r.batchBbl, 1)} bbl</span>
              <span className="num text-right text-ink-2">{sg(r.og)} → {sg(r.fg)}</span>
              <span className="num text-right text-ink-2">{r.abv.toFixed(1)}%</span>
              <span className="num text-right text-ink-2">{Math.round(r.ibu)}</span>
              <span className="text-right"><PerPint r={r} /></span>
            </div>
          </Link>
        ))}
      </Card>
    </section>
  );
}

function PerPint({ r }: { r: BrewRecipeRow }) {
  if (!r.lineCount) return <span className="text-xs text-muted">No lines yet</span>;
  if (r.unpricedLines > 0) return <span className="text-xs whitespace-nowrap text-warn">Needs prices</span>;
  return <span className="num text-sm whitespace-nowrap text-ink">{money(r.perPint)}</span>;
}

export function Swatch({ hex, srm, hasGrain, size = "sm" }: { hex: string; srm: number; hasGrain: boolean; size?: "sm" | "lg" }) {
  return (
    <span
      aria-label={hasGrain ? `Colour about ${Math.round(srm)} SRM` : "No colour yet"}
      role="img"
      className={cx("inline-block shrink-0 rounded-md border border-black/10", size === "sm" ? "size-6" : "size-9", !hasGrain && "border-dashed border-border-strong bg-transparent")}
      style={hasGrain ? { backgroundColor: hex } : undefined}
    />
  );
}
