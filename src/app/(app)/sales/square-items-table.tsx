"use client";

import { BulkPick, DataTable, DetailRow, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridSelect } from "@/components/grid";
import { Badge, Button, cx } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { setSquareMapping } from "@/server/actions/inline";
import type { SquareItemRow } from "@/server/services/square-menu";
import { Check, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { acceptSuggestions, applySquarePrices, createRecipesFromSquare, ignoreItems, rejectSuggestions, unignoreItems } from "./square-menu/actions";
import { draftSquareItems } from "../menu/drafts/actions";

export type { SquareItemRow };

type Status = "suggested" | "open" | "linked" | "ignored" | "removed";
export const statusOf = (r: SquareItemRow): Status => (r.deleted ? "removed" : r.recipeId ? "linked" : r.ignored ? "ignored" : r.suggestion ? "suggested" : "open");
const STATUS: Record<Status, { label: string; tone: "good" | "warn" | "neutral" | "bad" }> = {
  suggested: { label: "Suggested match", tone: "warn" },
  open: { label: "Not matched", tone: "warn" },
  linked: { label: "Linked", tone: "good" },
  ignored: { label: "Ignored", tone: "neutral" },
  removed: { label: "Removed from Square", tone: "neutral" },
};
const differs = (r: SquareItemRow) => !!r.drift;
const pctLabel = (c: number) => `${Math.round(c * 100)}%`;

/** Accept / not this one, inline. */
function SuggestionCell({ r }: { r: SquareItemRow }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  if (!r.suggestion) return null;
  const s = r.suggestion;
  const go = (fn: () => Promise<{ error?: string }>) => start(async () => { const res = await fn(); if (res.error) setMsg(res.error); router.refresh(); });
  return (
    <div className={cx("flex items-center gap-1.5", pending && "opacity-50")}>
      <span className="min-w-0 truncate text-ink-2" title={s.recipeName}>{s.recipeName}</span>
      <span className={cx("num text-xs", s.confidence >= 0.9 ? "text-good" : "text-muted")}>{pctLabel(s.confidence)}</span>
      <button type="button" disabled={pending} onClick={() => go(() => acceptSuggestions([{ squareId: r.squareId, recipeId: s.recipeId }]))} aria-label={`Accept ${s.recipeName} for ${r.name}`} title="Accept" className="relative grid size-7 shrink-0 place-items-center rounded-md border border-border-strong text-good after:absolute after:-inset-1 hover:bg-good-bg"><Check className="size-3.5" strokeWidth={2.5} /></button>
      <button type="button" disabled={pending} onClick={() => go(() => rejectSuggestions([{ squareId: r.squareId, recipeId: s.recipeId }]))} aria-label={`Not ${s.recipeName}`} title="Not this one" className="relative grid size-7 shrink-0 place-items-center rounded-md border border-border-strong text-muted after:absolute after:-inset-1 hover:bg-bad-bg hover:text-bad"><X className="size-3.5" strokeWidth={2.5} /></button>
      {msg && <span className="text-xs text-bad">{msg}</span>}
    </div>
  );
}

/** Drawer button: draft this item's recipe and open the review page. */
function DraftOne({ r }: { r: SquareItemRow }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section>
      <div className="mb-1.5 text-xs font-medium text-muted">{r.recipeId ? "Recipe has no ingredients yet" : "No recipe yet"}</div>
      <Button size="sm" disabled={pending} onClick={() => start(async () => {
        const res = await draftSquareItems([r.squareId]);
        if (res.error) setMsg(res.error);
        else router.push("/menu/drafts");
      })}><Sparkles className="size-3.5" />{pending ? "Drafting…" : "Draft recipe"}</Button>
      <p className="mt-1.5 text-xs text-muted">{msg ?? "Suggests ingredient lines from your similar recipes. You review it before anything is saved."}</p>
    </section>
  );
}

export function SquareItemsTable({ id, rows, recipes, showSold = true, defaultFilters, help }: { id: string; rows: SquareItemRow[]; recipes: { id: string; name: string; kind: string }[]; showSold?: boolean; defaultFilters?: Record<string, string[]>; help?: string }) {
  const confirm = useConfirm();
  const router = useRouter();
  const recipeOptions = useMemo(() => recipes.map((r) => ({ value: r.id, label: `${r.name}${r.kind === "MODIFIER" ? " (add-on)" : ""}` })), [recipes]);
  const linkOptions = useMemo(() => [{ value: "", label: "Not linked" }, { value: "__ignore", label: "Ignore (drinks, merch, gift cards)" }, ...recipeOptions], [recipeOptions]);

  const columns = useMemo<Column<SquareItemRow>[]>(() => [
    {
      id: "item",
      header: "Square item",
      width: 260,
      sort: (r) => r.name,
      csv: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium break-words text-ink">{r.name}</div>
          <div className="text-xs text-muted">{r.modifier ? "Modifier" : "Item"}{r.archived && " · archived in Square"}{r.deleted && " · removed from Square"}</div>
        </div>
      ),
    },
    { id: "status", header: "Status", sort: (r) => STATUS[statusOf(r)].label, csv: (r) => STATUS[statusOf(r)].label, cell: (r) => <Badge tone={STATUS[statusOf(r)].tone}>{STATUS[statusOf(r)].label}</Badge> },
    { id: "suggestion", header: "Suggested match", width: 260, sort: (r) => r.suggestion?.confidence ?? null, firstDir: "desc", csv: (r) => r.suggestion?.recipeName, cell: (r) => <SuggestionCell r={r} /> },
    { id: "price", header: "Price", align: "right", firstDir: "desc", sort: (r) => r.price, csv: (r) => r.price, cell: (r) => (r.price == null ? <span className="text-muted">{r.known ? "varies" : "—"}</span> : money(r.price)) },
    ...(showSold ? [{ id: "sold", header: "Sold, 4 wks", align: "right" as const, firstDir: "desc" as const, sort: (r: SquareItemRow) => r.sold, csv: (r: SquareItemRow) => r.sold, cell: (r: SquareItemRow) => <span className="text-ink-2">{qty(r.sold, 0)}</span>, total: (rs: SquareItemRow[]) => qty(rs.reduce((s, r) => s + r.sold, 0), 0) }] : []),
    {
      id: "recipe",
      header: "Recipe",
      help: "sales.mapping",
      edit: true,
      width: 240,
      sort: (r) => r.recipeName ?? (r.ignored ? "~ignored" : null),
      csv: (r) => r.recipeName ?? (r.ignored ? "Ignored" : ""),
      cell: (r) => <GridSelect value={r.ignored ? "__ignore" : r.recipeId ?? ""} options={linkOptions} onSave={setSquareMapping.bind(null, r.squareId)} ariaLabel={`Recipe for ${r.name}`} className="max-w-64 border-border" />,
    },
    { id: "category", header: "Category", sort: (r) => r.category, csv: (r) => r.category, cell: (r) => r.category ?? <span className="text-muted">—</span>, defaultHidden: true },
    {
      id: "menuPrice",
      header: "Menu price",
      align: "right",
      sort: (r) => r.drift?.diff ?? null,
      firstDir: "desc",
      csv: (r) => r.menuPrice,
      cell: (r) => (!r.recipeId ? <span className="text-muted">—</span> : (
        <span className="whitespace-nowrap">
          {money(r.menuPrice)}
          {r.drift && <span className={cx("ml-1.5 text-xs", r.drift.conflict ? "text-warn" : r.drift.diff == null ? "text-muted" : r.drift.diff > 0 ? "text-good" : "text-bad")}>{r.drift.conflict ? "several prices" : r.drift.diff == null ? "not set" : `${r.drift.diff > 0 ? "+" : "−"}${money(Math.abs(r.drift.diff))}`}</span>}
        </span>
      )),
    },
  ], [linkOptions, showSold]);

  const filters = useMemo<Filter<SquareItemRow>[]>(() => [
    { id: "status", label: "Status", kind: "facet", values: (r) => statusOf(r), options: (Object.keys(STATUS) as Status[]).map((s) => ({ value: s, label: STATUS[s].label })), param: "status" },
    { id: "category", label: "Category", kind: "facet", values: (r) => r.category ?? "No category" },
    { id: "type", label: "Type", kind: "facet", values: (r) => (r.modifier ? "Modifier" : "Item"), single: true },
    { id: "drift", label: "Price differs", kind: "toggle", test: differs, tone: "warn" },
    { id: "selling", label: "Sold in 4 weeks", kind: "toggle", test: (r) => r.sold > 0 },
    { id: "sure", label: "Match 90%+", kind: "toggle", test: (r) => (r.suggestion?.confidence ?? 0) >= 0.9, tone: "good" },
  ], []);

  const groups = useMemo<GroupBy<SquareItemRow>[]>(() => [
    { id: "category", label: "Category", key: (r) => r.category, title: (k) => k || "No category" },
    { id: "status", label: "Status", key: (r) => statusOf(r), title: (k) => STATUS[k as Status]?.label ?? k, order: (a, b) => Object.keys(STATUS).indexOf(a) - Object.keys(STATUS).indexOf(b) },
    { id: "recipe", label: "Recipe", key: (r) => r.recipeName, title: (k) => k || "Not linked" },
  ], []);

  return (
    <DataTable
      id={id}
      help={help}
      rows={rows}
      rowKey={(r) => r.squareId}
      columns={columns}
      noun={["Square item", "Square items"]}
      searchText={(r) => `${r.name} ${r.category ?? ""} ${r.recipeName ?? ""} ${r.suggestion?.recipeName ?? ""}`}
      filters={filters}
      groups={groups}
      defaultView={{ filters: defaultFilters ?? {}, sort: showSold ? [{ id: "sold", dir: "desc" }] : [], hidden: ["category"] }}
      csvName="square-items"
      summary={(vis) => [
        { value: vis.length, label: "items" },
        { value: vis.filter((r) => statusOf(r) === "suggested").length, label: "with a suggested match", tone: "warn", filter: { id: "status", value: "suggested" } },
        { value: vis.filter((r) => statusOf(r) === "open").length, label: "not matched", tone: "warn", filter: { id: "status", value: "open" } },
        { value: vis.filter((r) => statusOf(r) === "linked").length, label: "linked", tone: "good", filter: { id: "status", value: "linked" } },
        { value: vis.filter(differs).length, label: "price differences", filter: { id: "drift" } },
      ]}
      card={(r) => ({
        title: r.name,
        subtitle: r.recipeName ? `→ ${r.recipeName}` : r.suggestion ? `Suggested: ${r.suggestion.recipeName} (${pctLabel(r.suggestion.confidence)})` : STATUS[statusOf(r)].label,
        value: r.price == null ? "—" : money(r.price),
        sub: showSold ? `${qty(r.sold, 0)} sold` : r.modifier ? "modifier" : "item",
      })}
      drawerTitle={(r) => r.name}
      drawer={(r) => (
        <div className="space-y-5">
          <Badge tone={STATUS[statusOf(r)].tone}>{STATUS[statusOf(r)].label}</Badge>
          <section>
            <DetailRow label="Type">{r.modifier ? "Modifier (add-on)" : "Item"}</DetailRow>
            <DetailRow label="Category">{r.category ?? "—"}</DetailRow>
            <DetailRow label="Square price">{r.price == null ? (r.known ? "varies" : "—") : money(r.price)}</DetailRow>
            <DetailRow label="Sold, last 4 weeks">{qty(r.sold, 0)}</DetailRow>
            {r.recipeId && <DetailRow label="Recipe's menu price">{money(r.menuPrice)}</DetailRow>}
          </section>
          <section>
            <div className="mb-1.5 text-xs font-medium text-muted">Recipe</div>
            <GridSelect value={r.ignored ? "__ignore" : r.recipeId ?? ""} options={linkOptions} onSave={setSquareMapping.bind(null, r.squareId)} ariaLabel={`Recipe for ${r.name}`} className="border-border" />
          </section>
          {r.suggestion && (
            <section>
              <div className="mb-1.5 text-xs font-medium text-muted">Suggested match</div>
              <SuggestionCell r={r} />
            </section>
          )}
          {!r.deleted && (!r.recipeId || r.recipeEmpty) && <DraftOne r={r} />}
        </div>
      )}
      bulkActions={(api) => {
        const withSugg = api.rows.filter((r) => r.suggestion && !r.recipeId);
        const unlinked = api.rows.filter((r) => !r.recipeId && !r.deleted);
        const ignored = api.rows.filter((r) => r.ignored);
        const drifting = api.rows.filter((r) => r.drift && !r.drift.conflict && r.price != null);
        const draftable = api.rows.filter((r) => !r.deleted && !r.ignored && (!r.recipeId || r.recipeEmpty));
        return (
          <>
            {withSugg.length > 0 && <Button size="sm" variant="primary" disabled={api.pending} onClick={() => api.run(() => acceptSuggestions(withSugg.map((r) => ({ squareId: r.squareId, recipeId: r.suggestion!.recipeId }))))}><Check className="size-3.5" />Accept {withSugg.length}</Button>}
            {withSugg.length > 0 && <Button size="sm" disabled={api.pending} onClick={() => api.run(() => rejectSuggestions(withSugg.map((r) => ({ squareId: r.squareId, recipeId: r.suggestion!.recipeId }))))}>Reject {withSugg.length}</Button>}
            <BulkPick label="Link to recipe" options={recipeOptions} disabled={api.pending} onPick={(rid) => api.run(() => acceptSuggestions(api.keys.map((squareId) => ({ squareId, recipeId: rid }))))} />
            {unlinked.length > 0 && <Button size="sm" disabled={api.pending} onClick={async () => {
              if (await confirm({ title: `Create ${unlinked.length} recipe${unlinked.length === 1 ? "" : "s"}?`, body: "Each starts with Square's name, price and category and no ingredients yet. Names you already have are linked instead.", confirmLabel: "Create" })) api.run(() => createRecipesFromSquare(unlinked.map((r) => r.squareId)));
            }}>Create recipes</Button>}
            {draftable.length > 0 && <Button size="sm" disabled={api.pending} onClick={() => api.run(async () => {
              const res = await draftSquareItems(draftable.map((r) => r.squareId));
              if (!res.error) router.push("/menu/drafts");
              return res;
            })}><Sparkles className="size-3.5" />Draft recipes ({draftable.length})</Button>}
            {drifting.length > 0 && <Button size="sm" disabled={api.pending} onClick={() => api.run(() => applySquarePrices(drifting.map((r) => ({ recipeId: r.recipeId!, price: r.price! }))))}>Use Square price ({drifting.length})</Button>}
            {unlinked.some((r) => !r.ignored) && <Button size="sm" variant="ghost" disabled={api.pending} onClick={() => api.run(() => ignoreItems(unlinked.filter((r) => !r.ignored).map((r) => r.squareId)))}>Ignore</Button>}
            {ignored.length > 0 && <Button size="sm" variant="ghost" disabled={api.pending} onClick={() => api.run(() => unignoreItems(ignored.map((r) => r.squareId)))}>Un-ignore</Button>}
          </>
        );
      }}
    />
  );
}
