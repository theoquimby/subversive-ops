"use client";

import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { BaseUnit, CustomConversion, standardUnit, STANDARD_UNITS_BY_BASE, toBase } from "@/domain/units";
import { money, pct, qty, shortDate } from "@/lib/format";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useConfirm } from "@/components/dialog";
import { parseQuickLine, type QuickItem } from "@/domain/quickAdd";
import { archiveRecipe, saveRecipe } from "../actions";
import { HelpTip, HelpZone } from "@/components/help";

export interface EditorCatalog {
  ingredients: {
    id: string; name: string; baseUnit: BaseUnit; costPerUsableBase: number | null; conversions: CustomConversion[]; units: string[]; packQtyBase: number | null;
    /** The supplier product and price this ingredient's cost comes from (null: no price yet). */
    source?: { supplier: string; sku: string; description: string; pack: string | null; purchaseUnit: string; price: number; date: string } | null;
  }[];
  recipes: { id: string; name: string; baseUnit: BaseUnit; costPerBase: number | null; units: string[]; batchCost?: number | null; yieldQty?: number; yieldUnit?: string }[];
  defaultTarget: number;
}

interface Line {
  key: string;
  ingredientId: string | null;
  subRecipeId: string | null;
  qty: number;
  unit: string;
}

export interface EditorRecipe {
  id: string | null;
  name: string;
  kind: "MENU" | "PREP" | "MODIFIER";
  category: string;
  menuPrice: number | null;
  yieldQty: number;
  yieldUnit: string;
  yieldBase: BaseUnit;
  targetFoodCostPct: number | null;
  notes: string | null;
  lines: Line[];
}

const ALL_YIELD_UNITS = [...STANDARD_UNITS_BY_BASE.ml, ...STANDARD_UNITS_BY_BASE.g, ...STANDARD_UNITS_BY_BASE.each];
const newKey = () => Math.random().toString(36).slice(2);

export function RecipeEditor({ initial, catalog }: { initial: EditorRecipe; catalog: EditorCatalog }) {
  const router = useRouter();
  const [r, setR] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(r) !== JSON.stringify(initial);
  const confirm = useConfirm();
  const leaving = useRef(false);

  // Warn before losing unsaved edits: tab close/reload, and in-app link clicks (sidebar, back link…).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page / hash link
      e.preventDefault();
      e.stopPropagation();
      void confirm({ title: "Leave without saving?", body: "Your changes to this recipe will be lost.", confirmLabel: "Leave", danger: true }).then((ok) => {
        if (!ok) return;
        leaving.current = true;
        router.push(url.pathname + url.search + url.hash);
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, confirm, router]);

  const archive = async () => {
    if (!r.id) return;
    const ok = await confirm({
      title: `Archive ${initial.name || "this recipe"}?`,
      body: "It leaves the menu and stops counting toward costs. You can restore it any time from Menu costs → Archived.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    start(async () => {
      leaving.current = true;
      const res = await archiveRecipe(r.id!);
      if (res?.error) {
        leaving.current = false;
        setError(res.error);
      }
    });
  };

  const ingById = useMemo(() => new Map(catalog.ingredients.map((i) => [i.id, i])), [catalog]);
  const recById = useMemo(() => new Map(catalog.recipes.map((x) => [x.id, x])), [catalog]);

  const lineCost = (l: Line): { cost: number | null; error?: string } => {
    try {
      if (l.ingredientId) {
        const ing = ingById.get(l.ingredientId);
        if (!ing) return { cost: null, error: "Missing" };
        if (ing.costPerUsableBase == null) return { cost: null, error: "No price" };
        return { cost: toBase(l.qty, l.unit, ing.baseUnit, ing.conversions) * ing.costPerUsableBase };
      }
      if (l.subRecipeId) {
        const rec = recById.get(l.subRecipeId);
        if (!rec || rec.costPerBase == null) return { cost: null, error: "No cost" };
        return { cost: toBase(l.qty, l.unit, rec.baseUnit) * rec.costPerBase };
      }
      return { cost: null };
    } catch {
      return { cost: null, error: "Unit" };
    }
  };

  // Quick add: "6 oz ground beef", or paste a whole ingredient list.
  const quickItems = useMemo<(QuickItem & { kind: "i" | "r" })[]>(
    () => [...catalog.ingredients.map((i) => ({ id: i.id, name: i.name, units: i.units, kind: "i" as const })), ...catalog.recipes.map((x) => ({ id: x.id, name: x.name, units: x.units, kind: "r" as const }))],
    [catalog],
  );
  const [quick, setQuick] = useState("");
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const preview = quick.includes("\n") ? null : parseQuickLine(quick, quickItems);
  const addQuick = (text: string) => {
    const parsed = text.split(/\r?\n/).map((l) => parseQuickLine(l, quickItems)).filter((p): p is NonNullable<typeof p> => p != null);
    const ok = parsed.filter((p) => p.item);
    const missed = parsed.filter((p) => !p.item).map((p) => p.raw.trim());
    setR((cur) => ({
      ...cur,
      lines: [
        ...cur.lines,
        ...ok.map((p) => {
          const it = p.item as QuickItem & { kind: "i" | "r" };
          return { key: newKey(), ingredientId: it.kind === "i" ? it.id : null, subRecipeId: it.kind === "r" ? it.id : null, qty: p.qty, unit: p.unit };
        }),
      ],
    }));
    setQuick("");
    setQuickMsg(missed.length ? `Couldn't match: ${missed.join(", ")}` : ok.length > 1 ? `Added ${ok.length} lines` : null);
  };

  const costs = r.lines.map(lineCost);
  const total = costs.reduce((s, c) => s + (c.cost ?? 0), 0);
  const incomplete = costs.some((c) => c.cost == null);
  const isPrep = r.kind === "PREP";
  const target = r.targetFoodCostPct ?? catalog.defaultTarget;
  const foodCost = !isPrep && r.menuPrice ? total / r.menuPrice : null;

  const update = (patch: Partial<EditorRecipe>) => setR((cur) => ({ ...cur, ...patch }));
  const updateLine = (key: string, patch: Partial<Line>) => setR((cur) => ({ ...cur, lines: cur.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const pickItem = (key: string, value: string) => {
    const [type, id] = value.split(":");
    if (type === "i") {
      const ing = ingById.get(id)!;
      updateLine(key, { ingredientId: id, subRecipeId: null, unit: ing.units.includes(currentUnit(key)) ? currentUnit(key) : ing.units[0] });
    } else {
      const rec = recById.get(id)!;
      updateLine(key, { ingredientId: null, subRecipeId: id, unit: rec.units.includes(currentUnit(key)) ? currentUnit(key) : rec.units[0] });
    }
  };
  const currentUnit = (key: string) => r.lines.find((l) => l.key === key)?.unit ?? "";

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveRecipe(r.id, {
        name: r.name,
        kind: r.kind,
        category: r.category,
        menuPrice: isPrep ? null : r.menuPrice,
        yieldQty: r.yieldQty,
        yieldUnit: r.yieldUnit,
        yieldBase: r.yieldBase,
        targetFoodCostPct: r.targetFoodCostPct,
        notes: r.notes,
        lines: r.lines.filter((l) => (l.ingredientId || l.subRecipeId) && l.qty > 0).map(({ ingredientId, subRecipeId, qty, unit }) => ({ ingredientId, subRecipeId, qty, unit })),
      });
      if (res.error) return setError(res.error);
      if (!r.id && res.id) router.replace(`/menu/${res.id}`);
      else router.refresh();
    });

  return (
    <div className={cx(dirty || error ? "pb-24" : "pb-2")}>
      {/* Summary */}
      <HelpZone id="menu.editor.summary" tour="menu.summary" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label={isPrep ? "Batch cost" : "Plate cost"} value={money(total)} note={incomplete ? <Badge tone="warn">Missing prices</Badge> : null} />
        {isPrep ? (
          <Summary label="Yield" value={`${r.yieldQty} ${r.yieldUnit}`} />
        ) : (
          <>
            <Summary label="Food cost" value={pct(foodCost)} tone={foodCost == null ? undefined : foodCost > target ? "bad" : "good"} note={<span className="text-xs text-muted">target {pct(target, 0)}</span>} />
            <Summary label="Margin" value={r.menuPrice ? money(r.menuPrice - total) : "—"} />
            <Summary label={<span className="inline-flex items-center gap-1.5">Price to hit target <HelpTip id="menu.editor.summary" /></span>} value={total > 0 ? money(total / target) : "—"} />
          </>
        )}
      </HelpZone>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Ingredients */}
        <HelpZone id="menu.editor.lines" className="lg:col-span-2"><Card className="h-full" data-tour="menu.lines">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">{isPrep ? "Ingredients per batch" : "Ingredients per serving"} <HelpTip id="menu.editor.lines" /></h2>
            <span className="text-xs text-muted">{r.lines.length} line{r.lines.length === 1 ? "" : "s"}</span>
          </div>
          <div className="divide-y divide-border">
            {r.lines.map((l, idx) => {
              const units = l.ingredientId ? ingById.get(l.ingredientId)?.units : l.subRecipeId ? recById.get(l.subRecipeId)?.units : [];
              const c = costs[idx];
              return (
                <div key={l.key} className="grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_6rem_7rem_5.5rem_auto]">
                  <Select aria-label="Item" value={l.ingredientId ? `i:${l.ingredientId}` : l.subRecipeId ? `r:${l.subRecipeId}` : ""} onChange={(e) => pickItem(l.key, e.target.value)} className="col-span-4 sm:col-span-1">
                    <option value="" disabled>Choose an ingredient…</option>
                    <optgroup label="Ingredients">
                      {catalog.ingredients.map((i) => <option key={i.id} value={`i:${i.id}`}>{i.name}</option>)}
                    </optgroup>
                    {catalog.recipes.length > 0 && (
                      <optgroup label="Prep recipes">
                        {catalog.recipes.map((x) => <option key={x.id} value={`r:${x.id}`}>{x.name}</option>)}
                      </optgroup>
                    )}
                  </Select>
                  <Input aria-label="Quantity" type="number" inputMode="decimal" step="any" min={0} value={Number.isFinite(l.qty) ? l.qty : ""} onChange={(e) => updateLine(l.key, { qty: e.target.valueAsNumber })} className="num text-right" />
                  <Select aria-label="Unit" value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })}>
                    {(units ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
                    {units && !units.includes(l.unit) && <option value={l.unit}>{l.unit}</option>}
                  </Select>
                  <div className={cx("num text-right text-sm", c.cost == null && "text-warn")}>{c.cost != null ? money(c.cost) : c.error ?? "—"}</div>
                  <button type="button" onClick={() => setR((cur) => ({ ...cur, lines: cur.lines.filter((x) => x.key !== l.key) }))} className="relative rounded-md p-1.5 text-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface-2 hover:text-ink" aria-label="Remove line">
                    <X className="size-4" />
                  </button>
                  <CostSource line={l} cost={c.cost} ing={l.ingredientId ? ingById.get(l.ingredientId) : undefined} rec={l.subRecipeId ? recById.get(l.subRecipeId) : undefined} />
                </div>
              );
            })}
          </div>
          <HelpZone id="menu.editor.quickAdd" tour="menu.quick-add" className="border-t border-border px-4 py-3">
            <div className="relative">
              <Plus className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <textarea
                rows={1}
                value={quick}
                onChange={(e) => { setQuick(e.target.value); setQuickMsg(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (quick.trim()) addQuick(quick); } }}
                onPaste={(e) => { const t = e.clipboardData.getData("text/plain"); if (t.includes("\n")) { e.preventDefault(); addQuick(t); } }}
                placeholder='Add an ingredient: "6 oz ground beef"'
                className="block h-10 w-full resize-none rounded-lg border border-dashed border-border-strong bg-transparent py-2.5 pr-9 pl-9 text-sm placeholder:text-muted focus:border-ink-2 focus:border-solid focus:outline-none"
                aria-label="Quick add ingredient"
              />
              <span className="absolute top-1/2 right-3 flex -translate-y-1/2"><HelpTip id="menu.editor.quickAdd" /></span>
            </div>
            {preview?.item ? (
              <div className="mt-1.5 pl-1 text-xs text-muted">↵ adds <span className="num text-ink">{preview.qty} {preview.unit}</span> {preview.item.name}</div>
            ) : quick.trim() ? (
              <div className="mt-1.5 pl-1 text-xs text-warn">No matching ingredient</div>
            ) : quickMsg ? (
              <div className="mt-1.5 pl-1 text-xs text-muted">{quickMsg}</div>
            ) : null}
          </HelpZone>
        </Card></HelpZone>

        {/* Details */}
        <HelpZone id="menu.editor.details" className="self-start"><Card className="space-y-4 p-4" data-tour="menu.details">
          <h2 className="text-sm font-semibold">Details</h2>
          <Field label="Name"><Input value={r.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Subversive burger" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={r.kind} onChange={(e) => update({ kind: e.target.value as EditorRecipe["kind"] })}>
                <option value="MENU">Menu item</option>
                <option value="MODIFIER">Add-on</option>
                <option value="PREP">Prep recipe</option>
              </Select>
            </Field>
            <Field label="Category"><Input value={r.category} onChange={(e) => update({ category: e.target.value })} /></Field>
          </div>
          {isPrep ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Batch yield"><Input type="number" step="any" min={0} value={r.yieldQty} onChange={(e) => update({ yieldQty: e.target.valueAsNumber })} className="num" /></Field>
              <Field label="Unit">
                <Select value={r.yieldUnit} onChange={(e) => update({ yieldUnit: e.target.value, yieldBase: standardUnit(e.target.value)?.base ?? "each" })}>
                  {ALL_YIELD_UNITS.map((u) => <option key={u}>{u}</option>)}
                </Select>
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Menu price">
                <Input type="number" step="0.01" min={0} value={r.menuPrice ?? ""} onChange={(e) => update({ menuPrice: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null })} className="num" placeholder="0.00" />
              </Field>
              <Field label="Target food cost" hint={r.targetFoodCostPct == null ? `Default ${pct(catalog.defaultTarget, 0)}` : undefined}>
                <Input type="number" step="1" min={0} max={100} value={r.targetFoodCostPct == null ? "" : Math.round(r.targetFoodCostPct * 100)} onChange={(e) => update({ targetFoodCostPct: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber / 100 : null })} className="num" placeholder={String(Math.round(catalog.defaultTarget * 100))} />
              </Field>
            </div>
          )}
          <Field label="Notes"><Input value={r.notes ?? ""} onChange={(e) => update({ notes: e.target.value || null })} placeholder="Plating, portioning…" /></Field>
          {r.id && (
            <button type="button" className="-mx-2 -my-2 rounded-md px-2 py-2 text-xs text-muted hover:text-bad disabled:opacity-50" disabled={pending} onClick={archive}>
              Archive recipe
            </button>
          )}
        </Card></HelpZone>
      </div>

      {/* Save bar */}
      {(dirty || error) && (
        <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
          <HelpZone id="menu.editor.save" className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
            <span className={cx("text-sm", error ? "text-bad" : "text-muted")}>{error ?? "Unsaved changes"}</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => { setR(initial); setError(null); }} disabled={pending}>Discard</Button>
              <Button type="button" variant="primary" onClick={save} disabled={pending || !r.name.trim()}>{pending ? "Saving…" : "Save"}</Button>
            </div>
          </HelpZone>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, note, tone }: { label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <Card className="p-4">
      <div className="text-[0.8rem] text-muted">{label}</div>
      <div className={cx("num mt-1 text-xl font-semibold tracking-tight", tone === "bad" && "text-bad", tone === "good" && "text-good")}>{value}</div>
      {note && <div className="mt-1">{note}</div>}
    </Card>
  );
}

/**
 * Under each line: where its cost comes from — the supplier product, the price
 * used and when it was set, and what that works out to per unit. Tap to open
 * the ingredient (or prep recipe) and change it.
 */
function CostSource({ line, cost, ing, rec }: { line: Line; cost: number | null; ing?: EditorCatalog["ingredients"][number]; rec?: EditorCatalog["recipes"][number] }) {
  if (!ing && !rec) return null;
  const perUnit = cost != null && line.qty > 0 ? `${money(cost / line.qty)} ${/^(each|ea)$/i.test(line.unit) ? "each" : `per ${line.unit}`}` : null;
  const cls = "col-span-full -mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs text-muted hover:text-ink";
  if (rec) {
    return (
      <Link href={`/menu/${rec.id}`} className={cls}>
        <span className="font-medium text-ink-2">Prep recipe</span>
        {rec.batchCost != null && rec.yieldQty ? <span>· {money(rec.batchCost)} a {qty(rec.yieldQty)} {rec.yieldUnit} batch</span> : <span>· batch cost unknown</span>}
        {perUnit && <span>→ {perUnit}</span>}
      </Link>
    );
  }
  const src = ing!.source;
  if (!src) {
    return (
      <Link href={`/ingredients/${ing!.id}`} className={cx(cls, "text-warn")}>
        No price yet — link a supplier product or add a price →
      </Link>
    );
  }
  return (
    <Link href={`/ingredients/${ing!.id}`} className={cls}>
      <span className="font-medium text-ink-2">{src.supplier}</span>
      <span>#{src.sku}</span>
      <span className="min-w-0 truncate">· {src.description}{src.pack ? ` · ${src.pack}` : ""}</span>
      <span>· {money(src.price)} a {src.purchaseUnit}{src.date ? ` (${shortDate(src.date)})` : ""}</span>
      {perUnit && <span>→ {perUnit}</span>}
    </Link>
  );
}
