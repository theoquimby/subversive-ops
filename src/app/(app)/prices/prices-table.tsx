"use client";

import { BulkPick, DataTable, DetailRow, Sparkline, type Column, type Filter, type FilterOption, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, cx, EmptyState, LinkButton } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { money, shortDate, signedPct } from "@/lib/format";
import { linkProductToIngredient, setProductPrice } from "@/server/actions/inline";
import Link from "next/link";
import { useMemo } from "react";
import { createIngredientsFromProducts, linkProduct, linkProducts, setProductsActive } from "./actions";

export interface PriceRow {
  id: string;
  description: string;
  sku: string;
  supplierId: string;
  supplier: string;
  packText: string | null;
  purchaseUnit: string;
  packQtyBase: number | null;
  ingredientId: string | null;
  ingredient: string | null;
  category: string | null;
  storage: string | null;
  usedIn: number;
  price: number | null;
  /** Change vs 30 days ago (null when flat or unknown). */
  change: number | null;
  since: string | null;
  history: { date: string; price: number }[];
}

const changeBadge = (c: number | null) => (c == null ? <span className="text-muted">—</span> : <Badge tone={c > 0 ? "bad" : "good"}>{signedPct(c)}</Badge>);

function LinkCell({ p, ingredients }: { p: PriceRow; ingredients: FilterOption[] }) {
  if (p.ingredientId) return <Link href={`/ingredients/${p.ingredientId}`} className="text-ink-2 hover:text-ink hover:underline">{p.ingredient}</Link>;
  return (
    <div className="flex items-center gap-1">
      <GridSelect value="" options={[{ value: "", label: "Link to ingredient…" }, ...ingredients]} onSave={linkProductToIngredient.bind(null, p.id)} ariaLabel={`Link ${p.description}`} className="max-w-48 min-w-0 border-border text-warn" />
      <form action={linkProduct.bind(null, p.id)} className="shrink-0">
        <input type="hidden" name="ingredientId" value="__new" />
        <input type="hidden" name="newBase" value="g" />
        <Button size="sm" variant="ghost" title="Create a new ingredient from this product">+ New</Button>
      </form>
    </div>
  );
}

export function PricesTable({ rows, ingredients, hiddenView, today }: { rows: PriceRow[]; ingredients: FilterOption[]; hiddenView: boolean; today: string }) {
  const confirm = useConfirm();
  const monthAgo = addDays(today, -30);

  const columns = useMemo<Column<PriceRow>[]>(() => [
    {
      id: "item",
      header: "Item",
      width: 300,
      hideable: false,
      sort: (p) => p.description,
      csv: (p) => p.description,
      cell: (p) => (
        <div className="min-w-0">
          <div className="font-medium break-words text-ink">{p.description}</div>
          <div className="text-xs text-muted">#{p.sku}</div>
        </div>
      ),
    },
    { id: "supplier", header: "Supplier", sort: (p) => p.supplier, cell: (p) => <span className="text-ink-2">{p.supplier}</span> },
    { id: "sku", header: "Item #", sort: (p) => p.sku, cell: (p) => <span className="num text-ink-2">{p.sku}</span>, defaultHidden: true },
    { id: "pack", header: "Pack", sort: (p) => p.packText, cell: (p) => (p.packText ? <span className="text-ink-2">{p.packText}</span> : <span className="text-muted">—</span>) },
    {
      id: "ingredient",
      header: "Ingredient",
      help: "prices.link",
      edit: true,
      width: 220,
      sort: (p) => p.ingredient,
      csv: (p) => p.ingredient,
      cell: (p) => <div className="px-1.5"><LinkCell p={p} ingredients={ingredients} /></div>,
      total: (rs) => { const n = rs.filter((r) => !r.ingredientId).length; return n ? <span className="text-xs font-normal text-warn">{n} not linked</span> : null; },
    },
    { id: "category", header: "Category", sort: (p) => p.category, cell: (p) => p.category ?? <span className="text-muted">—</span>, defaultHidden: true },
    { id: "storage", header: "Storage", sort: (p) => p.storage, cell: (p) => p.storage ?? <span className="text-muted">—</span>, defaultHidden: true },
    {
      id: "price",
      header: "Price",
      help: "prices.list.price",
      align: "right",
      edit: true,
      width: 170,
      firstDir: "desc",
      sort: (p) => p.price,
      csv: (p) => p.price,
      cell: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          <GridCell grid="prices" col="price" type="number" prefix="$" decimals={2} value={p.price} onSave={setProductPrice.bind(null, p.id)} ariaLabel={`${p.description} price per ${p.purchaseUnit}`} className="w-24 shrink-0" />
          <span className="w-14 shrink-0 truncate text-left text-xs text-muted" title={p.purchaseUnit}>/ {p.purchaseUnit}</span>
        </div>
      ),
    },
    { id: "change", header: "vs 30 days ago", label: "Change vs 30 days ago", align: "right", firstDir: "desc", sort: (p) => p.change, cell: (p) => changeBadge(p.change), total: (rs) => { const up = rs.filter((r) => (r.change ?? 0) > 0).length; return up ? <span className="text-xs text-bad">{up} up</span> : null; } },
    { id: "since", header: "Price since", align: "right", firstDir: "desc", sort: (p) => p.since, cell: (p) => (p.since ? <span className="text-ink-2">{shortDate(p.since)}</span> : <span className="text-muted">—</span>), defaultHidden: true },
  ], [ingredients]);

  const filters = useMemo<Filter<PriceRow>[]>(() => {
    const suppliers = [...new Map(rows.map((r) => [r.supplierId, r.supplier])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
    return [
      { id: "supplier", label: "Supplier", kind: "facet", values: (p) => p.supplierId, options: suppliers, param: "supplier" },
      { id: "link", label: "Ingredient", kind: "facet", values: (p) => (p.ingredientId ? "linked" : "unlinked"), options: [{ value: "unlinked", label: "Not linked" }, { value: "linked", label: "Linked" }], single: true, param: "filter" },
      { id: "category", label: "Category", kind: "facet", values: (p) => p.category ?? "No category" },
      { id: "rose", label: "Price rose", kind: "toggle", test: (p) => (p.change ?? 0) > 0, tone: "bad", param: "rose" },
      { id: "recent", label: "Changed this month", kind: "toggle", test: (p) => !!p.since && p.since >= monthAgo && p.history.length > 1 },
      { id: "noprice", label: "No price", kind: "toggle", test: (p) => p.price == null, tone: "warn" },
      { id: "nopack", label: "No pack size", kind: "toggle", test: (p) => !!p.ingredientId && p.packQtyBase == null, tone: "warn" },
    ];
  }, [rows, monthAgo]);

  const groups = useMemo<GroupBy<PriceRow>[]>(() => [
    { id: "supplier", label: "Supplier", key: (p) => p.supplier },
    { id: "category", label: "Ingredient category", key: (p) => p.category, title: (k) => k || "Not linked" },
    { id: "storage", label: "Storage area", key: (p) => p.storage, title: (k) => k || "Not linked" },
    { id: "ingredient", label: "Ingredient", key: (p) => p.ingredient, title: (k) => k || "Not linked" },
  ], []);

  const empty = hiddenView ? (
    <EmptyState title="Nothing hidden" action={<LinkButton href="/prices">Back to prices</LinkButton>}>Products you hide show up here so you can bring them back.</EmptyState>
  ) : (
    <EmptyState title="No products yet" action={<LinkButton href="/prices/import">Import a price sheet</LinkButton>}>Import a distributor sheet or add products by hand.</EmptyState>
  );

  return (
    <DataTable
      id={hiddenView ? "prices-hidden" : "prices"}
      help="prices.list"
      tours={{ toolbar: "prices.filters" }}
      rows={rows}
      rowKey={(p) => p.id}
      columns={columns}
      noun={["product", "products"]}
      searchText={(p) => `${p.description} ${p.sku} ${p.supplier} ${p.ingredient ?? ""} ${p.packText ?? ""}`}
      searchPlaceholder="Search products"
      filters={filters}
      groups={groups}
      csvName="prices"
      empty={empty}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "product" : "products" },
        { value: vis.filter((p) => !p.ingredientId).length, label: "not linked", tone: "warn", filter: { id: "link", value: "unlinked" } },
        { value: vis.filter((p) => (p.change ?? 0) > 0).length, label: "price rises in 30 days", tone: "bad", filter: { id: "rose" } },
        { value: vis.filter((p) => p.price == null).length, label: "without a price", filter: { id: "noprice" } },
      ]}
      card={(p) => ({
        title: p.description,
        subtitle: <>{p.supplier} · #{p.sku}{p.packText ? ` · ${p.packText}` : ""}{!p.ingredientId && <span className="text-warn"> · not linked</span>}</>,
        value: p.price == null ? <span className="text-warn">No price</span> : money(p.price),
        sub: p.change != null ? <span className={p.change > 0 ? "text-bad" : "text-good"}>{signedPct(p.change)}</span> : `/ ${p.purchaseUnit}`,
      })}
      drawerTitle={(p) => p.description}
      rowHref={(p) => (p.ingredientId ? `/ingredients/${p.ingredientId}` : null)}
      drawer={(p) => <ProductDetail p={p} ingredients={ingredients} />}
      bulkActions={(api) => (
        <>
          {!hiddenView && <BulkPick label="Link to ingredient" options={ingredients} disabled={api.pending} onPick={(id) => api.run(() => linkProducts(api.keys, id))} />}
          {!hiddenView && api.rows.some((r) => !r.ingredientId) && (
            <Button size="sm" disabled={api.pending} onClick={async () => {
              const n = api.rows.filter((r) => !r.ingredientId).length;
              if (await confirm({ title: `Create ${n} ingredient${n === 1 ? "" : "s"}?`, body: "One per product not linked yet, named after it and counted in grams. Fix units afterwards on Ingredients.", confirmLabel: "Create" })) api.run(() => createIngredientsFromProducts(api.keys));
            }}>New ingredient each</Button>
          )}
          {hiddenView ? (
            <Button size="sm" disabled={api.pending} onClick={() => api.run(() => setProductsActive(api.keys, true))}>Restore</Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={api.pending} onClick={async () => {
              if (await confirm({ title: `Hide ${api.keys.length} product${api.keys.length === 1 ? "" : "s"}?`, body: "For things you no longer buy. Price history is kept; restore them from Hidden.", confirmLabel: "Hide" })) api.run(() => setProductsActive(api.keys, false));
            }}>Hide</Button>
          )}
        </>
      )}
    />
  );
}

function ProductDetail({ p, ingredients }: { p: PriceRow; ingredients: FilterOption[] }) {
  return (
    <div className="space-y-6">
      <div className="text-sm text-muted">{p.supplier} · #{p.sku}{p.packText ? ` · ${p.packText}` : ""}</div>
      <section>
        <div className="mb-1 text-xs font-medium text-muted">Price per {p.purchaseUnit}</div>
        <div className="flex items-center gap-3">
          <GridCell grid="prices-drawer" col="price" type="number" prefix="$" decimals={2} value={p.price} onSave={setProductPrice.bind(null, p.id)} ariaLabel={`${p.description} price`} className="w-32 text-lg" />
          {changeBadge(p.change)}
          <span className="text-xs text-muted">vs 30 days ago</span>
        </div>
      </section>
      <section>
        <div className="mb-2 text-xs font-medium text-muted">Price history</div>
        {p.history.length > 1 ? (
          <>
            <Sparkline points={p.history.map((h) => ({ date: h.date, value: h.price }))} />
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {[...p.history].reverse().slice(0, 8).map((h, i, a) => {
                const prev = a[i + 1];
                const c = prev ? (h.price - prev.price) / prev.price : null;
                return (
                  <li key={h.date} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-ink-2">{shortDate(h.date)}</span>
                    <span className="flex items-center gap-2"><span className="num">{money(h.price)}</span>{c != null && Math.abs(c) >= 0.0005 && <span className={cx("num w-14 text-right text-xs", c > 0 ? "text-bad" : "text-good")}>{signedPct(c)}</span>}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">{p.history.length === 1 ? `One price so far, since ${shortDate(p.history[0].date)}.` : "No price yet."}</p>
        )}
      </section>
      <section>
        <div className="mb-1 text-xs font-medium text-muted">Ingredient</div>
        {p.ingredientId ? (
          <>
            <DetailRow label="Linked to"><Link href={`/ingredients/${p.ingredientId}`} className="font-medium hover:underline">{p.ingredient}</Link></DetailRow>
            <DetailRow label="Category">{p.category}</DetailRow>
            <DetailRow label="Storage">{p.storage}</DetailRow>
            <DetailRow label="Used in">{p.usedIn ? `${p.usedIn} recipe line${p.usedIn === 1 ? "" : "s"}` : "No recipes yet"}</DetailRow>
            <DetailRow label="Pack size">{p.packQtyBase == null ? <span className="text-warn">Not set — set it on the ingredient</span> : "Set"}</DetailRow>
          </>
        ) : (
          <div className="pt-1"><LinkCell p={p} ingredients={ingredients} /></div>
        )}
      </section>
    </div>
  );
}
