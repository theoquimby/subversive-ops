"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { Badge, Button, cx } from "@/components/ui";
import { BUCKETS, dayLabel, LEAD_REF_LABEL, orderBucket, type OrderBucket } from "@/domain/brewOrdering";
import { daysBetween } from "@/domain/dates";
import { qty, shortDate } from "@/lib/format";
import type { OrderLineView, OrderView } from "@/server/services/brewOrdering";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setPlacedAction } from "./actions";

type Row = OrderView & { bucket: OrderBucket };
const RANK = Object.fromEntries(BUCKETS.map((b, i) => [b.id, i])) as Record<OrderBucket, number>;
const LABEL = Object.fromEntries(BUCKETS.map((b) => [b.id, b.label])) as Record<OrderBucket, string>;

/** "3 sacks (150 lb)" or "80 lb". */
function suggest(l: OrderLineView): string {
  const amt = l.short != null ? `${qty(l.short, 1)} ${l.unit}` : "";
  if (l.packs && l.packUnit) return `${l.packs} ${l.packUnit}${l.packs === 1 || /s$/.test(l.packUnit) ? "" : "s"}${amt ? ` (${amt})` : ""}`;
  return amt;
}

function whatText(o: OrderView): string {
  if (o.labelsOnly) return "Labels";
  const short = o.lines.filter((l) => (l.short ?? 0) > 0);
  if (!short.length) return "All from stock";
  return short.map((l) => `${l.name} ${suggest(l)}`).join(", ");
}

function refText(o: OrderView, today: string): string {
  if (o.ref === "dryHop") return `for the dry hop ${dayLabel(today, o.refOn)}`;
  if (o.ref === "pkg") return `for packaging ${dayLabel(today, o.refOn)}`;
  return `brew day ${dayLabel(today, o.brewOn)}`;
}

function Placed({ o, today }: { o: OrderView; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!o.supplierId) return <span className="text-xs text-muted">Set a supplier</span>;
  const run = (placed: boolean) => start(async () => {
    setError(null);
    const r = await setPlacedAction(o.brewId, o.supplier, placed, today);
    if (r.error) setError(r.error);
    else router.refresh();
  });
  return (
    <div className="flex items-center justify-end gap-1.5">
      {error && <span role="alert" className="max-w-32 truncate text-xs text-bad" title={error}>{error}</span>}
      {o.placedOn ? (
        <>
          <Badge tone="good">Placed {shortDate(o.placedOn)}</Badge>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(false)} aria-label={`Mark the ${o.supplier} order for ${o.brewName} not placed`}>Undo</Button>
        </>
      ) : o.needsOrder ? (
        <Button size="sm" variant={o.overdue ? "primary" : "secondary"} disabled={pending} onClick={() => run(true)}>Mark placed</Button>
      ) : (
        <span className="text-xs text-muted">Nothing to order</span>
      )}
    </div>
  );
}

function OrderBy({ o, today }: { o: OrderView; today: string }) {
  const late = o.overdue ? daysBetween(o.orderBy, today) : 0;
  return (
    <span className={cx("num whitespace-nowrap", o.overdue ? "text-bad" : o.needsOrder && !o.placedOn && o.orderBy <= today ? "text-warn" : "text-ink")}>
      {dayLabel(today, o.orderBy).replace(/^./, (c) => c.toUpperCase())}
      {late > 0 && <span className="block text-[0.7rem]">{late} day{late === 1 ? "" : "s"} late</span>}
    </span>
  );
}

export function OrdersTable({ orders, today }: { orders: OrderView[]; today: string }) {
  const rows = useMemo<Row[]>(() => orders.map((o) => ({ ...o, bucket: orderBucket(o, today) })), [orders, today]);
  const columns = useMemo<Column<Row>[]>(() => [
    { id: "orderBy", header: "Order by", width: 120, hideable: false, firstDir: "asc", help: "brewery.ordering.orderBy", sort: (o) => o.orderBy, csv: (o) => o.orderBy, cell: (o) => <OrderBy o={o} today={today} /> },
    { id: "supplier", header: "Supplier", width: 170, sort: (o) => o.supplier, csv: (o) => o.supplier, cell: (o) => <span className={cx("font-medium", o.supplierId ? "text-ink" : "text-warn")}>{o.supplier}</span> },
    {
      id: "brew",
      header: "For",
      width: 190,
      sort: (o) => o.brewOn,
      csv: (o) => `${o.brewName} (${o.brewCode})`,
      cell: (o) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{o.brewName} <span className="text-xs text-muted">{o.brewCode}</span></div>
          <div className="truncate text-xs text-muted">{refText(o, today)}</div>
        </div>
      ),
    },
    { id: "what", header: "What to order", width: 280, csv: (o) => whatText(o), cell: (o) => <span className={cx("line-clamp-2 text-sm", o.needsOrder ? "text-ink-2" : "text-muted")}>{whatText(o)}</span> },
    {
      id: "stock",
      header: "From stock",
      width: 110,
      align: "right",
      help: "brewery.ordering.allocation",
      sort: (o) => o.lines.filter((l) => (l.short ?? 0) > 0).length,
      csv: (o) => o.lines.map((l) => `${l.name}: need ${qty(l.need, 1)} ${l.unit}, from stock ${qty(l.fromStock, 1)}`).join("; "),
      cell: (o) => {
        if (!o.lines.length) return <span className="text-muted">—</span>;
        const covered = o.lines.filter((l) => !((l.short ?? 0) > 0)).length;
        return <span className="num text-sm text-ink-2">{covered} of {o.lines.length}</span>;
      },
    },
    { id: "placed", header: <span className="sr-only">Placed</span>, label: "Placed", width: 190, align: "right", hideable: false, sort: (o) => o.placedOn, csv: (o) => o.placedOn ?? "", cell: (o) => <Placed o={o} today={today} /> },
  ], [today]);

  const filters = useMemo<Filter<Row>[]>(() => [
    { id: "needs", label: "Needs an order", kind: "toggle", test: (o) => o.needsOrder && !o.placedOn, tone: "warn" },
    { id: "late", label: "Late", kind: "toggle", test: (o) => o.overdue, tone: "bad" },
    { id: "supplier", label: "Supplier", kind: "facet", values: (o) => o.supplier },
    { id: "brew", label: "Brew", kind: "facet", values: (o) => o.brewName },
  ], []);

  const groups = useMemo<GroupBy<Row>[]>(() => [
    { id: "bucket", label: "When", key: (o) => o.bucket, title: (k) => LABEL[k as OrderBucket] ?? k, order: (a, b) => RANK[a as OrderBucket] - RANK[b as OrderBucket] },
    { id: "supplier", label: "Supplier", key: (o) => o.supplier },
    { id: "brew", label: "Brew", key: (o) => `${o.brewOn} ${o.brewName}`, title: (k) => `${k.slice(11)} · ${shortDate(k.slice(0, 10))}` },
  ], []);

  return (
    <DataTable
      id="brewery-ordering"
      help="brewery.ordering"
      rows={rows}
      rowKey={(o) => o.key}
      columns={columns}
      noun={["order", "orders"]}
      searchText={(o) => `${o.supplier} ${o.brewName} ${o.brewCode} ${o.lines.map((l) => l.name).join(" ")}`}
      searchPlaceholder="Search suppliers, brews, ingredients"
      filters={filters}
      groups={groups}
      defaultView={{ group: "bucket", sort: [{ id: "orderBy", dir: "asc" }], collapsed: ["placed", "covered"] }}
      csvName="brewery-orders"
      urlSearch={false}
      summary={(vis) => [
        { value: vis.filter((o) => o.overdue).length, label: "late", tone: "bad", filter: { id: "late" } },
        { value: vis.filter((o) => o.bucket === "thisWeek").length, label: "to place this week", tone: "warn" },
        { value: vis.filter((o) => o.bucket === "nextWeek").length, label: "next week" },
        { value: vis.filter((o) => o.placedOn).length, label: "placed" },
      ]}
      card={(o) => ({
        title: <>{o.supplier}</>,
        subtitle: <>{o.brewName} · {refText(o, today)}</>,
        value: <OrderBy o={o} today={today} />,
        sub: whatText(o),
      })}
      drawerTitle={(o) => `${o.supplier} for ${o.brewName}`}
      drawer={(o) => <OrderDrawer o={o} today={today} />}
      empty={<span>No planned brews with a recipe in the next 12 weeks. Plan one on the <Link href="/brewery/schedule" className="underline underline-offset-2">schedule</Link>.</span>}
    />
  );
}

function OrderDrawer({ o, today }: { o: Row; today: string }) {
  return (
    <div className="space-y-5 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-muted">Order by</dt><dd><OrderBy o={o} today={today} /></dd></div>
        <div><dt className="text-xs text-muted">Counted back from</dt><dd>{LEAD_REF_LABEL[o.ref]}, {shortDate(o.refOn)}</dd></div>
        <div><dt className="text-xs text-muted">Brew</dt><dd>{o.brewName} ({o.brewCode}), {shortDate(o.brewOn)}</dd></div>
        <div><dt className="text-xs text-muted">Status</dt><dd>{LABEL[o.bucket]}</dd></div>
      </dl>
      {o.labelsOnly ? (
        <p className="text-ink-2">Labels for this brew, ready before packaging on {shortDate(o.refOn)}.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-medium">Ingredient</th>
              <th className="py-1 text-right font-medium">Needs</th>
              <th className="py-1 text-right font-medium">From stock</th>
              <th className="py-1 text-right font-medium">Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {o.lines.map((l) => (
              <tr key={`${l.ingredientId}-${l.needOn}`}>
                <td className="py-1.5 pr-2">{l.name}{l.needOn !== o.brewOn && <span className="block text-xs text-muted">dry hop, {shortDate(l.needOn)}</span>}</td>
                <td className="num py-1.5 text-right">{qty(l.need, 1)} {l.unit}</td>
                <td className="num py-1.5 text-right text-ink-2">{qty(l.fromStock, 1)}</td>
                <td className={cx("num py-1.5 text-right", (l.short ?? 0) > 0 ? "font-medium text-ink" : "text-muted")}>{(l.short ?? 0) > 0 ? suggest(l) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">Stock goes to planned brews in the order they need it, so an earlier brew is covered first. Packs round up to whole ones when the supplier&apos;s pack size is known.</p>
      <Placed o={o} today={today} />
    </div>
  );
}
