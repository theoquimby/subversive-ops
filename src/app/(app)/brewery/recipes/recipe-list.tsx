"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { cx, EmptyState, LinkButton } from "@/components/ui";
import { RECIPE_STATUSES, type BrewRecipeStatus } from "@/domain/brewRecipes";
import { money, qty } from "@/lib/format";
import type { BrewRecipeRow } from "@/server/services/brewRecipes";
import { useMemo } from "react";

export const sg = (n: number) => n.toFixed(3);

const STATUS_LABEL = Object.fromEntries(RECIPE_STATUSES.map((s) => [s.value, s.label])) as Record<BrewRecipeStatus, string>;
const STATUS_RANK: Record<BrewRecipeStatus, number> = { live: 0, dev: 1, archived: 2 };
const DEFAULT_VIEW = { filters: { status: ["current"] }, group: "status" };

/**
 * Every brewing recipe: search, Live / In development / Archived tabs (archived
 * hidden at first), beer and "needs prices" filters, sort by any number, CSV.
 * Grouped by status unless you pick otherwise; each row opens the recipe.
 */
export function RecipeList({ rows }: { rows: BrewRecipeRow[] }) {
  const columns = useMemo<Column<BrewRecipeRow>[]>(() => [
    {
      id: "name", header: "Recipe", width: 260, hideable: false, sort: (r) => r.name, csv: (r) => r.name,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Swatch hex={r.colorHex} srm={r.srm} hasGrain={r.og > 1} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{r.name}</span>
            <span className="block truncate text-xs text-muted">{r.style ?? "No style yet"}</span>
          </span>
        </span>
      ),
    },
    { id: "style", header: "Style", width: 150, defaultHidden: true, sort: (r) => r.style, csv: (r) => r.style ?? "", cell: (r) => <span className="text-ink-2">{r.style ?? "—"}</span> },
    { id: "beer", header: "Beer", width: 170, sort: (r) => r.beer, csv: (r) => r.beer ?? "", cell: (r) => <span className={cx("truncate", r.beer ? "text-ink-2" : "text-muted")}>{r.beer ?? "Not linked"}</span> },
    { id: "status", header: "Status", width: 130, defaultHidden: true, sort: (r) => STATUS_RANK[r.status], csv: (r) => STATUS_LABEL[r.status], cell: (r) => <span className="text-ink-2">{STATUS_LABEL[r.status]}</span> },
    { id: "batch", header: "Batch", align: "right", width: 80, firstDir: "desc", sort: (r) => r.batchBbl, csv: (r) => r.batchBbl, cell: (r) => <span className="text-ink-2">{qty(r.batchBbl, 1)} bbl</span> },
    { id: "gravity", header: "OG → FG", align: "right", width: 120, firstDir: "desc", sort: (r) => r.og, csv: (r) => `${sg(r.og)} → ${sg(r.fg)}`, cell: (r) => <span className="text-ink-2">{sg(r.og)} → {sg(r.fg)}</span> },
    { id: "abv", header: "ABV", align: "right", width: 70, firstDir: "desc", sort: (r) => r.abv, csv: (r) => r.abv, cell: (r) => <span className="text-ink-2">{r.abv.toFixed(1)}%</span> },
    { id: "ibu", header: "IBU", align: "right", width: 60, firstDir: "desc", sort: (r) => r.ibu, csv: (r) => Math.round(r.ibu), cell: (r) => <span className="text-ink-2">{Math.round(r.ibu)}</span> },
    { id: "srm", header: "SRM", align: "right", width: 60, defaultHidden: true, firstDir: "desc", sort: (r) => r.srm, csv: (r) => Math.round(r.srm), cell: (r) => <span className="text-ink-2">{Math.round(r.srm)}</span> },
    { id: "total", header: "Per batch", align: "right", width: 100, defaultHidden: true, firstDir: "desc", sort: (r) => (r.lineCount ? r.total : null), csv: (r) => (r.lineCount ? r.total : ""), cell: (r) => (r.lineCount ? <span className={r.unpricedLines ? "text-warn" : undefined}>{money(r.total, { whole: true })}{r.unpricedLines ? "+" : ""}</span> : <span className="text-muted">—</span>) },
    { id: "pint", header: "Per pint", align: "right", width: 110, firstDir: "desc", sort: (r) => (r.unpricedLines ? null : r.perPint), csv: (r) => (r.unpricedLines ? "needs prices" : r.perPint ?? ""), cell: (r) => <PerPint r={r} /> },
  ], []);

  const filters = useMemo<Filter<BrewRecipeRow>[]>(() => [
    { id: "status", label: "Status", kind: "facet", display: "segmented", single: true, allLabel: "All", values: (r) => (r.status === "archived" ? ["archived"] : ["current", r.status]), options: [{ value: "current", label: "In use" }, ...RECIPE_STATUSES] },
    { id: "prices", label: "Needs prices", kind: "toggle", tone: "warn", test: (r) => r.lineCount > 0 && r.unpricedLines > 0 },
    { id: "beer", label: "Beer", kind: "facet", values: (r) => r.beer ?? "Not linked" },
    { id: "style", label: "Style", kind: "facet", values: (r) => r.style ?? "No style yet" },
  ], []);

  const groups = useMemo<GroupBy<BrewRecipeRow>[]>(() => [
    { id: "status", label: "Status", key: (r) => r.status, title: (s) => STATUS_LABEL[s as BrewRecipeStatus] ?? s, order: (a, b) => STATUS_RANK[a as BrewRecipeStatus] - STATUS_RANK[b as BrewRecipeStatus] },
    { id: "beer", label: "Beer", key: (r) => r.beer ?? "", title: (b) => b || "Not linked" },
    { id: "style", label: "Style", key: (r) => r.style ?? "", title: (s) => s || "No style yet" },
  ], []);

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

  return (
    <DataTable
      id="brewery-recipes"
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      noun={["recipe", "recipes"]}
      searchText={(r) => `${r.name} ${r.style ?? ""} ${r.beer ?? ""}`}
      searchPlaceholder="Search recipes, styles, beers"
      filters={filters}
      groups={groups}
      defaultView={DEFAULT_VIEW}
      csvName="brewing-recipes"
      urlSearch={false}
      help="brewery.recipes"
      maxHeight="calc(100dvh - 12rem)"
      rowHref={(r) => `/brewery/recipes/${r.id}`}
      rowClassName={(r) => (r.status === "archived" ? "opacity-80" : undefined)}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "recipe" : "recipes" },
        ...(vis.some((r) => r.lineCount > 0 && r.unpricedLines > 0) ? [{ value: vis.filter((r) => r.lineCount > 0 && r.unpricedLines > 0).length, label: "need prices", tone: "warn" as const, filter: { id: "prices" } }] : []),
      ]}
      card={(r) => ({
        title: <span className="inline-flex min-w-0 items-center gap-2"><Swatch hex={r.colorHex} srm={r.srm} hasGrain={r.og > 1} />{r.name}</span>,
        subtitle: [r.style, r.beer && `pours as ${r.beer}`, `${qty(r.batchBbl, 1)} bbl · ${r.abv.toFixed(1)}% · ${Math.round(r.ibu)} IBU`].filter(Boolean).join(" · "),
        value: <PerPint r={r} />,
        sub: STATUS_LABEL[r.status],
      })}
    />
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
