"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import type { BrewStatus } from "@/domain/tankPlan";
import { money, shortDate } from "@/lib/format";
import type { BatchView } from "@/server/services/brewery";
import { useMemo } from "react";
import { abvText, BeerDot, bblText, gravityText, STATUS, StatusBadge } from "../bits";

/** The tabs: where a brew is in its life. */
const STAGE: Record<BrewStatus, string> = { PLANNED: "planned", FERMENTING: "tanks", CONDITIONING: "tanks", PACKAGED: "packaged", DUMPED: "dumped" };
const STAGES = [{ value: "planned", label: "Planned" }, { value: "tanks", label: "In tanks" }, { value: "packaged", label: "Packaged" }, { value: "dumped", label: "Dumped" }];
const STATUS_RANK: Record<BrewStatus, number> = { FERMENTING: 0, CONDITIONING: 1, PLANNED: 2, PACKAGED: 3, DUMPED: 4 };
/** Brew day, or the planned day for a brew not brewed yet. */
const day = (b: BatchView) => b.brewedOn ?? b.plannedOn;
const NO_RECIPE = "No recipe";

/** Every brew: search, stage tabs, beer, recipe and year filters, totals, CSV; each row opens the brew. */
export function BatchTable({ rows }: { rows: BatchView[] }) {
  const columns = useMemo<Column<BatchView>[]>(() => [
    {
      id: "brew", header: "Brew", width: 220, hideable: false, sort: (b) => b.name, csv: (b) => b.name,
      cell: (b) => (
        <span className="flex min-h-10 items-center gap-2.5">
          <BeerDot color={b.color} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{b.name}</span>
            <span className="num block text-xs text-muted">{b.code}</span>
          </span>
        </span>
      ),
    },
    { id: "code", header: "Code", width: 90, defaultHidden: true, sort: (b) => b.code, csv: (b) => b.code, cell: (b) => <span className="num">{b.code}</span> },
    { id: "recipe", header: "Recipe", width: 170, sort: (b) => b.recipeName, csv: (b) => b.recipeName ?? "", cell: (b) => <span className="text-ink-2">{b.recipeName ?? "—"}</span> },
    { id: "status", header: "Status", width: 120, sort: (b) => STATUS_RANK[b.status], csv: (b) => STATUS[b.status].label, cell: (b) => <StatusBadge status={b.status} /> },
    { id: "brewed", header: "Brewed", width: 100, firstDir: "desc", sort: (b) => day(b), csv: (b) => b.brewedOn ?? (b.plannedOn ? `planned ${b.plannedOn}` : ""), cell: (b) => <span className="num whitespace-nowrap">{b.brewedOn ? shortDate(b.brewedOn) : b.plannedOn ? <span className="text-muted">{shortDate(b.plannedOn)}</span> : "—"}</span> },
    { id: "packaged", header: "Packaged", width: 100, firstDir: "desc", sort: (b) => b.packagedOn, csv: (b) => b.packagedOn ?? "", cell: (b) => <span className="num whitespace-nowrap">{b.packagedOn ? shortDate(b.packagedOn) : "—"}</span> },
    { id: "bbl", header: "Volume", align: "right", width: 90, firstDir: "desc", sort: (b) => b.bbl, csv: (b) => b.bbl ?? "", cell: (b) => bblText(b.bbl), total: (l) => bblText(l.reduce((s, b) => s + (b.bbl ?? 0), 0)) },
    { id: "og", header: "OG", align: "right", width: 70, defaultHidden: true, sort: (b) => b.og, csv: (b) => b.og ?? "", cell: (b) => gravityText(b.og) },
    { id: "fg", header: "FG", align: "right", width: 70, defaultHidden: true, sort: (b) => b.fg, csv: (b) => b.fg ?? "", cell: (b) => gravityText(b.fg) },
    { id: "abv", header: "ABV", align: "right", width: 70, firstDir: "desc", sort: (b) => b.abv, csv: (b) => b.abv ?? "", cell: (b) => abvText(b.abv) },
    { id: "cost", header: "Cost", align: "right", width: 90, firstDir: "desc", sort: (b) => b.cost, csv: (b) => b.cost ?? "", cell: (b) => (b.cost != null ? money(b.cost, { whole: true }) : <span className="text-muted">—</span>), total: (l) => money(l.reduce((s, b) => s + (b.cost ?? 0), 0), { whole: true }) },
    { id: "pint", header: "Per pint", align: "right", width: 90, firstDir: "desc", sort: (b) => b.costPerPint, csv: (b) => b.costPerPint ?? "", cell: (b) => (b.costPerPint != null ? money(b.costPerPint) : <span className="text-muted">—</span>) },
    { id: "kegs", header: "Keg batch", width: 100, defaultHidden: true, sort: (b) => b.kegBatchCode, csv: (b) => b.kegBatchCode ?? "", cell: (b) => <span className="num text-muted">{b.kegBatchCode ?? "—"}</span> },
  ], []);

  const filters = useMemo<Filter<BatchView>[]>(() => [
    { id: "show", label: "Show", kind: "facet", display: "segmented", single: true, allLabel: "All", param: "show", values: (b) => STAGE[b.status], options: STAGES.filter((s) => s.value !== "dumped" || rows.some((b) => b.status === "DUMPED")) },
    { id: "beer", label: "Beer", kind: "facet", param: "beer", values: (b) => b.beerId ?? "none", options: beerOptions(rows) },
    { id: "recipe", label: "Recipe", kind: "facet", param: "recipe", values: (b) => b.recipeId ?? "none", options: recipeOptions(rows) },
    { id: "year", label: "Year", kind: "facet", param: "year", values: (b) => day(b)?.slice(0, 4) ?? "none", options: yearOptions(rows) },
    { id: "nocost", label: "No cost yet", kind: "toggle", test: (b) => b.status !== "PLANNED" && b.cost == null },
  ], [rows]);

  const groups = useMemo<GroupBy<BatchView>[]>(() => [
    { id: "status", label: "Status", key: (b) => b.status, title: (s) => STATUS[s as BrewStatus]?.label ?? s, order: (a, b) => STATUS_RANK[a as BrewStatus] - STATUS_RANK[b as BrewStatus] },
    { id: "beer", label: "Beer", key: (b) => b.name },
    { id: "recipe", label: "Recipe", key: (b) => b.recipeName ?? NO_RECIPE },
    { id: "year", label: "Year", key: (b) => day(b)?.slice(0, 4) ?? "", title: (y) => y || "No date", order: (a, b) => (a === "" ? 1 : b === "" ? -1 : b.localeCompare(a)) },
  ], []);

  return (
    <DataTable
      id="brewery-batches"
      rows={rows}
      rowKey={(b) => b.id}
      columns={columns}
      noun={["brew", "brews"]}
      searchText={(b) => `${b.code} ${b.name} ${b.recipeName ?? ""} ${b.kegBatchCode ?? ""}`}
      searchPlaceholder="Search code, beer, recipe"
      filters={filters}
      groups={groups}
      csvName="brews"
      help="brewery.batches"
      totals="Total"
      rowHref={(b) => `/brewery/batches/${b.id}`}
      rowClassName={(b) => (b.status === "DUMPED" ? "opacity-60" : undefined)}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "brew" : "brews" },
        { value: bblText(vis.reduce((s, b) => s + (b.bbl ?? 0), 0)), label: "in all" },
        ...(vis.some((b) => b.status !== "PLANNED" && b.cost == null) ? [{ value: vis.filter((b) => b.status !== "PLANNED" && b.cost == null).length, label: "with no cost yet", tone: "warn" as const, filter: { id: "nocost" } }] : []),
      ]}
      card={(b) => ({
        title: <span className="inline-flex items-center gap-2"><BeerDot color={b.color} />{b.name}</span>,
        subtitle: <span className="num">{b.code} · {STATUS[b.status].label.toLowerCase()}{b.brewedOn ? ` · brewed ${shortDate(b.brewedOn)}` : b.plannedOn ? ` · for ${shortDate(b.plannedOn)}` : ""}</span>,
        value: bblText(b.bbl),
        sub: b.costPerPint != null ? `${money(b.costPerPint)} a pint` : abvText(b.abv),
      })}
    />
  );
}

function beerOptions(rows: BatchView[]) {
  const seen = new Map<string, string>();
  for (const b of rows) if (b.beerId) seen.set(b.beerId, b.name);
  const list = [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  return rows.some((b) => !b.beerId) ? [...list, { value: "none", label: "No beer" }] : list;
}

function recipeOptions(rows: BatchView[]) {
  const seen = new Map<string, string>();
  for (const b of rows) if (b.recipeId && b.recipeName) seen.set(b.recipeId, b.recipeName);
  const list = [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  return rows.some((b) => !b.recipeId) ? [...list, { value: "none", label: NO_RECIPE }] : list;
}

function yearOptions(rows: BatchView[]) {
  const years = [...new Set(rows.map((b) => day(b)?.slice(0, 4) ?? "none"))].sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : b.localeCompare(a)));
  return years.map((y) => ({ value: y, label: y === "none" ? "No date" : y }));
}
