"use client";

import { Badge, Button, Card, cx, Field, Select } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { packTradeoff, type OrderSuggestion } from "@/domain/ordering";
import { orderWarnings } from "@/domain/orderGuards";
import { useConfirm } from "@/components/dialog";
import { dayDate, money, qty, shortDate } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { DataTable, type Column, type Filter } from "@/components/data-table";
import { createOrder } from "../actions";
import { HelpTip, HelpZone } from "@/components/help";

type Line = OrderSuggestion & { onHandNote: string; why?: string };

const STATUS_LABEL: Record<Line["status"], string> = { "runs-out": "Runs out first", order: "To order", "needs-count": "Needs a count", "needs-setup": "Needs pack size", covered: "Covered" };
const packs = (base: number, l: Line) => (l.packQtyBase ? base / l.packQtyBase : null);
const cover = (d: number) => (d >= 30 ? "30+ days" : d < 1 ? "under a day" : `${qty(d, d < 10 ? 1 : 0)} day${Math.round(d * 10) === 10 ? "" : "s"}`);

/** − qty + (whole packs). */
function Stepper({ l, q, set }: { l: Line; q: number; set: (id: string, n: number) => void }) {
  const changed = q !== l.suggestedUnits;
  return (
    <div className="inline-flex flex-col items-end">
      <div className="inline-flex items-center rounded-lg border border-border-strong" data-tour="ordering.qty">
        <button type="button" className="h-9 w-9 text-ink-2 hover:bg-surface-2" onClick={() => set(l.ingredientId, q - 1)} aria-label="Less">−</button>
        <input
          inputMode="numeric"
          value={q}
          onChange={(e) => set(l.ingredientId, Number(e.target.value.replace(/\D/g, "")) || 0)}
          onFocus={(e) => e.target.select()}
          className={cx("num h-9 w-12 border-x border-border bg-transparent text-center text-base focus:outline-none sm:text-sm", changed && "font-semibold")}
          aria-label={`${l.ingredientName} quantity`}
        />
        <button type="button" className="h-9 w-9 text-ink-2 hover:bg-surface-2" onClick={() => set(l.ingredientId, q + 1)} aria-label="More">+</button>
      </div>
      {changed && <div className="mt-1 text-xs font-normal text-muted">suggested {l.suggestedUnits}</div>}
    </div>
  );
}

/** The line as ordered in another of its packs. */
function withPack(l: Line, id: string | undefined): Line {
  const o = id && id !== l.supplierProductId ? l.options?.find((x) => x.supplierProductId === id) : undefined;
  if (!o) return l;
  return { ...l, supplierProductId: o.supplierProductId, description: o.description, purchaseUnit: o.purchaseUnit, packQtyBase: o.packQtyBase, unitPrice: o.unitPrice, suggestedUnits: o.suggestedUnits, lineCost: o.lineCost };
}

/** Per-unit price people compare packs by: oz, fl oz, each. */
const COMPARE: Record<string, { unit: string; factor: number }> = { g: { unit: "oz", factor: 28.349523125 }, ml: { unit: "fl oz", factor: 29.5735295625 }, each: { unit: "ea", factor: 1 } };

/** Switch between the packs a supplier sells an item in, with price per oz and the trade-off. */
function PackPicker({ l, onPick }: { l: Line; onPick: (l: Line, id: string) => void }) {
  if (!l.options || l.options.length < 2) return null;
  const per = COMPARE[l.baseUnit ?? "each"];
  const note = packTradeoff(l.options, l.supplierProductId, per);
  return (
    <div className="mt-1.5 whitespace-normal" data-tour="ordering.packs" onClick={(e) => e.stopPropagation()}>
      <Select
        value={l.supplierProductId}
        onChange={(e) => onPick(l, e.target.value)}
        options={l.options.map((o) => ({ value: o.supplierProductId, label: `${o.purchaseUnit}${o.packText ? ` · ${o.packText}` : ""}`, hint: `${o.costPerBase != null ? `${money(o.costPerBase * per.factor)}/${per.unit}` : "no price"}${o.suggestedUnits ? ` · need ${o.suggestedUnits}` : ""}` }))}
        className="!h-9 !w-full max-w-60 text-xs"
        aria-label={`Pack to order ${l.ingredientName} in`}
      />
      {note && <div className="mt-1 text-xs leading-snug text-ink-2 [overflow-wrap:anywhere]">{note}</div>}
    </div>
  );
}

export function OrderBuilder(props: {
  supplierId: string;
  deliveryDate: string;
  coverUntil: string;
  deliveryOptions: string[];
  minOrder: number | null;
  problems: string[];
  lines: Line[];
  /** Usual quantity per supplier product (middle of recent orders), for the "far above usual" check. */
  usual?: Record<string, number | null>;
  /** Minutes to this delivery's cutoff (negative once passed). */
  minsToCutoff?: number | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [qtys, setQtys] = useState<Record<string, number>>(() => Object.fromEntries(props.lines.map((l) => [l.ingredientId, l.suggestedUnits])));
  // Which pack each line is ordered in (starts on the one ordered last time).
  const [pack, setPack] = useState<Record<string, string>>(() => Object.fromEntries(props.lines.map((l) => [l.ingredientId, l.supplierProductId])));
  const rows = useMemo(() => props.lines.map((l) => withPack(l, pack[l.ingredientId])), [props.lines, pack]);
  const choosePack = (l: Line, id: string) => {
    const o = l.options?.find((x) => x.supplierProductId === id);
    if (!o) return;
    setPack((p) => ({ ...p, [l.ingredientId]: id }));
    setQtys((q) => ({ ...q, [l.ingredientId]: o.suggestedUnits }));
  };
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total = rows.reduce((s, l) => s + (qtys[l.ingredientId] ?? 0) * (l.unitPrice ?? 0), 0);
  const ordering = rows.filter((l) => (qtys[l.ingredientId] ?? 0) > 0).length;
  const runsOut = rows.filter((l) => l.status === "runs-out");

  const setQ = (id: string, n: number) => setQtys((s) => ({ ...s, [id]: Math.max(0, n) }));
  const columns = useMemo<Column<Line>[]>(() => [
    {
      id: "item",
      header: "Item",
      width: 260,
      sort: (l) => l.ingredientName,
      csv: (l) => l.ingredientName,
      cell: (l) => (
        <div className={cx(l.status === "covered" && (qtys[l.ingredientId] ?? 0) === 0 && "opacity-60")}>
          <div className="font-medium text-ink">{l.ingredientName}</div>
          <div className="text-xs text-muted">{l.description} · {money(l.unitPrice)}/{l.purchaseUnit}</div>
          {l.why && <div className="text-xs text-ink-2">{l.why}</div>}
          <PackPicker l={l} onPick={choosePack} />
          {l.status === "needs-setup" && <span className="mt-1 flex items-center gap-1.5"><Badge tone="warn">Set pack size</Badge><HelpTip id="ordering.builder.needsSetup" /></span>}
          {l.status === "needs-count" && <span className="mt-1 flex items-center gap-1.5"><Badge tone="warn">Count to auto-order</Badge><HelpTip id="ordering.builder.needsCount" /></span>}
          {l.status === "runs-out" && <span className="mt-1 flex items-center gap-1.5"><Badge tone="bad">Runs out before delivery</Badge><HelpTip id="ordering.builder.runsOut" /></span>}
          {l.byPar && <span className="mt-1 flex items-center gap-1.5"><Badge>Min on hand</Badge><HelpTip id="ordering.builder.par" /></span>}
        </div>
      ),
    },
    { id: "status", header: "Status", defaultHidden: true, sort: (l) => STATUS_LABEL[l.status], csv: (l) => STATUS_LABEL[l.status], cell: (l) => <span className="text-ink-2">{STATUS_LABEL[l.status]}</span> },
    {
      id: "cover",
      header: "Days of cover",
      help: "ordering.builder.daysOfCover",
      align: "right",
      sort: (l) => (l.status === "needs-count" ? null : l.daysOfCover),
      csv: (l) => l.daysOfCover,
      cell: (l) => <span className={cx(l.status === "runs-out" ? "font-medium text-bad" : l.daysOfCover != null && l.daysOfCover < 3 ? "text-warn" : "")}>{l.status === "needs-count" ? <span className="text-muted">?</span> : l.daysOfCover == null ? <span className="text-muted">—</span> : cover(l.daysOfCover)}</span>,
    },
    {
      id: "onHand",
      header: <span data-tour="ordering.on-hand">On hand at delivery</span>,
      label: "On hand at delivery",
      help: "ordering.builder.onHand",
      align: "right",
      sort: (l) => packs(Math.max(0, l.projectedAtDelivery), l),
      csv: (l) => packs(Math.max(0, l.projectedAtDelivery), l),
      cell: (l) => (
        <>
          {l.status === "needs-count" ? <span className="text-muted">?</span> : packs(Math.max(0, l.projectedAtDelivery), l) == null ? "—" : `${qty(packs(Math.max(0, l.projectedAtDelivery), l), 1)} ${l.purchaseUnit}`}
          <div className="text-xs text-muted">{l.onHandNote.replace(/(\d{4}-\d{2}-\d{2})/, (d) => shortDate(d))}</div>
        </>
      ),
    },
    { id: "needed", header: "Needed", help: "ordering.builder.needed", align: "right", firstDir: "desc", sort: (l) => packs(l.neededForCover, l), csv: (l) => packs(l.neededForCover, l), cell: (l) => (packs(l.neededForCover, l) == null ? "—" : `${qty(packs(l.neededForCover, l), 1)} ${l.purchaseUnit}`) },
    { id: "order", header: "Order", align: "right", hideable: false, width: 150, firstDir: "desc", sort: (l) => qtys[l.ingredientId] ?? 0, csv: (l) => qtys[l.ingredientId] ?? 0, cell: (l) => <Stepper l={l} q={qtys[l.ingredientId] ?? 0} set={setQ} /> },
    { id: "cost", header: "Cost", align: "right", firstDir: "desc", sort: (l) => (qtys[l.ingredientId] ?? 0) * (l.unitPrice ?? 0), csv: (l) => (qtys[l.ingredientId] ?? 0) * (l.unitPrice ?? 0), cell: (l) => { const q = qtys[l.ingredientId] ?? 0; return q > 0 ? money(q * (l.unitPrice ?? 0)) : <span className="text-muted">—</span>; } },
  ], [qtys]);

  const filters = useMemo<Filter<Line>[]>(() => [
    { id: "status", label: "Status", kind: "facet", values: (l) => l.status, options: (Object.keys(STATUS_LABEL) as Line["status"][]).map((k) => ({ value: k, label: STATUS_LABEL[k] })) },
    { id: "hideCovered", label: "Hide covered", kind: "toggle", test: (l) => l.status !== "covered" || (qtys[l.ingredientId] ?? 0) > 0 },
    { id: "ordering", label: "On this order", kind: "toggle", test: (l) => (qtys[l.ingredientId] ?? 0) > 0 },
  ], [qtys]);

  const go = (delivery: string, until: string) => router.push(`?delivery=${delivery}&until=${until}`);

  return (
    <div className="pb-24">
      <HelpZone id="ordering.builder.window" className="mb-6"><Card className="grid gap-4 p-4 sm:grid-cols-3" data-tour="ordering.window">
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
      </Card></HelpZone>

      {props.problems.length > 0 && (
        <HelpZone id="ordering.builder.problems" className="mb-6"><Card className="border-warn/30 bg-warn-bg p-4 text-sm text-warn">
          <div className="flex items-center gap-1.5 font-medium">Some recipe lines couldn't be counted <HelpTip id="ordering.builder.problems" /></div>
          <ul className="mt-1 list-disc pl-5">{props.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul>
        </Card></HelpZone>
      )}

      {runsOut.length > 0 && (
        <HelpZone id="ordering.builder.runsOut" className="mb-6"><Card className="border-bad/30 bg-bad-bg p-4 text-sm text-bad">
          <div className="font-medium">
            {runsOut.length} item{runsOut.length === 1 ? " runs" : "s run"} out before this delivery arrives
          </div>
          <p className="mt-0.5 text-ink-2">{runsOut.slice(0, 4).map((l) => l.ingredientName).join(", ")}{runsOut.length > 4 ? ` and ${runsOut.length - 4} more` : ""}. They&apos;re on this order, but you&apos;ll need to borrow, buy locally or ask for an earlier drop to bridge the gap.</p>
        </Card></HelpZone>
      )}

      <HelpZone id="ordering.builder.lines">
        <DataTable
          id="order-builder"
          rows={rows}
          rowKey={(l) => l.ingredientId}
          columns={columns}
          noun={["item", "items"]}
          searchText={(l) => `${l.ingredientName} ${l.description}`}
          filters={filters}
          defaultView={{ filters: { hideCovered: ["1"] } }}
          csvName="order"
          maxHeight="calc(100dvh - 14rem)"
          summary={(vis) => [
            { value: vis.length, label: vis.length === 1 ? "item" : "items" },
            { value: vis.filter((l) => (qtys[l.ingredientId] ?? 0) > 0).length, label: "on this order", filter: { id: "ordering" } },
            { value: vis.filter((l) => l.status === "runs-out").length, label: "run out first", tone: "bad", filter: { id: "status", value: "runs-out" } },
            { value: vis.filter((l) => l.status === "needs-count" || l.status === "needs-setup").length, label: "need setup or a count", tone: "warn" },
          ]}
          card={(l) => ({
            title: l.ingredientName,
            subtitle: <>{l.description} · {money(l.unitPrice)}/{l.purchaseUnit}{l.status !== "order" && l.status !== "covered" && <span className={l.status === "runs-out" ? "text-bad" : "text-warn"}> · {STATUS_LABEL[l.status]}</span>}<PackPicker l={l} onPick={choosePack} /></>,
            value: <Stepper l={l} q={qtys[l.ingredientId] ?? 0} set={setQ} />,
          })}
        />
      </HelpZone>

      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <HelpZone id="ordering.builder.save" tour="ordering.save" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="text-sm">
            <span className="num font-semibold">{money(total)}</span>
            <span className="text-muted"> · {ordering} item{ordering === 1 ? "" : "s"}</span>
            {props.minOrder != null && total < props.minOrder && total > 0 && <span className="ml-2 text-warn">Below {money(props.minOrder, { whole: true })} minimum</span>}
            {error && <span className="ml-2 text-bad">{error}</span>}
          </div>
          <Button
            variant="primary"
            disabled={pending || ordering === 0}
            onClick={async () => {
              // Guard rails: far above the usual, or after the cutoff. Never blocks; asks for a second look.
              const warnings = orderWarnings({ lines: rows.map((l) => ({ name: l.ingredientName, qty: qtys[l.ingredientId] ?? 0, usual: props.usual?.[l.supplierProductId] ?? null, unit: l.purchaseUnit })), minsToCutoff: props.minsToCutoff ?? null });
              if (warnings.length && !(await confirm({ title: "Check before saving", body: <ul className="list-disc space-y-1 pl-4">{warnings.map((w) => <li key={w.text}>{w.text}</li>)}</ul>, confirmLabel: "Save anyway" }))) return;
              start(async () => {
              setError(null);
              const res = await createOrder({
                supplierId: props.supplierId,
                deliveryDate: props.deliveryDate,
                coverUntil: props.coverUntil,
                lines: rows.map((l) => ({ supplierProductId: l.supplierProductId, suggestedQty: l.suggestedUnits, qty: qtys[l.ingredientId] ?? 0, unitPrice: l.unitPrice })),
              });
              if (res?.error) setError(res.error);
              });
            }}
          >
            {pending ? "Saving…" : "Save order"}
          </Button>
        </HelpZone>
      </div>
    </div>
  );
}
