"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { GridCell } from "@/components/grid";
import { EmptyState, Field, LinkButton, Select } from "@/components/ui";
import { money, shortDate } from "@/lib/format";
import type { BrewPriceRow } from "@/server/services/brewRecipes";
import Link from "next/link";
import { useMemo, useState } from "react";
import { setBrewingPriceAction } from "./actions";

const HOW: Record<string, string> = { IMPORT: "price sheet or invoice", MANUAL: "typed in", SCRAPE: "supplier website" };
const sourceText = (r: BrewPriceRow) => (r.source ? `${r.source.supplier} · ${HOW[r.source.how] ?? "price list"} · ${shortDate(r.source.date)}` : "No price yet");

/**
 * Brewing ingredients with today's price per lb (or package, or gallon). Type a
 * price to record it; it goes into the same price history the menu costs use.
 * Search, category and "no price yet" filters; the ones with no price come first.
 */
export function PriceTable({ rows, suppliers }: { rows: BrewPriceRow[]; suppliers: { id: string; name: string }[] }) {
  const [supplierId, setSupplierId] = useState("");
  const columns = useMemo<Column<BrewPriceRow>[]>(() => [
    {
      id: "name", header: "Ingredient", width: 230, hideable: false, sort: (r) => r.name, csv: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/ingredients/${r.id}`} className="font-medium text-ink hover:underline">{r.name}</Link>
          <div className="text-xs text-muted">{r.category}</div>
        </div>
      ),
    },
    { id: "category", header: "Category", width: 120, defaultHidden: true, sort: (r) => r.category, csv: (r) => r.category, cell: (r) => <span className="text-ink-2">{r.category}</span> },
    { id: "used", header: "Recipes", align: "right", width: 80, firstDir: "desc", sort: (r) => r.usedBy, csv: (r) => r.usedBy, cell: (r) => <span className="text-ink-2">{r.usedBy || "—"}</span> },
    {
      id: "price", header: "Price", align: "right", edit: true, width: 170, firstDir: "desc", sort: (r) => r.price, csv: (r) => (r.price == null ? "" : Number(r.price.toFixed(2))),
      cell: (r) => (
        <div>
          <GridCell
            grid="brew-prices"
            col="price"
            type="number"
            prefix="$"
            suffix={`/ ${r.unit}`}
            decimals={2}
            value={r.price == null ? null : Number(r.price.toFixed(2))}
            placeholder="No price"
            ariaLabel={`${r.name} price per ${r.unit}`}
            onSave={(v) => setBrewingPriceAction(r.id, v, r.unit, supplierId || null)}
          />
          {r.perOz != null && r.category === "Hops" && <div className="num px-2 text-right text-xs text-muted">{money(r.perOz)} / oz</div>}
        </div>
      ),
    },
    { id: "unit", header: "Per", width: 70, defaultHidden: true, sort: (r) => r.unit, csv: (r) => r.unit, cell: (r) => <span className="text-muted">{r.unit}</span> },
    { id: "source", header: "Where it came from", width: 260, sort: (r) => r.source?.date ?? null, csv: (r) => sourceText(r), cell: (r) => <span className={r.source ? "text-xs text-muted" : "text-xs text-warn"}>{sourceText(r)}</span> },
  ], [supplierId]);

  const filters = useMemo<Filter<BrewPriceRow>[]>(() => [
    { id: "category", label: "Category", kind: "facet", values: (r) => r.category },
    { id: "unpriced", label: "No price yet", kind: "toggle", tone: "warn", test: (r) => r.price == null },
    { id: "used", label: "In a recipe", kind: "toggle", test: (r) => r.usedBy > 0 },
    { id: "supplier", label: "Supplier", kind: "facet", values: (r) => r.source?.supplier || "No supplier" },
  ], []);

  const groups = useMemo<GroupBy<BrewPriceRow>[]>(() => [{ id: "category", label: "Category", key: (r) => r.category }], []);

  if (!rows.length) {
    return (
      <EmptyState title="No brewing ingredients yet" action={<LinkButton href="/brewery/recipes/new">New recipe</LinkButton>}>
        Match a recipe line to an ingredient, or add it as a new one from the recipe, and it shows here to price.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <Field label="Prices you type are from" className="w-full sm:w-72">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} searchable options={[{ value: "", label: "No supplier in particular" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} aria-label="Supplier for typed prices" />
        </Field>
        <p className="min-w-0 flex-1 basis-64 pb-2 text-xs text-muted">
          Price sheets and invoices from your maltster and hop suppliers keep these current on their own once their products are linked to these ingredients (<Link href="/prices" className="underline underline-offset-2 hover:text-ink">Prices</Link>).
        </p>
      </div>
      <DataTable
        id="brewery-prices"
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        noun={["ingredient", "ingredients"]}
        searchText={(r) => `${r.name} ${r.category} ${r.source?.supplier ?? ""}`}
        searchPlaceholder="Search ingredients"
        filters={filters}
        groups={groups}
        csvName="brewing-prices"
        urlSearch={false}
        help="brewery.recipes.prices"
        maxHeight="36rem"
        summary={(vis) => [
          { value: vis.length, label: vis.length === 1 ? "ingredient" : "ingredients" },
          ...(vis.some((r) => r.price == null) ? [{ value: vis.filter((r) => r.price == null).length, label: "with no price yet", tone: "warn" as const, filter: { id: "unpriced" } }] : []),
        ]}
        card={(r) => ({
          title: r.name,
          subtitle: `${r.category}${r.usedBy ? ` · in ${r.usedBy} recipe${r.usedBy === 1 ? "" : "s"}` : ""}`,
          value: r.price == null ? <span className="text-warn">No price</span> : `${money(r.price)} / ${r.unit}`,
          sub: r.source ? `${r.source.supplier}, ${shortDate(r.source.date)}` : undefined,
        })}
        drawerTitle={(r) => r.name}
        rowHref={(r) => `/ingredients/${r.id}`}
        drawer={(r) => (
          <div className="space-y-3">
            <div>
              <div className="mb-0.5 text-[0.8rem] font-medium text-ink-2">Price per {r.unit}</div>
              <GridCell grid="brew-prices-d" col="price" type="number" prefix="$" suffix={`/ ${r.unit}`} decimals={2} value={r.price == null ? null : Number(r.price.toFixed(2))} placeholder="No price" ariaLabel={`${r.name} price per ${r.unit}`} onSave={(v) => setBrewingPriceAction(r.id, v, r.unit, supplierId || null)} />
              {r.perOz != null && r.category === "Hops" && <div className="num mt-0.5 px-2 text-xs text-muted">{money(r.perOz)} / oz</div>}
            </div>
            <p className="text-sm text-muted">{sourceText(r)}. Used in {r.usedBy || "no"} recipe{r.usedBy === 1 ? "" : "s"}.</p>
          </div>
        )}
      />
    </div>
  );
}
