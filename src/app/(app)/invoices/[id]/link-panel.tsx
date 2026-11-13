"use client";

import { Badge, Button, Card, Select } from "@/components/ui";
import { ArrowRight, Check, Link2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptAllLinkSuggestions, acceptLinkSuggestion, updateLine } from "../actions";

export type LinkItem = {
  lineId: string;
  description: string;
  sku: string | null;
} & (
  | { kind: "product"; productLabel: string }
  | { kind: "create"; packText: string | null; purchaseUnit: string; packNote: string | null; ingredientId: string | null; ingredientName: string | null; newIngredientName: string }
);

const NEW = "";

/**
 * Lines that aren't linked to a product yet, each with the autopilot's best
 * guess: "same as this product?" or "new product for this ingredient". One tap
 * each, or accept them all.
 */
export function LinkPanel({ invoiceId, items, ingredients }: { invoiceId: string; items: LinkItem[]; ingredients: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  if (!items.length) return null;

  const all = () =>
    start(async () => {
      const r = await acceptAllLinkSuggestions(invoiceId, choice);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Done." });
      router.refresh();
    });
  const one = (item: LinkItem) =>
    start(async () => {
      const r = await acceptLinkSuggestion(invoiceId, item.lineId, item.kind === "create" && item.lineId in choice ? choice[item.lineId] : undefined);
      if (r.error) setMsg({ ok: false, text: r.error });
      router.refresh();
    });
  const notProduct = (item: LinkItem) =>
    start(async () => {
      await updateLine(item.lineId, { field: "kind", value: "fee" });
      router.refresh();
    });

  const creates = items.filter((i) => i.kind === "create").length;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[0.95rem] font-semibold"><Sparkles className="size-4 text-muted" />{items.length} line{items.length === 1 ? "" : "s"} to link</div>
          <p className="mt-0.5 text-sm text-muted">{creates ? `${creates} new to you — they're added as products so next time they link by themselves.` : "These look like products you already buy."}</p>
        </div>
        <Button variant="primary" disabled={pending} onClick={all} className="max-sm:w-full max-sm:h-11"><Check className="size-4" />Accept all</Button>
      </div>
      {msg && <div className={msg.ok ? "px-4 pt-2 text-sm text-good" : "px-4 pt-2 text-sm text-bad"}>{msg.text}</div>}
      <div className="divide-y divide-border">
        {items.map((item) => {
          const chosen = item.kind === "create" ? (item.lineId in choice ? choice[item.lineId] : item.ingredientId ?? NEW) : null;
          return (
            <div key={item.lineId} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.description}</div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                  {item.sku && <span>#{item.sku}</span>}
                  <ArrowRight className="size-3" />
                  {item.kind === "product" ? (
                    <span>Same as <span className="font-medium text-ink-2">{item.productLabel}</span>?</span>
                  ) : (
                    <>
                      <Badge>New product</Badge>
                      {item.packText && <span>{item.packText}{item.packNote ? ` = ${item.packNote}` : ""}</span>}
                      <span>per {item.purchaseUnit}</span>
                    </>
                  )}
                </div>
                {item.kind === "create" && (
                  <div className="mt-2 max-w-sm">
                    <Select
                      value={chosen ?? NEW}
                      searchable
                      aria-label={`Ingredient for ${item.description}`}
                      onChange={(e) => setChoice((c) => ({ ...c, [item.lineId]: e.target.value }))}
                      options={[
                        { value: NEW, label: `New ingredient: ${item.newIngredientName}` },
                        ...(item.ingredientId ? [{ value: item.ingredientId, label: item.ingredientName ?? "Suggested", hint: "suggested" }] : []),
                        ...ingredients.filter((o) => o.value !== item.ingredientId),
                      ]}
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2 sm:justify-end">
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => notProduct(item)} className="max-sm:h-10 max-sm:flex-1">Not a product</Button>
                <Button size="sm" disabled={pending} onClick={() => one(item)} className="max-sm:h-10 max-sm:flex-1"><Link2 className="size-3.5" />{item.kind === "product" ? "Link" : "Add"}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
