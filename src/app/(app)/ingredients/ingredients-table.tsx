"use client";

import { BulkPick, BulkValue, DataTable, DetailRow, Sparkline, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, cx, EmptyState, LinkButton } from "@/components/ui";
import { money, qty as fmtQty, shortDate } from "@/lib/format";
import { setIngredientField } from "@/server/actions/inline";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { archiveIngredients, bulkSetIngredients, bulkSetMinOnHand } from "./actions";
import { ArchiveIngredientButton } from "./archive-buttons";
import { MinOnHandCell } from "./min-on-hand-cell";

export interface IngredientRow {
  id: string;
  name: string;
  category: string;
  storage: string;
  /** Usable cost per display unit (after yield). */
  cost: number | null;
  costUnit: string;
  yieldPct: number;
  bufferPct: number;
  units: string[];
  countUnit: string;
  /** Estimated on hand, in the count unit. */
  onHand: number | null;
  countedOn: string | null;
  /** Minimum on hand, in the count unit. */
  par: number | null;
  hasSupplier: boolean;
  recipes: string[];
  products: { id: string; supplier: string; description: string; sku: string; pack: string | null; unit: string; preferred: boolean }[];
  history: { date: string; price: number }[];
}

const below = (i: IngredientRow) => i.par != null && i.onHand != null && i.onHand < i.par;

/** `areas`: storage areas in walking order (Counts → storage areas), plus any in use. */
export function IngredientsTable({ rows, areas: areaNames }: { rows: IngredientRow[]; areas: string[] }) {
  const confirm = useConfirm();
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort().map((c) => ({ value: c, label: c })), [rows]);
  const areas = useMemo(() => areaNames.map((c) => ({ value: c, label: c })), [areaNames]);

  const columns = useMemo<Column<IngredientRow>[]>(() => [
    {
      id: "name",
      header: "Ingredient",
      edit: true,
      width: 280,
      sort: (i) => i.name,
      csv: (i) => i.name,
      cell: (i) => (
        <div className="flex items-center gap-1">
          <GridCell grid="ing" col="name" value={i.name} onSave={setIngredientField.bind(null, i.id, "name")} ariaLabel="Name" className="min-w-0 flex-1 font-medium" />
          {!i.hasSupplier && <Badge tone="warn">No supplier</Badge>}
          <Link href={`/ingredients/${i.id}`} className="relative shrink-0 rounded-md p-1.5 text-muted after:absolute after:-inset-1 after:content-[''] hover:bg-surface-2 hover:text-ink" aria-label={`Open ${i.name}`}>
            <ArrowUpRight className="size-4" />
          </Link>
          <ArchiveIngredientButton id={i.id} name={i.name} usedIn={i.recipes.length} />
        </div>
      ),
    },
    { id: "category", header: "Category", edit: true, width: 150, sort: (i) => i.category, csv: (i) => i.category, cell: (i) => <GridCell grid="ing" col="category" value={i.category} onSave={setIngredientField.bind(null, i.id, "category")} ariaLabel="Category" /> },
    { id: "storage", header: "Storage", edit: true, width: 190, sort: (i) => i.storage, csv: (i) => i.storage, cell: (i) => <GridCell grid="ing" col="storage" value={i.storage} onSave={setIngredientField.bind(null, i.id, "storageArea")} ariaLabel="Storage area" /> },
    {
      id: "cost",
      header: "Cost",
      help: "ingredients.cost",
      align: "right",
      firstDir: "desc",
      sort: (i) => i.cost,
      csv: (i) => i.cost,
      cell: (i) => (i.cost == null ? <span className="text-warn">No price</span> : <span className="whitespace-nowrap">{money(i.cost)}<span className="text-muted">/{i.costUnit}</span></span>),
    },
    { id: "yield", header: "Yield", help: "ingredients.yield", align: "right", edit: true, width: 96, sort: (i) => i.yieldPct, csv: (i) => i.yieldPct, cell: (i) => <GridCell grid="ing" col="yield" type="number" suffix="%" value={i.yieldPct} onSave={setIngredientField.bind(null, i.id, "yieldPct")} ariaLabel="Yield percent" /> },
    { id: "buffer", header: "Buffer", help: "ingredients.buffer", align: "right", edit: true, width: 96, sort: (i) => i.bufferPct, csv: (i) => i.bufferPct, cell: (i) => <GridCell grid="ing" col="buffer" type="number" suffix="%" value={i.bufferPct} onSave={setIngredientField.bind(null, i.id, "safetyPct")} ariaLabel="Order buffer percent" /> },
    { id: "countIn", header: "Count in", help: "ingredients.countIn", edit: true, width: 120, sort: (i) => i.countUnit, csv: (i) => i.countUnit, cell: (i) => <GridSelect value={i.countUnit} options={i.units.map((u) => ({ value: u, label: u }))} onSave={setIngredientField.bind(null, i.id, "countUnit")} ariaLabel="Count unit" /> },
    {
      id: "onHand",
      header: "On hand (est.)",
      help: "ingredients.onHand",
      align: "right",
      firstDir: "desc",
      sort: (i) => i.onHand,
      csv: (i) => i.onHand,
      cell: (i) =>
        i.onHand == null ? <span className="text-muted">Not counted</span> : (
          <div className="whitespace-nowrap">
            <span className={cx(below(i) && "font-medium text-warn")}>{fmtQty(i.onHand, 1)}</span> <span className="text-muted">{i.countUnit}</span>
            {i.countedOn && <div className="text-xs text-muted">counted {shortDate(i.countedOn)}</div>}
          </div>
        ),
    },
    { id: "par", header: "Min on hand", help: "ingredients.minOnHand", align: "right", edit: true, width: 120, sort: (i) => i.par, csv: (i) => i.par, cell: (i) => <MinOnHandCell id={i.id} value={i.par} unit={i.countUnit} /> },
    { id: "recipes", header: "Used in", align: "right", firstDir: "desc", sort: (i) => i.recipes.length, csv: (i) => i.recipes.length, cell: (i) => (i.recipes.length ? <span className="text-ink-2">{i.recipes.length}</span> : <span className="text-muted">—</span>), defaultHidden: true },
    { id: "products", header: "Products", align: "right", firstDir: "desc", sort: (i) => i.products.length, csv: (i) => i.products.length, cell: (i) => <span className="text-ink-2">{i.products.length || "—"}</span>, defaultHidden: true },
  ], []);

  const filters = useMemo<Filter<IngredientRow>[]>(() => [
    { id: "category", label: "Category", kind: "facet", values: (i) => i.category, param: "category" },
    { id: "storage", label: "Storage", kind: "facet", values: (i) => i.storage, options: areas.filter((a) => rows.some((r) => r.storage === a.value)), param: "storage" },
    { id: "nosupplier", label: "No supplier", kind: "toggle", test: (i) => !i.hasSupplier, tone: "warn" },
    { id: "noprice", label: "No price", kind: "toggle", test: (i) => i.cost == null, tone: "warn" },
    { id: "below", label: "Below minimum", kind: "toggle", test: below, tone: "bad", param: "below" },
    { id: "notcounted", label: "Not counted", kind: "toggle", test: (i) => i.onHand == null },
    { id: "unused", label: "Not in any recipe", kind: "toggle", test: (i) => i.recipes.length === 0 },
  ], [areas, rows]);

  const groups = useMemo<GroupBy<IngredientRow>[]>(() => [
    { id: "category", label: "Category", key: (i) => i.category },
    { id: "storage", label: "Storage area", key: (i) => i.storage, order: (a, b) => areaNames.indexOf(a) - areaNames.indexOf(b) },
  ], [areaNames]);

  return (
    <DataTable
      id="ingredients"
      help="ingredients.grid"
      tours={{ root: "ingredients.grid", search: "ingredients.search" }}
      rows={rows}
      rowKey={(i) => i.id}
      columns={columns}
      noun={["ingredient", "ingredients"]}
      searchText={(i) => `${i.name} ${i.category} ${i.storage} ${i.products.map((p) => `${p.description} ${p.sku} ${p.supplier}`).join(" ")}`}
      filters={filters}
      groups={groups}
      empty={<EmptyState title="No ingredients yet" action={<LinkButton href="/ingredients/new">Add one</LinkButton>}>Add ingredients by hand, import a sheet, or link supplier products on Prices.</EmptyState>}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "ingredient" : "ingredients" },
        { value: vis.filter((i) => !i.hasSupplier).length, label: "with no supplier", tone: "warn", filter: { id: "nosupplier" } },
        { value: vis.filter((i) => i.cost == null).length, label: "without a price", tone: "warn", filter: { id: "noprice" } },
        { value: vis.filter(below).length, label: "below minimum", tone: "bad", filter: { id: "below" } },
        { value: vis.filter((i) => !i.recipes.length).length, label: "not in a recipe", filter: { id: "unused" } },
      ]}
      card={(i) => ({
        title: i.name,
        subtitle: <>{i.category} · {i.storage}{i.recipes.length ? ` · in ${i.recipes.length} recipe${i.recipes.length === 1 ? "" : "s"}` : ""}</>,
        value: i.cost == null ? <span className="text-warn">No price</span> : <>{money(i.cost)}<span className="text-xs font-normal text-muted">/{i.costUnit}</span></>,
        sub: i.onHand == null ? "not counted" : <span className={below(i) ? "text-warn" : undefined}>{fmtQty(i.onHand, 1)} {i.countUnit}</span>,
      })}
      rowHref={(i) => `/ingredients/${i.id}`}
      drawerTitle={(i) => i.name}
      drawer={(i) => <IngredientDetail i={i} />}
      bulkActions={(api) => (
        <>
          <BulkPick label="Category" options={categories} allowNew newLabel="New category" disabled={api.pending} onPick={(v) => api.run(() => bulkSetIngredients(api.keys, "category", v))} />
          <BulkPick label="Storage" options={areas} allowNew newLabel="New area" disabled={api.pending} onPick={(v) => api.run(() => bulkSetIngredients(api.keys, "storageArea", v))} />
          <BulkValue label="Buffer" suffix="%" placeholder="10" disabled={api.pending} onApply={(v) => api.run(() => bulkSetIngredients(api.keys, "safetyPct", v || "10"))} />
          <BulkValue label="Min on hand" placeholder="blank clears" disabled={api.pending} onApply={(v) => api.run(() => bulkSetMinOnHand(api.keys, v))} />
          <button type="button" disabled={api.pending} className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-bad hover:bg-bad-bg disabled:opacity-50" onClick={async () => {
            const used = api.rows.filter((r) => r.recipes.length).length;
            if (await confirm({ title: `Archive ${api.keys.length - used} ingredient${api.keys.length - used === 1 ? "" : "s"}?`, body: `They drop out of counts, ordering and this list; price history is kept.${used ? ` ${used} still in recipes will be skipped.` : ""}`, confirmLabel: "Archive", danger: true })) api.run(() => archiveIngredients(api.keys));
          }}>Archive</button>
        </>
      )}
    />
  );
}

function IngredientDetail({ i }: { i: IngredientRow }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted">Cost after yield</div>
          <div className="num mt-1 text-lg font-semibold">{i.cost == null ? <span className="text-warn">No price</span> : <>{money(i.cost)}<span className="text-sm font-normal text-muted">/{i.costUnit}</span></>}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted">On hand (est.)</div>
          <div className={cx("num mt-1 text-lg font-semibold", below(i) && "text-warn")}>{i.onHand == null ? <span className="text-muted">Not counted</span> : <>{fmtQty(i.onHand, 1)} <span className="text-sm font-normal text-muted">{i.countUnit}</span></>}</div>
        </div>
      </div>
      <section>
        <DetailRow label="Category">{i.category}</DetailRow>
        <DetailRow label="Storage">{i.storage}</DetailRow>
        <DetailRow label="Yield">{i.yieldPct}%</DetailRow>
        <DetailRow label="Order buffer">{i.bufferPct}%</DetailRow>
        <DetailRow label="Min on hand">{i.par == null ? "—" : `${i.par} ${i.countUnit}`}</DetailRow>
      </section>
      <section>
        <div className="mb-2 text-xs font-medium text-muted">Price of the preferred product</div>
        {i.history.length > 1 ? <Sparkline points={i.history.map((h) => ({ date: h.date, value: h.price }))} /> : <p className="text-sm text-muted">{i.history.length ? `${money(i.history[0].price)} since ${shortDate(i.history[0].date)}.` : "No price history yet."}</p>}
      </section>
      <section>
        <div className="mb-2 text-xs font-medium text-muted">Bought as</div>
        {i.products.length === 0 ? <p className="text-sm text-muted">No supplier product linked. Link one on <Link href="/prices?filter=unlinked" className="underline underline-offset-2">Prices</Link>.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {i.products.map((p) => (
              <li key={p.id} className="px-3 py-2 text-sm">
                <div className="flex items-center gap-2"><span className="min-w-0 flex-1 font-medium">{p.description}</span>{p.preferred && <Badge tone="good">Preferred</Badge>}</div>
                <div className="text-xs text-muted">{p.supplier} · #{p.sku}{p.pack ? ` · ${p.pack}` : ""} · per {p.unit}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="mb-2 text-xs font-medium text-muted">Used in {i.recipes.length} recipe{i.recipes.length === 1 ? "" : "s"}</div>
        {i.recipes.length === 0 ? <p className="text-sm text-muted">Not in any recipe yet.</p> : (
          <div className="flex flex-wrap gap-1.5">{i.recipes.map((r) => <span key={r} className="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-2">{r}</span>)}</div>
        )}
      </section>
    </div>
  );
}
