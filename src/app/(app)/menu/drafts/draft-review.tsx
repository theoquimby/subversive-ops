"use client";

import { useConfirm } from "@/components/dialog";
import { useUnsavedGuard } from "@/components/form-hooks";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { everydayUnit, parseQuickLine, typedMeasure, type ParsedLine, type QuickItem } from "@/domain/quickAdd";
import { draftCost, type DraftItem, type DraftLine } from "@/domain/recipeDraft";
import { leftOutText, linesLeftOut } from "@/domain/recipeEntry";
import { STANDARD_UNITS_BY_BASE, standardUnit, type BaseUnit, type CustomConversion } from "@/domain/units";
import { money, pct, qty as fmtQty } from "@/lib/format";
import type { StoredDraft } from "@/server/services/recipe-drafts";
import { Camera, Check, ClipboardPaste, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { NewItemChoices } from "../new-item-choices";
import { acceptRecipeDraft, acceptRecipeDrafts, discardRecipeDrafts, draftEmptyRecipes, readRecipePhotos, readRecipeText, type DraftEdit } from "./actions";

export interface ReviewCatalog {
  items: { key: string; name: string; kind: "ingredient" | "recipe"; baseUnit: BaseUnit; units: string[]; conversions: CustomConversion[]; costPerBase: number | null }[];
  defaultTarget: number;
}

type Msg = { error?: string; message?: string } | null;

const YIELD_UNITS = [...STANDARD_UNITS_BY_BASE.ml, ...STANDARD_UNITS_BY_BASE.g, ...STANDARD_UNITS_BY_BASE.each];
const KIND_LABEL = { MENU: "Menu item", MODIFIER: "Add-on", PREP: "Prep recipe" } as const;
const KIND_OPTIONS = (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const MEASURE_OPTIONS: { value: BaseUnit; label: string }[] = [{ value: "g", label: "By weight" }, { value: "ml", label: "By volume" }, { value: "each", label: "By count" }];
const METHOD_LABEL = { similar: "Copied from a similar recipe", keywords: "From the name", ai: "Drafted by Claude", photo: "Read from a photo", text: "Read from your text" } as const;

// ---- A draft as edited on its card ---------------------------------------------------------

type EditLine = DraftLine & { k: string };
type CardState = Omit<StoredDraft, "lines"> & { lines: EditLine[] };
const newK = () => Math.random().toString(36).slice(2);
/** The card as stored; line keys come from the draft so it can be rebuilt the same way on every render. */
const initCard = (d: StoredDraft): CardState => ({ ...d, lines: d.lines.map((l, i) => ({ ...l, k: `${d.id}:${i}` })) });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const newBase = (l: DraftLine): BaseUnit => l.newBaseUnit ?? standardUnit(l.unit)?.base ?? "each";

/** What Accept sends: the card exactly as edited. */
function toInput(d: CardState): DraftEdit {
  const isPrep = d.kind === "PREP";
  return {
    name: d.name, kind: d.kind, category: d.category, menuPrice: isPrep ? null : d.menuPrice, yieldQty: d.yieldQty, yieldUnit: d.yieldUnit, notes: d.notes,
    lines: d.lines.map((l) => ({ itemKey: l.itemKey, newName: l.itemKey ? null : l.newName?.trim() || null, newBaseUnit: l.itemKey ? null : newBase(l), qty: Number.isFinite(l.qty) ? l.qty : 0, unit: l.unit })),
  };
}

/** Lines Accept leaves out (no item or name, or no amount), said on the card instead of dropped quietly. */
function cardLeftOut(d: CardState, index: { byKey: Map<string, DraftItem> }): string | null {
  const out = linesLeftOut(d.lines.map((l) => ({ ...l, ingredientId: l.itemKey ?? (l.newName?.trim() ? "new" : null), subRecipeId: null })));
  return leftOutText(out, out.noAmount.map((l) => (l.itemKey ? index.byKey.get(l.itemKey)?.name : l.newName) ?? "a line"));
}

export function DraftReview({ drafts, catalog, ai, aiNote, emptyRecipes, forRecipe, targets }: {
  drafts: StoredDraft[];
  catalog: ReviewCatalog;
  ai: boolean;
  aiNote: string | null;
  emptyRecipes: number;
  forRecipe: { id: string; name: string } | null;
  targets: Record<string, number | null>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  // Saved drafts leave the list on refresh; keep a line for each with a link to the recipe.
  const [saved, setSaved] = useState<{ id: string; recipeId: string; message: string }[]>([]);
  // Cards someone has edited, by draft id. Untouched cards are rebuilt from the stored draft.
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const run = (fn: () => Promise<Msg>) => start(async () => { setMsg(null); const r = await fn(); setMsg(r); router.refresh(); });
  const forget = (ids: string[]) => setCards((cur) => { const next = { ...cur }; for (const id of ids) delete next[id]; return next; });

  const index = useMemo(() => ({ byKey: new Map(catalog.items.map((i) => [i.key, { ...i, category: "", kind: i.kind } as DraftItem])) }), [catalog]);
  const live = drafts.filter((d) => !saved.some((x) => x.id === d.id));
  const cardOf = (d: StoredDraft) => cards[d.id] ?? initCard(d);
  const edited = live.filter((d) => cards[d.id]).length;
  useUnsavedGuard(edited > 0, { title: "Leave without accepting?", body: `Your edits to ${edited === 1 ? "a draft" : `${edited} drafts`} aren't saved. The drafts stay, but the edits will be lost.` });

  return (
    <div className="space-y-8">
      <Intake ai={ai} aiNote={aiNote} emptyRecipes={emptyRecipes} forRecipe={forRecipe} startOpen={!drafts.length || !!forRecipe} onDone={(m) => { setMsg(m); router.refresh(); }} />

      {msg && <p role="status" className={cx("text-sm", msg.error ? "text-bad" : "text-ink-2")}>{msg.error ?? msg.message}</p>}

      {saved.length > 0 && (
        <div className="space-y-2">
          {saved.map((x) => (
            <Card key={x.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
              <span className="text-ink-2"><Check className="mr-1.5 inline size-4 text-good" />{x.message}</span>
              <Link href={`/menu/${x.recipeId}`} className="font-medium underline underline-offset-2">Open recipe →</Link>
            </Card>
          ))}
        </div>
      )}

      {live.length === 0 ? (
        saved.length ? null : (
          <EmptyState title="No drafts waiting">
            Draft recipes from <Link href="/sales/square-menu" className="underline underline-offset-2">Menu from Square</Link> (tick items → Draft recipes), from empty recipes, or from a photo or pasted recipe above.
          </EmptyState>
        )
      ) : (
        <HelpZone id="menu.drafts.review">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">{live.length} draft{live.length === 1 ? "" : "s"} to review <HelpTip id="menu.drafts.review" /></h2>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={pending} onClick={async () => {
                if (await confirm({ title: `Discard ${live.length} draft${live.length === 1 ? "" : "s"}?`, body: `Your recipes stay as they are.${edited ? " Your edits to the drafts go too." : ""}`, confirmLabel: "Discard", danger: true })) {
                  const ids = live.map((d) => d.id);
                  run(async () => { const r = await discardRecipeDrafts(ids); if (!r.error) forget(ids); return r; });
                }
              }}>Discard all</Button>
              <Button size="sm" variant="primary" pending={pending} onClick={async () => {
                const body = `Each becomes a recipe with the lines on its card${edited ? ", including your edits" : ""}. Lines marked new add an ingredient with no price yet. You can change any recipe later.`;
                if (!(await confirm({ title: `Accept ${live.length} draft${live.length === 1 ? "" : "s"}?`, body, confirmLabel: "Accept all" }))) return;
                const list = live.map((d) => ({ id: d.id, input: toInput(cardOf(d)) }));
                run(async () => { const r = await acceptRecipeDrafts(list); if (r.ids) forget(r.ids); return r; });
              }}>{!pending && <Check className="size-3.5" />}Accept all</Button>
            </div>
          </div>
          <div className="space-y-4">
            {live.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                d={cardOf(d)}
                edited={!!cards[d.id]}
                update={(fn) => setCards((cur) => ({ ...cur, [d.id]: fn(cur[d.id] ?? initCard(d)) }))}
                catalog={catalog}
                index={index}
                target={(d.target.recipeId ? targets[d.target.recipeId] : null) ?? catalog.defaultTarget}
                onSaved={(recipeId, message) => { setSaved((cur) => [...cur, { id: d.id, recipeId, message }]); forget([d.id]); }}
                onDiscarded={() => forget([d.id])}
              />
            ))}
          </div>
        </HelpZone>
      )}
    </div>
  );
}

// ---- Getting drafts in: photos, pasted text, empty recipes ---------------------------------

/** Shrink a phone photo before upload (server actions take ~12 MB in total). */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 900_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

function Intake({ ai, aiNote, emptyRecipes, forRecipe, startOpen, onDone }: { ai: boolean; aiNote: string | null; emptyRecipes: number; forRecipe: { id: string; name: string } | null; startOpen: boolean; onDone: (m: Msg) => void }) {
  const [open, setOpen] = useState(startOpen);
  const [mode, setMode] = useState<"photo" | "text">(ai ? "photo" : "text");
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const readPhotos = () => start(async () => {
    const fd = new FormData();
    for (const f of await Promise.all(files.map(shrink))) fd.append("photos", f);
    if (forRecipe) fd.set("recipeId", forRecipe.id);
    const r = await readRecipePhotos(fd);
    if (!r.error) setFiles([]);
    onDone(r);
  });
  const readText = () => start(async () => {
    const r = await readRecipeText(text, forRecipe?.id ?? null);
    if (!r.error) setText("");
    onDone(r);
  });

  const tab = (m: "photo" | "text", label: string, Icon: typeof Camera) => (
    <button type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={cx("inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium sm:h-8", mode === m ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>
      <Icon className="size-4" />{label}
    </button>
  );

  if (!open) {
    return (
      <HelpZone id="menu.drafts.intake" className="flex flex-wrap items-center gap-2">
        <Button onClick={() => { setMode(ai ? "photo" : "text"); setOpen(true); }}><Camera className="size-4" />Read a recipe card</Button>
        <Button onClick={() => { setMode("text"); setOpen(true); }}><ClipboardPaste className="size-4" />Paste a recipe</Button>
        {emptyRecipes > 0 && <Button disabled={pending} onClick={() => start(async () => onDone(await draftEmptyRecipes()))}>{pending ? "Drafting…" : `Draft ${emptyRecipes} empty recipe${emptyRecipes === 1 ? "" : "s"}`}</Button>}
        <HelpTip id="menu.drafts.intake" />
        {aiNote && <p className="w-full text-xs text-muted">{aiNote}</p>}
      </HelpZone>
    );
  }

  return (
    <HelpZone id="menu.drafts.intake">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">{forRecipe ? `Read the recipe for ${forRecipe.name}` : "Add a recipe from a card or your notes"} <HelpTip id="menu.drafts.intake" /></h2>
          <div className="flex gap-1">{tab("photo", "Photo", Camera)}{tab("text", "Paste text", ClipboardPaste)}</div>
        </div>

        {mode === "photo" ? (
          ai ? (
            <div className="space-y-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => input.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); setFiles((cur) => [...cur, ...Array.from(e.dataTransfer.files)].slice(0, 8)); }}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border-strong px-4 py-4 hover:border-ink-2/50 hover:bg-surface-2/50"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><Camera className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} ready` : "Snap or choose photos"}</div>
                  <div className="text-xs text-muted">Recipe cards, binder pages or a brewing sheet. Several pages are fine.</div>
                </div>
                <input ref={input} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} onChange={(e) => { setFiles((cur) => [...cur, ...Array.from(e.target.files ?? [])].slice(0, 8)); e.target.value = ""; }} />
              </div>
              {files.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-lg bg-surface-2 py-1 pr-1 pl-2.5 text-xs">
                      <span className="max-w-40 truncate">{f.name}</span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} className="relative rounded p-1 text-muted after:absolute after:-inset-2 hover:text-ink"><X className="size-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="primary" disabled={pending || !files.length} onClick={readPhotos}><Sparkles className="size-4" />{pending ? "Reading…" : "Read recipe"}</Button>
            </div>
          ) : (
            <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-ink-2">
              Reading photos needs AI features. Turn them on in <Link href="/settings/connections" className="underline underline-offset-2">Settings → Connections</Link>. Until then, <button type="button" className="underline underline-offset-2" onClick={() => setMode("text")}>paste the recipe as text</button>.
            </div>
          )
        ) : (
          <div className="space-y-3">
            <Textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Recipe text"
              placeholder={"Chipotle aioli\nYield: 2 qt\n4 cups mayo\n3 tbsp chipotle powder\n2 tbsp lemon juice\n\nor a brew sheet: Batch 7 bbl · 420 lb pale malt · 6 lb Cascade @ 60 min · 2 packs US-05"}
              className="font-mono text-[0.9rem]"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={pending || text.trim().length < 3} onClick={readText}>{pending ? "Reading…" : "Read recipe"}</Button>
              <span className="text-xs text-muted">One line per ingredient. &quot;Yield&quot;, &quot;Serves&quot; or &quot;Batch size&quot; lines are understood.</span>
            </div>
          </div>
        )}

        {(aiNote || (!forRecipe && emptyRecipes > 0)) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            {aiNote ? <p className="text-xs text-muted">{aiNote}</p> : <span />}
            {!forRecipe && emptyRecipes > 0 && (
              <Button size="sm" disabled={pending} onClick={() => start(async () => onDone(await draftEmptyRecipes()))}>
                {pending ? "Drafting…" : `Draft ${emptyRecipes} empty recipe${emptyRecipes === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        )}
      </Card>
    </HelpZone>
  );
}

// ---- One draft ----------------------------------------------------------------------------

function DraftCard({ draft, d, edited, update, catalog, index, target, onSaved, onDiscarded }: {
  draft: StoredDraft;
  d: CardState;
  edited: boolean;
  update: (fn: (cur: CardState) => CardState) => void;
  catalog: ReviewCatalog;
  index: { byKey: Map<string, DraftItem> };
  target: number;
  onSaved: (recipeId: string, message: string) => void;
  onDiscarded: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [quick, setQuick] = useState("");
  const [quickMsg, setQuickMsg] = useState<string | null>(null);

  const isPrep = d.kind === "PREP";
  const cost = draftCost(d, index);
  const over = cost.foodCostPct != null && cost.foodCostPct > target;
  const newLines = new Set(d.lines.filter((l) => !l.itemKey && l.newName?.trim()).map((l) => (l.newName ?? "").trim().toLowerCase())).size;
  const priced = cost.lines.some((c) => c != null);
  const leftOut = cardLeftOut(d, index);

  const options = useMemo(() => [
    ...catalog.items.filter((i) => i.kind === "ingredient").map((i) => ({ value: i.key, label: i.name, group: "Ingredients" })),
    ...catalog.items.filter((i) => i.kind === "recipe" && i.key !== `r:${draft.target.recipeId}`).map((i) => ({ value: i.key, label: i.name, group: "Prep recipes" })),
  ], [catalog, draft.target.recipeId]);
  const quickItems = useMemo<QuickItem[]>(() => catalog.items.map((i) => ({ id: i.key, name: i.name, units: i.units })), [catalog]);

  const set = (patch: Partial<CardState>) => update((cur) => ({ ...cur, ...patch }));
  const setLine = (k: string, patch: Partial<EditLine>) => update((cur) => ({ ...cur, lines: cur.lines.map((l) => (l.k === k ? { ...l, ...patch } : l)) }));
  const pick = (l: EditLine, key: string) => {
    if (key.startsWith("new:")) return setLine(l.k, { itemKey: null });
    const it = index.byKey.get(key)!;
    setLine(l.k, { itemKey: key, unit: it.units.includes(l.unit) ? l.unit : it.units[0] });
  };
  /** A new ingredient line is measured by weight, volume or count; the unit follows when it no longer fits. */
  const setMeasure = (l: EditLine, base: BaseUnit) => setLine(l.k, { newBaseUnit: base, unit: standardUnit(l.unit)?.base === base ? l.unit : everydayUnit(STANDARD_UNITS_BY_BASE[base]) });

  // Quick add: only sure matches go in by themselves; a guess or a miss asks first, like the recipe editor.
  const preview = quick.trim() && !quick.includes("\n") ? parseQuickLine(quick, quickItems) : null;
  const lineFrom = (p: ParsedLine): EditLine => ({ k: newK(), itemKey: p.item!.id, qty: p.qty, unit: p.unit, note: null });
  const addLines = (lines: EditLine[]) => update((cur) => ({ ...cur, lines: [...cur.lines, ...lines] }));
  const addQuick = (t: string) => {
    const parsed = t.split(/\r?\n/).map((x) => parseQuickLine(x, quickItems)).filter((p): p is ParsedLine => p != null);
    const ok = parsed.filter((p) => p.item && p.sure);
    const left = parsed.filter((p) => !(p.item && p.sure)).map((p) => p.raw.trim());
    if (!ok.length && parsed.length === 1) return; // the choice is on screen under the box
    addLines(ok.map(lineFrom));
    setQuick(left.length && parsed.length > 1 ? left.join("\n") : "");
    setQuickMsg(left.length ? `Added ${ok.length}. Not sure about ${left.length === 1 ? "this one" : `these ${left.length}`}, so ${left.length === 1 ? "it's" : "they're"} left in the box: add ${left.length === 1 ? "it" : "them"} one at a time.` : ok.length > 1 ? `Added ${ok.length} lines` : null);
  };
  const takeGuess = (p: ParsedLine) => { addLines([lineFrom(p)]); setQuick(""); setQuickMsg(null); };
  /** A line for a new ingredient, made when the draft is accepted. */
  const addNew = (p: ParsedLine, base?: BaseUnit) => {
    const measured = typedMeasure(p.raw);
    const b = base ?? measured ?? "each";
    addLines([{ k: newK(), itemKey: null, newName: cap(p.name), newBaseUnit: b, qty: p.qty, unit: measured ? p.unit : everydayUnit(STANDARD_UNITS_BY_BASE[b]), note: null }]);
    setQuick("");
    setQuickMsg(`${cap(p.name)} will be a new ingredient when you accept, with no price yet.`);
  };

  const accept = () => start(async () => {
    setMsg(null);
    const r = await acceptRecipeDraft(draft.id, toInput(d));
    if (r.error) return setMsg(r);
    onSaved(r.recipeId!, r.message ?? "Saved.");
    router.refresh();
  });
  const discard = async () => {
    if (edited && !(await confirm({ title: `Discard ${d.name || "this draft"}?`, body: "Your edits to it go too. Your recipes stay as they are.", confirmLabel: "Discard", danger: true }))) return;
    start(async () => { const r = await discardRecipeDrafts([draft.id]); setMsg(r); if (!r.error) onDiscarded(); router.refresh(); });
  };

  return (
    <Card className={cx("overflow-hidden", pending && "opacity-60")} data-draft={draft.id}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <Input aria-label="Recipe name" value={d.name} onChange={(e) => set({ name: e.target.value })} className="h-9 max-w-md border-transparent px-1.5 text-base font-semibold hover:border-border focus:border-border-strong" />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1.5 text-xs text-muted">
            <Select aria-label="Type" value={d.kind} onChange={(e) => set({ kind: e.target.value as CardState["kind"] })} options={KIND_OPTIONS} className="w-36" />
            <Input aria-label="Category" value={d.category} onChange={(e) => set({ category: e.target.value })} placeholder={isPrep ? "Prep" : "Food"} className="w-32" />
            <span>{draft.source}</span>
            <Badge tone={d.method === "ai" || d.method === "photo" ? "good" : "neutral"}>{METHOD_LABEL[d.method]}</Badge>
            {draft.basis.length > 0 && <span className="min-w-0 truncate">from {draft.basis.slice(0, 2).join(", ")}</span>}
          </div>
        </div>
        <div className={cx("grid gap-4 text-right", isPrep && !/^(bbl|hl)$/.test(d.yieldUnit) ? "grid-cols-2" : "grid-cols-3")}>
          <div>
            <div className="text-[0.75rem] text-muted">{isPrep ? "Batch cost" : "Plate cost"}</div>
            <div className="num text-lg font-semibold">{priced ? money(cost.total) : "—"}</div>
            {cost.missing > 0 && <div className="text-[0.7rem] text-warn">{cost.missing} line{cost.missing === 1 ? "" : "s"} unpriced</div>}
          </div>
          {isPrep && /^(bbl|hl)$/.test(d.yieldUnit) && (
            <div>
              <div className="text-[0.75rem] text-muted">Per pint</div>
              <div className="num text-lg font-semibold">{priced && d.yieldQty > 0 ? money((cost.total / (d.yieldQty * (standardUnit(d.yieldUnit)?.factor ?? 1))) * 473.176) : "—"}</div>
            </div>
          )}
          {isPrep ? (
            <div>
              <div className="text-[0.75rem] text-muted">Per {d.yieldUnit}</div>
              <div className="num text-lg font-semibold">{priced && d.yieldQty > 0 ? money(cost.total / d.yieldQty) : "—"}</div>
            </div>
          ) : (
            <div>
              <div className="text-[0.75rem] text-muted">Food cost</div>
              <div className={cx("num text-lg font-semibold", cost.foodCostPct != null && (over ? "text-bad" : "text-good"))}>{pct(cost.foodCostPct)}</div>
              <div className="text-[0.7rem] text-muted">target {pct(target, 0)}</div>
            </div>
          )}
          {!isPrep && (
            <div>
              <div className="text-[0.75rem] text-muted">Price</div>
              <Input aria-label="Menu price" type="number" inputMode="decimal" step="0.01" min={0} value={d.menuPrice ?? ""} placeholder="0.00" onChange={(e) => set({ menuPrice: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null })} className="num mt-0.5 h-8 w-24 text-right" />
            </div>
          )}
        </div>
      </div>

      {draft.warnings.length > 0 && (
        <div className="space-y-1 border-b border-border bg-surface-2/60 px-4 py-2 text-xs text-ink-2">
          {draft.warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      {isPrep && (
        <div className="grid grid-cols-2 gap-3 border-b border-border px-4 py-3 sm:max-w-sm">
          <Field label="Batch yield"><Input type="number" inputMode="decimal" step="any" min={0} value={Number.isFinite(d.yieldQty) ? d.yieldQty : ""} onChange={(e) => set({ yieldQty: e.target.valueAsNumber })} className="num" /></Field>
          <Field label="Unit"><Select value={d.yieldUnit} onChange={(e) => set({ yieldUnit: e.target.value })} options={YIELD_UNITS.map((u) => ({ value: u, label: u }))} aria-label="Yield unit" /></Field>
        </div>
      )}

      <div className="divide-y divide-border">
        {d.lines.map((l, i) => {
          const it = l.itemKey ? index.byKey.get(l.itemKey) : null;
          const units = it ? it.units : [...new Set([l.unit, ...STANDARD_UNITS_BY_BASE[newBase(l)]])];
          const c = cost.lines[i];
          const noAmount = !(l.qty > 0);
          return (
            <div key={l.k} className="grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_6rem_7rem_5.5rem_auto]">
              <div className="col-span-4 sm:col-span-1">
                <Select
                  aria-label="Item"
                  value={l.itemKey ?? `new:${l.newName}`}
                  onChange={(e) => pick(l, e.target.value)}
                  options={l.itemKey ? options : [{ value: `new:${l.newName}`, label: `New: ${l.newName || "(no name yet)"}`, group: "New ingredient" }, ...options]}
                  searchable
                />
              </div>
              <Input aria-label="Quantity" aria-invalid={noAmount || undefined} type="number" inputMode="decimal" step="any" min={0} value={Number.isFinite(l.qty) ? l.qty : ""} onChange={(e) => setLine(l.k, { qty: e.target.valueAsNumber })} className={cx("num text-right", noAmount && "border-warn")} />
              <Select aria-label="Unit" value={l.unit} onChange={(e) => setLine(l.k, { unit: e.target.value })} options={[...new Set([...units, l.unit])].map((u) => ({ value: u, label: u }))} />
              <div className={cx("num text-right text-sm", c == null && "text-warn")}>{c != null ? money(c) : !l.itemKey ? "new" : it?.costPerBase == null ? "No price" : "Unit"}</div>
              <button type="button" onClick={() => update((cur) => ({ ...cur, lines: cur.lines.filter((x) => x.k !== l.k) }))} className="relative rounded-md p-1.5 text-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface-2 hover:text-ink" aria-label="Remove line">
                <X className="size-4" />
              </button>
              {!l.itemKey && (
                <div className="col-span-full -mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="warn">New ingredient · no price yet</Badge>
                  <Input aria-label="New ingredient name" value={l.newName ?? ""} onChange={(e) => setLine(l.k, { newName: e.target.value })} placeholder="Name it" className="min-w-0 flex-1 sm:max-w-64" />
                  <Select aria-label="Measured by" value={newBase(l)} onChange={(e) => setMeasure(l, e.target.value as BaseUnit)} options={MEASURE_OPTIONS} className="w-32" />
                </div>
              )}
              {l.note && <div className="col-span-full -mt-1 text-xs text-muted">{l.note}</div>}
            </div>
          );
        })}
        {d.lines.length === 0 && <p className="px-4 py-3 text-sm text-muted">No lines yet. Add them below.</p>}
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="relative">
          <Plus className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <textarea
            rows={1}
            value={quick}
            onChange={(e) => { setQuick(e.target.value); setQuickMsg(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (quick.trim()) addQuick(quick); } }}
            onPaste={(e) => { const t = e.clipboardData.getData("text/plain"); if (t.includes("\n")) { e.preventDefault(); addQuick(t); } }}
            placeholder='Add a line: "2 slices bacon"'
            aria-label="Add a line"
            className="block h-10 w-full resize-none rounded-lg border border-dashed border-border-strong bg-transparent py-2.5 pr-3 pl-9 text-sm placeholder:text-muted focus:border-ink-2 focus:border-solid focus:outline-none"
          />
        </div>
        {preview?.item && preview.sure ? (
          <div className="mt-1.5 pl-1 text-xs text-muted">↵ adds <span className="num text-ink">{fmtQty(preview.qty)} {preview.unit}</span> {preview.item.name}</div>
        ) : preview ? (
          <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
            <p className="text-ink-2">
              {preview.item ? <>Not sure that&apos;s on the list. The closest is <b className="text-ink">{preview.item.name}</b>.</> : <>No ingredient called <b className="text-ink">{preview.name}</b> yet.</>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {preview.item && <Button size="sm" onClick={() => takeGuess(preview)}>Use {preview.item.name}</Button>}
              <NewItemChoices name={preview.name} measure={typedMeasure(quick)} primary={!preview.item} onIngredient={(base) => addNew(preview, base)} />
            </div>
          </div>
        ) : quickMsg ? (
          <div className="mt-1.5 pl-1 text-xs text-muted">{quickMsg}</div>
        ) : null}
      </div>

      {d.notes && <details className="border-t border-border px-4 py-2 text-xs text-muted"><summary className="cursor-pointer py-1">Notes kept with the recipe</summary><p className="whitespace-pre-wrap pb-1">{d.notes}</p></details>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2/40 px-4 py-3">
        <span role={msg?.error ? "alert" : undefined} className={cx("min-w-0 text-sm", msg?.error ? "text-bad" : leftOut ? "text-warn" : "text-muted")}>
          {msg?.error ?? leftOut ?? (draft.target.recipeId ? "Fills the empty recipe" : draft.target.squareIds.length ? `Creates the recipe and links ${draft.target.squareIds.length} Square item${draft.target.squareIds.length === 1 ? "" : "s"}` : "Creates a new recipe")}
          {newLines > 0 && !msg?.error && !leftOut ? ` · adds ${newLines} new ingredient${newLines === 1 ? "" : "s"}` : ""}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={pending} onClick={discard}>Discard</Button>
          <Button variant="primary" pending={pending} disabled={!d.name.trim() || d.lines.length === 0} onClick={accept}>{!pending && <Check className="size-4" />}Accept</Button>
        </div>
      </div>
    </Card>
  );
}
