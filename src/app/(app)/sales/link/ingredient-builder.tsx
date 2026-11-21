"use client";

import { Button, Input, Select } from "@/components/ui";
import { everydayUnit, parseQuickLine, type ParsedLine, type QuickItem } from "@/domain/quickAdd";
import { Plus, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { createIngredientForRecipe } from "../../menu/actions";

/**
 * Ingredient lines for a recipe being created, without leaving the page: type
 * "6 oz ground beef" and press Enter, or pick from the list. It never adds a
 * guess on its own; anything not on the list can be added as a new ingredient.
 */

export interface Part {
  id: string;
  kind: "i" | "r";
  name: string;
  units: string[];
}

export interface BuiltLine {
  key: string;
  part: Part;
  qty: number;
  unit: string;
}

const newKey = () => Math.random().toString(36).slice(2);

export function IngredientBuilder({ parts, lines, onChange }: { parts: Part[]; lines: BuiltLine[]; onChange: (lines: BuiltLine[]) => void }) {
  const [extra, setExtra] = useState<Part[]>([]);
  const all = useMemo(() => [...parts, ...extra.filter((e) => !parts.some((p) => p.id === e.id))], [parts, extra]);
  const quickItems = useMemo<(QuickItem & { part: Part })[]>(() => all.map((p) => ({ id: `${p.kind}:${p.id}`, name: p.name, units: p.units, part: p })), [all]);
  const options = useMemo(() => all.map((p) => ({ value: `${p.kind}:${p.id}`, label: p.name, badge: p.kind === "r" ? "Prep recipe" : "Ingredient", group: p.kind === "r" ? "Prep recipes (made here)" : "Ingredients" })), [all]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, start] = useTransition();
  const [pick, setPick] = useState("");
  const preview = text.trim() ? parseQuickLine(text, quickItems) : null;
  const partOf = (p: ParsedLine) => (p.item as (QuickItem & { part: Part }) | null)?.part ?? null;

  const add = (part: Part, qty: number, unit: string) => {
    onChange([...lines, { key: newKey(), part, qty, unit }]);
    setText("");
    setMsg(null);
  };
  const enter = () => {
    if (!preview) return;
    const part = partOf(preview);
    if (part && preview.sure) add(part, preview.qty, preview.unit);
  };
  const addNew = (p: ParsedLine) =>
    start(async () => {
      const typedUnit = /\d\s*[a-z]/i.test(text);
      const res = await createIngredientForRecipe({ name: p.name, unit: typedUnit ? p.unit : "" });
      if (res.error || !res.ingredient) return setMsg(res.error ?? "Couldn't add it.");
      const part: Part = { id: res.ingredient.id, kind: "i", name: res.ingredient.name, units: res.ingredient.units };
      setExtra((x) => [...x, part]);
      add(part, p.qty, res.unit ?? everydayUnit(part.units));
      setMsg(`${part.name} is on the ingredient list now, with no price yet.`);
    });

  return (
    <div className="space-y-2">
      {lines.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lines.map((l) => (
            <li key={l.key} className="grid grid-cols-[1fr_4.5rem_5.5rem_auto] items-center gap-2 px-3 py-2">
              <span className="min-w-0 truncate text-sm">{l.part.name}{l.part.kind === "r" && <span className="ml-1.5 text-xs text-muted">prep</span>}</span>
              <Input aria-label={`Amount of ${l.part.name}`} type="number" inputMode="decimal" step="any" min={0} value={Number.isFinite(l.qty) ? l.qty : ""} onChange={(e) => onChange(lines.map((x) => (x.key === l.key ? { ...x, qty: e.target.valueAsNumber } : x)))} className="num h-9 text-right" />
              <Select aria-label={`Unit for ${l.part.name}`} value={l.unit} onChange={(e) => onChange(lines.map((x) => (x.key === l.key ? { ...x, unit: e.target.value } : x)))} options={[...new Set([...l.part.units, l.unit])].map((u) => ({ value: u, label: u }))} />
              <button type="button" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.part.name}`} className="relative rounded-md p-1.5 text-muted after:absolute after:-inset-1.5 hover:bg-surface-2 hover:text-ink">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <div className="relative">
          <Plus className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enter(); } }} placeholder='Type "6 oz ground beef", then Enter' aria-label="Add an ingredient" className="pl-9" />
        </div>
        <Select
          value={pick}
          onChange={(e) => {
            const v = e.target.value;
            const part = all.find((p) => `${p.kind}:${p.id}` === v);
            if (part) add(part, 1, everydayUnit(part.units));
            setPick("");
          }}
          options={options}
          searchable
          placeholder="Or pick from the list…"
          aria-label="Pick an ingredient or prep recipe"
        />
      </div>
      {preview && partOf(preview) && preview.sure ? (
        <p className="pl-1 text-xs text-muted">↵ adds <span className="num text-ink">{preview.qty} {preview.unit}</span> {preview.item!.name}</p>
      ) : preview ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <span className="text-ink-2">{preview.item ? <>Not sure. The closest is <b className="text-ink">{preview.item.name}</b>.</> : <>No ingredient called <b className="text-ink">{preview.name}</b> yet.</>}</span>
          {preview.item && <Button size="sm" onClick={() => add(partOf(preview)!, preview.qty, preview.unit)}>Use {preview.item.name}</Button>}
          <Button size="sm" variant="ghost" disabled={creating} onClick={() => addNew(preview)}><Plus className="size-3.5" />{creating ? "Adding…" : `New ingredient “${preview.name.charAt(0).toUpperCase() + preview.name.slice(1)}”`}</Button>
        </div>
      ) : msg ? (
        <p className="pl-1 text-xs text-muted">{msg}</p>
      ) : null}
    </div>
  );
}
