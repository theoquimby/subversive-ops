"use client";

import { useConfirm } from "@/components/dialog";
import { Button, Card, cx, Input, Select } from "@/components/ui";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addArea, removeArea, renameArea, reorderArea } from "./actions";

export interface AreaRow { name: string; items: number }

/**
 * Add, rename, reorder (walking order for counts) and remove storage areas.
 * Used on the Count page and in Settings → Storage areas.
 */
export function AreaManager({ areas, compact }: { areas: AreaRow[]; compact?: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) return setError(r.error);
      setError(null);
      after?.();
      router.refresh();
    });

  return (
    <Card className="overflow-hidden">
      <ol className="divide-y divide-border">
        {areas.map((a, i) => (
          <li key={a.name} className="px-4 py-3">
            {editing === a.name ? (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => renameArea(a.name, draft), () => setEditing(null)); }}>
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`New name for ${a.name}`} className="min-w-0 flex-1" autoFocus />
                <Button type="submit" variant="primary" disabled={pending || !draft.trim()} aria-label="Save name"><Check className="size-4" /></Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel"><X className="size-4" /></Button>
              </form>
            ) : removing === a.name ? (
              <div className="space-y-2">
                <div className="text-sm">Remove <b>{a.name}</b>?{a.items > 0 && <> Its {a.items} item{a.items === 1 ? "" : "s"} move to:</>}</div>
                <div className="flex flex-wrap gap-2">
                  {a.items > 0 && (
                    <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move items to" placeholder="Choose an area…" className="min-w-48 flex-1"
                      options={areas.filter((x) => x.name !== a.name).map((x) => ({ value: x.name, label: x.name }))} />
                  )}
                  <Button variant="danger" disabled={pending || (a.items > 0 && !moveTo)} onClick={() => run(() => removeArea(a.name, moveTo || null), () => { setRemoving(null); setMoveTo(""); })}>Remove</Button>
                  <Button variant="ghost" onClick={() => { setRemoving(null); setMoveTo(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="num w-5 shrink-0 text-xs text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{a.name}</div>
                  <Link href={`/ingredients?storage=${encodeURIComponent(a.name)}`} className="text-xs text-muted hover:text-ink">{a.items ? `${a.items} item${a.items === 1 ? "" : "s"}` : "Empty — put items here from Ingredients"}</Link>
                </div>
                <div className={cx("flex shrink-0 items-center", compact ? "gap-0" : "gap-0.5")}>
                  <Button size="sm" variant="ghost" className="size-9 p-0" disabled={pending || i === 0} onClick={() => run(() => reorderArea(a.name, -1))} aria-label={`Move ${a.name} up`}><ArrowUp className="size-4" /></Button>
                  <Button size="sm" variant="ghost" className="size-9 p-0" disabled={pending || i === areas.length - 1} onClick={() => run(() => reorderArea(a.name, 1))} aria-label={`Move ${a.name} down`}><ArrowDown className="size-4" /></Button>
                  <Button size="sm" variant="ghost" className="size-9 p-0" onClick={() => { setEditing(a.name); setDraft(a.name); setRemoving(null); }} aria-label={`Rename ${a.name}`}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" className="size-9 p-0 text-muted hover:text-bad" onClick={async () => {
                    if (a.items === 0) {
                      if (await confirm({ title: `Remove ${a.name}?`, body: "It's empty, so nothing moves.", confirmLabel: "Remove", danger: true })) run(() => removeArea(a.name, null));
                    } else { setRemoving(a.name); setEditing(null); }
                  }} aria-label={`Remove ${a.name}`}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <form className="flex gap-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); run(() => addArea(name), () => setName("")); }}>
        <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="New area, e.g. Beer cooler" aria-label="New area name" className="min-w-0 flex-1" />
        <Button type="submit" variant="primary" disabled={pending || !name.trim()}><Plus className="size-4" /> Add</Button>
      </form>
      {error && <p role="alert" className="px-4 pb-4 text-sm text-bad">{error}</p>}
      <p className="border-t border-border px-4 py-3 text-xs text-muted">The order here is the order you walk them — counts of “Everything” follow it.</p>
    </Card>
  );
}
