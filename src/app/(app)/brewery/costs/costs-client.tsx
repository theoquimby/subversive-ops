"use client";

import { DataTable, type Column, type Filter } from "@/components/data-table";
import { GridCell } from "@/components/grid";
import { LineChart } from "@/components/line-chart";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { whatIf, type Cogs, type WhatIfInput } from "@/domain/brewCogs";
import { PACKAGING_LOSS, type PricedIngredient } from "@/domain/brewRecipes";
import { money, pct, qty } from "@/lib/format";
import type { CogsIngredient, CogsRecipeView, CogsView } from "@/server/services/brewCogs";
import { Plus, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { setWholesaleAction } from "./actions";

type Row = CogsRecipeView & { base: Cogs; next: Cogs; affected: boolean };
type Change = { key: number; ingredientId: string; pct: string };

const num = (s: string): number | null => {
  const t = s.replace(/[%,\s]/g, "").replace("−", "-");
  if (t === "" || t === "-" || t === "+") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const signedMoney = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${money(Math.abs(d))}`;
const points = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(1)} pts`;

/** A cost with what the what-if moves it by underneath. */
function Money({ base, next, show, floor }: { base: number | null; next: number | null; show: boolean; floor: boolean }) {
  const d = base != null && next != null ? next - base : null;
  return (
    <span className="num whitespace-nowrap">
      {next == null ? "—" : `${floor ? "≥ " : ""}${money(next)}`}
      {show && d != null && Math.abs(d) >= 0.005 && <span className={cx("block text-[0.7rem]", d > 0 ? "text-bad" : "text-good")}>{signedMoney(d)}</span>}
    </span>
  );
}

function Margin({ base, next, show, ceiling }: { base: number | null; next: number | null; show: boolean; ceiling: boolean }) {
  if (next == null) return <span className="text-muted">—</span>;
  const d = base != null ? next - base : null;
  return (
    <span className={cx("num whitespace-nowrap", next < 0 ? "text-bad" : "text-ink")}>
      {ceiling ? "≤ " : ""}{pct(next, 0)}
      {show && d != null && Math.abs(d) >= 0.0005 && <span className={cx("block text-[0.7rem]", d < 0 ? "text-bad" : "text-good")}>{points(d)}</span>}
    </span>
  );
}

function moneyCell(r: Row, pick: (c: Cogs) => number | null, active: boolean) {
  return <Money base={pick(r.base)} next={pick(r.next)} show={active && r.affected} floor={!r.next.complete} />;
}

export function CostsClient({ view }: { view: CogsView }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [batch, setBatch] = useState("");
  const [loss, setLoss] = useState("");
  const catalog = useMemo(() => new Map<string, PricedIngredient>(view.ingredients.map((i) => [i.id, i])), [view.ingredients]);
  const input = useMemo<WhatIfInput>(() => {
    const pricePct: Record<string, number> = {};
    for (const c of changes) {
      const n = num(c.pct);
      if (c.ingredientId && n != null && n > -100) pricePct[c.ingredientId] = (pricePct[c.ingredientId] ?? 0) + n;
    }
    const b = num(batch);
    const l = num(loss);
    return { pricePct, batchBbl: b != null && b > 0 ? b : null, lossPct: l != null && l >= 0 && l < 100 ? l : null };
  }, [changes, batch, loss]);
  const active = Object.keys(input.pricePct).length > 0 || input.batchBbl != null || input.lossPct != null;
  const rows = useMemo<Row[]>(() => {
    const r = whatIf(view.recipes, catalog, input, view.pourYield);
    return view.recipes.map((rec, i) => ({ ...rec, ...r[i] }));
  }, [view.recipes, catalog, input, view.pourYield]);
  const affected = rows.filter((r) => r.affected);
  const biggest = affected.filter((r) => r.base.perPint != null && r.next.perPint != null).sort((a, b) => Math.abs(b.next.perPint! - b.base.perPint!) - Math.abs(a.next.perPint! - a.base.perPint!))[0];
  const hasWholesale = view.wholesale.half != null || view.wholesale.sixth != null;

  const columns = useMemo<Column<Row>[]>(() => {
    const m = (pick: (c: Cogs) => number | null) => (r: Row) => moneyCell(r, pick, active);
    return [
      {
        id: "name",
        header: "Recipe",
        width: 200,
        hideable: false,
        sort: (r) => r.name,
        csv: (r) => r.name,
        cell: (r) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5"><span className="truncate font-medium text-ink">{r.name}</span>{r.status === "dev" && <Badge>Dev</Badge>}</div>
            <div className="truncate text-xs text-muted">{r.beer ? `pours as ${r.beer}` : (r.style ?? "Not linked to a beer")}</div>
          </div>
        ),
      },
      { id: "batch", header: "Batch", align: "right", width: 80, sort: (r) => r.next.batchBbl, csv: (r) => r.next.batchBbl, cell: (r) => <span className="num text-ink-2">{qty(r.next.batchBbl, 1)} bbl</span> },
      { id: "total", header: "Per batch", align: "right", width: 110, firstDir: "desc", sort: (r) => r.next.total, csv: (r) => r.next.total, cell: m((c) => c.total) },
      { id: "bbl", header: "Per bbl", align: "right", width: 100, firstDir: "desc", sort: (r) => r.next.perBbl, csv: (r) => r.next.perBbl, cell: m((c) => c.perBbl) },
      { id: "half", header: "Per ½ keg", align: "right", width: 100, firstDir: "desc", sort: (r) => r.next.perHalf, csv: (r) => r.next.perHalf, cell: m((c) => c.perHalf) },
      { id: "sixth", header: "Per ⅙ keg", align: "right", width: 100, firstDir: "desc", sort: (r) => r.next.perSixth, csv: (r) => r.next.perSixth, cell: m((c) => c.perSixth) },
      { id: "pint", header: "Per pint", align: "right", width: 100, firstDir: "desc", help: "brewery.costs.pint", sort: (r) => r.next.perPint, csv: (r) => r.next.perPint, cell: m((c) => c.perPint) },
      { id: "price", header: "Pint sells for", align: "right", width: 110, firstDir: "desc", sort: (r) => r.pintPrice, csv: (r) => r.pintPrice, cell: (r) => <span className="num text-ink-2">{money(r.pintPrice)}</span> },
      { id: "margin", header: "Pint margin", align: "right", width: 110, firstDir: "desc", help: "brewery.costs.margin", sort: (r) => r.next.pintMargin, csv: (r) => r.next.pintMargin, cell: (r) => <Margin base={r.base.pintMargin} next={r.next.pintMargin} show={active && r.affected} ceiling={!r.next.complete} /> },
      { id: "halfMargin", header: "½ keg margin", align: "right", width: 110, firstDir: "desc", defaultHidden: !hasWholesale, sort: (r) => r.next.halfMargin, csv: (r) => r.next.halfMargin, cell: (r) => <Margin base={r.base.halfMargin} next={r.next.halfMargin} show={active && r.affected} ceiling={!r.next.complete} /> },
      { id: "sixthMargin", header: "⅙ keg margin", align: "right", width: 110, firstDir: "desc", defaultHidden: !hasWholesale, sort: (r) => r.next.sixthMargin, csv: (r) => r.next.sixthMargin, cell: (r) => <Margin base={r.base.sixthMargin} next={r.next.sixthMargin} show={active && r.affected} ceiling={!r.next.complete} /> },
    ];
  }, [active, hasWholesale]);

  const filters = useMemo<Filter<Row>[]>(() => [
    { id: "affected", label: "Changed by the what-if", kind: "toggle", test: (r) => r.affected, tone: "warn" },
    { id: "status", label: "Status", kind: "facet", values: (r) => r.status, options: [{ value: "live", label: "Live" }, { value: "dev", label: "In development" }] },
    { id: "unpriced", label: "Missing prices", kind: "toggle", test: (r) => !r.next.complete },
  ], []);

  return (
    <div className="space-y-8">
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[0.95rem] font-semibold text-ink">What if</h2>
          <span className="text-sm text-muted" aria-live="polite">
            {active ? (affected.length ? `${affected.length} recipe${affected.length === 1 ? "" : "s"} change${biggest && biggest.next.perPint != null && biggest.base.perPint != null ? ` · most: ${biggest.name}, ${signedMoney(biggest.next.perPint - biggest.base.perPint)} a pint` : ""}` : "No recipe changes") : "Nothing is saved: try a price, a batch size or more loss and watch the table."}
          </span>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">Ingredient prices</div>
            {changes.map((c) => (
              <PriceChange key={c.key} c={c} ingredients={view.ingredients} onChange={(n) => setChanges(changes.map((x) => (x.key === c.key ? n : x)))} onRemove={() => setChanges(changes.filter((x) => x.key !== c.key))} />
            ))}
            <Button size="sm" variant="ghost" onClick={() => setChanges([...changes, { key: Date.now(), ingredientId: "", pct: "10" }])} disabled={!view.ingredients.length}>
              <Plus className="size-4" /> Change a price
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 self-start">
            <Field label="Batch size" hint="Every recipe at this size">
              <Input inputMode="decimal" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Own size" aria-label="Batch size in barrels" />
            </Field>
            <Field label="Yield loss" hint={`Brewhouse to kegs; usually ${Math.round(PACKAGING_LOSS * 100)}%`}>
              <Input inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} placeholder={`${Math.round(PACKAGING_LOSS * 100)}%`} aria-label="Yield loss percent" />
            </Field>
          </div>
        </div>
        {active && (
          <div className="mt-4 border-t border-border pt-3">
            <Button size="sm" variant="ghost" onClick={() => { setChanges([]); setBatch(""); setLoss(""); }}><RotateCcw className="size-3.5" /> Back to today&apos;s numbers</Button>
          </div>
        )}
      </Card>

      <DataTable
        id="brewery-costs"
        help="brewery.costs"
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        noun={["recipe", "recipes"]}
        searchText={(r) => `${r.name} ${r.beer ?? ""} ${r.style ?? ""}`}
        searchPlaceholder="Search recipes"
        filters={filters}
        defaultView={{ sort: [{ id: "name", dir: "asc" }] }}
        csvName="brewing-costs"
        urlSearch={false}
        rowClassName={(r) => (active && r.affected ? "bg-warn-bg/25" : undefined)}
        summary={(vis) => {
          // Only fully priced recipes: one with unpriced lines has a margin that is only a ceiling (no prices at all reads 100%).
          const priced = vis.filter((r) => r.next.pintMargin != null && r.next.complete);
          const avg = priced.length ? priced.reduce((s, r) => s + r.next.pintMargin!, 0) / priced.length : null;
          return [
            { value: vis.length, label: vis.length === 1 ? "recipe" : "recipes" },
            ...(avg != null ? [{ value: pct(avg, 0), label: "average pint margin" }] : []),
            ...(active ? [{ value: vis.filter((r) => r.affected).length, label: "changed", tone: "warn" as const, filter: { id: "affected" } }] : []),
            { value: vis.filter((r) => !r.next.complete).length, label: "missing prices", filter: { id: "unpriced" } },
          ];
        }}
        card={(r) => ({
          title: r.name,
          subtitle: <>{money(r.next.total)} a batch · {r.pintPrice != null ? `sells ${money(r.pintPrice)}` : "no pour price"}</>,
          value: <Money base={r.base.perPint} next={r.next.perPint} show={active && r.affected} floor={!r.next.complete} />,
          sub: r.next.pintMargin != null ? `${r.next.complete ? "" : "≤ "}${pct(r.next.pintMargin, 0)} margin` : "a pint",
        })}
        drawerTitle={(r) => r.name}
        drawer={(r) => <RecipeDrawer r={r} history={view.history[r.id]} pourYield={view.pourYield} />}
        empty={<span>No brewing recipes yet. Add one under <Link href="/brewery/recipes" className="underline underline-offset-2">Recipes</Link>.</span>}
      />

      <Card className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-5">
        <div>
          <h2 className="text-[0.95rem] font-semibold text-ink">Wholesale keg prices</h2>
          <p className="mt-1 text-sm text-muted">What an account pays for a full keg, for the keg margins. Leave blank if you don&apos;t sell wholesale.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-80">
          <Field label="½ bbl keg"><GridCell grid="wholesale" col="half" type="number" prefix="$" decimals={2} value={view.wholesale.half} placeholder="—" ariaLabel="Wholesale price of a half barrel keg" onSave={(v) => setWholesaleAction("half", v)} /></Field>
          <Field label="⅙ bbl keg"><GridCell grid="wholesale" col="sixth" type="number" prefix="$" decimals={2} value={view.wholesale.sixth} placeholder="—" ariaLabel="Wholesale price of a sixth barrel keg" onSave={(v) => setWholesaleAction("sixth", v)} /></Field>
        </div>
      </Card>
    </div>
  );
}

function PriceChange({ c, ingredients, onChange, onRemove }: { c: Change; ingredients: CogsIngredient[]; onChange: (c: Change) => void; onRemove: () => void }) {
  const ing = ingredients.find((i) => i.id === c.ingredientId);
  return (
    <div className="flex items-center gap-2">
      <Select
        value={c.ingredientId}
        onChange={(e) => onChange({ ...c, ingredientId: e.target.value })}
        options={ingredients.map((i) => ({ value: i.id, label: i.name, hint: `${i.usedBy} recipe${i.usedBy === 1 ? "" : "s"}${i.costPerBase == null ? " · no price" : ""}`, group: i.category }))}
        placeholder="Pick an ingredient"
        searchable
        aria-label="Ingredient"
        className="min-w-0 flex-1"
      />
      <div className="relative w-24 shrink-0">
        <Input inputMode="decimal" value={c.pct} onChange={(e) => onChange({ ...c, pct: e.target.value })} aria-label={`Price change for ${ing?.name ?? "the ingredient"}, percent`} className="pr-6 text-right" />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted">%</span>
      </div>
      <Button size="sm" variant="ghost" className="size-10 shrink-0 p-0 sm:size-8" onClick={onRemove} aria-label="Remove this price change"><X className="size-4" /></Button>
    </div>
  );
}

function RecipeDrawer({ r, history, pourYield }: { r: Row; history?: { date: string; perPint: number | null }[]; pourYield: number }) {
  const line = (label: string, v: string, hint?: string) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-ink-2">{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
      <span className="num text-ink">{v}</span>
    </div>
  );
  return (
    <div className="space-y-6 text-sm">
      <div className="divide-y divide-border">
        {line("Per batch", `${r.next.complete ? "" : "≥ "}${money(r.next.total)}`, `${qty(r.next.batchBbl, 1)} bbl${r.next.unpricedLines ? `, ${r.next.unpricedLines} line${r.next.unpricedLines === 1 ? "" : "s"} with no price` : ""}`)}
        {line("Per barrel", money(r.next.perBbl))}
        {line("Per ½ bbl keg", money(r.next.perHalf))}
        {line("Per ⅙ bbl keg", money(r.next.perSixth))}
        {line("Per pint packaged", money(r.next.perPint))}
        {line("Per pint poured", money(r.next.pouredPint), `after foam and line loss (${Math.round(pourYield * 100)}% reaches the glass)`)}
        {line("Pint sells for", money(r.pintPrice), r.pintPrice == null ? "no draft sales on Square for this beer lately" : "average on Square, last 4 months")}
        {line("Pint margin", r.next.pintMargin == null ? "—" : `${r.next.complete ? "" : "≤ "}${pct(r.next.pintMargin, 0)}`)}
        {r.halfPrice != null && line("½ keg wholesale margin", r.next.halfMargin == null ? "—" : pct(r.next.halfMargin, 0), `at ${money(r.halfPrice)}`)}
        {r.sixthPrice != null && line("⅙ keg wholesale margin", r.next.sixthMargin == null ? "—" : pct(r.next.sixthMargin, 0), `at ${money(r.sixthPrice)}`)}
      </div>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">Cost per pint over the year</h3>
        {history ? (
          <>
            <LineChart points={history.map((p) => ({ x: p.date, y: p.perPint }))} ariaLabel={`${r.name} cost per pint by month`} height={160} />
            <p className="mt-1 text-xs text-muted">Today&apos;s recipe at each month&apos;s prices, from the price history. Gaps are months when a line had no price yet.</p>
          </>
        ) : (
          <p className="text-muted">Not enough price history yet: it shows once every line has had a price for two months.</p>
        )}
      </section>
      <Link href={`/brewery/recipes/${r.id}`} className="inline-block text-sm font-medium text-ink underline underline-offset-2">Open the recipe</Link>
    </div>
  );
}
