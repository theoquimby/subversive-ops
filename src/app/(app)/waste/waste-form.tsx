"use client";

import { Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { useEffect, useState, useTransition } from "react";
import { CloudOff, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { newClientId, useOffline } from "@/lib/offline-queue";
import { parseAmount } from "@/lib/amount";
import { pushRecent } from "@/domain/purchasing";
import { deleteWaste, undoWasteEntry } from "./actions";
import { wasteQueue } from "./queue";
import { HelpTip } from "@/components/help";

const REASONS = ["Spoiled", "Expired", "Dropped", "Overcooked", "Returned", "Other"];

type Errors = { item?: string; qty?: string };

export interface RecipeItem {
  id: string;
  name: string;
  /** PREP | MENU | MODIFIER */
  kind: string;
  units: string[];
}

type Mode = "ingredient" | "recipe";

/** This phone's memory: the last items wasted, and the unit last used for each. */
const RECENT_KEY = "waste.recent.v1";
const UNITS_KEY = "waste.units.v1";
const load = <T,>(key: string, fallback: T): T => { try { return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback; } catch { return fallback; } };
const keep = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* not kept */ } };
const itemKey = (m: Mode, id: string) => `${m}:${id}`;

export function WasteForm({ items, recipes = [] }: { items: { id: string; name: string; units: string[] }[]; recipes?: RecipeItem[] }) {
  const [mode, setMode] = useState<Mode>("ingredient");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  // Stays on Yesterday for the next entry too: last night's waste usually comes in a batch.
  const [when, setWhen] = useState<"today" | "yesterday">("today");
  const [errors, setErrors] = useState<Errors>({});
  const [recent, setRecent] = useState<string[]>([]);
  const [toast, show] = useToast();
  const offline = useOffline();
  const queue = wasteQueue.useQueue((failed) => show(failed[0], "bad"));
  useEffect(() => {
    const v = load<unknown>(RECENT_KEY, []);
    setRecent(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 6) : []);
  }, []);
  const list = mode === "ingredient" ? items : recipes;
  const item = list.find((i) => i.id === itemId);
  const units = item?.units ?? [];
  const switchMode = (m: Mode) => { setMode(m); setItemId(""); setUnit(""); setErrors({}); };
  const pick = (id: string, m: Mode = mode) => {
    const from = m === "ingredient" ? items : recipes;
    const its = from.find((i) => i.id === id)?.units ?? [];
    const last = load<Record<string, string>>(UNITS_KEY, {})[itemKey(m, id)];
    setItemId(id);
    setUnit(last && its.includes(last) ? last : its[0] ?? "");
    setErrors((x) => ({ ...x, item: undefined }));
    // Straight on to the amount, keyboard up.
    requestAnimationFrame(() => document.getElementById("waste-qty")?.focus());
  };
  const pickRecent = (key: string) => {
    const [m, id] = [key.slice(0, key.indexOf(":")) as Mode, key.slice(key.indexOf(":") + 1)];
    if (m !== mode) { setMode(m); setErrors({}); }
    pick(id, m);
  };
  const recentChips = recent
    .map((k) => {
      const [m, id] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
      const found = (m === "recipe" ? recipes : m === "ingredient" ? items : []).find((i) => i.id === id);
      return found ? { key: k, name: found.name } : null;
    })
    .filter((x): x is { key: string; name: string } => x != null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // App-styled validation instead of the browser's "Please fill out this field" bubbles.
    const n = parseAmount(qty) ?? NaN;
    const next: Errors = {};
    if (!itemId) next.item = "Pick what was thrown out.";
    if (!(n > 0)) next.qty = "Enter how much.";
    setErrors(next);
    if (next.item || next.qty) {
      document.getElementById(next.item ? "waste-item" : "waste-qty")?.focus();
      return;
    }
    const label = `${Number(n.toFixed(3))} ${unit && unit !== "each" ? `${unit} ` : ""}${item!.name}`;
    const entry = { clientId: newClientId(), label, mode, itemId, qty: n, unit: unit || (mode === "recipe" ? "each" : ""), reason, when, at: Date.now() };
    // This phone remembers the item and its unit for next time.
    const k = itemKey(mode, itemId);
    if (entry.unit) keep(UNITS_KEY, { ...load<Record<string, string>>(UNITS_KEY, {}), [k]: entry.unit });
    const nextRecent = pushRecent(load<unknown>(RECENT_KEY, []), k);
    keep(RECENT_KEY, nextRecent);
    setRecent(nextRecent);
    // Optimistic: the form clears straight away for the next one; it comes back if the server says no.
    const before = { itemId, qty, unit };
    setItemId("");
    setQty("");
    // Ready for the next item.
    requestAnimationFrame(() => document.getElementById("waste-item")?.focus());
    const r = await wasteQueue.send(entry);
    const day = when === "yesterday" ? " for yesterday" : "";
    if ("error" in r) {
      setItemId(before.itemId);
      setQty(before.qty);
      setUnit(before.unit);
      show(r.error, "bad");
    } else if (r.queued) show(`${label}${day} saved on this phone. It sends when there's signal.`, "queued");
    else show(`Logged ${label}${day} · ${reason.toLowerCase()}`, "good", {
      label: "Undo",
      onClick: async () => {
        const u = await undoWasteEntry(entry.clientId).catch(() => ({ error: "No connection. Remove it from the list below once you have signal." }));
        if (u.error) show(u.error, "bad");
        else show(`Took back ${label}`, "good");
      },
    });
  };

  return (
    <Card className="p-5" data-tour="waste.form">
      {toast}
      {(offline || queue.length > 0) && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-warn-bg px-3 py-2.5 text-sm font-medium text-warn" role="status">
          <CloudOff className="size-4 shrink-0" aria-hidden />
          {queue.length > 0 ? `${queue.length} waiting to send: ${queue.map((q) => q.label).join(", ")}` : "No signal. Keep logging — it's saved on this phone."}
        </p>
      )}
      {recipes.length > 0 && (
        <div role="tablist" aria-label="What was thrown out" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" data-tour="waste.mode">
          {([["ingredient", "Ingredient"], ["recipe", "Prep or menu item"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={cx("h-11 rounded-lg text-sm transition-[background-color,color,box-shadow] duration-120", mode === m ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 active:bg-surface/60")}>{label}</button>
          ))}
        </div>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        {recentChips.length > 0 && (
          <div>
            <span id="waste-recent" className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Recent</span>
            <div aria-labelledby="waste-recent" className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none]">
              {recentChips.map((c) => (
                <button key={c.key} type="button" onClick={() => pickRecent(c.key)} aria-pressed={itemKey(mode, itemId) === c.key}
                  className={cx("h-10 max-w-48 shrink-0 truncate rounded-full border px-3.5 text-sm transition-colors duration-120", itemKey(mode, itemId) === c.key ? "border-ink bg-primary font-medium text-primary-ink" : "border-border-strong text-ink-2 active:bg-surface-2")}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field
          label={mode === "ingredient" ? "Item" : <span className="inline-flex items-center gap-1.5">Prep or menu item <HelpTip id="waste.prepItems" /></span>}
          hint={errors.item ? <span className="text-bad" role="alert">{errors.item}</span> : mode === "recipe" ? "Logged as the ingredients it's made from, so food cost counts it." : undefined}
        >
          <Select
            id="waste-item"
            aria-label={mode === "ingredient" ? "Item" : "Prep or menu item"}
            value={itemId}
            onChange={(e) => pick(e.target.value)}
            placeholder={mode === "ingredient" ? "Choose an item…" : "Choose a prep or menu item…"}
            searchable
            className={cx("h-12 text-base", errors.item && "border-bad")}
            options={mode === "ingredient" ? items.map((i) => ({ value: i.id, label: i.name })) : recipes.map((r) => ({ value: r.id, label: r.name, group: r.kind === "PREP" ? "Prep" : "Menu" }))}
          />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={mode === "recipe" && item && recipes.find((r) => r.id === itemId)?.kind !== "PREP" ? "How many" : "How much"} hint={errors.qty && <span className="text-bad" role="alert">{errors.qty}</span>}>
            <Input id="waste-qty" name="qty" inputMode="decimal" autoComplete="off" enterKeyHint="done" value={qty} aria-invalid={errors.qty ? true : undefined} onChange={(e) => { setQty(e.target.value); if (errors.qty) setErrors((x) => ({ ...x, qty: undefined })); }} placeholder="0" className={cx("num h-12 text-lg", errors.qty && "border-bad")} />
          </Field>
          <Field label="Unit" className="w-32">
            {/* Defaults to the item's count unit (or a prep's batch unit), so it's never blank. */}
            <Select aria-label="Unit" className="h-12 text-base" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!units.length} placeholder={itemId ? "Choose…" : "—"} options={units.map((u) => ({ value: u, label: u }))} />
          </Field>
        </div>
        <div data-tour="waste.reasons">
          <span id="waste-why" className="mb-1.5 flex items-center gap-1.5 text-[0.8rem] font-medium text-ink-2">Why <HelpTip id="waste.reasons" /></span>
          <div role="radiogroup" aria-labelledby="waste-why" className="grid grid-cols-3 gap-2">
            {REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={r === reason} onClick={() => setReason(r)} className={cx("h-11 rounded-xl border px-2 text-sm transition-[background-color,border-color,color,transform] duration-120 active:scale-[0.97] motion-reduce:active:scale-100", r === reason ? "border-ink bg-primary font-medium text-primary-ink" : "border-border-strong text-ink-2")}>{r}</button>
            ))}
          </div>
        </div>
        <div>
          <span id="waste-when" className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">When</span>
          <div role="radiogroup" aria-labelledby="waste-when" className="grid grid-cols-2 gap-2">
            {([["today", "Today"], ["yesterday", "Yesterday"]] as const).map(([w, label]) => (
              <button key={w} type="button" role="radio" aria-checked={when === w} onClick={() => setWhen(w)} className={cx("h-11 rounded-xl border px-2 text-sm transition-[background-color,border-color,color] duration-120", when === w ? "border-ink bg-primary font-medium text-primary-ink" : "border-border-strong text-ink-2")}>{label}</button>
            ))}
          </div>
          {when === "yesterday" && <p className="mt-1.5 text-xs text-muted">Logged against yesterday, for waste from last night&apos;s close.</p>}
        </div>
        {/* Stays in thumb reach while the form is taller than the screen. */}
        <div className="sticky bottom-[var(--tabbar)] z-10 -mx-5 -mb-5 rounded-b-xl bg-gradient-to-t from-surface from-70% to-transparent px-5 pt-5 pb-5 lg:bottom-0">
          <Button variant="primary" size="lg" className="h-13 w-full rounded-xl text-base shadow-[0_6px_20px_-6px_rgb(0_0_0/0.35)]" >Log waste</Button>
        </div>
      </form>
    </Card>
  );
}

/** Remove a waste entry (own entries for 15 minutes; managers any time). */
export function DeleteWasteButton({ id, label }: { id: string; label: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        aria-label={`Remove ${label}`}
        onClick={async () => {
          if (!(await confirm({ title: "Remove this entry?", body: label, confirmLabel: "Remove", danger: true }))) return;
          start(async () => { const res = await deleteWaste(id); setError(res.error ?? null); });
        }}
        className="relative grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-bad active:bg-surface-2 disabled:opacity-50 sm:size-8"
      >
        <Trash2 className="size-4" strokeWidth={1.75} />
      </button>
      {error && <span role="alert" className="mt-1 max-w-48 text-right text-xs text-bad">{error}</span>}
    </span>
  );
}
