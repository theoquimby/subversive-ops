"use client";

import { BulkPick, BulkValue, DataTable, DetailRow, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridCell } from "@/components/grid";
import { Badge, cx, EmptyState, LinkButton } from "@/components/ui";
import { money, pct, qty as fmtQty, signedPct } from "@/lib/format";
import { setRecipeField } from "@/server/actions/inline";
import Link from "next/link";
import { useMemo } from "react";
import { archiveRecipes, bulkSetRecipes } from "./actions";

export interface MenuRow {
  id: string;
  name: string;
  kind: "MENU" | "MODIFIER" | "PREP";
  category: string;
  menuPrice: number | null;
  cost: number | null;
  costBefore: number | null;
  foodCostPct: number | null;
  target: number;
  clsLabel: string;
  cls: string;
  incomplete: boolean;
  needsIngredients: boolean;
  error: string | null;
  lines: { label: string; qty: number; unit: string; cost: number | null; recipe: boolean }[];
}

const KIND_LABEL: Record<MenuRow["kind"], string> = { MENU: "Menu item", MODIFIER: "Add-on", PREP: "Prep recipe" };
const change = (r: MenuRow) => (r.cost != null && r.costBefore ? (r.cost - r.costBefore) / r.costBefore : null);
const over = (r: MenuRow) => r.kind !== "PREP" && r.foodCostPct != null && r.foodCostPct > r.target;
const margin = (r: MenuRow) => (r.menuPrice != null && r.cost != null && r.kind !== "PREP" ? r.menuPrice - r.cost : null);
const flag = (r: MenuRow) => (r.needsIngredients ? "Needs ingredients" : r.incomplete ? (r.error ? "Error" : "Missing prices") : null);

export function MenuTable({ rows }: { rows: MenuRow[] }) {
  const confirm = useConfirm();
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort().map((c) => ({ value: c, label: c })), [rows]);

  const columns = useMemo<Column<MenuRow>[]>(() => [
    {
      id: "name",
      header: "Name",
      width: 260,
      sort: (r) => r.name,
      csv: (r) => r.name,
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/menu/${r.id}`} data-tour="menu.recipe-link" className="font-medium text-ink hover:underline">{r.name}</Link>
          {flag(r) && <Badge tone="warn">{flag(r)}</Badge>}
        </div>
      ),
    },
    { id: "kind", header: "Type", sort: (r) => KIND_LABEL[r.kind], csv: (r) => KIND_LABEL[r.kind], cell: (r) => <span className="text-ink-2">{KIND_LABEL[r.kind]}</span>, defaultHidden: true },
    { id: "category", header: "Category", sort: (r) => r.category, csv: (r) => r.category, cell: (r) => <span className="text-ink-2">{r.category}{r.kind !== "PREP" && r.cls !== "food" && <Badge className="ml-2">{r.clsLabel}</Badge>}</span> },
    {
      id: "price",
      header: "Price",
      help: "menu.list.price",
      align: "right",
      edit: true,
      width: 112,
      firstDir: "desc",
      sort: (r) => r.menuPrice,
      csv: (r) => r.menuPrice,
      cell: (r) => (r.kind === "PREP" ? <span className="px-2 text-muted">—</span> : <GridCell grid="menu" col="price" type="number" prefix="$" decimals={2} value={r.menuPrice} onSave={setRecipeField.bind(null, r.id, "menuPrice")} ariaLabel={`${r.name} price`} />),
    },
    { id: "cost", header: "Cost", help: "menu.list.cost", align: "right", firstDir: "desc", sort: (r) => r.cost, csv: (r) => r.cost, cell: (r) => money(r.cost) },
    {
      id: "change",
      header: "30 days",
      label: "Cost change, 30 days",
      help: "menu.list.change",
      align: "right",
      firstDir: "desc",
      sort: (r) => change(r),
      csv: (r) => change(r),
      cell: (r) => { const c = change(r); return c == null || Math.abs(c) < 0.001 ? <span className="text-muted">—</span> : <span className={c > 0 ? "text-bad" : "text-good"}>{signedPct(c)}</span>; },
    },
    {
      id: "foodCost",
      header: "Food cost",
      help: "menu.list.target",
      align: "right",
      firstDir: "desc",
      sort: (r) => (r.kind === "PREP" ? null : r.foodCostPct),
      csv: (r) => r.foodCostPct,
      cell: (r) => (r.kind === "PREP" ? <span className="text-muted">—</span> : <span className={cx("font-medium", over(r) ? "text-bad" : "text-ink")}>{pct(r.foodCostPct)}</span>),
      total: (rs) => { const n = rs.filter(over).length; return n ? <span className="text-bad">{n} over</span> : null; },
    },
    {
      id: "target",
      header: "Target",
      align: "right",
      edit: true,
      width: 96,
      sort: (r) => (r.kind === "PREP" ? null : r.target),
      csv: (r) => r.target,
      cell: (r) => (r.kind === "PREP" ? <span className="px-2 text-muted">—</span> : <GridCell grid="menu" col="target" type="number" suffix="%" value={Math.round(r.target * 100)} onSave={setRecipeField.bind(null, r.id, "targetFoodCostPct")} ariaLabel={`${r.name} target food cost`} />),
    },
    { id: "margin", header: "Margin", align: "right", firstDir: "desc", sort: margin, csv: margin, cell: (r) => (margin(r) == null ? <span className="text-muted">—</span> : money(margin(r))) },
  ], []);

  const filters = useMemo<Filter<MenuRow>[]>(() => [
    { id: "kind", label: "Type", kind: "facet", display: "segmented", single: true, allLabel: "All recipes", values: (r) => r.kind, options: [{ value: "MENU", label: "Menu items" }, { value: "MODIFIER", label: "Add-ons" }, { value: "PREP", label: "Prep recipes" }], param: "kind" },
    { id: "category", label: "Category", kind: "facet", values: (r) => r.category, param: "category" },
    { id: "over", label: "Over target", kind: "toggle", test: over, tone: "bad", param: "over" },
    { id: "rose", label: "Cost rose", kind: "toggle", test: (r) => (change(r) ?? 0) >= 0.001, tone: "bad" },
    { id: "incomplete", label: "Needs work", kind: "toggle", test: (r) => !!flag(r), tone: "warn" },
    { id: "noprice", label: "No menu price", kind: "toggle", test: (r) => r.kind !== "PREP" && r.menuPrice == null },
  ], []);

  const groups = useMemo<GroupBy<MenuRow>[]>(() => [
    { id: "category", label: "Category", key: (r) => r.category },
    { id: "kind", label: "Type", key: (r) => KIND_LABEL[r.kind] },
    { id: "cls", label: "Food or drink", key: (r) => r.clsLabel },
  ], []);

  return (
    <DataTable
      id="menu"
      help="menu.list"
      tours={{ root: "menu.table" }}
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      noun={["recipe", "recipes"]}
      searchText={(r) => `${r.name} ${r.category} ${KIND_LABEL[r.kind]} ${r.lines.map((l) => l.label).join(" ")}`}
      searchPlaceholder="Search recipes"
      filters={filters}
      groups={groups}
      defaultView={{ filters: { kind: ["MENU"] } }}
      empty={<EmptyState title="No recipes yet" action={<LinkButton href="/menu/new">Add one</LinkButton>}>Add a recipe to see its plate cost.</EmptyState>}
      summary={(vis) => {
        const priced = vis.filter((r) => r.kind !== "PREP" && r.foodCostPct != null);
        const avg = priced.length ? priced.reduce((s, r) => s + r.foodCostPct!, 0) / priced.length : null;
        return [
          { value: vis.length, label: vis.length === 1 ? "recipe" : "recipes" },
          { value: vis.filter(over).length, label: "over target", tone: "bad", filter: { id: "over" } },
          { value: vis.filter((r) => !!flag(r)).length, label: "need work", tone: "warn", filter: { id: "incomplete" } },
          ...(avg != null ? [{ value: pct(avg), label: "average food cost" }] : []),
        ];
      }}
      card={(r) => ({
        title: r.name,
        subtitle: <>{r.category}{flag(r) && <span className="text-warn"> · {flag(r)}</span>}</>,
        value: r.kind === "PREP" ? money(r.cost) : <span className={over(r) ? "text-bad" : undefined}>{pct(r.foodCostPct)}</span>,
        sub: r.kind === "PREP" ? "batch cost" : `${money(r.cost)} of ${money(r.menuPrice)}`,
      })}
      rowHref={(r) => `/menu/${r.id}`}
      drawerTitle={(r) => r.name}
      drawer={(r) => <RecipeDetail r={r} />}
      bulkActions={(api) => (
        <>
          <BulkPick label="Category" options={categories} allowNew newLabel="New category" disabled={api.pending} onPick={(v) => api.run(() => bulkSetRecipes(api.keys, "category", v))} />
          <BulkValue label="Target" suffix="%" placeholder="default" disabled={api.pending} onApply={(v) => api.run(() => bulkSetRecipes(api.keys, "targetFoodCostPct", v))} />
          <button type="button" disabled={api.pending} className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-bad hover:bg-bad-bg disabled:opacity-50" onClick={async () => {
            if (await confirm({ title: `Archive ${api.keys.length} recipe${api.keys.length === 1 ? "" : "s"}?`, body: "They leave the menu, costing and ordering. Restore them any time from Archived.", confirmLabel: "Archive", danger: true })) api.run(() => archiveRecipes(api.keys));
          }}>Archive</button>
        </>
      )}
    />
  );
}

function RecipeDetail({ r }: { r: MenuRow }) {
  const c = change(r);
  return (
    <div className="space-y-6">
      <div className="text-sm text-muted">{KIND_LABEL[r.kind]} · {r.category}</div>
      <div className="grid grid-cols-3 gap-2">
        {[
          [r.kind === "PREP" ? "Batch cost" : "Plate cost", money(r.cost)],
          r.kind === "PREP" ? ["30 days", c == null ? "—" : signedPct(c)] : ["Price", money(r.menuPrice)],
          r.kind === "PREP" ? ["", ""] : ["Food cost", pct(r.foodCostPct)],
        ].filter(([l]) => l).map(([l, v]) => (
          <div key={l} className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted">{l}</div>
            <div className={cx("num mt-1 text-lg font-semibold", l === "Food cost" && over(r) && "text-bad")}>{v}</div>
          </div>
        ))}
      </div>
      {r.kind !== "PREP" && (
        <section>
          <DetailRow label="Target">{pct(r.target, 0)}</DetailRow>
          <DetailRow label="Margin">{money(margin(r))}</DetailRow>
          <DetailRow label="Price to hit target">{r.cost != null && r.target > 0 ? money(r.cost / r.target) : "—"}</DetailRow>
          <DetailRow label="Cost vs 30 days ago">{c == null ? "—" : <span className={c > 0 ? "text-bad" : "text-good"}>{signedPct(c)}</span>}</DetailRow>
        </section>
      )}
      <section>
        <div className="mb-2 text-xs font-medium text-muted">{r.lines.length} line{r.lines.length === 1 ? "" : "s"}</div>
        {r.lines.length === 0 ? <p className="text-sm text-muted">No ingredients yet. <Link href={`/menu/${r.id}`} className="underline underline-offset-2">Add them</Link>.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {[...r.lines].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1)).map((l, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{l.label}{l.recipe && <span className="ml-1.5 text-xs text-muted">prep</span>}</span>
                <span className="num text-xs text-muted">{fmtQty(l.qty, 2)} {l.unit}</span>
                <span className={cx("num w-16 text-right", l.cost == null && "text-warn")}>{l.cost == null ? "no price" : money(l.cost)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
