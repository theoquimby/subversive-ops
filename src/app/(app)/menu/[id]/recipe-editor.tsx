"use client";

import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { BaseUnit, canConvert, CustomConversion, standardUnit, STANDARD_UNITS_BY_BASE, toBase } from "@/domain/units";
import { money, pct, qty, shortDate } from "@/lib/format";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useConfirm } from "@/components/dialog";
import { everydayUnit, parseQuickLine, type ParsedLine, type QuickItem } from "@/domain/quickAdd";
import { archiveRecipe, createIngredientForRecipe, saveRecipe } from "../actions";
import { HelpTip, HelpZone } from "@/components/help";
import { looksHouseMade, prepTwin } from "@/domain/linking";
import type { SelectOption } from "@/components/select";

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
  const [breakdown, setBreakdown] = useState(false);
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

  // Ingredients added from this page (quick add's "New ingredient") join the list straight away.
  const [extra, setExtra] = useState<EditorCatalog["ingredients"]>([]);
  const ingredients = useMemo(() => [...catalog.ingredients, ...extra.filter((e) => !catalog.ingredients.some((c) => c.id === e.id))], [catalog, extra]);
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
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
    () => [...ingredients.map((i) => ({ id: i.id, name: i.name, units: i.units, kind: "i" as const })), ...catalog.recipes.map((x) => ({ id: x.id, name: x.name, units: x.units, kind: "r" as const }))],
    [ingredients, catalog],
  );
  const [quick, setQuick] = useState("");
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const preview = quick.includes("\n") ? null : parseQuickLine(quick, quickItems);
  const lineFor = (p: Pick<ParsedLine, "qty" | "unit">, it: QuickItem & { kind: "i" | "r" }) => ({ key: newKey(), ingredientId: it.kind === "i" ? it.id : null, subRecipeId: it.kind === "r" ? it.id : null, qty: p.qty, unit: p.unit });
  /** Add lines that matched for sure. A guess or a miss is never added without asking: one line shows the choice, a pasted list names them. */
  const addQuick = (text: string) => {
    const parsed = text.split(/\r?\n/).map((l) => parseQuickLine(l, quickItems)).filter((p): p is NonNullable<typeof p> => p != null);
    const ok = parsed.filter((p) => p.item && p.sure);
    const left = parsed.filter((p) => !(p.item && p.sure)).map((p) => p.raw.trim());
    if (!ok.length && parsed.length === 1) return; // the choice is on screen under the box
    setR((cur) => ({ ...cur, lines: [...cur.lines, ...ok.map((p) => lineFor(p, p.item as QuickItem & { kind: "i" | "r" }))] }));
    setQuick(left.length && parsed.length > 1 ? left.join("\n") : "");
    setQuickMsg(left.length ? `Added ${ok.length}. Not sure about ${left.length === 1 ? "this one" : `these ${left.length}`}, so ${left.length === 1 ? "it's" : "they're"} left in the box: add ${left.length === 1 ? "it" : "them"} one at a time.` : ok.length > 1 ? `Added ${ok.length} lines` : null);
  };
  /** Use the closest guess anyway. */
  const takeGuess = (p: ParsedLine) => {
    setR((cur) => ({ ...cur, lines: [...cur.lines, lineFor(p, p.item as QuickItem & { kind: "i" | "r" })] }));
    setQuick("");
    setQuickMsg(null);
  };
  /** Add what was typed as a new ingredient (no price yet), and the line with it. */
  const newIngredient = (p: ParsedLine, typedUnit: boolean) =>
    startCreate(async () => {
      const res = await createIngredientForRecipe({ name: p.name, unit: typedUnit ? p.unit : "" });
      if (res.error || !res.ingredient) return setQuickMsg(res.error ?? "Couldn't add it.");
      const ing = res.ingredient;
      setExtra((cur) => [...cur, { id: ing.id, name: ing.name, baseUnit: ing.baseUnit, costPerUsableBase: null, conversions: [], units: ing.units, packQtyBase: null, source: null }]);
      setR((cur) => ({ ...cur, lines: [...cur.lines, { key: newKey(), ingredientId: ing.id, subRecipeId: null, qty: p.qty, unit: res.unit ?? everydayUnit(ing.units) }] }));
      setQuick("");
      setQuickMsg(`${ing.name} is on the ingredient list now, with no price yet. Add one on its page or on Prices to cost this line.`);
    });
  /** An empty line, to pick the item from the list. */
  const addBlank = () => setR((cur) => ({ ...cur, lines: [...cur.lines, { key: newKey(), ingredientId: null, subRecipeId: null, qty: 1, unit: "" }] }));
  // Was a unit typed? ("2 oz pepper jack" yes, "pepper jack" no.)
  const typedUnit = (raw: string) => /\d\s*[a-z]/i.test(raw);

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
      updateLine(key, { ingredientId: id, subRecipeId: null, unit: ing.units.includes(currentUnit(key)) ? currentUnit(key) : everydayUnit(ing.units) });
    } else {
      const rec = recById.get(id)!;
      updateLine(key, { ingredientId: null, subRecipeId: id, unit: rec.units.includes(currentUnit(key)) ? currentUnit(key) : everydayUnit(rec.units) });
    }
  };
  const currentUnit = (key: string) => r.lines.find((l) => l.key === key)?.unit ?? "";

  // The line picker: every ingredient and prep recipe with a type badge, what this
  // line would cost with it, and whether the line's unit works for it.
  const itemOptions = (l: Line): SelectOption[] => {
    const preview = (base: BaseUnit, perBase: number | null, conv: CustomConversion[] = []) => {
      const fits = l.unit ? canConvert(l.unit, base, conv) : true;
      if (!fits) return `by ${base === "each" ? "each" : base === "g" ? "weight" : "volume"} — unit changes`;
      if (perBase == null) return "no price yet";
      if (!(l.qty > 0) || !l.unit) return `${money(perBase * (base === "each" ? 1 : base === "g" ? 28.3495 : 29.5735))} per ${base === "each" ? "each" : base === "g" ? "oz" : "fl oz"}`;
      try { return `${money(toBase(l.qty, l.unit, base, conv) * perBase)} for ${qty(l.qty)} ${l.unit}`; } catch { return "unit changes"; }
    };
    return [
      ...ingredients.map((i) => ({ value: `i:${i.id}`, label: i.name, badge: "Ingredient", group: "Ingredients", hint: preview(i.baseUnit, i.costPerUsableBase, i.conversions) })),
      ...catalog.recipes.map((x) => ({ value: `r:${x.id}`, label: x.name, badge: "Prep recipe", group: "Prep recipes (made here)", hint: preview(x.baseUnit, x.costPerBase) })),
    ];
  };
  const preps = useMemo(() => catalog.recipes.map((x) => ({ id: x.id, name: x.name })), [catalog]);
  /** Swap an ingredient line for the prep recipe of the same thing, keeping the amount when the unit converts. */
  const swapToPrep = (key: string, recId: string) => {
    const rec = recById.get(recId)!;
    const l = r.lines.find((x) => x.key === key)!;
    updateLine(key, { ingredientId: null, subRecipeId: recId, unit: rec.units.includes(l.unit) || canConvert(l.unit, rec.baseUnit) ? l.unit : rec.units[0] });
  };

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
        <Summary
          label={<span className="inline-flex items-center gap-1.5">{isPrep ? "Batch cost" : "Plate cost"} <HelpTip id="menu.editor.breakdown" /></span>}
          value={money(total)}
          onClick={r.lines.length ? () => setBreakdown((v) => !v) : undefined}
          expanded={breakdown}
          action={breakdown ? "Hide breakdown" : "Where it comes from"}
          note={incomplete ? <Badge tone="warn">Missing prices</Badge> : null}
        />
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

      {breakdown && r.lines.length > 0 && (
        <CostBreakdown
          isPrep={isPrep}
          total={total}
          menuPrice={isPrep ? null : r.menuPrice}
          target={target}
          yieldText={isPrep ? `${qty(r.yieldQty)} ${r.yieldUnit}` : null}
          rows={r.lines.map((l, idx) => ({
            key: l.key,
            name: (l.ingredientId ? ingById.get(l.ingredientId)?.name : l.subRecipeId ? recById.get(l.subRecipeId)?.name : null) ?? "Not chosen yet",
            amount: `${qty(l.qty)} ${l.unit}`,
            cost: costs[idx].cost,
            problem: costs[idx].error ?? null,
            href: l.ingredientId ? `/ingredients/${l.ingredientId}` : l.subRecipeId ? `/menu/${l.subRecipeId}` : null,
            prep: !!l.subRecipeId,
          }))}
          onClose={() => setBreakdown(false)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Ingredients */}
        <HelpZone id="menu.editor.lines" className="lg:col-span-2"><Card className="h-full" data-tour="menu.lines">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">{isPrep ? "Ingredients per batch" : "Ingredients per serving"} <HelpTip id="menu.editor.lines" /></h2>
            <span className="ml-auto mr-3 hidden items-center gap-1 text-xs text-muted sm:inline-flex">Ingredient or prep recipe? <HelpTip id="menu.editor.picker" /></span>
            <span className="text-xs text-muted">{r.lines.length} line{r.lines.length === 1 ? "" : "s"}</span>
          </div>
          <div className="divide-y divide-border">
            {r.lines.map((l, idx) => {
              const units = l.ingredientId ? ingById.get(l.ingredientId)?.units : l.subRecipeId ? recById.get(l.subRecipeId)?.units : [];
              const c = costs[idx];
              return (
                <div key={l.key} className="grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_6rem_7rem_5.5rem_auto]">
                  <Select aria-label="Item" value={l.ingredientId ? `i:${l.ingredientId}` : l.subRecipeId ? `r:${l.subRecipeId}` : ""} onChange={(e) => pickItem(l.key, e.target.value)} options={itemOptions(l)} searchable placeholder="Choose an ingredient or prep recipe…" className="col-span-4 sm:col-span-1" />
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
                  {l.ingredientId && <HouseMadeHint name={ingById.get(l.ingredientId)?.name ?? ""} twin={prepTwin(ingById.get(l.ingredientId)?.name ?? "", preps)} onUse={(id) => swapToPrep(l.key, id)} />}
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
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (quick.trim() && !creating) addQuick(quick); } }}
                onPaste={(e) => { const t = e.clipboardData.getData("text/plain"); if (t.includes("\n")) { e.preventDefault(); addQuick(t); } }}
                placeholder='Add an ingredient: "6 oz ground beef"'
                className="block h-10 w-full resize-none rounded-lg border border-dashed border-border-strong bg-transparent py-2.5 pr-9 pl-9 text-sm placeholder:text-muted focus:border-ink-2 focus:border-solid focus:outline-none"
                aria-label="Quick add ingredient"
              />
              <span className="absolute top-1/2 right-3 flex -translate-y-1/2"><HelpTip id="menu.editor.quickAdd" /></span>
            </div>
            {preview?.item && preview.sure ? (
              <div className="mt-1.5 pl-1 text-xs text-muted">↵ adds <span className="num text-ink">{preview.qty} {preview.unit}</span> {preview.item.name}</div>
            ) : preview && quick.trim() ? (
              <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
                <p className="text-ink-2">
                  {preview.item ? <>Not sure that&apos;s on the list. The closest is <b className="text-ink">{preview.item.name}</b>.</> : <>No ingredient called <b className="text-ink">{preview.name}</b> yet.</>}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {preview.item && <Button size="sm" onClick={() => takeGuess(preview)}>Use {preview.item.name}</Button>}
                  <Button size="sm" variant={preview.item ? "ghost" : "secondary"} disabled={creating} onClick={() => newIngredient(preview, typedUnit(quick))}>
                    <Plus className="size-3.5" />{creating ? "Adding…" : `New ingredient “${preview.name.charAt(0).toUpperCase() + preview.name.slice(1)}”`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { addBlank(); setQuick(""); }}>Pick from the list</Button>
                </div>
              </div>
            ) : quickMsg ? (
              <div className="mt-1.5 pl-1 text-xs text-muted">{quickMsg}</div>
            ) : (
              <button type="button" onClick={addBlank} className="mt-1.5 pl-1 text-xs text-muted underline underline-offset-2 hover:text-ink">Or pick from the list</button>
            )}
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

/**
 * Under an ingredient line that sounds made in the kitchen (aioli, pickles,
 * pulled pork): use the prep recipe of the same name if there is one, or make one,
 * so its cost comes from its own ingredients and it shows on the prep list.
 */
function HouseMadeHint({ name, twin, onUse }: { name: string; twin: { id: string; name: string } | null; onUse: (id: string) => void }) {
  if (twin) {
    return (
      <div className="col-span-full -mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink-2">
        <span>There&apos;s a prep recipe for this.</span>
        <button type="button" onClick={() => onUse(twin.id)} className="font-medium text-ink underline underline-offset-2 hover:no-underline">Use {twin.name}</button>
        <span className="text-muted">so it costs what you make it for.</span>
      </div>
    );
  }
  if (!looksHouseMade(name)) return null;
  return (
    <div className="col-span-full -mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted">
      <span>Made here?</span>
      <Link href={`/menu/new?kind=PREP&name=${encodeURIComponent(name)}`} className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">Make {name} a prep recipe</Link>
      <span>to cost it from its ingredients and add it to the prep list.</span>
    </div>
  );
}

function Summary({ label, value, note, tone, onClick, expanded, action }: { label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; tone?: "good" | "bad"; onClick?: () => void; expanded?: boolean; action?: string }) {
  return (
    <Card className={cx("relative p-4 transition-colors duration-120", onClick && "hover:bg-surface-2/50", expanded && "border-ink-2/40")}>
      {/* The label's "?" sits above the card-wide button so both stay tappable. */}
      <div className="relative z-10 w-fit text-[0.8rem] text-muted">{label}</div>
      <div className={cx("num mt-1 text-xl font-semibold tracking-tight", tone === "bad" && "text-bad", tone === "good" && "text-good")}>{value}</div>
      {(note || onClick) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {note}
          {onClick && (
            <button type="button" onClick={onClick} aria-expanded={expanded} className="text-xs text-muted underline decoration-dotted underline-offset-2 after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:text-ink">
              {action}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

interface BreakdownRow { key: string; name: string; amount: string; cost: number | null; problem: string | null; href: string | null; prep: boolean }

/**
 * "Where the $3.01 comes from": every line's share of the plate (or batch), biggest
 * first, with the sum written out — so the number on the card is never a mystery.
 * Each line opens the ingredient (its price, supplier and yield) or the prep recipe.
 */
function CostBreakdown({ rows, total, isPrep, menuPrice, target, yieldText, onClose }: { rows: BreakdownRow[]; total: number; isPrep: boolean; menuPrice: number | null; target: number; yieldText: string | null; onClose: () => void }) {
  const sorted = [...rows].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1));
  const missing = rows.filter((x) => x.cost == null);
  const shade = (i: number) => Math.max(0.22, 0.95 - i * 0.16);
  return (
    <Card className="mb-6 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Where the {money(total)} comes from</h2>
          <p className="mt-0.5 text-xs text-muted">
            {isPrep ? "Batch cost" : "Plate cost"} = each line&apos;s amount × what that ingredient costs per unit after trim and yield, at the latest price on file. Tap a line to see its price and supplier.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Hide breakdown" className="relative -m-1 rounded-md p-1.5 text-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface-2 hover:text-ink"><X className="size-4" /></button>
      </div>
      {total > 0 && (
        <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
          {sorted.filter((x) => (x.cost ?? 0) > 0).map((x, i) => (
            <span key={x.key} className="h-full border-r-2 border-surface bg-area last:border-r-0" style={{ width: `${((x.cost ?? 0) / total) * 100}%`, opacity: shade(i) }} />
          ))}
        </div>
      )}
      <ol className="mt-3 divide-y divide-border">
        {sorted.map((x, i) => {
          const share = x.cost != null && total > 0 ? x.cost / total : null;
          const row = (
            <>
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-area" style={{ opacity: x.cost != null && x.cost > 0 ? shade(i) : 0.12 }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm break-words text-ink">{x.name}</span>
                <span className="num block text-xs text-muted">{x.amount}{x.prep && " · prep recipe"}</span>
              </span>
              <span className="num w-12 shrink-0 text-right text-xs text-muted">{share != null ? pct(share, 0) : ""}</span>
              <span className={cx("num w-20 shrink-0 text-right text-sm", x.cost == null && "text-warn")}>{x.cost != null ? money(x.cost) : x.problem === "Unit" ? "Unit?" : "No price"}</span>
            </>
          );
          return (
            <li key={x.key}>
              {x.href ? <Link href={x.href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2/60">{row}</Link> : <div className="flex items-center gap-3 py-2">{row}</div>}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 space-y-1 border-t border-border pt-3 text-xs text-muted">
        <p className="num flex justify-between gap-3"><span>Total of {rows.length} line{rows.length === 1 ? "" : "s"}</span><span className="font-medium text-ink">{money(total)}</span></p>
        {yieldText && <p>One batch makes {yieldText}; menu items that use it pay their share of the batch.</p>}
        {menuPrice != null && menuPrice > 0 && (
          <p>Food cost = {money(total)} ÷ {money(menuPrice)} menu price = <span className="font-medium text-ink">{pct(total / menuPrice)}</span>. Under your {pct(target, 0)} target is good; over it means the price or the portion needs a look.</p>
        )}
        {missing.length > 0 && (
          <p className="text-warn">{missing.length} line{missing.length === 1 ? " has" : "s have"} no cost yet, so the real {isPrep ? "batch" : "plate"} cost is higher than {money(total)}. Open {missing.length === 1 ? "it" : "each one"} to add a price or fix the unit.</p>
        )}
      </div>
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
