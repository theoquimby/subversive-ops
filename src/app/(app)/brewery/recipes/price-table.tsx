"use client";

import { GridCell } from "@/components/grid";
import { Card, cx, EmptyState, Field, LinkButton, Select } from "@/components/ui";
import { money, shortDate } from "@/lib/format";
import type { BrewPriceRow } from "@/server/services/brewRecipes";
import Link from "next/link";
import { useState } from "react";
import { setBrewingPriceAction } from "./actions";

const HOW: Record<string, string> = { IMPORT: "price sheet or invoice", MANUAL: "typed in", SCRAPE: "supplier website" };

/**
 * Brewing ingredients with today's price per lb (or package, or gallon). Type a
 * price to record it; it goes into the same price history the menu costs use.
 */
export function PriceTable({ rows, suppliers }: { rows: BrewPriceRow[]; suppliers: { id: string; name: string }[] }) {
  const [supplierId, setSupplierId] = useState("");
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
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[0.75rem] text-muted">
              <th className="border-b border-border px-4 py-2.5 text-left font-medium">Ingredient</th>
              <th className="hidden border-b border-border px-4 py-2.5 text-right font-medium sm:table-cell">Recipes</th>
              <th className="border-b border-border px-2 py-2.5 text-right font-medium">Price</th>
              <th className="hidden border-b border-border px-4 py-2.5 text-left font-medium md:table-cell">Where it came from</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="border-b border-border px-4 py-2.5 [tr:last-child_&]:border-b-0">
                  <Link href={`/ingredients/${r.id}`} className="font-medium text-ink hover:underline">{r.name}</Link>
                  <div className="text-xs text-muted">
                    {r.category}
                    <span className="md:hidden">{r.source ? ` · ${r.source.supplier}, ${shortDate(r.source.date)}` : ""}</span>
                  </div>
                </td>
                <td className="num hidden border-b border-border px-4 py-2.5 text-right text-ink-2 sm:table-cell [tr:last-child_&]:border-b-0">{r.usedBy || "—"}</td>
                <td className="w-40 border-b border-border px-2 py-1.5 [tr:last-child_&]:border-b-0">
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
                </td>
                <td className={cx("hidden border-b border-border px-4 py-2.5 text-xs md:table-cell [tr:last-child_&]:border-b-0", r.source ? "text-muted" : "text-warn")}>
                  {r.source ? `${r.source.supplier} · ${HOW[r.source.how] ?? "price list"} · ${shortDate(r.source.date)}` : "No price yet"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
