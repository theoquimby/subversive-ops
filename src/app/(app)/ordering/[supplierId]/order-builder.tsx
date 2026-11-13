"use client";

import { Badge, Button, Card, cx, Field, Select } from "@/components/ui";
import { addDays } from "@/domain/dates";
import type { OrderSuggestion } from "@/domain/ordering";
import { dayDate, money, qty, shortDate } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createOrder } from "../actions";
import { HelpTip } from "@/components/help";

type Line = OrderSuggestion & { onHandNote: string };

export function OrderBuilder(props: {
  supplierId: string;
  deliveryDate: string;
  coverUntil: string;
  deliveryOptions: string[];
  minOrder: number | null;
  problems: string[];
  lines: Line[];
}) {
  const router = useRouter();
  const [qtys, setQtys] = useState<Record<string, number>>(() => Object.fromEntries(props.lines.map((l) => [l.supplierProductId, l.suggestedUnits])));
  const [showCovered, setShowCovered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total = props.lines.reduce((s, l) => s + (qtys[l.supplierProductId] ?? 0) * (l.unitPrice ?? 0), 0);
  const ordering = props.lines.filter((l) => (qtys[l.supplierProductId] ?? 0) > 0).length;
  const visible = props.lines.filter((l) => showCovered || l.status !== "covered" || (qtys[l.supplierProductId] ?? 0) > 0);
  const hidden = props.lines.length - visible.length;

  const go = (delivery: string, until: string) => router.push(`?delivery=${delivery}&until=${until}`);
  const packs = (base: number, l: Line) => (l.packQtyBase ? base / l.packQtyBase : null);

  return (
    <div className="pb-24">
      <Card className="mb-6 grid gap-4 p-4 sm:grid-cols-3" data-tour="ordering.window">
        <Field label="Delivery">
          <Select value={props.deliveryDate} onChange={(e) => go(e.target.value, e.target.value >= props.coverUntil ? addDays(e.target.value, 7) : props.coverUntil)}>
            {props.deliveryOptions.map((d) => <option key={d} value={d}>{dayDate(d)}</option>)}
          </Select>
        </Field>
        <Field label="Order covers through">
          <Select value={props.coverUntil} onChange={(e) => go(props.deliveryDate, e.target.value)}>
            {Array.from({ length: 14 }, (_, i) => addDays(props.deliveryDate, i + 1)).map((d) => <option key={d} value={d}>{dayDate(addDays(d, -1))}</option>)}
          </Select>
        </Field>
        <div className="text-sm text-muted sm:pt-6" data-tour="ordering.formula">Quantities = forecast sales × recipes + buffer − stock you'll have on delivery day. <HelpTip id="ordering.builder.formula" /></div>
      </Card>

      {props.problems.length > 0 && (
        <Card className="mb-6 border-warn/30 bg-warn-bg p-4 text-sm text-warn">
          <div className="flex items-center gap-1.5 font-medium">Some recipe lines couldn't be counted <HelpTip id="ordering.builder.problems" /></div>
          <ul className="mt-1 list-disc pl-5">{props.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[0.75rem] text-muted">
              <th className="px-4 py-2.5 text-left font-medium">Item</th>
              <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell" data-tour="ordering.on-hand"><span className="inline-flex items-center gap-1">On hand at delivery <HelpTip id="ordering.builder.onHand" /></span></th>
              <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell"><span className="inline-flex items-center gap-1">Needed <HelpTip id="ordering.builder.needed" /></span></th>
              <th className="px-4 py-2.5 text-right font-medium">Order</th>
              <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Cost</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const q = qtys[l.supplierProductId] ?? 0;
              const changed = q !== l.suggestedUnits;
              return (
                <tr key={l.supplierProductId} className={cx("border-b border-border last:border-b-0", l.status === "covered" && q === 0 && "text-muted")}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{l.ingredientName}</div>
                    <div className="text-xs text-muted">{l.description} · {money(l.unitPrice)}/{l.purchaseUnit}</div>
                    {l.status === "needs-setup" && <span className="mt-1 flex items-center gap-1.5"><Badge tone="warn">Set pack size</Badge><HelpTip id="ordering.builder.needsSetup" /></span>}
                    {l.status === "needs-count" && <span className="mt-1 flex items-center gap-1.5"><Badge tone="warn">Count to auto-order</Badge><HelpTip id="ordering.builder.needsCount" /></span>}
                  </td>
                  <td className="num hidden px-4 py-3 text-right md:table-cell">
                    {l.status === "needs-count" ? <span className="text-muted">?</span> : packs(Math.max(0, l.projectedAtDelivery), l) == null ? "—" : `${qty(packs(Math.max(0, l.projectedAtDelivery), l), 1)} ${l.purchaseUnit}`}
                    <div className="text-xs text-muted">{l.onHandNote.replace(/(\d{4}-\d{2}-\d{2})/, (d) => shortDate(d))}</div>
                  </td>
                  <td className="num hidden px-4 py-3 text-right sm:table-cell">{packs(l.neededForCover, l) == null ? "—" : `${qty(packs(l.neededForCover, l), 1)} ${l.purchaseUnit}`}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center rounded-lg border border-border-strong" data-tour="ordering.qty">
                      <button type="button" className="h-9 w-9 text-ink-2 hover:bg-surface-2" onClick={() => setQtys((s) => ({ ...s, [l.supplierProductId]: Math.max(0, q - 1) }))} aria-label="Less">−</button>
                      <input
                        type="number" inputMode="numeric" min={0} step={1} value={q}
                        onChange={(e) => setQtys((s) => ({ ...s, [l.supplierProductId]: Math.max(0, e.target.valueAsNumber || 0) }))}
                        className={cx("num h-9 w-12 border-x border-border bg-transparent text-center text-sm focus:outline-none", changed && "font-semibold")}
                        aria-label={`${l.ingredientName} quantity`}
                      />
                      <button type="button" className="h-9 w-9 text-ink-2 hover:bg-surface-2" onClick={() => setQtys((s) => ({ ...s, [l.supplierProductId]: q + 1 }))} aria-label="More">+</button>
                    </div>
                    {changed && <div className="mt-1 text-xs text-muted">suggested {l.suggestedUnits}</div>}
                  </td>
                  <td className="num hidden px-4 py-3 text-right sm:table-cell">{q > 0 ? money(q * (l.unitPrice ?? 0)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hidden > 0 && (
          <button type="button" onClick={() => setShowCovered(true)} className="w-full border-t border-border px-4 py-2.5 text-left text-sm text-muted hover:text-ink">
            Show {hidden} item{hidden === 1 ? "" : "s"} you're covered on
          </button>
        )}
      </Card>

      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8" data-tour="ordering.save">
          <div className="text-sm">
            <span className="num font-semibold">{money(total)}</span>
            <span className="text-muted"> · {ordering} item{ordering === 1 ? "" : "s"}</span>
            {props.minOrder != null && total < props.minOrder && total > 0 && <span className="ml-2 text-warn">Below {money(props.minOrder, { whole: true })} minimum</span>}
            {error && <span className="ml-2 text-bad">{error}</span>}
          </div>
          <Button
            variant="primary"
            disabled={pending || ordering === 0}
            onClick={() => start(async () => {
              setError(null);
              const res = await createOrder({
                supplierId: props.supplierId,
                deliveryDate: props.deliveryDate,
                coverUntil: props.coverUntil,
                lines: props.lines.map((l) => ({ supplierProductId: l.supplierProductId, suggestedQty: l.suggestedUnits, qty: qtys[l.supplierProductId] ?? 0, unitPrice: l.unitPrice })),
              });
              if (res?.error) setError(res.error);
            })}
          >
            {pending ? "Saving…" : "Save order"}
          </Button>
        </div>
      </div>
    </div>
  );
}
