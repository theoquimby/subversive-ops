"use client";

/**
 * Tap an item on the count sheet (or in Count setup) to see what it is: photo,
 * item numbers, packs, where it lives, last count and how to count it.
 * Managers can change all of that here without leaving the count.
 */

import { Badge, Button, cx, Input, Select, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/dialog";
import { compressImage } from "../invoices/compress";
import { toBase, STANDARD_UNITS_BY_BASE } from "@/domain/units";
import { shortDate } from "@/lib/format";
import type { CountItem } from "@/server/services/counts";
import { Camera, ChevronDown, ChevronUp, ImageUp, Star, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { COUNT_EVERY } from "@/domain/countPlan";
import { addCountUnit, setCountEvery, setExtraHomeAreas, moveCountItem, removeItemPhoto, retireCountItem, setAllowedUnits, setCountItemArea, setCountNote, setDefaultCountUnit, uploadItemPhoto } from "./setup-actions";

/** Item numbers made up on import aren't worth showing. */
export const realSku = (sku: string) => !/^(import|misc)-/i.test(sku);

/** "6/#10 · Driscoll #300601" for the count row. */
export function packLine(item: Pick<CountItem, "packs" | "category" | "kind">): string {
  const p = item.packs[0];
  if (item.kind === "prep") return "Prep · made in house";
  if (!p) return item.category;
  const bits = [p.packText || p.description, `${p.supplier}${realSku(p.sku) ? ` #${p.sku}` : ""}`];
  return bits.join(" · ") + (item.packs.length > 1 ? ` · +${item.packs.length - 1} more` : "");
}

/** A base quantity shown in one of the item's units: 13608 g → "1 case". */
export function inUnit(base: number, unit: string, item: Pick<CountItem, "base" | "conversions">): string {
  try {
    return `${Number((base / toBase(1, unit, item.base, item.conversions)).toFixed(2))} ${unit}`;
  } catch {
    return `${Number(base.toFixed(2))} ${item.base}`;
  }
}

export function Sheet({ title, onClose, children, label }: { title: ReactNode; label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <div className="dialog-panel dialog-sheet max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0 text-base font-semibold leading-tight">{title}</div>
          <Button variant="ghost" size="sm" className="-mr-2 size-10 shrink-0 p-0" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
        </div>
        <div className="px-4 pt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const Label = ({ children }: { children: ReactNode }) => <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h3>;

export function ItemSheet({ item, manager, onClose, onTellManager, areas, setup }: {
  item: CountItem;
  manager: boolean;
  onClose: () => void;
  /** Staff: open the "tell the manager" note. */
  onTellManager?: () => void;
  /** Count setup: area picker, shelf order and retire. */
  areas?: string[];
  setup?: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(item.countNote ?? "");
  const [savedNote, setSavedNote] = useState(item.countNote ?? "");
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const [newUnit, setNewUnit] = useState({ name: "", amount: "", unit: item.allUnits.find((u) => STANDARD_UNITS_BY_BASE[item.base].includes(u)) ?? item.base });
  const allowed = item.allowed.length ? item.allowed : item.allUnits;
  const limited = item.allowed.length > 0;

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else { after?.(); router.refresh(); }
    });

  const pick = (f: File | undefined) => {
    if (!f) return;
    start(async () => {
      setError(null);
      try {
        const small = await compressImage(f, { maxSide: 900, quality: 0.8 });
        const fd = new FormData();
        fd.set("key", item.id);
        fd.set("file", small);
        const r = await uploadItemPhoto(fd);
        if (r.error) setError(r.error);
        else router.refresh();
      } catch {
        setError("Couldn't read that photo.");
      }
      if (camera.current) camera.current.value = "";
      if (upload.current) upload.current.value = "";
    });
  };

  const toggleUnit = (u: string) => {
    const cur = limited ? item.allowed : [];
    const next = cur.includes(u) ? cur.filter((x) => x !== u) : [...cur, u];
    run(() => setAllowedUnits(item.id, next));
  };

  return (
    <Sheet title={<>{item.name}<div className="mt-0.5 text-xs font-normal text-muted">{item.area} · {item.category}</div></>} label={item.name} onClose={onClose}>
      <div className="space-y-5 pb-2">
        <section>
          {item.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photoUrl} alt={`Photo of ${item.name}`} className="aspect-[4/3] w-full rounded-xl bg-surface-2 object-cover ring-1 ring-border" />
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-surface-2 text-sm text-muted ring-1 ring-border ring-inset">{manager ? "No photo yet. Add one so anyone can spot it." : "No photo yet."}</div>
          )}
          {manager && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" className="h-10" disabled={pending} onClick={() => camera.current?.click()}><Camera className="size-4" /> {item.photoUrl ? "Retake" : "Take photo"}</Button>
              <Button size="sm" variant="ghost" className="h-10" disabled={pending} onClick={() => upload.current?.click()}><ImageUp className="size-4" /> Upload</Button>
              {item.photoUrl && <Button size="sm" variant="ghost" className="ml-auto h-10 text-muted hover:text-bad" disabled={pending} onClick={async () => { if (await confirm({ title: "Remove this photo?", confirmLabel: "Remove", danger: true })) run(() => removeItemPhoto(item.id)); }} aria-label="Remove photo"><Trash2 className="size-4" /></Button>}
              <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
              <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp,image/heic" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
            </div>
          )}
        </section>

        <section>
          <Label>How to count this</Label>
          {manager ? (
            <>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Count full jugs only. Open jug goes in the line fridge, not here." className="min-h-16 text-base sm:text-sm" aria-label="How to count this" maxLength={600} />
              {note.trim() !== savedNote.trim() && <Button size="sm" variant="primary" className="mt-2 h-10" disabled={pending} onClick={() => run(() => setCountNote(item.id, note), () => setSavedNote(note))}>Save note</Button>}
            </>
          ) : (
            <p className={cx("text-sm", item.countNote ? "text-ink" : "text-muted")}>{item.countNote || "No notes. Count what's on the shelf."}</p>
          )}
        </section>

        <section>
          <Label>{item.kind === "prep" ? "House-made" : "Item numbers and packs"}</Label>
          {item.kind === "prep" ? <p className="text-sm text-muted">Made in house. Valued at recipe cost; the prep list uses this count for what&apos;s on hand.</p> : item.packs.length === 0 ? <p className="text-sm text-muted">Not linked to a supplier product.</p> : (
            <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
              {item.packs.map((p, i) => (
                <li key={i} className="px-3 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.supplier}{realSku(p.sku) && <span className="num ml-1.5 font-normal text-ink-2">#{p.sku}</span>}</span>
                    {p.preferred && item.packs.length > 1 && <Badge>Usual</Badge>}
                  </div>
                  <div className="text-xs text-muted">{p.description}{p.packText ? ` · ${p.packText}` : ""} · bought by the {p.purchaseUnit}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <Label>{manager ? "Count units" : "Count in"}</Label>
          {manager && <p className="mb-2 text-xs text-muted">{limited ? "Staff can only use the units ticked." : "Staff can use any of these. Tap units to limit them."} The star is the default.</p>}
          <div className="flex flex-wrap gap-1.5">
            {(manager ? item.allUnits : item.units).map((u) => {
              const on = manager ? (limited ? item.allowed.includes(u) : false) : true;
              const isDefault = u === item.units[0];
              return manager ? (
                <span key={u} className={cx("inline-flex h-9 items-center overflow-hidden rounded-full border text-sm", on ? "border-ink bg-ink text-surface" : "border-border text-ink-2")}>
                  <button type="button" className="h-full pr-1 pl-3" onClick={() => toggleUnit(u)} disabled={pending} aria-pressed={on} title={item.unitNotes[u]}>{u}</button>
                  <button type="button" className={cx("grid h-full w-8 place-items-center", isDefault ? "" : "opacity-40 hover:opacity-100")} onClick={() => !isDefault && run(() => setDefaultCountUnit(item.id, u))} disabled={pending} aria-label={isDefault ? `${u} is the default` : `Make ${u} the default`} aria-pressed={isDefault}>
                    <Star className={cx("size-3.5", isDefault && "fill-current")} />
                  </button>
                </span>
              ) : (
                <span key={u} className="inline-flex h-8 items-center rounded-full border border-border px-3 text-sm text-ink-2" title={item.unitNotes[u]}>{u}{item.unitNotes[u] && <span className="ml-1.5 text-xs text-muted">{item.unitNotes[u]}</span>}</span>
              );
            })}
          </div>
          {!manager && allowed.length > 1 && <p className="mt-2 text-xs text-muted">Got some of each? Pick “Add another unit” in the unit list, e.g. 2 jug + 3 can.</p>}
          {manager && (
            <form className="mt-3 flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); run(() => addCountUnit(item.id, newUnit.name, Number(newUnit.amount), newUnit.unit), () => setNewUnit((v) => ({ ...v, name: "", amount: "" }))); }}>
              <span className="text-muted">1</span>
              <Input value={newUnit.name} onChange={(e) => setNewUnit((v) => ({ ...v, name: e.target.value }))} placeholder={item.kind === "prep" ? "1/3 pan" : "jug"} className="h-10 w-24 text-base sm:text-sm" aria-label="New unit name" />
              <span className="text-muted">=</span>
              <Input value={newUnit.amount} onChange={(e) => setNewUnit((v) => ({ ...v, amount: e.target.value }))} type="number" inputMode="decimal" step="any" min={0} placeholder={item.kind === "prep" ? "30" : "114"} className="num h-10 w-20 text-right text-base sm:text-sm" aria-label="Amount in one" />
              <Select value={newUnit.unit} onChange={(e) => setNewUnit((v) => ({ ...v, unit: e.target.value }))} options={item.allUnits.map((u) => ({ value: u, label: u }))} className="!h-10 !w-28" aria-label="Amount unit" />
              <Button size="sm" className="h-10" disabled={pending || !newUnit.name.trim() || !(Number(newUnit.amount) > 0)}>Add unit</Button>
            </form>
          )}
        </section>

        <section>
          <Label>Last count</Label>
          <p className="text-sm">{item.last ? <><span className="num">{inUnit(item.last.qtyBase, item.units[0], item)}</span> <span className="text-muted">· {shortDate(item.last.at.slice(0, 10))}</span></> : <span className="text-muted">Not counted yet.</span>}</p>
        </section>

        {manager && (
          <section>
            <Label>How often</Label>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="How often it's counted">
              {COUNT_EVERY.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={item.every === o.value} disabled={pending} onClick={() => item.every !== o.value && run(() => setCountEvery(item.id, o.value))}
                  className={cx("min-h-11 rounded-xl border px-2 py-1.5 text-sm leading-tight transition-colors", item.every === o.value ? "border-ink bg-ink text-surface" : "border-border text-ink-2 hover:border-border-strong")}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">{COUNT_EVERY.find((o) => o.value === item.every)?.hint}{item.every !== "every" && !item.due ? " Not due this time." : ""}</p>
          </section>
        )}

        {setup && manager && areas && (
          <section>
            <Label>Where it lives</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={item.area} options={[...areas.map((a) => ({ value: a, label: a })), ...(item.kind === "prep" ? [{ value: "", label: "Not on the count" }] : [])]} onChange={(e) => run(() => setCountItemArea(item.id, e.target.value))} className="!h-10 min-w-40 flex-1" aria-label="Storage area" />
              <Button size="sm" variant="ghost" className="size-10 p-0" disabled={pending} onClick={() => run(() => moveCountItem(item.id, -1))} aria-label="Move up the shelf"><ChevronUp className="size-4" /></Button>
              <Button size="sm" variant="ghost" className="size-10 p-0" disabled={pending} onClick={() => run(() => moveCountItem(item.id, 1))} aria-label="Move down the shelf"><ChevronDown className="size-4" /></Button>
            </div>
          {item.area && areas.length > 1 && (
              <>
                <p className="mt-3 mb-1.5 text-xs text-muted">Also list it in (for opened ones, overflow):</p>
                <div className="flex flex-wrap gap-1.5">
                  {areas.filter((a) => a !== item.area).map((a) => {
                    const on = item.homeAreas.includes(a);
                    const extra = item.homeAreas.slice(1);
                    return <button key={a} type="button" aria-pressed={on} disabled={pending} onClick={() => run(() => setExtraHomeAreas(item.id, on ? extra.filter((x) => x !== a) : [...extra, a]))} className={cx("h-9 rounded-full border px-3 text-sm transition-colors", on ? "border-ink bg-ink text-surface" : "border-border text-ink-2 hover:border-border-strong")}>{a}</button>;
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {error && <p className="text-sm text-bad" role="alert">{error}</p>}

        {!manager && onTellManager && (
          <Button variant="ghost" className="h-11 w-full" onClick={onTellManager}>Something wrong or missing? Tell the manager</Button>
        )}
        {setup && manager && (
          <Button variant="ghost" className="h-11 w-full text-muted hover:text-bad" disabled={pending} onClick={async () => {
            if (await confirm({ title: `Take ${item.name} off the count?`, body: item.kind === "prep" ? "It stays on the menu and the prep list; it's just not counted here. You can add it back in Count setup." : "It's archived: off counts, ordering and the ingredient list. You can restore it from Ingredients.", confirmLabel: "Take off", danger: true })) run(() => retireCountItem(item.id), onClose);
          }}>Take off the count</Button>
        )}
      </div>
    </Sheet>
  );
}
