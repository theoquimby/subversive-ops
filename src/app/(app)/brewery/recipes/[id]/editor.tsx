"use client";

import { useConfirm } from "@/components/dialog";
import { HelpTip, HelpZone } from "@/components/help";
import type { SelectOption } from "@/components/select";
import { Badge, Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import { BREW_UNITS, grainDefaults, MASS_UNITS, recipeStats, scaleQty, type BrewLineKind, type BrewUnit, type HopUse } from "@/domain/brewMath";
import { brewToBase, categoryForKind, costBrewRecipe, HOP_USE_LABEL, KIND_LABEL, PACKAGING_LOSS, RECIPE_STATUSES, type BrewRecipeStatus, type PricedIngredient } from "@/domain/brewRecipes";
import { money, pct, qty, shortDate } from "@/lib/format";
import type { BrewCatalogIngredient, BrewLineData, BrewRecipeData } from "@/server/services/brewRecipes";
import { Copy, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { Swatch } from "../recipe-list";
import { createBrewIngredientAction, duplicateBrewRecipeAction, removeBrewRecipeAction, saveBrewRecipeAction } from "../actions";

type Line = BrewLineData & { key: string };
type Recipe = Omit<BrewRecipeData, "lines"> & { lines: Line[] };
type SectionId = "grain" | "hop" | "yeast" | "other";

const newKey = () => Math.random().toString(36).slice(2);
const plain = (l: Line): BrewLineData => {
  const { key, ...rest } = l;
  void key;
  return rest;
};
const withKeys = (r: BrewRecipeData): Recipe => ({ ...r, lines: r.lines.map((l) => ({ ...l, key: l.id ?? newKey() })) });
const sectionOf = (k: BrewLineKind): SectionId => (k === "grain" ? "grain" : k === "hop" ? "hop" : k === "yeast" ? "yeast" : "other");
const sg = (n: number) => n.toFixed(3);

const SECTIONS: { id: SectionId; title: string; add: BrewLineKind; addLabel: string; units: BrewUnit[]; defaultUnit: BrewUnit; help: string }[] = [
  { id: "grain", title: "Grain bill", add: "grain", addLabel: "Add grain", units: MASS_UNITS, defaultUnit: "lb", help: "brewery.recipes.grain" },
  { id: "hop", title: "Hops", add: "hop", addLabel: "Add hop", units: ["lb", "oz", "kg", "g"], defaultUnit: "lb", help: "brewery.recipes.hops" },
  { id: "yeast", title: "Yeast", add: "yeast", addLabel: "Add yeast", units: ["pkg", "g", "kg", "lb", "oz", "l", "ml", "each"], defaultUnit: "pkg", help: "brewery.recipes.yeast" },
  { id: "other", title: "Other", add: "adjunct", addLabel: "Add adjunct, salt or fining", units: [...BREW_UNITS], defaultUnit: "lb", help: "brewery.recipes.other" },
];

const blankLine = (kind: BrewLineKind, unit: BrewUnit): Line => ({
  key: newKey(),
  id: null,
  kind,
  name: "",
  ingredientId: null,
  qty: 0,
  unit,
  potentialPpg: null,
  colorL: null,
  alphaPct: null,
  use: kind === "hop" ? "boil" : null,
  minutes: kind === "hop" ? 60 : null,
  attenuationPct: null,
});

/** Price of one lb / package / gallon of an ingredient, for the picker. */
function perUnitText(i: BrewCatalogIngredient): string {
  if (i.costPerBase == null) return "no price yet";
  const unit = i.baseUnit === "g" ? "lb" : i.baseUnit === "ml" ? "gal" : "pkg";
  try {
    return `${money(brewToBase(1, unit, i.baseUnit, i.conversions) * i.costPerBase)} / ${unit}`;
  } catch {
    return "priced";
  }
}

export function BrewRecipeEditor({ initial, catalog, brews }: { initial: BrewRecipeData; catalog: { ingredients: BrewCatalogIngredient[]; beers: { id: string; name: string }[] }; brews: number }) {
  const router = useRouter();
  const confirm = useConfirm();
  const start0 = useMemo(() => withKeys(initial), [initial]);
  const [r, setR] = useState<Recipe>(start0);
  const [ingredients, setIngredients] = useState(catalog.ingredients);
  const [error, setError] = useState<string | null>(null);
  const [scaleTo, setScaleTo] = useState<number | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const leaving = useRef(false);
  const strip = (x: Recipe) => JSON.stringify({ ...x, lines: x.lines.map(plain) });
  const dirty = strip(r) !== strip(start0);

  // Warn before losing unsaved edits: tab close/reload, and in-app link clicks.
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
      if (url.pathname === location.pathname && url.search === location.search) return;
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

  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const priced = useMemo(() => new Map<string, PricedIngredient>(ingredients.map((i) => [i.id, { id: i.id, name: i.name, baseUnit: i.baseUnit, costPerBase: i.costPerBase, conversions: i.conversions }])), [ingredients]);

  // The numbers, recomputed on every change with the same maths the server uses.
  const stats = recipeStats({ batchBbl: r.batchBbl, efficiencyPct: r.efficiencyPct, boilMinutes: r.boilMinutes, lines: r.lines });
  const cost = costBrewRecipe(r.lines, priced, r.batchBbl);
  const scaling = scaleTo != null && scaleTo > 0 && r.batchBbl > 0 && Math.abs(scaleTo - r.batchBbl) > 1e-9;
  const shownBbl = scaling ? scaleTo! : r.batchBbl;
  const batchTotal = scaling ? scaleQty(cost.total, r.batchBbl, scaleTo!) : cost.total;

  const update = (patch: Partial<Recipe>) => setR((cur) => ({ ...cur, ...patch }));
  const updateLine = (key: string, patch: Partial<Line>) => setR((cur) => ({ ...cur, lines: cur.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key: string) => setR((cur) => ({ ...cur, lines: cur.lines.filter((l) => l.key !== key) }));
  const addLine = (kind: BrewLineKind, unit: BrewUnit) => setR((cur) => ({ ...cur, lines: [...cur.lines, blankLine(kind, unit)] }));

  const match = (l: Line, value: string) => {
    if (value !== "__new__") {
      const ing = value ? ingById.get(value) : undefined;
      updateLine(l.key, { ingredientId: value || null, ...(ing && !l.name.trim() ? { name: ing.name } : {}) });
      return;
    }
    setCreating(l.key);
    start(async () => {
      const res = await createBrewIngredientAction(l.name, l.kind, l.unit);
      setCreating(null);
      if ("error" in res) return setError(res.error);
      setIngredients((cur) => (cur.some((i) => i.id === res.id) ? cur : [...cur, res]));
      updateLine(l.key, { ingredientId: res.id });
    });
  };

  const save = () =>
    start(async () => {
      setError(null);
      const lines = r.lines.filter((l) => l.name.trim() || l.ingredientId || l.qty > 0);
      if (lines.some((l) => !l.name.trim())) return setError("Every line needs a name.");
      const res = await saveBrewRecipeAction(r.id, {
        name: r.name,
        style: r.style,
        status: r.status,
        beerId: r.beerId,
        batchBbl: r.batchBbl,
        efficiencyPct: r.efficiencyPct,
        boilMinutes: r.boilMinutes,
        fermentDays: r.fermentDays,
        conditionDays: r.conditionDays,
        targetOg: r.targetOg,
        targetFg: r.targetFg,
        notes: r.notes,
        lines: lines.map((l) => ({ ...plain(l), qty: Number.isFinite(l.qty) ? l.qty : 0 })),
      });
      if (res.error) return setError(res.error);
      if (!r.id && res.id) {
        leaving.current = true;
        router.replace(`/brewery/recipes/${res.id}`);
      } else router.refresh();
    });

  const duplicate = () =>
    start(async () => {
      if (dirty) return setError("Save or discard your changes before making a copy.");
      const res = await duplicateBrewRecipeAction(r.id!);
      if (res.error) return setError(res.error);
      router.push(`/brewery/recipes/${res.id}`);
    });

  const remove = async () => {
    const ok = await confirm(
      brews > 0
        ? { title: `Archive ${initial.name}?`, body: `${brews} brew${brews === 1 ? " uses" : "s use"} this recipe, so it's archived instead of deleted. You can bring it back by setting it to Live.`, confirmLabel: "Archive", danger: true }
        : { title: `Delete ${initial.name}?`, body: "It's gone for good. No brew uses it.", confirmLabel: "Delete", danger: true },
    );
    if (!ok) return;
    start(async () => {
      leaving.current = true;
      const res = await removeBrewRecipeAction(r.id!);
      if (res.error) {
        leaving.current = false;
        return setError(res.error);
      }
      if (res.deleted) router.push("/brewery/recipes");
      else router.refresh();
    });
  };

  const applyScale = () => {
    if (!scaling) return;
    setR((cur) => ({ ...cur, batchBbl: scaleTo!, lines: cur.lines.map((l) => ({ ...l, qty: Number(scaleQty(l.qty, cur.batchBbl, scaleTo!).toFixed(4)) })) }));
    setScaleTo(null);
  };

  const totalText = cost.complete ? money(batchTotal) : `at least ${money(batchTotal)}`;
  const perText = (v: number | null) => (v == null ? "—" : cost.complete ? money(v) : `≥ ${money(v)}`);

  return (
    <div className={cx(dirty || error ? "pb-24" : "pb-2")}>
      {/* What the recipe makes and costs, live */}
      <HelpZone id="brewery.recipes.numbers" className="mb-6 block">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="OG" value={sg(stats.og)} hint={r.targetOg ? `target ${sg(r.targetOg)}` : `${qty(r.efficiencyPct, 0)}% efficiency`} />
          <Fact label="FG" value={sg(stats.fg)} hint={r.targetFg ? `target ${sg(r.targetFg)}` : `${qty(stats.attenuationPct, 0)}% attenuation${stats.attenuationAssumed ? ", assumed" : ""}`} />
          <Fact label="ABV" value={`${stats.abv.toFixed(1)}%`} />
          <Fact label="IBU" value={Math.round(stats.ibu)} hint="Tinseth" />
          <Fact label="Colour" value={<span className="inline-flex items-center gap-2"><Swatch hex={stats.colorHex} srm={stats.srm} hasGrain={stats.og > 1} />{stats.srm.toFixed(1)}</span>} hint="SRM, Morey" />
          <Fact
            label={scaling ? `Batch of ${qty(shownBbl, 2)} bbl` : "Cost per batch"}
            value={<span className={cx(!cost.complete && "text-warn")}>{totalText}</span>}
            hint={cost.complete ? `${qty(r.lines.length, 0)} line${r.lines.length === 1 ? "" : "s"}` : `${cost.unpricedLines} ingredient${cost.unpricedLines === 1 ? " has" : "s have"} no price`}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact small label="Per barrel" value={perText(cost.perBbl)} />
          <Fact small label="Per 1/2 bbl keg" value={perText(cost.perHalf)} />
          <Fact small label="Per 1/6 bbl keg" value={perText(cost.perSixth)} />
          <Fact small label="Per 16 oz pint" value={perText(cost.perPint)} />
        </div>
        <p className="mt-2 text-xs text-muted">
          Keg and pint costs share the batch over what reaches the kegs: {qty(shownBbl, 2)} bbl less {Math.round(PACKAGING_LOSS * 100)}% lost to trub, tank bottoms and transfers. Foam and line loss at the tap aren&apos;t included.
        </p>
        {(stats.notes.length > 0 || cost.unpriced.length > 0) && (
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {cost.unpriced.length > 0 && (
              <li className="text-warn">
                No price yet: {cost.unpriced.map((u) => u.name || "a line with no name").join("; ")}. The cost counts them as nothing, so it&apos;s the least this batch costs.{" "}
                <Link href="/brewery/recipes#prices" className="underline underline-offset-2">Add prices</Link>
              </li>
            )}
            {stats.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </HelpZone>

      {scaling && (
        <Card className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-ink-2/30 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">Amounts below are for <b className="num">{qty(scaleTo, 2)} bbl</b> instead of {qty(r.batchBbl, 2)} bbl. Gravity, bitterness and colour don&apos;t change. Nothing is saved.</span>
          <Button size="sm" className="h-10 sm:h-8" onClick={applyScale}>Make this the batch size</Button>
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setScaleTo(null)}>Back to {qty(r.batchBbl, 2)} bbl</Button>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {SECTIONS.map((s) => (
            <LineSection
              key={s.id}
              section={s}
              lines={r.lines.filter((l) => sectionOf(l.kind) === s.id)}
              allLines={r.lines}
              stats={stats}
              costLines={cost.lines}
              scale={scaling ? (q: number) => scaleQty(q, r.batchBbl, scaleTo!) : null}
              ingredients={ingredients}
              ingById={ingById}
              creating={creating}
              onAdd={() => addLine(s.add, s.defaultUnit)}
              onChange={updateLine}
              onRemove={removeLine}
              onMatch={match}
            />
          ))}
        </div>

        <div className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          <HelpZone id="brewery.recipes.details" className="block">
            <Card className="space-y-4 p-4">
              <h2 className="text-sm font-semibold">Recipe</h2>
              <Field label="Name"><Input value={r.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. New York Nectar" /></Field>
              <Field label="Style"><Input value={r.style ?? ""} onChange={(e) => update({ style: e.target.value || null })} placeholder="e.g. Hazy IPA" /></Field>
              <Field label="Status">
                <Select value={r.status} onChange={(e) => update({ status: e.target.value as BrewRecipeStatus })} options={RECIPE_STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
              </Field>
              <Field label="Beer it pours as" hint={r.status === "live" && r.beerId ? "Keg pour costs for this beer come from this recipe once every line has a price." : undefined}>
                <Select value={r.beerId ?? ""} onChange={(e) => update({ beerId: e.target.value || null })} searchable options={[{ value: "", label: "Not linked to a beer" }, ...catalog.beers.map((b) => ({ value: b.id, label: b.name }))]} />
              </Field>
              {r.id && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" className="h-10 sm:h-8" onClick={duplicate} disabled={pending}><Copy className="size-3.5" />Duplicate</Button>
                  <Button size="sm" variant="danger" className="h-10 sm:h-8" onClick={remove} disabled={pending}><Trash2 className="size-3.5" />{brews > 0 ? "Archive" : "Delete"}</Button>
                </div>
              )}
            </Card>
          </HelpZone>

          <HelpZone id="brewery.recipes.process" className="block">
            <Card className="space-y-4 p-4">
              <h2 className="text-sm font-semibold">Process</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Batch size, bbl"><NumInput value={r.batchBbl} onChange={(v) => update({ batchBbl: v ?? 0 })} step="0.5" /></Field>
                <Field label="Efficiency, %"><NumInput value={r.efficiencyPct} onChange={(v) => update({ efficiencyPct: v ?? 0 })} step="1" /></Field>
                <Field label="Boil, minutes"><NumInput value={r.boilMinutes} onChange={(v) => update({ boilMinutes: v ?? 0 })} step="5" /></Field>
                <Field label="Scale to, bbl" hint="Shows amounts only">
                  <NumInput value={scaleTo} onChange={setScaleTo} step="0.5" placeholder={qty(r.batchBbl, 2)} />
                </Field>
                <Field label="Days fermenting"><NumInput value={r.fermentDays} onChange={(v) => update({ fermentDays: v ?? 0 })} step="1" /></Field>
                <Field label="Days conditioning"><NumInput value={r.conditionDays} onChange={(v) => update({ conditionDays: v ?? 0 })} step="1" /></Field>
                <Field label="Target OG"><NumInput value={r.targetOg} onChange={(v) => update({ targetOg: v })} step="0.001" placeholder={sg(stats.og)} /></Field>
                <Field label="Target FG"><NumInput value={r.targetFg} onChange={(v) => update({ targetFg: v })} step="0.001" placeholder={sg(stats.fg)} /></Field>
              </div>
              <Field label="Notes"><Textarea value={r.notes ?? ""} onChange={(e) => update({ notes: e.target.value || null })} placeholder="Mash schedule, water, finings, dry hop timing…" rows={4} /></Field>
            </Card>
          </HelpZone>
        </div>
      </div>

      {/* Save bar */}
      {(dirty || error) && (
        <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
            <span className={cx("min-w-0 text-sm", error ? "text-bad" : "text-muted")}>{error ?? "Unsaved changes"}</span>
            <div className="flex shrink-0 gap-2">
              {dirty && <Button type="button" variant="ghost" onClick={() => { setR(start0); setError(null); setScaleTo(null); }} disabled={pending}>Discard</Button>}
              {!dirty && error && <Button type="button" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}
              {dirty && <Button type="button" variant="primary" onClick={save} disabled={pending || !r.name.trim()}>{pending ? "Saving…" : "Save"}</Button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, hint, small }: { label: ReactNode; value: ReactNode; hint?: ReactNode; small?: boolean }) {
  return (
    <Card className={cx("min-w-0", small ? "px-4 py-3" : "p-4")}>
      <div className="truncate text-[0.8rem] text-muted">{label}</div>
      <div className={cx("num mt-1 truncate font-semibold tracking-tight", small ? "text-base" : "text-xl")}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted">{hint}</div>}
    </Card>
  );
}

function NumInput({ value, onChange, step = "any", placeholder, label, className }: { value: number | null; onChange: (v: number | null) => void; step?: string; placeholder?: string; label?: string; className?: string }) {
  // Keep what's typed ("1.", "") while it isn't a number yet; report numbers up.
  const [text, setText] = useState(value == null ? "" : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value == null ? "" : String(Number(value.toFixed(4))));
    }
  }, [value]);
  return (
    <Input
      type="number"
      inputMode="decimal"
      step={step}
      min={0}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      className={cx("num text-right", className)}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value === "" ? null : Number(e.target.value);
        const v = n != null && Number.isFinite(n) ? n : null;
        last.current = v;
        onChange(v);
      }}
    />
  );
}

interface Col {
  label: string;
  width: string;
  cell: (l: Line, i: number) => ReactNode;
}

function LineSection({
  section,
  lines,
  allLines,
  stats,
  costLines,
  scale,
  ingredients,
  ingById,
  creating,
  onAdd,
  onChange,
  onRemove,
  onMatch,
}: {
  section: (typeof SECTIONS)[number];
  lines: Line[];
  allLines: Line[];
  stats: ReturnType<typeof recipeStats>;
  costLines: ReturnType<typeof costBrewRecipe>["lines"];
  scale: ((q: number) => number) | null;
  ingredients: BrewCatalogIngredient[];
  ingById: Map<string, BrewCatalogIngredient>;
  creating: string | null;
  onAdd: () => void;
  onChange: (key: string, patch: Partial<Line>) => void;
  onRemove: (key: string) => void;
  onMatch: (l: Line, value: string) => void;
}) {
  const at = (l: Line) => allLines.indexOf(l);
  const unitSelect = (l: Line) => (
    <Select
      aria-label={`${l.name || "Line"} unit`}
      value={l.unit}
      onChange={(e) => onChange(l.key, { unit: e.target.value })}
      options={[...new Set<string>([...section.units, l.unit])].map((u) => ({ value: u, label: u }))}
    />
  );
  const amount = (l: Line) =>
    scale ? (
      <div className="num flex h-10 items-center justify-end rounded-lg bg-surface-2 px-3 text-sm sm:h-9" title="Scaled amount">{qty(scale(l.qty), 2)}</div>
    ) : (
      <NumInput label={`${l.name || "Line"} amount`} value={l.qty} onChange={(v) => onChange(l.key, { qty: v ?? 0 })} />
    );
  const costCell = (l: Line) => {
    const c = costLines[at(l)];
    if (!c) return null;
    const value = c.cost == null ? null : scale ? scale(c.cost) : c.cost;
    return <div className={cx("num flex h-10 items-center justify-end text-sm sm:h-9", value == null && "text-warn")}>{value == null ? (c.cost == null && c.reason === "unit" ? "Unit?" : "No price") : money(value)}</div>;
  };
  const read = (text: ReactNode, tone?: "muted") => <div className={cx("num flex h-10 items-center justify-end text-sm sm:h-9", tone === "muted" ? "text-muted" : "text-ink-2")}>{text}</div>;

  const cols: Col[] =
    section.id === "grain"
      ? [
          { label: "Amount", width: "6rem", cell: amount },
          { label: "Unit", width: "4.75rem", cell: unitSelect },
          { label: "ppg", width: "4.5rem", cell: (l) => <NumInput label={`${l.name} extract, ppg`} value={l.potentialPpg} onChange={(v) => onChange(l.key, { potentialPpg: v })} placeholder={String(grainDefaults(l.name).ppg)} /> },
          { label: "°L", width: "4.5rem", cell: (l) => <NumInput label={`${l.name} colour, °L`} value={l.colorL} onChange={(v) => onChange(l.key, { colorL: v })} placeholder={String(grainDefaults(l.name).colorL)} /> },
          { label: "Grist", width: "3.75rem", cell: (l) => read(stats.lines[at(l)]?.gristPct == null ? "—" : pct(stats.lines[at(l)]!.gristPct, 0), "muted") },
          { label: "Cost", width: "5.5rem", cell: costCell },
        ]
      : section.id === "hop"
        ? [
            { label: "Amount", width: "5.5rem", cell: amount },
            { label: "Unit", width: "4.75rem", cell: unitSelect },
            { label: "Alpha %", width: "4.5rem", cell: (l) => <NumInput label={`${l.name} alpha acid %`} value={l.alphaPct} onChange={(v) => onChange(l.key, { alphaPct: v })} placeholder="—" /> },
            { label: "Use", width: "7.5rem", cell: (l) => <Select aria-label={`${l.name} use`} value={l.use ?? "boil"} onChange={(e) => onChange(l.key, { use: e.target.value as HopUse })} options={Object.entries(HOP_USE_LABEL).map(([value, label]) => ({ value, label }))} /> },
            { label: "Time", width: "4.75rem", cell: (l) => (l.use === "firstwort" || l.use === "mash" ? read("—", "muted") : <NumInput label={`${l.name} ${l.use === "dryhop" ? "days" : "minutes"}`} value={l.minutes} onChange={(v) => onChange(l.key, { minutes: v })} placeholder={l.use === "dryhop" ? "days" : l.use === "whirlpool" ? "20" : "min"} />) },
            { label: "IBU", width: "3.5rem", cell: (l) => read((stats.lines[at(l)]?.ibu ?? 0).toFixed(1), "muted") },
            { label: "Cost", width: "5.5rem", cell: costCell },
          ]
        : section.id === "yeast"
          ? [
              { label: "Amount", width: "6rem", cell: amount },
              { label: "Unit", width: "4.75rem", cell: unitSelect },
              { label: "Attenuation %", width: "6.5rem", cell: (l) => <NumInput label={`${l.name} attenuation %`} value={l.attenuationPct} onChange={(v) => onChange(l.key, { attenuationPct: v })} placeholder="75" /> },
              { label: "Cost", width: "5.5rem", cell: costCell },
            ]
          : [
              { label: "Kind", width: "7.5rem", cell: (l) => <Select aria-label={`${l.name} kind`} value={l.kind} onChange={(e) => onChange(l.key, { kind: e.target.value as BrewLineKind, potentialPpg: e.target.value === "adjunct" ? l.potentialPpg : null })} options={(["adjunct", "water", "other"] as BrewLineKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} /> },
              { label: "Amount", width: "6rem", cell: amount },
              { label: "Unit", width: "4.75rem", cell: unitSelect },
              { label: "ppg", width: "4.5rem", cell: (l) => (l.kind === "adjunct" ? <NumInput label={`${l.name} extract, ppg`} value={l.potentialPpg} onChange={(v) => onChange(l.key, { potentialPpg: v })} placeholder="—" /> : read("—", "muted")) },
              { label: "Cost", width: "5.5rem", cell: costCell },
            ];

  const template = ["minmax(0,1fr)", ...cols.map((c) => c.width)].join(" ");
  const style = { "--cols": template } as CSSProperties;
  const sectionTotal = lines.reduce((s, l) => s + (costLines[at(l)]?.cost ?? 0), 0);

  return (
    <HelpZone id={section.help} className="block">
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">{section.title} <HelpTip id={section.help} /></h2>
          <span className="num text-xs text-muted">
            {section.id === "grain" && stats.grainLb > 0 && `${qty(scale ? scale(stats.grainLb) : stats.grainLb, 1)} lb · `}
            {section.id === "hop" && stats.ibu > 0 && `${Math.round(stats.ibu)} IBU · `}
            {lines.length ? money(scale ? scale(sectionTotal) : sectionTotal) : "Nothing yet"}
          </span>
        </div>
        {lines.length > 0 && (
          <div className="hidden gap-2 px-4 pt-2.5 text-[0.75rem] font-medium text-muted sm:grid sm:[grid-template-columns:var(--cols)]" style={style}>
            <span>Name</span>
            {cols.map((c) => <span key={c.label} className={c.label === "Unit" || c.label === "Use" || c.label === "Kind" ? "" : "text-right"}>{c.label}</span>)}
          </div>
        )}
        <div className="divide-y divide-border">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-3 gap-2 px-4 py-2.5 sm:[grid-template-columns:var(--cols)]" style={style}>
              <div className="col-span-3 flex min-w-0 items-center gap-1 sm:col-span-1">
                <Input aria-label={`${section.title} name`} value={l.name} onChange={(e) => onChange(l.key, { name: e.target.value })} placeholder={section.id === "grain" ? "e.g. Pilsner malt" : section.id === "hop" ? "e.g. Citra" : section.id === "yeast" ? "e.g. London ale" : "e.g. Gypsum"} />
                <button type="button" onClick={() => onRemove(l.key)} className="relative shrink-0 rounded-md p-2 text-muted after:absolute after:-inset-1 after:content-[''] hover:bg-surface-2 hover:text-ink" aria-label={`Remove ${l.name || "line"}`}>
                  <X className="size-4" />
                </button>
              </div>
              {cols.map((c) => (
                <div key={c.label} className="min-w-0">
                  <span className="mb-1 block text-[0.7rem] text-muted sm:hidden">{c.label}</span>
                  {c.cell(l, at(l))}
                </div>
              ))}
              <MatchRow line={l} ingredients={ingredients} ing={l.ingredientId ? ingById.get(l.ingredientId) : undefined} cost={costLines[at(l)]} creating={creating === l.key} onMatch={(v) => onMatch(l, v)} />
            </div>
          ))}
        </div>
        <div className="border-t border-border px-4 py-2.5">
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={onAdd}><Plus className="size-4" />{section.addLabel}</Button>
        </div>
      </Card>
    </HelpZone>
  );
}

/** Which Ingredient a line is priced from: pick one, add it as a new one, and see where its price comes from. */
function MatchRow({ line, ingredients, ing, cost, creating, onMatch }: { line: Line; ingredients: BrewCatalogIngredient[]; ing?: BrewCatalogIngredient; cost: ReturnType<typeof costBrewRecipe>["lines"][number] | undefined; creating: boolean; onMatch: (v: string) => void }) {
  const name = line.name.trim();
  const exact = name && ingredients.some((i) => i.name.toLowerCase() === name.toLowerCase());
  const options: SelectOption[] = [
    { value: "", label: "Not matched to an ingredient" },
    ...(name && !exact ? [{ value: "__new__", label: `Add “${name}” as a new ingredient`, hint: categoryForKind(line.kind), badge: "New" }] : []),
    ...ingredients.map((i) => ({ value: i.id, label: i.name, group: i.category, hint: perUnitText(i) })),
  ];
  let status: ReactNode;
  if (creating) status = <span>Adding…</span>;
  else if (!line.ingredientId || !ing) status = <span className="text-warn">Not matched, so it has no cost yet.</span>;
  else if (cost && cost.cost == null && cost.reason === "unit") status = <span className="text-warn">{ing.name} is {ing.baseUnit === "g" ? "weighed" : ing.baseUnit === "ml" ? "measured by volume" : "counted"}: change this line&apos;s unit{ing.baseUnit === "g" ? " to a weight" : ing.baseUnit === "ml" ? " to a volume" : " to pkg"}.</span>;
  else if (ing.source) status = <span>{ing.source.supplier} · {money(ing.source.price)} a {ing.source.purchaseUnit} · {shortDate(ing.source.date)}</span>;
  else status = <span className="text-warn">No price yet. <Link href="/brewery/recipes#prices" className="underline underline-offset-2">Add one</Link></span>;
  return (
    <div className="col-span-full flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <Select variant="cell" searchable aria-label={`${name || "Line"} ingredient`} value={line.ingredientId ?? ""} onChange={(e) => onMatch(e.target.value)} options={options} placeholder="Match to an ingredient" className="w-auto max-w-full min-w-0 text-xs" />
      {line.ingredientId && <Badge tone={cost?.cost != null ? "good" : "warn"} className="hidden sm:inline-flex">{cost?.cost != null ? "Priced" : "No price"}</Badge>}
      <span className="min-w-0">{status}</span>
    </div>
  );
}
