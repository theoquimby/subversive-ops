"use client";

import { useConfirm } from "@/components/dialog";
import { Badge, Button, cx, Table, Td, Th, Tr } from "@/components/ui";
import type { PriceDrift } from "@/domain/squareMenu";
import { money } from "@/lib/format";
import { Check, Minus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { acceptSuggestions, createRecipesFromSquare, ignoreItems, applySquarePrices } from "./actions";

type Msg = { error?: string; message?: string } | null;

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <span role="status" className={cx("text-sm", msg.error ? "text-bad" : "text-good")}>{msg.error ?? msg.message}</span>;
}

/** App-styled checkbox (40px touch target on phones). */
function Tick({ checked, mixed, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={mixed ? "mixed" : checked} aria-label={label} onClick={onChange} className="-m-2 inline-flex size-10 items-center justify-center sm:size-8">
      <span className={cx("inline-flex size-[18px] items-center justify-center rounded-[5px] border transition-colors", checked || mixed ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface")}>
        {mixed ? <Minus className="size-3" strokeWidth={3} /> : checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

const pctLabel = (c: number) => `${Math.round(c * 100)}%`;

// ---- Suggestions ------------------------------------------------------------------------

export function SuggestionTable({ rows }: { rows: { squareId: string; squareName: string; recipeId: string; recipeName: string; confidence: number; price: number | null; modifier: boolean }[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const accept = (list: typeof rows) =>
    start(async () => {
      setMsg(await acceptSuggestions(list.map((r) => ({ squareId: r.squareId, recipeId: r.recipeId }))));
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={pending} onClick={() => accept(rows)}>Accept all {rows.length} suggestions</Button>
        <Note msg={msg} />
      </div>
      <Table>
        <thead>
          <tr><Th>Square item</Th><Th>Recipe</Th><Th align="right" className="hidden sm:table-cell">Match</Th><Th className="w-24" /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.squareId}>
              <Td>
                <div className="font-medium">{r.squareName}</div>
                <div className="text-xs text-muted">{r.modifier ? "Modifier" : "Item"}{r.price != null && ` · ${money(r.price)}`}</div>
              </Td>
              <Td className="text-ink-2">{r.recipeName}</Td>
              <Td align="right" className={cx("hidden sm:table-cell", r.confidence >= 0.9 ? "text-good" : "text-ink-2")}>{pctLabel(r.confidence)}</Td>
              <Td align="right"><Button size="sm" disabled={pending} onClick={() => accept([r])}>Accept</Button></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

// ---- Create ---------------------------------------------------------------------------------

export function CreateList({ rows }: { rows: { squareId: string; name: string; price: number | null; category: string | null; modifier: boolean; archived: boolean; known: boolean; suggested: boolean }[] }) {
  // Pre-pick live items without a suggested match.
  const [picked, setPicked] = useState(() => new Set(rows.filter((r) => !r.suggested && !r.archived).map((r) => r.squareId)));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const router = useRouter();
  const all = picked.size === rows.length;
  const some = picked.size > 0 && !all;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const list = useMemo(() => rows.filter((r) => picked.has(r.squareId)).map((r) => r.squareId), [rows, picked]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={pending || !list.length}
          onClick={async () => {
            const ok = await confirm({ title: `Create ${list.length} recipe${list.length === 1 ? "" : "s"}?`, body: "Each starts with Square's name, price and category and no ingredients yet.", confirmLabel: "Create" });
            if (ok) start(async () => { setMsg(await createRecipesFromSquare(list)); setPicked(new Set()); router.refresh(); });
          }}
        >
          Create {list.length || ""} recipe{list.length === 1 ? "" : "s"}
        </Button>
        <Button
          variant="ghost"
          disabled={pending || !list.length}
          onClick={() => start(async () => { setMsg(await ignoreItems(list)); setPicked(new Set()); router.refresh(); })}
        >
          Ignore selected
        </Button>
        <Note msg={msg} />
      </div>
      <Table>
        <thead>
          <tr>
            <Th className="w-10"><Tick checked={all} mixed={some} label="Select all" onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.squareId)))} /></Th>
            <Th>Square item</Th>
            <Th className="hidden sm:table-cell">Category</Th>
            <Th align="right">Price</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.squareId} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) toggle(r.squareId); }}>
              <Td><Tick checked={picked.has(r.squareId)} label={`Select ${r.name}`} onChange={() => toggle(r.squareId)} /></Td>
              <Td>
                <div className="font-medium">{r.name}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {r.modifier ? "Becomes an add-on" : "Becomes a menu item"}
                  {r.suggested && <Badge>has a suggested match</Badge>}
                  {r.archived && <Badge tone="warn">archived in Square</Badge>}
                  <span className="sm:hidden">{r.category ? `· ${r.category}` : ""}</span>
                </div>
              </Td>
              <Td className="hidden text-ink-2 sm:table-cell">{r.category ?? <span className="text-muted">—</span>}</Td>
              <Td align="right" className="text-ink-2">{r.price == null ? <span className="text-muted">{r.known ? "varies" : "—"}</span> : money(r.price)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

// ---- Price drift ------------------------------------------------------------------------------

export function DriftTable({ rows }: { rows: PriceDrift[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const safe = rows.filter((r) => !r.conflict);
  const apply = (list: PriceDrift[]) =>
    start(async () => {
      setMsg(await applySquarePrices(list.map((r) => ({ recipeId: r.recipeId, price: r.squarePrice }))));
      router.refresh();
    });
  return (
    <div className="space-y-3">
      {safe.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending} onClick={() => apply(safe)}>Use Square prices for all {safe.length}</Button>
          <Note msg={msg} />
        </div>
      )}
      <Table>
        <thead>
          <tr><Th>Item</Th><Th align="right">Square</Th><Th align="right">Menu price</Th><Th align="right" className="hidden sm:table-cell">Difference</Th><Th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.squareId}>
              <Td>
                <div className="font-medium">{r.recipeName}</div>
                <div className="text-xs text-muted">Square: {r.squareName}{r.conflict && " · several Square prices, pick by hand"}</div>
              </Td>
              <Td align="right" className="font-medium">{money(r.squarePrice)}</Td>
              <Td align="right" className="text-ink-2">{money(r.menuPrice)}</Td>
              <Td align="right" className={cx("hidden sm:table-cell", r.diff == null ? "text-muted" : r.diff > 0 ? "text-good" : "text-bad")}>{r.diff == null ? "not set" : `${r.diff > 0 ? "+" : "−"}${money(Math.abs(r.diff))}`}</Td>
              <Td align="right"><Button size="sm" disabled={pending} onClick={() => apply([r])} aria-label={`Use Square price for ${r.recipeName}`}><span className="sm:hidden">Use</span><span className="hidden sm:inline">Use Square price</span></Button></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {safe.length <= 1 && <Note msg={msg} />}
    </div>
  );
}
